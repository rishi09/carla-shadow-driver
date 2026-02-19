# Shadow Driver v3 - Project Instructions

## Project Overview

Shadow Driver is a browser-based racing game where you race against an AI car in CARLA simulator running on a cloud GPU. The frontend is a React/Vite app deployed on Vercel. The backend is a Python WebSocket server running inside a Docker container on Vast.ai GPU instances, streaming JPEG frames from CARLA.

**Key URLs:**
- Game (v3): https://shadow-driver-v3.vercel.app
- Docker image: rkshah09/shadow-driver-v3:latest
- GitHub: https://github.com/rishi09/carla-shadow-driver

**Active branch:** `v3`

---

## Current Status (Feb 18, 2026)

### Working
- CARLA 0.9.15 running on Vast.ai GPU (RTX 3090, root privilege fix applied)
- Direct WebSocket connection via `?ws=<tunnel_url>` query parameter
- Player car controls: WASD + Space (handbrake), R (respawn), C (camera toggle)
- AI opponent using CARLA autopilot (racing mode: ignores lights/signs, 40% over speed limit)
- Steering: progressive ramping (~100-130ms attack, ~130-200ms release), speed-limited (0.7 low, 0.15 high)
- Reverse: full throttle when S pressed and speed < 5 km/h
- Compass navigation arrow pointing to next checkpoint
- Race HUD: speedometer, lap timer, gap timer, throttle/brake/steer bars, connection quality
- Minimap with player/AI positions
- Countdown overlay (3-2-1-GO with traffic light colors)
- Screen shake + impact sound on collisions
- Engine sound + background music with speed-based intensity
- Model selector on RaceSetup screen (Easy/Medium/Hard - UI only, no weights yet)
- GitHub Actions auto-builds Docker image on push to v3 (server/docker/configs paths)
- Vercel auto-deploys frontend on push to v3

### Not Working / TODO
- **Server SIGABRT crash (mitigated)**: Cleanup now disables autopilot and sync mode before destroying actors, sensors destroyed before vehicles. Server no longer calls cleanup on client disconnect — only on new race start. Still close extra tabs to be safe.
- **No trained model weights**: AI uses CARLA autopilot fallback. PilotNet weights available at HuggingFace (sergiopaniego/OptimizedPilotNet, 200x66 input). Alpamayo is 10B params (~20GB), probably won't fit alongside CARLA on 24GB GPU.
- **Full provisioning flow untested**: The "Play Game" button flow (Vast.ai auto-provision + Cloudflare tunnel + callback) hasn't been tested end-to-end with the v3 Docker image.
- **Docker Hub token**: May need to regenerate Docker Hub access token for GitHub Actions (was getting "Password required" error).

---

## Architecture

```
shadow-driver-v3.vercel.app (Frontend - React/Vite/Tailwind v4)
    │
    ├─ /race?ws=<url>   → Direct WebSocket connection (dev/testing)
    ├─ /race?demo=true  → Demo mode (connects to localhost:8765)
    └─ /race            → Full flow: GPU provisioning modal
    │
    │ API calls for provisioning
    ▼
shadow-driver-v3.vercel.app/api/gpu/* (Vercel API routes)
    │
    ├─ /api/gpu/start    → Provisions GPU on Vast.ai
    ├─ /api/gpu/status   → Polls GPU status + tunnel URL
    ├─ /api/gpu/callback → Receives tunnel URL from GPU
    └─ /api/gpu/stop     → Destroys GPU instance
    │
    ▼
Vast.ai GPU Instance (Docker: rkshah09/shadow-driver-v3:latest)
    │
    ├─ CARLA 0.9.15 (headless, run as 'carla' user)
    ├─ Race Server (Python, WebSocket on port 8765)
    └─ Cloudflare Tunnel (exposes WS to browser)
```

### Key Files

**Frontend (v3/src/):**
- `pages/Race.tsx` - Main racing page, keyboard controls, view state machine
- `components/RaceSetup.tsx` - Pre-race config: track, weather, laps, AI model
- `components/RaceHUD.tsx` - HUD overlay: speed, laps, gap, inputs, checkpoint arrow
- `components/VideoCanvas.tsx` - Renders binary JPEG frames to canvas
- `components/Minimap.tsx` - Top-down minimap with positions
- `hooks/useGPUConnection.ts` - WebSocket connection + GPU provisioning state
- `hooks/useEngineSound.ts` - Web Audio API engine sounds
- `types/index.ts` - TypeScript interfaces (RaceState, RacerState, etc.)

