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

    // Filter for suitable GPUs (16GB+ VRAM, verified, high reliability, reasonable price)
    // IMPORTANT: Filter out deverified hosts which have broken GPU/Docker configs
    const suitable = (offers.offers || []).filter(o =>
      o.gpu_ram >= 16000 &&
      o.verified !== false &&     // Exclude explicitly deverified hosts
      o.reliability >= 0.95 &&    // Higher reliability threshold (was 0.90)
      o.dph_total < 1.00  // Max $1.00/hr
    ).sort((a, b) => a.dph_total - b.dph_total);

    if (suitable.length === 0) {
      return res.status(503).json({
        error: 'No suitable GPUs available',
        hint: 'Try again in a few minutes or adjust requirements'
      });
    }

    // Startup script that runs when the instance boots
    // Uses Cloudflare Tunnel for secure WebSocket access (no account required)
    // INSTANCE_ID is passed as environment variable for callback reporting
    const onstart = `#!/bin/bash
set -e

# Function to report status to callback
report_status() {
    curl -s -X POST "https://carla-shadow-driver.vercel.app/api/gpu/callback" \\
        -H "Content-Type: application/json" \\
        -d "{\\"instance_id\\":\\"$INSTANCE_ID\\",\\"status\\":\\"$1\\",\\"message\\":\\"$2\\"}" || true
}

# Function to report error and exit
report_error() {
    echo "ERROR: $1"
    report_status "error" "$1"
    exit 1
}

echo "=== Installing system dependencies ==="
report_status "installing" "Installing system dependencies"
if ! apt-get update; then
    report_error "apt-get update failed"
fi
if ! apt-get install -y libgl1-mesa-glx libglib2.0-0 curl --no-install-recommends; then
    report_error "apt-get install failed"
fi

echo "=== Installing cloudflared ==="
report_status "installing" "Installing cloudflared"
if ! curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared; then
    report_error "Failed to download cloudflared"
fi
chmod +x /usr/local/bin/cloudflared

echo "=== Cloning repository ==="
report_status "installing" "Cloning repository"
cd /workspace
if ! git clone https://github.com/rishi09/carla-shadow-driver.git; then
    report_error "Failed to clone repository"
fi
cd carla-shadow-driver

echo "=== Installing Python dependencies ==="
report_status "installing" "Installing Python dependencies"
# Fix NumPy 2.x incompatibility with PyTorch
if ! pip install 'numpy<2'; then
    report_error "Failed to install numpy"
fi
if ! pip install -r requirements.txt; then
    report_error "Failed to install Python dependencies"
fi

echo "=== Downloading model ==="
report_status "installing" "Downloading model"
if ! python scripts/download_model.py pilotnet; then
    report_error "Failed to download model"
fi

echo "=== Starting WebSocket server in background ==="
report_status "starting" "Starting WebSocket server"
python src/shadow_mode.py --websocket --port 5001 &
WS_PID=$!
sleep 5  # Wait for server to start

# Check if WebSocket server is running
if ! kill -0 $WS_PID 2>/dev/null; then
    report_error "WebSocket server failed to start"
fi

echo "=== Starting Cloudflare Tunnel ==="
report_status "tunneling" "Starting Cloudflare tunnel"

# Start cloudflared and capture ALL output to a file (much more reliable than while loop)
cloudflared tunnel --url http://localhost:5001 > /tmp/cloudflared.log 2>&1 &
CF_PID=$!

# Retry loop: 6 attempts, 10 seconds each (total 60 seconds)
MAX_ATTEMPTS=6
ATTEMPT=1
TUNNEL_URL=""

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    echo "=== Attempt $ATTEMPT of $MAX_ATTEMPTS: Waiting for tunnel URL ==="
    report_status "tunneling" "Waiting for tunnel URL (attempt $ATTEMPT/$MAX_ATTEMPTS)"

    sleep 10

    # Check if cloudflared is still running
    if ! kill -0 $CF_PID 2>/dev/null; then
        echo "ERROR: cloudflared died on attempt $ATTEMPT"
        cat /tmp/cloudflared.log
        report_error "cloudflared failed to start"
    fi

    # Clean ANSI codes before grepping (fixes parsing issues)
    sed -i 's/\\x1b\\[[0-9;]*m//g' /tmp/cloudflared.log 2>/dev/null || true

    # Try to extract tunnel URL from log
    TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\\.trycloudflare\\.com' /tmp/cloudflared.log | head -1)

    if [ -z "$TUNNEL_URL" ]; then
        # Try alternate pattern (just look for trycloudflare.com anywhere)
        TUNNEL_URL=$(grep -oE 'https://[^[:space:]]+trycloudflare[^[:space:]]*' /tmp/cloudflared.log | head -1)
    fi

    if [ -n "$TUNNEL_URL" ]; then
        echo "=== Found Tunnel URL on attempt $ATTEMPT: $TUNNEL_URL ==="
        break
    fi

    ATTEMPT=$((ATTEMPT + 1))
done

# Parse the log file for tunnel URL (final output for debugging)
echo "=== Cloudflared output ==="
cat /tmp/cloudflared.log

if [ -n "$TUNNEL_URL" ]; then
    echo "=== Reporting Tunnel URL: $TUNNEL_URL ==="
    curl -s -X POST "https://carla-shadow-driver.vercel.app/api/gpu/callback" -H "Content-Type: application/json" -d "{\\"instance_id\\":\\"$INSTANCE_ID\\",\\"tunnel_url\\":\\"$TUNNEL_URL\\"}"
    echo "=== Tunnel URL reported! ==="
else
    # Report failure with first 500 chars of log so we can debug
    LOG_PREVIEW=$(head -c 500 /tmp/cloudflared.log | tr '\\n' ' ' | tr '"' "'")
    echo "=== No tunnel URL found after $MAX_ATTEMPTS attempts. Log preview: $LOG_PREVIEW ==="
    report_status "error" "No tunnel URL found after $MAX_ATTEMPTS attempts. Log: $LOG_PREVIEW"
fi

# Keep container running
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
