# CARLA Shadow Driver - Autonomous Execution Plan

**Created:** January 7, 2026
**For:** Claude Code autonomous execution when user resumes
**Context:** User has Vast.ai account with SSH key and $4.98 credits. Instance was destroyed. All local setup complete.

---

## OBJECTIVE

Execute the complete CARLA shadow mode setup and testing sequence autonomously. User should be able to say "execute the plan" and Claude Code handles everything.

---

## PRE-REQUISITES (Already Done)

✅ Vast.ai account: https://cloud.vast.ai/
✅ SSH key added to Vast.ai
✅ Credits: $4.98 remaining
✅ Local project: `/Users/rkshah20/side-projects/carla-shadow-driver`
✅ Python venv with dependencies installed
✅ Pre-trained model downloaded: `models/pilotnet_carla.pth`

---

## EXECUTION PLAN

### Phase 1: Vast.ai Instance Rental (MANUAL - User must do this)

**Why manual:** Vast.ai requires web browser interaction. Claude Code cannot automate this.

**User instructions:**
1. Go to https://cloud.vast.ai/
2. Click "Search"
3. Set filters:
   - GPU RAM: 16+ GB
   - System RAM: 32+ GB
   - Verified only
   - Sort by $/hr
4. Pick instance ~$0.10-0.30/hr (RTX 3080, 4090, 5070, or T4)
5. Click RENT
6. Configure:
   - Template: `pytorch/pytorch:latest`
   - Container Size: 50 GB
   - Click RENT/Deploy
7. Wait for "running" status
8. **Note the SSH connection details:**
   - IP address
   - Port number
9. **Provide these to Claude Code**

**Claude Code needs from user:**
- `VAST_IP=<ip address>`
- `VAST_PORT=<port number>`

**Example:**
```
VAST_IP=27.65.48.179
VAST_PORT=55116
```

---

### Phase 2: CARLA Installation (AUTONOMOUS)

**Trigger:** User provides IP and PORT

**Execution steps:**

#### 2.1 Test SSH Connection
```bash
# Test if we can connect
ssh -o StrictHostKeyChecking=no -p $VAST_PORT root@$VAST_IP "echo 'SSH connection successful'"
```

**Expected output:** `SSH connection successful`
**On failure:** Report connection error to user, ask them to verify instance is running

#### 2.2 Install CARLA
```bash
# Single command to install and start CARLA
ssh -p $VAST_PORT root@$VAST_IP << 'EOF'
set -e

echo "=== Installing CARLA on Vast.ai instance ==="
echo "[1/4] Updating system packages..."
apt-get update -qq

echo "[2/4] Pulling CARLA Docker image (this takes 3-5 minutes)..."
docker pull carlasim/carla:0.9.16

echo "[3/4] Starting CARLA server..."
docker run --gpus all --net=host -d \
    --name carla-server \
    carlasim/carla:0.9.16 \
    bash CarlaUE4.sh -RenderOffScreen -nosound -quality-level=Low

echo "[4/4] Waiting 30 seconds for CARLA to initialize..."
sleep 30

echo "=== Checking CARLA status ==="
docker logs carla-server | tail -20

echo "=== CARLA Installation Complete ==="
EOF
```

**Expected final output:** Should contain "LogCarla" or "Initialization" messages
**On failure:**
- Check if Docker is available: `ssh -p $VAST_PORT root@$VAST_IP "docker --version"`
- Check if GPU is accessible: `ssh -p $VAST_PORT root@$VAST_IP "nvidia-smi"`

#### 2.3 Verify CARLA is Running
```bash
ssh -p $VAST_PORT root@$VAST_IP "docker ps | grep carla-server"
```

**Expected output:** Line showing `carla-server` container
**On failure:** CARLA didn't start - check logs with `docker logs carla-server`

---

### Phase 3: SSH Tunnel Setup (AUTONOMOUS)

**Purpose:** Forward CARLA ports from cloud to local Mac

#### 3.1 Kill Existing Tunnels (if any)
```bash
# Kill any existing SSH tunnels to avoid conflicts
pkill -f "ssh.*2000:localhost:2000" || true
```

#### 3.2 Create Background SSH Tunnel
```bash
# Create tunnel in background
ssh -f -N -L 2000:localhost:2000 -L 2001:localhost:2001 \
    -o StrictHostKeyChecking=no \
    -p $VAST_PORT root@$VAST_IP

# Verify tunnel is running
sleep 2
ps aux | grep "ssh.*2000:localhost:2000" | grep -v grep
```

**Expected output:** Line showing ssh process with port forwarding
**On failure:**
- Check if ports are already in use: `lsof -i :2000`
- Try killing process on port: `lsof -ti:2000 | xargs kill -9`

---

### Phase 4: Test CARLA Connection (AUTONOMOUS)

**Execution:**

#### 4.1 Activate Virtual Environment and Test
```bash
cd /Users/rkshah20/side-projects/carla-shadow-driver
source venv/bin/activate
python src/test_connection.py
```

**Expected output:**
```
CARLA Connection Test
Connecting to localhost:2000...

  Server version: 0.9.16
  Client version: 0.9.16
  Current map: Town10HD
  Available vehicles: X
  Available sensors: X
  Spawn points: X

CONNECTION SUCCESSFUL!
```

**On failure:**
- If "Connection refused": CARLA may still be initializing. Wait 30 more seconds and retry.
- If "Version mismatch": Note versions but proceed (usually not critical)
- If "Module not found": Install carla: `pip install carla==0.9.16`

---

### Phase 5: Launch Shadow Mode (AUTONOMOUS)

**Decision point:** Ask user if they want to launch now or just verify setup

**If user says launch:**

