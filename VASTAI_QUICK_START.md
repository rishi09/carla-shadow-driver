# Vast.ai Quick Start Guide

Run real AI models (NVIDIA Alpamayo or PilotNet) on GPU and connect from the browser demo.

## GPU Requirements

| Model | Min VRAM | Recommended GPU | Cost |
|-------|----------|-----------------|------|
| PilotNet | 8 GB | RTX 5080 (16GB) | ~$0.15/hr |
| Alpamayo | 24 GB | RTX 5090 (32GB) | ~$0.58/hr |

## Step 1: Rent a GPU

1. Go to [vast.ai/console/create](https://cloud.vast.ai/create/)
2. Set filters:
   - **Per GPU RAM**: 24+ GB (for Alpamayo) or 16+ GB (for PilotNet)
   - **Reliability**: 99%+
3. Select a **PyTorch** template
4. Click **RENT**

## Step 2: Connect via SSH

Once the instance shows "running":

```bash
# Copy the SSH command from Vast.ai console
ssh -p <port> root@<ip-address>
```

## Step 3: Set Up Environment

```bash
# Clone the repo
git clone https://github.com/rishi09/carla-shadow-driver.git
cd carla-shadow-driver

# Install dependencies
pip install -r requirements.txt

# Download model (choose one)
python scripts/download_model.py pilotnet    # 6 MB, fast
python scripts/download_model.py alpamayo    # 20 GB, needs 24GB+ VRAM
```

## Step 4: Start WebSocket Server

```bash
python src/shadow_mode.py --websocket --port 8765
```

You should see:
```
==================================================
SHADOW MODE - WEBSOCKET SERVER
==================================================

Listening on ws://0.0.0.0:8765
Model: carla_pilotnet

Connect from browser demo using:
  Host: <your-ip>
  Port: 8765
```

## Step 5: Connect from Browser

1. Open your demo: https://carla-shadow-driver.vercel.app
2. Click **"Connect Real AI (GPU)"** button
3. Enter:
   - **Host**: Your Vast.ai instance IP (from SSH command)
   - **Port**: 8765
4. Click **Connect**

The status dot will turn green when connected.

## Step 6: Stop When Done

1. Press `Ctrl+C` in the SSH terminal
2. Go to Vast.ai console → Instances
3. Click **DESTROY** to stop billing

## Troubleshooting

### Can't connect from browser?
- Make sure port 8765 is open (Vast.ai usually exposes common ports)
- Try a different port: `--port 8080`
- Check the instance has a public IP

### Model won't load?
- Check GPU RAM: `nvidia-smi`
- Alpamayo needs 24GB+ free VRAM
- Try PilotNet instead if low on memory

### Connection drops?
- Vast.ai instances may have idle timeouts
- Keep the browser tab active
- Re-run the WebSocket server if needed

## Cost Estimates

| GPU | Hourly | $5 Budget |
|-----|--------|-----------|
| RTX 5080 (16GB) | $0.15 | ~33 hours |
| RTX 5090 (32GB) | $0.58 | ~8.5 hours |
| RTX 4090 (24GB) | $0.40 | ~12.5 hours |

## WebSocket Protocol

The server accepts these message types:

```javascript
// Ping
{ "type": "ping" }

// State update (returns AI prediction)
{ "type": "state_update", "state": { "position": 0.1, "curvature": 0.05, "speed": 45 } }

// Switch model
{ "type": "switch_model", "model": "alpamayo" }

// Get status
{ "type": "get_status" }
```
