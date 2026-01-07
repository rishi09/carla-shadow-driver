# Full Automation Plan: Play/Stop GPU Buttons

## Overview
Add Play/Stop buttons to the Vercel demo that automatically provision and destroy Vast.ai GPU instances.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BROWSER (Vercel)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ Play Button │  │ Stop Button │  │ Status      │  │ WebSocket       │ │
│  │ (start GPU) │  │ (destroy)   │  │ (polling)   │  │ (to GPU)        │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
└─────────┼────────────────┼────────────────┼──────────────────┼──────────┘
          │                │                │                  │
          ▼                ▼                ▼                  │
┌─────────────────────────────────────────────────────────────┐│
│                    VERCEL API ROUTES                         ││
│  /api/gpu/start    /api/gpu/stop    /api/gpu/status          ││
│  (serverless functions)                                      ││
└─────────────────────────────────────────────────────────────┘│
          │                │                │                  │
          ▼                ▼                ▼                  │
┌─────────────────────────────────────────────────────────────┐│
│                      VAST.AI API                             ││
│  POST /instances (create)   DELETE /instances/:id (destroy)  ││
│  GET /instances/:id (status)                                 ││
└─────────────────────────────────────────────────────────────┘│
          │                                                    │
          ▼                                                    │
┌─────────────────────────────────────────────────────────────┐│
│                    GPU INSTANCE                              ││
│  1. Boot with PyTorch template                               ││
│  2. Run startup script (onstart.sh):                         ││
│     - git clone carla-shadow-driver                          ││
│     - pip install requirements                               ││
│     - python download_model.py pilotnet                      ││
│     - Start shadow_mode.py --websocket                       ││
│     - Start ngrok tunnel                                     │◀┘
│     - Report ngrok URL to status endpoint                    │
│  3. Expose wss:// URL for browser connection                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Get Vast.ai API Key
1. Go to https://cloud.vast.ai/account/
2. Find API Key section
3. Copy key, add to Vercel environment variables as `VASTAI_API_KEY`

### Step 2: Create Vercel API Routes

#### `/api/gpu/start.js`
```javascript
// Provisions a new GPU instance
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const VASTAI_API_KEY = process.env.VASTAI_API_KEY;

  // Search for available RTX 5090/4090 instances
  const searchResponse = await fetch('https://console.vast.ai/api/v0/bundles', {
    headers: { 'Authorization': `Bearer ${VASTAI_API_KEY}` }
  });
  const offers = await searchResponse.json();

  // Filter for suitable GPUs (24GB+ VRAM, good reliability)
  const suitable = offers.offers.filter(o =>
    o.gpu_ram >= 24000 &&
    o.reliability >= 0.95 &&
    o.dph_total < 0.80  // Max $0.80/hr
  ).sort((a, b) => a.dph_total - b.dph_total);

  if (suitable.length === 0) {
    return res.status(503).json({ error: 'No suitable GPUs available' });
  }

  const cheapest = suitable[0];

  // Create instance with startup script
  const createResponse = await fetch('https://console.vast.ai/api/v0/asks/' + cheapest.id + '/', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${VASTAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: 'carla-shadow-driver',
      image: 'pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime',
      disk: 20,
      onstart: `#!/bin/bash
cd /workspace
git clone https://github.com/rishi09/carla-shadow-driver.git
cd carla-shadow-driver
pip install -r requirements.txt
pip install pyngrok
python scripts/download_model.py pilotnet

# Start ngrok and save URL
python -c "
from pyngrok import ngrok
import json
tunnel = ngrok.connect(5001, 'tcp')
print(json.dumps({'url': tunnel.public_url}))
with open('/workspace/ngrok_url.txt', 'w') as f:
    f.write(tunnel.public_url)
" &

# Start WebSocket server
python src/shadow_mode.py --websocket --port 5001
`
    })
  });

  const instance = await createResponse.json();

  return res.status(200).json({
    instance_id: instance.new_contract,
    status: 'starting',
    estimated_ready: '2-3 minutes'
  });
}
```

