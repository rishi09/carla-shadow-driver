// Provisions a new GPU instance on Vast.ai
// Uses Upstash Redis for persistent storage across cold starts

import { Redis } from '@upstash/redis';

// Lazy initialization for Redis client
let redis = null;
let useRedis = false;
let initialized = false;

function initRedis() {
  if (initialized) return;
  initialized = true;

  // Check for Upstash env vars (both naming conventions)
  // When installed via Vercel Marketplace, Upstash uses KV_* naming for compatibility
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (url && token) {
    redis = new Redis({ url, token });
    useRedis = true;
    console.log('[Redis] Upstash Redis initialized');
  } else {
    console.warn('[Redis] No Upstash credentials found, using in-memory fallback');
  }
}

// In-memory fallback
if (!global.tunnelUrls) {
  global.tunnelUrls = {};
}

// Helper to set data in Redis or memory
async function setData(key, data) {
  initRedis();
  if (useRedis) {
    try {
      await redis.set(`gpu:${key}`, JSON.stringify(data), { ex: 3600 }); // 1 hour TTL
      console.log(`[Redis] Stored data for ${key}`);
    } catch (e) {
      console.error('Redis set error:', e);
      global.tunnelUrls[key] = data;
    }
  } else {
    console.warn('[WARN] Redis not configured, using in-memory (will lose data on cold start)');
    global.tunnelUrls[key] = data;
  }
}