**Server (v3/server/):**
- `race_server.py` - WebSocket server, race loop (30Hz frames + 30Hz telemetry)
- `carla_manager.py` - CARLA vehicle/camera/control management, physics
- `race_logic.py` - Checkpoints, lap tracking, race state
- `model_manager.py` - AI model loading (PilotNet/Alpamayo)

**Infrastructure:**
- `v3/docker/Dockerfile` - Based on carlasim/carla:0.9.15 + Miniconda + PyTorch
- `v3/docker/entrypoint.sh` - Starts CARLA (as carla user) + race server + cloudflare tunnel
- `v3/api/gpu/start.ts` - Vast.ai provisioning with onstart script
- `.github/workflows/docker-build.yml` - Auto Docker build on push

---

## Deploy & Test (Server Changes)

Server code lives locally at `v3/server/`. To test changes on a running Vast.ai instance:

### Prerequisites
- SSH key loaded: `ssh-add ~/.ssh/id_ed25519` (key labeled "carla-shadow-driver")
- A running Vast.ai instance with Docker image `rkshah09/shadow-driver-v3:latest`

### Get SSH port and IP from Vast.ai
1. Go to https://cloud.vast.ai/instances/
2. Click the SSH icon (terminal `>_` button) on your instance
3. Copy the port and IP from the connection string: `ssh -p <PORT> root@<IP>`

### One-command deploy
From the `v3/` directory, run the deploy script which copies server files, restarts the server, starts a new Cloudflare tunnel, and prints the game link:

```bash
cd v3 && bash deploy.sh <PORT> <IP>
```

Example:
```bash
cd v3 && bash deploy.sh 50156 66.115.179.154
```

Output will include:
```
Game link:
https://shadow-driver-v3.vercel.app/race?ws=https://xxx.trycloudflare.com
```

Open that link in your browser to play.

### Manual deploy (if deploy.sh doesn't work)
```bash
scp -P <PORT> v3/server/carla_manager.py v3/server/race_server.py v3/server/race_logic.py root@<IP>:/opt/shadow-driver/server/
ssh -p <PORT> root@<IP>
pkill -f race_server; sleep 1
cd /opt/shadow-driver && python3 -u server/race_server.py &
```

### Check server logs
```bash
ssh -p <PORT> root@<IP> 'tail -30 /tmp/race.log'
```

## Quick Start (Fresh Instance)

1. Rent a GPU on Vast.ai (RTX 3090+, Docker image: `rkshah09/shadow-driver-v3:latest`)
2. Wait for instance to start, SSH in to check logs:
   ```bash
   ssh -p <PORT> root@<IP>
   cat /tmp/shadow-driver.log
   ```
3. Get the Cloudflare tunnel URL from logs (looks like `https://xxx.trycloudflare.com`)
4. Open: `https://shadow-driver-v3.vercel.app/race?ws=<tunnel_url>`
5. Configure track/weather/laps, click Start Race

---

## Known Issues & Fixes

### Issue: CARLA "Refusing to run with root privileges"
**Cause:** CARLA/UE4 checks getuid()==0 and exits. Vast.ai containers run as root.
**Fix:** Run CARLA as `carla` user via `su -s /bin/bash -c "..." carla` in entrypoint.sh

### Issue: Server crashes with SIGABRT (exit code 134)
**Cause:** CARLA actor cleanup while traffic manager is active, triggered by reconnecting clients
**Fix (applied):** Server no longer calls `cleanup()` on client disconnect. Instead, `_reset_race()` cancels loop tasks and resets state while keeping actors alive. Full `cleanup()` is only called when starting a new race. Cleanup order: disable autopilot, disable TM sync, disable world sync, destroy sensors, destroy vehicles (with sleeps between).

### Issue: AI car not visible / drives into walls
**Cause:** No trained model weights, neural network outputs random controls
**Fix:** Fallback to CARLA autopilot when weights not found

### Issue: Docker build "Password required" on GitHub Actions
**Cause:** DOCKERHUB_TOKEN secret empty or expired
**Fix:** Generate new Docker Hub access token, update repository secret

---

## Environment Variables

**Vercel (shadow-driver-v3 project):**
```
VASTAI_API_KEY              - Vast.ai API key for GPU provisioning
```

**GitHub (repository secrets):**
```
DOCKERHUB_USERNAME          - Docker Hub username (rkshah09)
DOCKERHUB_TOKEN             - Docker Hub access token
```
