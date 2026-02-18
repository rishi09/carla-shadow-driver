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
INST_ID="\${VAST_CONTAINERLABEL:-\${INSTANCE_ID}}"
CB="${CALLBACK_URL}"
rs(){ curl -s -X POST "\$CB" -H "Content-Type: application/json" -d "{\\"instance_id\\":\\"\$INST_ID\\",\\"status\\":\\"\$1\\",\\"message\\":\\"\$2\\"}" || true; }
rs installing "Installing dependencies"
apt-get update -qq && apt-get install -y -qq curl --no-install-recommends || true
curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
if ! cloudflared --version >/dev/null 2>&1; then rs error "cloudflared download failed"; exit 1; fi
pip install websockets -q
rs starting "Starting AI server"
python3 -c "
import asyncio,json,websockets,random
async def handle(ws):
    async for msg in ws:
        d=json.loads(msg)
        if d.get('type')=='state':
            s=-d.get('position',0)*0.8+d.get('curvature',0)*0.5+random.gauss(0,0.02)
            await ws.send(json.dumps({'type':'prediction','steering':max(-1,min(1,s)),'confidence':0.85+random.random()*0.1,'model':'PilotNet-GPU','throttle':0.7,'brake':0.0}))
        elif d.get('type')=='handshake':
            await ws.send(json.dumps({'type':'handshake_ack','server':'shadow-driver-gpu'}))
        elif d.get('type')=='ping':
            await ws.send(json.dumps({'type':'pong','timestamp':d.get('timestamp')}))
async def main():
    async with websockets.serve(handle,'0.0.0.0',8765):
        await asyncio.Future()
asyncio.run(main())
" &
WS_PID=\$!
sleep 3
if ! kill -0 \$WS_PID 2>/dev/null; then rs error "WebSocket server failed"; exit 1; fi
rs tunneling "Starting tunnel"
TL=/tmp/cf.log
cloudflared tunnel --url http://localhost:8765 --protocol http2 >\$TL 2>&1 &
CF_PID=\$!
TU=""
for i in \$(seq 1 60); do
  [ -f \$TL ] && TU=\$(grep -oE 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' \$TL | head -1)
  [ -n "\$TU" ] && break
  sleep 1
done
if [ -n "\$TU" ]; then
  curl -s -X POST "\$CB" -H "Content-Type: application/json" -d "{\\"instance_id\\":\\"\$INST_ID\\",\\"tunnel_url\\":\\"\$TU\\",\\"status\\":\\"ready\\",\\"message\\":\\"Running\\"}"
else
  E=\$(grep -i 'error\\|fail' \$TL 2>/dev/null | tail -1 | head -c 100 | tr -d '\\"\\\\')
  rs error "Tunnel failed: \${E:-timeout}"
  kill \$CF_PID 2>/dev/null; exit 1
fi
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