#### `/api/gpu/status.js`
```javascript
// Check instance status and get ngrok URL
export default async function handler(req, res) {
  const { instance_id } = req.query;
  const VASTAI_API_KEY = process.env.VASTAI_API_KEY;

  const response = await fetch(`https://console.vast.ai/api/v0/instances/${instance_id}`, {
    headers: { 'Authorization': `Bearer ${VASTAI_API_KEY}` }
  });
  const instance = await response.json();

  // Check if ngrok URL is available
  let ngrok_url = null;
  if (instance.actual_status === 'running') {
    // SSH into instance and get ngrok URL
    // (This requires SSH key setup or alternative approach)
    // Alternative: Use a callback URL that the GPU posts to
  }

  return res.status(200).json({
    status: instance.actual_status,
    ngrok_url: ngrok_url,
    cost_so_far: instance.total_cost,
    uptime_seconds: instance.duration
  });
}
```

#### `/api/gpu/stop.js`
```javascript
// Destroy GPU instance
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { instance_id } = req.body;
  const VASTAI_API_KEY = process.env.VASTAI_API_KEY;

  await fetch(`https://console.vast.ai/api/v0/instances/${instance_id}/`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${VASTAI_API_KEY}` }
  });

  return res.status(200).json({ status: 'destroyed' });
}
```

### Step 3: Add ngrok to GPU Startup

Modify startup script to:
1. Install pyngrok: `pip install pyngrok`
2. Start ngrok tunnel before WebSocket server
3. Save ngrok URL to a known location or POST to a callback

#### Option A: Callback URL
GPU posts ngrok URL to a Vercel endpoint that stores it temporarily.

#### Option B: Redis/KV Store
Use Vercel KV to store instance_id → ngrok_url mapping.

### Step 4: Update Browser UI

Add to `demo_visual_car.html`:

```html
<!-- GPU Control Panel -->
<div id="gpu-panel" style="position: fixed; top: 10px; right: 10px;">
  <button id="play-gpu" onclick="startGPU()">▶ Start Real AI ($0.50/hr)</button>
  <button id="stop-gpu" onclick="stopGPU()" style="display:none;">⬛ Stop</button>
  <div id="gpu-status"></div>
  <div id="gpu-cost"></div>
</div>

<script>
let currentInstanceId = null;
let statusPollInterval = null;

async function startGPU() {
  document.getElementById('gpu-status').textContent = 'Starting GPU...';
  document.getElementById('play-gpu').disabled = true;

  const response = await fetch('/api/gpu/start', { method: 'POST' });
  const data = await response.json();

  currentInstanceId = data.instance_id;

  // Poll for status
  statusPollInterval = setInterval(pollGPUStatus, 5000);
}

async function pollGPUStatus() {
  const response = await fetch(`/api/gpu/status?instance_id=${currentInstanceId}`);
  const data = await response.json();

  document.getElementById('gpu-status').textContent = `Status: ${data.status}`;
  document.getElementById('gpu-cost').textContent = `Cost: $${data.cost_so_far.toFixed(3)}`;

  if (data.ngrok_url) {
    // Auto-connect!
    clearInterval(statusPollInterval);
    document.getElementById('stop-gpu').style.display = 'inline';
    connectToGPU(data.ngrok_url);
  }
}

async function stopGPU() {
  await fetch('/api/gpu/stop', {
    method: 'POST',
    body: JSON.stringify({ instance_id: currentInstanceId })
  });

  currentInstanceId = null;
  document.getElementById('gpu-status').textContent = 'GPU stopped';
  document.getElementById('stop-gpu').style.display = 'none';
  document.getElementById('play-gpu').disabled = false;
}
</script>
```

### Step 5: Handle ngrok URL Callback

Create `/api/gpu/callback.js` for GPU to report its ngrok URL:

```javascript
// GPU calls this after ngrok starts
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const { instance_id, ngrok_url } = req.body;

  // Store in KV with 1 hour expiry
  await kv.set(`gpu:${instance_id}`, ngrok_url, { ex: 3600 });

  return res.status(200).json({ status: 'ok' });
}
```

Update GPU startup script to call this:
```bash
curl -X POST https://carla-shadow-driver.vercel.app/api/gpu/callback \
  -H "Content-Type: application/json" \
  -d "{\"instance_id\": \"$INSTANCE_ID\", \"ngrok_url\": \"$(cat /workspace/ngrok_url.txt)\"}"
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `vercel-deploy/api/gpu/start.js` | Create | Provision GPU |
| `vercel-deploy/api/gpu/stop.js` | Create | Destroy GPU |
| `vercel-deploy/api/gpu/status.js` | Create | Check status |
| `vercel-deploy/api/gpu/callback.js` | Create | Receive ngrok URL |
| `demo_visual_car.html` | Modify | Add Play/Stop buttons |
| `vercel-deploy/vercel.json` | Modify | Add API routes config |
| `scripts/gpu_startup.sh` | Create | Startup script for GPU |

---

## Environment Variables Needed

Add to Vercel project settings:

| Variable | Description |
|----------|-------------|
| `VASTAI_API_KEY` | Your Vast.ai API key |
| `KV_REST_API_URL` | Vercel KV connection (for ngrok URL storage) |
| `KV_REST_API_TOKEN` | Vercel KV auth token |

---

## Estimated Implementation Time

| Task | Time |
|------|------|
| Set up Vercel KV | 10 min |
| Create API routes | 45 min |
| Update browser UI | 30 min |
| Create GPU startup script | 20 min |
| Testing & debugging | 30 min |
| **Total** | **~2.5 hours** |

---

## Cost Considerations

- **ngrok free tier**: 1 tunnel, works for this use case
- **Vercel KV**: Free tier should be sufficient
- **GPU**: ~$0.50/hr for RTX 5090

---

## Security Notes

1. Rate limit the `/api/gpu/start` endpoint (prevent abuse)
2. Add user session tracking (optional, to limit one GPU per user)
3. Auto-destroy instances after max time (e.g., 1 hour) as failsafe
4. Never expose `VASTAI_API_KEY` to browser

---

## Testing Steps

1. Click "Start Real AI" button
2. Watch status updates (starting → running)
3. Should auto-connect when ngrok URL is ready
4. Test AI Only mode with real GPU predictions
5. Click "Stop" and verify instance is destroyed
6. Check Vast.ai console to confirm no orphaned instances