export default async function handler(req, res) {
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

  // Initialize Redis on first request
  initRedis();

  const VASTAI_API_KEY = process.env.VASTAI_API_KEY;

  if (!VASTAI_API_KEY) {
    return res.status(500).json({ error: 'VASTAI_API_KEY not configured' });
  }

  try {
    // Search for available GPU instances
    const searchResponse = await fetch('https://console.vast.ai/api/v0/bundles', {
      headers: { 'Authorization': `Bearer ${VASTAI_API_KEY}` }
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      return res.status(502).json({ error: 'Failed to search Vast.ai offers', details: errorText });
    }

    const offers = await searchResponse.json();

    // Debug: Log sample of offers to understand verification field values
    const sampleOffers = (offers.offers || []).slice(0, 5).map(o => ({
      id: o.id,
      gpu_name: o.gpu_name,
      verified: o.verified,
      verification: o.verification,
      dph_total: o.dph_total,
      reliability: o.reliability
    }));
    console.log('[GPU Start] Sample offers:', JSON.stringify(sampleOffers));

    // Filter for suitable GPUs (16GB+ VRAM, not deverified, high reliability, reasonable price)
    // IMPORTANT: Exclude deverified hosts - they have broken GPU/Docker configs
    // verified can be: true (verified), false (deverified), undefined/null (unverified)
    // We exclude only explicitly deverified (verified === false), allowing unverified
    const suitable = (offers.offers || []).filter(o =>
      o.gpu_ram >= 16000 &&
      o.verified !== false &&       // Exclude deverified hosts (allow verified + unverified)
      o.reliability >= 0.95 &&      // High reliability threshold
      o.dph_total < 1.00            // Max $1.00/hr
    ).sort((a, b) => a.dph_total - b.dph_total);

    console.log('[GPU Start] Suitable offers count:', suitable.length);
    if (suitable.length > 0) {
      console.log('[GPU Start] First suitable:', JSON.stringify({
        id: suitable[0].id,
        gpu_name: suitable[0].gpu_name,
        verified: suitable[0].verified,
        reliability: suitable[0].reliability
      }));
    }

    if (suitable.length === 0) {
      return res.status(503).json({
        error: 'No suitable GPUs available',
        hint: 'Try again in a few minutes or adjust requirements'
      });
    }

    // Startup script that runs when the instance boots
    // Uses Cloudflare Tunnel for secure WebSocket access (no account required)
    // INSTANCE_ID is passed as environment variable for callback reporting
    // NOTE: Must be under 4048 chars for Vast.ai
    const onstart = `#!/bin/bash
set -e
CB="https://carla-shadow-driver.vercel.app/api/gpu/callback"
report() { curl -s -X POST "$CB" -H "Content-Type: application/json" -d "{\\"instance_id\\":\\"$INSTANCE_ID\\",\\"status\\":\\"$1\\",\\"message\\":\\"$2\\"}" || true; }
die() { report "error" "$1"; exit 1; }

report "installing" "Installing system dependencies"
apt-get update && apt-get install -y libgl1-mesa-glx libglib2.0-0 curl --no-install-recommends || die "apt-get failed"

report "installing" "Installing cloudflared"
curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared || die "cloudflared install failed"

report "installing" "Cloning repository"
cd /workspace && git clone https://github.com/rishi09/carla-shadow-driver.git && cd carla-shadow-driver || die "git clone failed"

report "installing" "Installing Python dependencies"
pip install 'numpy<2' && pip install -r requirements.txt || die "pip install failed"

report "installing" "Downloading model"
python scripts/download_model.py pilotnet || die "model download failed"

report "starting" "Starting WebSocket server"
python src/shadow_mode.py --websocket --port 5001 &
WS_PID=$!
sleep 5
kill -0 $WS_PID 2>/dev/null || die "WebSocket server failed to start"

report "tunneling" "Starting Cloudflare tunnel"
cloudflared tunnel --url http://localhost:5001 > /tmp/cf.log 2>&1 &
CF_PID=$!

for i in 1 2 3 4 5 6; do
  sleep 10
  kill -0 $CF_PID 2>/dev/null || die "cloudflared died"
  URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\\.trycloudflare\\.com' /tmp/cf.log | head -1)
  [ -n "$URL" ] && break
  report "tunneling" "Waiting for tunnel ($i/6)"
done

if [ -n "$URL" ]; then
  curl -s -X POST "$CB" -H "Content-Type: application/json" -d "{\\"instance_id\\":\\"$INSTANCE_ID\\",\\"tunnel_url\\":\\"$URL\\"}"
  report "ready" "Tunnel established"
else
  die "No tunnel URL after 60s"
fi

wait $WS_PID
`;

    // Try up to 5 different offers in case some are already taken
    const maxRetries = Math.min(5, suitable.length);
    let lastError = null;

    for (let i = 0; i < maxRetries; i++) {
      const offer = suitable[i];

      try {
        const createResponse = await fetch(`https://console.vast.ai/api/v0/asks/${offer.id}/`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${VASTAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            client_id: 'carla-shadow-driver',
            image: 'pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime',
            disk: 20,
            onstart: onstart,
            env: { INSTANCE_ID: offer.id.toString() }  // Pass offer ID as instance identifier
          })
        });

        if (createResponse.ok) {
          const instance = await createResponse.json();
          const instanceId = instance.new_contract;

          // Store the offer ID -> instance ID mapping in Redis for callback lookup
          await setData(`offer_${offer.id}`, { pending: true, instance_id: instanceId });

          return res.status(200).json({
            instance_id: instanceId,
            offer_id: offer.id,
            status: 'starting',
            gpu_name: offer.gpu_name,
            price_per_hour: offer.dph_total,
            estimated_ready: '2-3 minutes',
            using_redis: useRedis
          });
        }

        // If this offer failed, save error and try next
        lastError = await createResponse.text();
        console.log(`Offer ${offer.id} failed, trying next...`);

      } catch (e) {
        lastError = e.message;
        console.log(`Offer ${offer.id} error: ${e.message}, trying next...`);
      }
    }

    // All retries failed
    return res.status(502).json({
      error: 'Failed to create instance after multiple attempts',
      details: lastError,
      hint: 'GPU offers are being claimed quickly. Please try again.'
    });

  } catch (error) {
    console.error('Error provisioning GPU:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
