# Vast.ai Quick Start Guide

Run real AI models (PilotNet or NVIDIA Alpamayo) on GPU and connect from the browser demo.

## GPU Requirements

| Model | Min VRAM | Recommended GPU | Cost |
|-------|----------|-----------------|------|
| PilotNet | 8 GB | RTX 5080 (16GB) | ~$0.15/hr |
| Alpamayo | 24 GB | RTX 5090 (32GB) | ~$0.58/hr |

---

## Quick Setup (5 Steps)

### Step 1: Rent a GPU on Vast.ai

1. Go to [cloud.vast.ai/create](https://cloud.vast.ai/create/)
2. Set filter: **Per GPU RAM** ≥ 24 GB
3. Select **PyTorch (vast)** template
4. Click **RENT** on an RTX 5090 or similar

Wait for status to show **Running**.

### Step 2: Open GPU Terminal

1. Click the **terminal icon** (>_) on your instance
2. Click **"Open Jupyter terminal"**
3. Accept the SSL warning if prompted

### Step 3: Set Up the Server

In the GPU terminal, run:

```bash
git clone https://github.com/rishi09/carla-shadow-driver.git
cd carla-shadow-driver
pip install -r requirements.txt
python scripts/download_model.py pilotnet
```

### Step 4: Start WebSocket Server

```bash
python src/shadow_mode.py --websocket --port 5001
```

Keep this running. You should see:
```
SHADOW MODE - WEBSOCKET SERVER
Listening on ws://0.0.0.0:5001
```

### Step 5: Create SSH Tunnel (on your Mac)

Vast.ai doesn't expose custom ports directly. Use SSH tunneling:

**First time only - set up SSH key:**
```bash
# Generate key if you don't have one
ssh-keygen -t rsa -b 4096  # Press Enter for all prompts

# Copy your public key
cat ~/.ssh/id_rsa.pub
```
Add this key to Vast.ai: **Account** → **SSH Keys** → Paste → Save

**Create the tunnel:**
```bash
ssh -L 9999:localhost:5001 -p <SSH_PORT> root@<INSTANCE_IP>
```

Find `<SSH_PORT>` and `<INSTANCE_IP>` from Vast.ai console:
- Look for `VAST_TCP_PORT_22=XXXXX` (XXXXX is your SSH port)
- IP is shown at top of instance card

Example:
```bash
ssh -L 9999:localhost:5001 -p 34548 root@194.228.55.129
```

### Step 6: Connect from Browser

1. Open `demo_visual_car.html` locally (double-click the file)
2. Click **"Connect Real AI (GPU)"**
3. Enter:
   - Host: `localhost`
   - Port: `9999`
4. Click **Connect** - green dot = success!
5. Switch to **AI Only** mode and watch the AI drive

---

## Resuming Later

When you come back later:

### If instance is still running:
1. Start WebSocket server on GPU (Step 4)
2. Create SSH tunnel on Mac (Step 5)
3. Connect from browser (Step 6)

### If you destroyed the instance:
Start from Step 1.

---

## Finding Your SSH Port

Run this in the GPU terminal to see port mappings:
```bash
env | grep VAST_TCP_PORT
```

Look for `VAST_TCP_PORT_22=XXXXX` - that XXXXX is your SSH port.

---

## Troubleshooting

### "Address already in use" on GPU
```bash
pkill -f shadow_mode
python src/shadow_mode.py --websocket --port 5001
```

### "Address already in use" on Mac (port 9999)
Use a different local port:
```bash
ssh -L 8888:localhost:5001 -p <SSH_PORT> root@<IP>
```
Then connect to `localhost:8888` in browser.

### Connection stuck on "Connecting..."
- Make sure SSH tunnel is running on Mac
- Make sure WebSocket server is running on GPU
- Try refreshing the browser page

### HTTPS error in browser
Don't use the Vercel URL for GPU connection. Open `demo_visual_car.html` directly from your local files instead.

---

## When Done

1. Press `Ctrl+C` in GPU terminal to stop server
2. Close SSH tunnel on Mac (`exit` or `Ctrl+D`)
3. Go to Vast.ai → Instances → **DESTROY** to stop billing

---

## Cost Estimates

| GPU | Hourly | $5 Budget |
|-----|--------|-----------|
| RTX 5080 (16GB) | $0.15 | ~33 hours |
| RTX 5090 (32GB) | $0.58 | ~8.5 hours |
| RTX 4090 (24GB) | $0.40 | ~12.5 hours |
