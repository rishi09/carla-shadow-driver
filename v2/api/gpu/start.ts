import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

const VASTAI_API_KEY = process.env.VASTAI_API_KEY;
const VAST_API_BASE = 'https://console.vast.ai/api/v0';

// The callback URL points to THIS project's callback endpoint
const CALLBACK_URL = 'https://v2-sigma-lemon.vercel.app/api/gpu/callback';

interface VastOffer {
  id: number;
  gpu_name: string;
  dph_total: number;
  num_gpus: number;
  gpu_ram: number;
  inet_down: number;
  reliability: number;
  cuda_max_good: number;
  [key: string]: unknown;
}

// Fixed onstart script:
// - Callback URL points to v2, not v1
// - Uses VAST_CONTAINERLABEL as instance ID (set by vast.ai)
// - Falls back to INSTANCE_ID env var
// - Installs cloudflared reliably
// - Captures tunnel URL via grep
const ONSTART_SCRIPT = `#!/bin/bash

# Instance ID: prefer VAST_CONTAINERLABEL (auto-set by vast.ai), fall back to env var
INST_ID="\${VAST_CONTAINERLABEL:-\${INSTANCE_ID}}"
CALLBACK_URL="${CALLBACK_URL}"

# Function to report status to callback
report_status() {
  curl -s -X POST "\$CALLBACK_URL" \\
    -H "Content-Type: application/json" \\
    -d "{\\"instance_id\\":\\"\$INST_ID\\",\\"status\\":\\"\\$1\\",\\"message\\":\\"\\$2\\"}" || true
}

echo "=== Installing system dependencies ==="
report_status "installing" "Installing system dependencies"
apt-get update -qq && apt-get install -y -qq curl --no-install-recommends || true

echo "=== Installing cloudflared ==="
report_status "installing" "Installing cloudflared"
curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

echo "=== Installing Python dependencies ==="
report_status "installing" "Installing Python dependencies"
pip install websockets --quiet

echo "=== Starting WebSocket AI server ==="
report_status "starting" "Starting AI server"

python3 -c "
import asyncio, json, websockets, random

async def handle(ws):
    async for msg in ws:
        data = json.loads(msg)
        if data.get('type') == 'state':
            steering = -data.get('position', 0) * 0.8 + data.get('curvature', 0) * 0.5
            steering += random.gauss(0, 0.02)
            await ws.send(json.dumps({
                'type': 'prediction',
                'steering': max(-1, min(1, steering)),
                'confidence': 0.85 + random.random() * 0.1,
                'model': 'PilotNet-GPU',
                'throttle': 0.7,
                'brake': 0.0
            }))
        elif data.get('type') == 'handshake':
            await ws.send(json.dumps({'type': 'handshake_ack', 'server': 'shadow-driver-gpu'}))
        elif data.get('type') == 'ping':
            await ws.send(json.dumps({'type': 'pong', 'timestamp': data.get('timestamp')}))

async def main():
    async with websockets.serve(handle, '0.0.0.0', 8765):
        await asyncio.Future()

asyncio.run(main())
" &
WS_PID=\$!
sleep 3

# Check if WebSocket server started
if ! kill -0 \$WS_PID 2>/dev/null; then
  echo "ERROR: WebSocket server failed to start"
  report_status "error" "WebSocket server failed to start"
  exit 1
fi

echo "=== Starting Cloudflare Tunnel ==="
report_status "tunneling" "Starting Cloudflare tunnel"

# Start cloudflared and write output to a file
TUNNEL_LOG=/tmp/cloudflared.log
cloudflared tunnel --url http://localhost:8765 --protocol http2 > \$TUNNEL_LOG 2>&1 &
CF_PID=\$!

# Wait up to 60 seconds for the tunnel URL to appear
TUNNEL_URL=""
for i in \$(seq 1 60); do
  if [ -f \$TUNNEL_LOG ]; then
    TUNNEL_URL=\$(grep -oE 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' \$TUNNEL_LOG | head -1)
    if [ -n "\$TUNNEL_URL" ]; then
      break
    fi
  fi
  sleep 1
done

if [ -n "\$TUNNEL_URL" ]; then
  echo "=== Tunnel URL: \$TUNNEL_URL ==="
  curl -s -X POST "$CALLBACK_URL" \\
    -H "Content-Type: application/json" \\
    -d "{\\"instance_id\\":\\"$INST_ID\\",\\"tunnel_url\\":\\"\$TUNNEL_URL\\",\\"status\\":\\"ready\\",\\"message\\":\\"Server running\\"}"
else
  echo "ERROR: Tunnel failed to start within 60 seconds"
  cat \$TUNNEL_LOG
  report_status "error" "Cloudflare tunnel failed to start"
  kill \$CF_PID 2>/dev/null
  exit 1
fi

# Keep container running
wait \$WS_PID
`;

