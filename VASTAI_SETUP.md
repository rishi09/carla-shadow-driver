# Vast.ai Setup Guide

Step-by-step guide to get CARLA running on Vast.ai and connecting from your Mac.

## Prerequisites

- Credit card for Vast.ai (start with $5-10)
- SSH key on your Mac
- Python 3.9+ on your Mac

---

## Step 1: Create Vast.ai Account

1. Go to https://cloud.vast.ai/
2. Click "Sign Up"
3. Verify your email
4. Add $5-10 in credits (Account → Billing → Add Funds)

---

## Step 2: Add Your SSH Key

1. On your Mac, check if you have an SSH key:
   ```bash
   cat ~/.ssh/id_rsa.pub
   # or
   cat ~/.ssh/id_ed25519.pub
   ```

2. If you don't have one, create it:
   ```bash
   ssh-keygen -t ed25519 -C "your-email@example.com"
   ```

3. In Vast.ai: Account → SSH Keys → Add Key
4. Paste your public key

---

## Step 3: Find and Rent a GPU Instance

1. Go to the Console: https://cloud.vast.ai/
2. Click "Search" or "Create Instance"
3. Set these filters:
   - **GPU**: RTX 3080, RTX 3090, or T4 (any will work)
   - **GPU RAM**: 16+ GB
   - **RAM**: 32+ GB
   - **Storage**: 50+ GB
   - **Reliability**: 95%+

4. Sort by price ($/hr)

5. Look for an instance around $0.15-0.30/hour

6. Click "Rent"

7. For the template, select:
   - **Template**: Select "Pytorch" or any Ubuntu-based template
   - Or use: `nvidia/cuda:12.1.0-devel-ubuntu22.04`

8. Click "Rent" to confirm

9. Wait for status to show "Running" (1-2 minutes)

---

## Step 4: Connect to Your Instance

1. Find your instance in the Console
2. Note the SSH command shown (looks like):
   ```
   ssh -p 12345 root@123.45.67.89
   ```

3. Connect from your Mac terminal:
   ```bash
   ssh -p 12345 root@123.45.67.89
   ```

4. Accept the fingerprint if prompted

---

## Step 5: Set Up CARLA on the Instance

Run these commands on your Vast.ai instance:

```bash
# Update system
apt-get update

# Install Docker if not present
which docker || apt-get install -y docker.io

# Pull CARLA image (takes ~5 minutes)
docker pull carlasim/carla:0.9.16

# Start CARLA server
docker run --gpus all --net=host -d \
    --name carla-server \
    carlasim/carla:0.9.16 \
    bash CarlaUE4.sh -RenderOffScreen -nosound -quality-level=Low

# Wait for startup
echo "Waiting 30 seconds for CARLA to initialize..."
sleep 30

# Check it's running
docker logs carla-server | tail -20
```

You should see output like:
```
LogCarla: Initialization complete.
```

---

## Step 6: Create SSH Tunnel on Your Mac

In a NEW terminal on your Mac (keep it open):

```bash
ssh -N -L 2000:localhost:2000 -L 2001:localhost:2001 -p 12345 root@123.45.67.89
```

Replace:
- `12345` with your Vast.ai port
- `123.45.67.89` with your Vast.ai IP

This command will appear to hang - that's correct! It's tunneling traffic.

---

## Step 7: Install Local Dependencies

In another terminal on your Mac:

```bash
cd carla-shadow-driver

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install carla==0.9.16 numpy opencv-python pygame torch torchvision pyyaml matplotlib tqdm Pillow
```

---

## Step 8: Test the Connection

```bash
cd carla-shadow-driver
python src/test_connection.py
```

You should see:
```
CARLA Connection Test
Connecting to localhost:2000...

  Server version: 0.9.16
  Client version: 0.9.16
  Current map: Town10HD
  Available vehicles: 28
  Available sensors: 15
  Spawn points: 150

CONNECTION SUCCESSFUL!
```

---

## Step 9: Run Shadow Mode

```bash
python src/shadow_mode.py
```

Controls:
- W/S - Throttle/Brake
- A/D - Steer
- R - Toggle recording
- SPACE - Emergency stop
- ESC - Quit

---

## Stopping Your Instance

**IMPORTANT:** You're charged while the instance is running!

1. Stop CARLA on the instance:
   ```bash
   docker stop carla-server
   ```

2. In Vast.ai Console: Click "Stop" or "Destroy" on your instance
   - **Stop**: Saves disk, small storage fee
   - **Destroy**: No more charges, but need to set up again

---

## Troubleshooting

### "Connection refused" error

1. Check CARLA is running:
   ```bash
   docker ps  # on Vast.ai instance
   docker logs carla-server
   ```

2. Make sure SSH tunnel is active (the ssh -N -L command)

3. Wait 30-60 seconds after starting CARLA

### "Version mismatch" warning

Install matching CARLA Python client:
```bash
pip install carla==0.9.16
```

### Slow frame rate

CARLA is rendering on the cloud. Some latency is normal.
Try reducing quality:
```bash
docker stop carla-server
docker run --gpus all --net=host -d \
    --name carla-server \
    carlasim/carla:0.9.16 \
    bash CarlaUE4.sh -RenderOffScreen -nosound -quality-level=Epic -world-port=2000
```

### Instance not connecting

Check your SSH key is added to Vast.ai account.

---

## Cost Estimate

| Action | Time | Cost |
|--------|------|------|
| Pull Docker image | ~10 min | ~$0.05 |
| Test connection | ~5 min | ~$0.02 |
| Shadow mode session | 1 hour | ~$0.25 |

**Total for a good session: ~$0.50-1.00**

---

## Quick Reference Commands

```bash
# Start CARLA (on Vast.ai instance)
docker run --gpus all --net=host -d --name carla-server \
    carlasim/carla:0.9.16 bash CarlaUE4.sh -RenderOffScreen -nosound

# Stop CARLA
docker stop carla-server && docker rm carla-server

# Check CARLA logs
docker logs -f carla-server

# SSH tunnel (on Mac)
ssh -N -L 2000:localhost:2000 -L 2001:localhost:2001 -p PORT root@IP

# Run shadow mode (on Mac)
python src/shadow_mode.py
```