#### 5.1 Start Shadow Mode
```bash
cd /Users/rkshah20/side-projects/carla-shadow-driver
source venv/bin/activate
python src/shadow_mode.py
```

**What will happen:**
- A pygame window will open
- CARLA graphics will display
- User can drive with W/A/S/D
- Green (human) vs Blue (AI) steering will show
- Press ESC to quit

**User controls:**
- W/S - Throttle/Brake
- A/D - Steer
- R - Toggle recording
- SPACE - Emergency stop
- ESC - Quit

---

### Phase 6: Cleanup (AUTONOMOUS or ON-DEMAND)

**When user is done (they tell you to stop):**

#### 6.1 Stop CARLA on Instance
```bash
ssh -p $VAST_PORT root@$VAST_IP "docker stop carla-server && docker rm carla-server"
```

#### 6.2 Kill SSH Tunnel
```bash
pkill -f "ssh.*2000:localhost:2000"
```

#### 6.3 Remind User to Stop/Destroy Instance
```
IMPORTANT: Go to https://cloud.vast.ai/ → Instances
Click STOP or DESTROY on your instance to stop billing!
Current cost: $X.XX/hr
```

---

## ERROR HANDLING MATRIX

| Error | Diagnosis | Solution |
|-------|-----------|----------|
| SSH connection refused | Instance not ready | Wait 60s, retry |
| Docker not found | Wrong template | Tell user to use pytorch template |
| GPU not detected | Instance has no GPU | Verify instance has GPU in Vast.ai |
| CARLA pull fails | Network issue | Retry: `docker pull carlasim/carla:0.9.16` |
| CARLA won't start | Insufficient resources | Check RAM/GPU with `nvidia-smi`, `free -h` |
| Port 2000 in use | Previous tunnel running | Kill with `lsof -ti:2000 \| xargs kill -9` |
| test_connection.py fails | CARLA not ready | Wait 30s, retry. Check `docker logs carla-server` |
| pygame window won't open | Display issue | User may need to give Terminal display permissions |
| No module 'carla' | Missing package | `pip install carla==0.9.16` |

---

## COST TRACKING

**Automatic cost calculation:**

```bash
# Calculate cost based on time
START_TIME=$(date +%s)
# ... user does stuff ...
END_TIME=$(date +%s)
DURATION_HOURS=$(echo "scale=2; ($END_TIME - $START_TIME) / 3600" | bc)
COST=$(echo "scale=2; $DURATION_HOURS * $HOURLY_RATE" | bc)
echo "Session cost: \$$COST ($DURATION_HOURS hours @ \$$HOURLY_RATE/hr)"
```

**Report to user:**
- Start time
- End time
- Duration
- Cost this session
- Remaining credits

---

## SUCCESS CRITERIA

✅ SSH connection to instance works
✅ CARLA Docker container is running
✅ SSH tunnel is established (port 2000 forwarding)
✅ `test_connection.py` returns "CONNECTION SUCCESSFUL"
✅ Shadow mode window opens
✅ User can drive and see AI predictions

---

## DECISION POINTS (Ask user)

1. **After Phase 1:** "Instance details received. Proceed with CARLA installation?"
2. **After Phase 4:** "Connection test successful! Launch shadow mode now or just leave setup ready?"
3. **When user says done:** "Stop CARLA and kill tunnel?"
4. **At end:** "Remind user to destroy instance?"

---

## AUTONOMOUS EXECUTION FLOW

```
User: "Execute the plan"

Claude Code:
1. Check if VAST_IP and VAST_PORT are provided
   - If not: Ask user for these values
   - If yes: Proceed

2. Execute Phase 2 (CARLA Installation)
   - Run SSH commands
   - Monitor output
   - Report status

3. Execute Phase 3 (SSH Tunnel)
   - Kill existing tunnels
   - Create new tunnel
   - Verify it's running

4. Execute Phase 4 (Test Connection)
   - Activate venv
   - Run test script
   - Report results

5. Ask user: "Setup complete! Launch shadow mode now?"
   - If yes: Execute Phase 5
   - If no: "Setup ready. Run 'python src/shadow_mode.py' when ready"

6. When user says "stop" or "done":
   - Execute Phase 6 (Cleanup)
   - Calculate and report costs
   - Remind to destroy instance
```

---

## BYPASS PERMISSIONS

**The following commands may run without asking:**

✅ `ssh -p PORT root@IP "command"`
✅ `ssh -f -N -L 2000:localhost:2000 ...`
✅ `pkill -f "ssh.*2000"`
✅ `cd /Users/rkshah20/side-projects/carla-shadow-driver`
✅ `source venv/bin/activate`
✅ `python src/test_connection.py`
✅ `python src/shadow_mode.py`
✅ `lsof -i :2000`
✅ `ps aux | grep ssh`

**These require user confirmation:**
- Initial connection to new IP (first time only)
- Destroying instance on Vast.ai (manual - can only remind)

---

## TESTING CHECKLIST

Before autonomous execution, verify:

- [ ] Can SSH to instance
- [ ] Docker is available on instance
- [ ] GPU is detected (`nvidia-smi` works)
- [ ] Local venv exists and has dependencies
- [ ] test_connection.py exists
- [ ] shadow_mode.py exists
- [ ] Ports 2000/2001 are free locally

---

## NOTES FOR CLAUDE CODE

- Be verbose: Report each step as you do it
- If something fails, try common fixes before asking user
- Always report costs
- When done, remind user about instance billing
- Save session logs to: `/Users/rkshah20/side-projects/carla-shadow-driver/logs/session_YYYYMMDD_HHMMSS.log`

---

**END OF PLAN**

User can now say "execute the plan" and provide IP/PORT when prompted.