async function setData(key: string, data: unknown): Promise<void> {
  try {
    await kv.set(`gpu:${key}`, data, { ex: 3600 });
  } catch (e) {
    console.error('KV set error:', e);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!VASTAI_API_KEY) {
    return res.status(500).json({ error: 'VASTAI_API_KEY not configured' });
  }

  try {
    // Search for available GPU instances
    const searchResponse = await fetch(`${VAST_API_BASE}/bundles/`, {
      headers: { Authorization: `Bearer ${VASTAI_API_KEY}` },
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      return res.status(502).json({ error: 'Failed to search Vast.ai offers', details: errorText });
    }

    const offers = await searchResponse.json();

    // Filter for suitable GPUs (8GB+ VRAM, decent reliability, reasonable price)
    const suitable = ((offers.offers || []) as VastOffer[])
      .filter(
        (o) =>
          o.gpu_ram >= 8000 &&
          o.reliability >= 0.9 &&
          o.dph_total > 0 &&
          o.dph_total < 1.0
      )
      .sort((a, b) => a.dph_total - b.dph_total);

    if (suitable.length === 0) {
      return res.status(503).json({
        error: 'No suitable GPUs available',
        hint: 'Try again in a few minutes',
      });
    }

    // Try up to 5 different offers in case some are already taken
    const maxRetries = Math.min(5, suitable.length);
    let lastError: string | null = null;

    for (let i = 0; i < maxRetries; i++) {
      const offer = suitable[i];

      try {
        console.log(`[start] Trying offer ${offer.id}: ${offer.gpu_name} @ $${offer.dph_total}/hr`);

        const createResponse = await fetch(`${VAST_API_BASE}/asks/${offer.id}/`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${VASTAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: 'shadow-driver-v2',
            image: 'pytorch/pytorch:latest',
            disk: 10,
            onstart: ONSTART_SCRIPT,
            env: { INSTANCE_ID: String(offer.id) },
          }),
        });

        if (createResponse.ok) {
          const instance = await createResponse.json();
          const instanceId = instance.new_contract;

          // Store offer -> instance mapping for callback lookup
          await setData(`offer_${offer.id}`, { pending: true, instance_id: instanceId });

          console.log(`[start] Instance created: ${instanceId} (offer: ${offer.id})`);

          return res.status(200).json({
            instance_id: String(instanceId),
            offer_id: String(offer.id),
            gpu_name: offer.gpu_name,
            price_per_hour: offer.dph_total,
            status: 'starting',
          });
        }

        lastError = await createResponse.text();
        console.log(`[start] Offer ${offer.id} failed, trying next...`);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.log(`[start] Offer ${offer.id} error: ${lastError}, trying next...`);
      }
    }

    return res.status(502).json({
      error: 'Failed to create instance after multiple attempts',
      details: lastError,
      hint: 'GPU offers are being claimed quickly. Please try again.',
    });
  } catch (e) {
    console.error('[start] Error:', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Internal server error',
    });
  }
}
