# 🚗 CARLA Shadow Driver - Session Resume Guide

**Last Updated:** January 7, 2026
**Status:** Instance destroyed - Ready to rent new GPU and launch CARLA
**Estimated Time to Complete:** 40-50 minutes (includes GPU rental)
**Estimated Cost:** ~$0.05-0.10

---

## ✅ What We've Already Done

### 1. Project Setup (100% Complete)
- ✅ Downloaded **real NVIDIA PilotNet** model (6.09 MB, trained on 59.6k CARLA examples)
- ✅ Created **flexible model manager** (swap models easily)
- ✅ Built **3 interactive demos**:
  - `demo.html` - Basic demo
  - `demo_enhanced.html` - Weather, obstacles, curves
  - `demo_visual_car.html` - **Visual car with steering** (best one!)
- ✅ Updated shadow mode to use real neural network
- ✅ Everything works locally on your M1 Mac

### 2. Vast.ai Setup (Account Ready)
- ✅ Created Vast.ai account
- ✅ Added SSH key: `ssh-ed25519 AAAAC3Nza...`
- ✅ Added credits remaining: **~$4.98**
- ⏸️ Previous instance **DESTROYED** (saved money!)
- 🎯 Ready to rent new instance when needed

---

## 📍 Where You Are Now

✅ **Instance destroyed** - No charges running!
✅ **Account ready** - SSH key + credits loaded
✅ **Project ready** - Model downloaded, code works

**Next steps when you resume:**
1. Rent a new GPU instance (~2 minutes)
2. SSH into it
3. Install CARLA (~5 minutes)
4. Create SSH tunnel from your Mac
5. Run shadow mode with real 3D graphics!

---

## 🚀 How to Resume (When You're Ready)

### Step 1: Rent a New GPU Instance

Since you destroyed the previous instance, you'll rent a fresh one. **This takes ~2 minutes.**

#### 1.1 Go to Vast.ai Search

1. Navigate to: https://cloud.vast.ai/
2. Click **"Search"** in the left sidebar (or top menu)
3. You'll see a list of available GPU instances

#### 1.2 Set Filters (Left Sidebar)

**Important filters to set:**

- **GPU RAM**: Min **16 GB**
- **System RAM**: Min **32 GB**
- **Disk Space**: You'll set this later (after clicking RENT)
- **Verification**: Check **"Verified"** only
- **Sort by**: Select **"$/hr"** (cheapest first)

**Optional - Filter by GPU type:**
- Check: **RTX 3080**, **RTX 4090**, **RTX 5070**, or **T4**
- These are all good for CARLA

#### 1.3 Pick an Instance

Look for instances around **$0.10-0.30/hour**.

**Good options:**
- RTX 5070 Ti: ~$0.10-0.15/hr
- RTX 3080: ~$0.15-0.25/hr
- T4: ~$0.10-0.20/hr
- RTX 4090: ~$0.30-0.50/hr (fastest, but pricier)

**Find one you like and click the blue "RENT" button.**

#### 1.4 Configure Template (Popup appears)

After clicking RENT, you'll see a configuration popup:

1. **Template/Image selection:**
   - Click the **"Select Template"** or **"Change Template"** button
   - In the search box, type: **pytorch**
   - Select: **`pytorch/pytorch:latest`** or **`PyTorch (Vast)`**
   - Click to confirm selection

2. **You may see a Jupyter HTTPS popup** - Click **"I Understand"** to close it

3. **Set Container Size (Disk Space):**
   - Look for **"Container Size"** slider (left side of popup)
   - Drag it to **50 GB** (or type 50 in the box)

4. **Leave everything else as default**

5. **Click the final "RENT" or "Deploy" button** at the bottom of the popup

#### 1.5 Wait for Instance to Start

- Status will show "Loading..." then change to "Running"
- Takes **1-2 minutes**
- You'll be taken to the **Instances** page

#### 1.6 Get Your Connection Details

Once status shows **"running"**:

1. Look for your instance in the list
2. Note these details:
   - **IP Address**: (e.g., 27.65.48.179)
   - **SSH Port**: (e.g., 55116)
   - **SSH Command**: Often displayed like `ssh -p 12345 root@1.2.3.4`

**Write these down!** You'll need them for the next step.

---

### Step 2: Connect via SSH

**In your Mac Terminal.app (not Claude Code):**

```bash
# Replace PORT and IP with YOUR values from Vast.ai
ssh -p PORT root@IP_ADDRESS

# Example (use your actual values):
# ssh -p 12345 root@27.65.48.179
```

**When prompted:**
```
The authenticity of host '...' can't be established.
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

Type: **yes** and press Enter

You should now be connected! You'll see a prompt like `root@machine-id:~#`

---

### Step 3: Install CARLA (Run these commands one by one)

Once you're SSH'd into the instance:

```bash
# 1. Update system (15 seconds)
apt-get update -qq

# 2. Pull CARLA Docker image (3-5 minutes)
docker pull carlasim/carla:0.9.16

# 3. Start CARLA server (instant)
docker run --gpus all --net=host -d \
    --name carla-server \
    carlasim/carla:0.9.16 \
    bash CarlaUE4.sh -RenderOffScreen -nosound -quality-level=Low

# 4. Wait 30 seconds for CARLA to initialize
sleep 30

# 5. Check it's running (should see "LogCarla: Initialization complete")
docker logs carla-server | tail -20

# 6. Exit SSH (type this)
exit
```

---

### Step 4: Create SSH Tunnel (On Your Mac)

**Open a NEW terminal window** and run:

```bash
# Replace with YOUR IP and port from Vast.ai
ssh -N -L 2000:localhost:2000 -L 2001:localhost:2001 -p 55116 root@27.65.48.179
```

**This command will appear to "hang" - that's correct!** Leave it running.

The tunnel is now forwarding CARLA traffic to your Mac.

---

### Step 5: Test Connection

**Open ANOTHER terminal window** and run:

```bash
cd ~/side-projects/carla-shadow-driver
source venv/bin/activate
python src/test_connection.py
```

**You should see:**
```
CONNECTION SUCCESSFUL!
Server version: 0.9.16
Current map: Town10HD
```

---

### Step 6: Run Shadow Mode! 🎉

```bash
python src/shadow_mode.py
```

**Controls:**
- W/S - Throttle/Brake
- A/D - Steer
- R - Toggle recording
- SPACE - Emergency stop
- ESC - Quit

**You'll see:**
- Real CARLA 3D graphics
- Your green steering vs AI blue steering
- Real-time divergence warnings
- Actual physics simulation!

---

## 💰 Cost Tracking

| Action | Time | Cost @ $0.104/hr |
|--------|------|------------------|
| Install CARLA | 5 mins | $0.009 |
| Test connection | 5 mins | $0.009 |
| Drive & explore | 30 mins | $0.052 |
| **Total Session** | **40 mins** | **~$0.07** |

**Your $5 lasts:** ~70 sessions like this, or 48 hours continuous

---

## 🛑 When You're Done

### Always Stop/Destroy the Instance!

1. Go to Vast.ai → Instances
2. Click **STOP** (saves instance) or **DESTROY** (deletes it)
3. Verify status shows "stopped" or instance is gone

**If you forget:** You'll be charged $0.104/hour until you stop it!

---

## 📁 Project Files Reference

### Demos (Run Locally Anytime)
```bash
# Start server (if not running)
cd ~/side-projects/carla-shadow-driver
python3 -m http.server 8080
```

- http://localhost:8080/demo_visual_car.html - **Best visual demo**
- http://localhost:8080/demo_enhanced.html - Weather/obstacles
- http://localhost:8080/demo.html - Basic

### Model Testing (Local)
```bash
source venv/bin/activate
python src/model_manager.py
```

### Project Structure
```
carla-shadow-driver/
├── demo_visual_car.html       ← Visual car steering demo
├── demo_enhanced.html         ← Full featured demo
├── src/
│   ├── shadow_mode.py         ← Main CARLA app
│   ├── test_connection.py     ← Test CARLA connection
│   ├── model_manager.py       ← Model system
│   └── ...
├── models/
│   └── pilotnet_carla.pth     ← Pre-trained weights
├── VASTAI_SETUP.md            ← Detailed Vast.ai guide
└── GETTING_STARTED.md         ← Full documentation
```

---

## 🐛 Troubleshooting

### Instance won't start
- Try a different instance (prices fluctuate)
- Look for RTX 3080, 4090, 5070, or T4 GPUs

### SSH connection refused
- Wait 1-2 minutes after starting instance
- Check IP and port haven't changed
- Verify instance status is "running"

### CARLA connection fails
- Wait 60 seconds after starting CARLA
- Check SSH tunnel is still running
- Run: `docker logs carla-server` on the instance

### "No module named 'carla'"
- Make sure venv is activated: `source venv/bin/activate`
- If needed: `pip install carla==0.9.16`

---

## 📝 Quick Commands Cheat Sheet

### On Vast.ai Instance (via SSH):
```bash
# Start CARLA
docker run --gpus all --net=host -d --name carla-server \
    carlasim/carla:0.9.16 bash CarlaUE4.sh -RenderOffScreen -nosound

# Check CARLA status
docker logs carla-server

# Stop CARLA
docker stop carla-server && docker rm carla-server
```

### On Your Mac:
```bash
# SSH tunnel (keep running in background)
ssh -N -L 2000:localhost:2000 -L 2001:localhost:2001 -p PORT root@IP

# Test connection
cd ~/side-projects/carla-shadow-driver
source venv/bin/activate
python src/test_connection.py

# Run shadow mode
python src/shadow_mode.py
```

---

## 🎯 Your Next Session Goals

1. ⏱️ **Budget 45 mins** - Enough time to complete setup + testing
2. 💵 **Cost:** ~$0.08 for the session
3. 🎮 **Experience:** Drive in 3D CARLA with real AI predictions!
4. 📹 **Record:** Try the recording feature (press R)
5. 🧪 **Experiment:** See where you and AI diverge

---

## 💡 Tips

- **Test the visual car demo first** - http://localhost:8080/demo_visual_car.html
  - Gets you familiar with controls
  - Shows steering concept clearly

- **Run model test** - Verify neural network works:
  ```bash
  source venv/bin/activate
  python src/model_manager.py
  ```

- **Keep cost low:**
  - Rent instance only when ready to use
  - Stop immediately when done
  - Use cheapest GPU that meets specs (T4, RTX 3080)

---

## ✨ What Makes This Special

You're not just running a demo - you're using:

1. **Real neural network** trained on 59.6k CARLA examples
2. **Real-time inference** on cloud GPU
3. **Industry-standard pipeline**: Camera → Neural Network → Control
4. **Shadow mode** - exactly how Tesla/Waymo validate models
5. **Flexible architecture** - swap models, add your own

This is a **real autonomous driving development environment!**

---

**Ready when you are! Just follow the "How to Resume" section above. Good luck! 🚗💨**
