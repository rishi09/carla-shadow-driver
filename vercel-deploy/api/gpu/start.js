// Provisions a new GPU instance on Vast.ai
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

    // Filter for suitable GPUs (16GB+ VRAM, decent reliability, reasonable price)
    const suitable = (offers.offers || []).filter(o =>
      o.gpu_ram >= 16000 &&
      o.reliability >= 0.90 &&
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
    const onstart = `#!/bin/bash
set -e

echo "=== Installing system dependencies ==="
apt-get update && apt-get install -y libgl1-mesa-glx libglib2.0-0 curl --no-install-recommends

echo "=== Installing cloudflared ==="
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

echo "=== Cloning repository ==="
cd /workspace
git clone https://github.com/rishi09/carla-shadow-driver.git
cd carla-shadow-driver

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Downloading model ==="
python scripts/download_model.py pilotnet

echo "=== Starting WebSocket server in background ==="
python src/shadow_mode.py --websocket --port 5001 &
WS_PID=$!
sleep 5  # Wait for server to start

echo "=== Starting Cloudflare Tunnel ==="
# Start cloudflared and capture the URL
cloudflared tunnel --url http://localhost:5001 2>&1 | while read line; do
    echo "$line"
    # Look for the tunnel URL in the output
    if echo "$line" | grep -q "trycloudflare.com"; then
        TUNNEL_URL=$(echo "$line" | grep -oE 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com')
        if [ -n "$TUNNEL_URL" ]; then
            echo "=== Tunnel URL: $TUNNEL_URL ==="
            # Report URL to callback endpoint
            curl -X POST "https://carla-shadow-driver.vercel.app/api/gpu/callback" \\
                -H "Content-Type: application/json" \\
                -d "{\\"instance_id\\":\\"\\$(hostname)\\",\\"tunnel_url\\":\\"$TUNNEL_URL\\"}" || true
        fi
    fi
done &

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
            onstart: onstart
          })
        });

        if (createResponse.ok) {
          const instance = await createResponse.json();
          return res.status(200).json({
            instance_id: instance.new_contract,
            status: 'starting',
            gpu_name: offer.gpu_name,
            price_per_hour: offer.dph_total,
            estimated_ready: '2-3 minutes'
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
