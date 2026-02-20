# Shadow Driver v3 - Project Instructions

## Project Overview

Shadow Driver is a browser-based racing game where you race against an AI car in CARLA simulator running on a cloud GPU. The frontend is a React/Vite app deployed on Vercel. The backend is a Python WebSocket server running inside a Docker container on Vast.ai GPU instances, streaming H.264 video from CARLA via NVENC hardware encoding (with JPEG fallback).

**Key URLs:**
- Game (v3): https://shadow-driver-v3.vercel.app
- Docker image: rkshah09/shadow-driver-v3:latest
- GitHub: https://github.com/rishi09/carla-shadow-driver

**Active branch:** `v3`

---

## Current Status (Feb 20, 2026)

### Working (E2E verified with Safari automation + Vast.ai GPU)
- CARLA 0.9.15 running on Vast.ai GPU (RTX 3090, root privilege fix applied)
- Direct WebSocket connection via `?ws=<tunnel_url>` query parameter
- H.264 video via NVENC hardware encoding + WebCodecs decode (~30 FPS, ~80-120ms latency target). Falls back to JPEG when unavailable.
- NVENC encoder now matched to camera resolution (1920x1080) — fixes frame size mismatch that caused 548 encode errors and black screen
- NVENC spatial-AQ for 10-15% better perceived quality at zero latency cost
- NVENC H.264 encoding pipeline (server) + WebCodecs VideoDecoder (client) — auto-fallback to JPEG if unavailable
- Player car controls: WASD + Space (handbrake), R (respawn), C (camera toggle)
- Car selection: 6 vehicles (Tesla Model 3, Ford Mustang, Dodge Charger, Audi TT, Mini Cooper, Chevrolet Impala)
- AI opponent using CARLA autopilot with 3 difficulty levels (Easy/Medium/Hard)
- AI rubber banding: distance-based speed adjustment keeps races close (50m threshold, per-difficulty scaling)
- AI mistake injection: periodic speed penalties create overtaking opportunities
- AI personality system with emotional states (confident, nervous, impressed, desperate)
- AI trash talk ("Right on your tail...", "Contact! Watch the walls!")
- Hard mode: 55% over speed limit, aggressive lane changes
- Steering: progressive ramping (~100-130ms attack, ~130-200ms release), speed-limited (0.7 low, 0.15 high)
- Faster throttle (~150ms) and brake (~60ms) response; reverse threshold 15 km/h
- Traction control + countersteer assist (10° threshold, 0.35 max correction — tuned for high latency)
- Tire grip tuned for high-latency stability: front friction 4.0, rear 3.8, matched lateral stiffness, CoM -0.4
- Drift detection and scoring system
- Compass navigation arrow pointing to next checkpoint
- Race HUD: speedometer, lap timer, gap timer, throttle/brake/steer bars, connection quality, drift score
- Minimap with player/AI positions + race progress tracker
- Countdown overlay (3-2-1-GO with traffic light colors)
- Engine sound + background music with speed-based intensity
- Camera FOV scaling at speed (1.0→1.05x at 150+ km/h)
- Speed vignette (GPU-accelerated CSS gradient) + speed lines above 80 km/h
- Screen shake, motion blur, steering prediction transforms, G-force tilt all **disabled** for high-latency playability
- Rear-view mirror camera (disabled — can be re-enabled)
- Daily Challenge system (unique track/weather/difficulty per day)
- Photo mode (F key)
- Race recording overlay (REC indicator)
- FirstTimeOverlay with controls tutorial
- Debug overlay (~ key): FPS, latency, quality, resolution, encode time, codec
- Tab title stats: shows `18fps 340ms | Shadow Driver` during racing
- Health check script: `node v3/scripts/health_check.mjs` tests full WebSocket pipeline
- Server session metrics: per-second [stats] log line, session summary on disconnect
- GitHub Actions auto-builds Docker image on push to v3 (server/docker/configs paths)
- NvFBC zero-copy GPU framebuffer capture (with x11grab fallback, then CARLA sensor fallback)
- Adaptive bitrate (2-12 Mbps) based on client network quality (jitter, drop rate, RTT)
- CARLA depth-of-field post-processing presets (Cinematic/Balanced/Raw) selectable in Race Setup
- WebRTC data channel for low-latency input (~30-50ms savings, falls back to WebSocket over tunnels)
- Xvfb virtual display (:99) for NvFBC capture compatibility
- Visual Style selector in Race Setup advanced settings
- Adaptive quality tiers relaxed for SSH tunnels: >500ms->q25/540p, 300-500ms->q50/720p, 150-300ms->q60, 80-150ms->q70, <80ms->q75
- `v3/play.sh` — one-command local play setup: auto-detects Vast.ai instance, loads SSH key, starts tunnel + Vite

### Not Working / TODO
- **Latency-adaptive steering**: Server should reduce steering limits when RTT is high (280ms+) to prevent overcorrection fishtailing. Partially addressed by grip tuning, but a dynamic latency→steer_limit multiplier is the right fix.
- **Tunneling**: ngrok blocked by IT restrictions. bore.pub unreachable from some Vast.ai datacenters. Cloudflare QUIC timeouts on Russian datacenters. **SSH port forwarding is the most reliable option**: `ssh -N -L 8765:localhost:8765 -p PORT root@IP`. Localtunnel.me may work as alternative.
- **Vercel deploy**: Project is `shadow-driver-v3` under team `rishi09-3609s-projects`. Root directory is `v3/`.
  - **CLI deploy** (from repo root, NOT from v3/): `npx vercel deploy --prod --yes --scope rishi09-3609s-projects --token <VERCEL_TOKEN>`
  - **IMPORTANT**: Must run from repo root (`/Users/rkshah20/side-projects/carla-shadow-driver/`), not from `v3/`. Vercel project has `rootDirectory: v3` configured server-side.
  - **IMPORTANT**: Git email must be `rishi09@gmail.com` (not `rkshah20@fb.com`). Set with: `git config user.email "rishi09@gmail.com"`
  - **Free tier limit**: 100 deployments/day. If rate limited, wait ~1 hour.
  - **Token**: Generate at https://vercel.com/account/tokens (scope: full account)
- **WebRTC disabled (intentional)**: WebRTC video was disabled in commit 92e56e0 because Cloudflare quick tunnels don't support UDP. JPEG-over-WebSocket works reliably. TODO: Re-enable WebRTC when using direct IP connections (not tunnels).
- **Server SIGABRT crash (mitigated)**: Cleanup now disables autopilot and sync mode before destroying actors, sensors destroyed before vehicles. Server no longer calls cleanup on client disconnect — only on new race start. Still close extra tabs to be safe.
- **No trained model weights**: AI uses CARLA autopilot fallback. PilotNet weights available at HuggingFace (sergiopaniego/OptimizedPilotNet, 200x66 input). Alpamayo is 10B params (~20GB), probably won't fit alongside CARLA on 24GB GPU.
- **Full provisioning flow untested**: The "Play Game" button flow (Vast.ai auto-provision + Cloudflare tunnel + callback) hasn't been tested end-to-end with the v3 Docker image.
- **Docker Hub token**: Secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set in GitHub. Push to v3 branch (paths: `v3/server/**`, `v3/docker/**`, `v3/configs/**`) triggers auto-build via `.github/workflows/docker-build.yml`.
- **Cloudflare tunnels unreliable on some datacenters**: QUIC connections timeout on some Vast.ai hosts. Workaround: use `--protocol http2` flag, or SSH port forwarding (`ssh -N -L 8765:localhost:8765 -p PORT root@IP`), or local dev server (`npm run dev` + SSH tunnel). ngrok is preferred but requires valid auth token.
- **ngrok auth token**: If the token is expired or missing, generate a new one at https://dashboard.ngrok.com/get-started/your-authtoken. **Do not ask the user for this — proactively get a new token yourself from the ngrok dashboard if needed, or remind the user only once that they need to provide it.** Store the token in Vercel env (`NGROK_AUTHTOKEN`) and pass to Vast.ai instances via `start.ts`.

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
    └─ Tunnel (Cloudflare/ngrok/SSH port forward)
```

### Key Files

**Frontend (v3/src/):**
- `pages/Race.tsx` - Main racing page, keyboard controls, view state machine, FOV scaling
- `components/RaceSetup.tsx` - Pre-race config: track, weather, laps, AI model, car selection
- `components/RaceHUD.tsx` - HUD overlay: speed, laps, gap, inputs, checkpoint arrow
- `components/VideoCanvas.tsx` - Renders binary JPEG frames to canvas (fallback path)
- `components/WebGLCanvas.tsx` - WebGL2 renderer with shader post-processing (primary path)
- `components/WebRTCVideo.tsx` - WebRTC H.264 video stream (disabled for tunnel compat)
- `components/SpeedEffects.tsx` - Speed vignette + collision/gear flash
- `components/SpeedLines.tsx` - Anime-style radial speed lines
- `components/ParticleOverlay.tsx` - Sparks, tire smoke, rain particles
- `components/Minimap.tsx` - Top-down minimap with positions
- `components/ArcSpeedometer.tsx` - SVG arc speedometer with animated needle
- `components/RaceResults.tsx` - Post-race results with Wordle-style share
- `hooks/useGPUConnection.ts` - WebSocket connection, GPU provisioning state, exposes window.__gameWs
- `hooks/useEngineSound.ts` - Web Audio API engine sounds
- `hooks/useGamepad.ts` - Gamepad API support (analog triggers/sticks)
- `hooks/useSteeringPrediction.ts` - Client-side steering prediction for lag compensation
- `hooks/useFrameExtrapolation.ts` - Frame interpolation/extrapolation
- `types/index.ts` - TypeScript interfaces (RaceState, RacerState, etc.)

**Server (v3/server/):**
- `race_server.py` - WebSocket server, WebRTC signaling, race loop (30Hz frames + 30Hz telemetry), NVENC H.264 encoding with JPEG fallback
- `carla_manager.py` - CARLA vehicle/camera/control management, physics, AI speed adjustment, raw BGRA frame buffer
- `race_logic.py` - Checkpoints, lap tracking, race state, RaceDirector (rubber banding), AIMistakeGenerator
- `nvenc_encoder.py` - FFmpeg NVENC subprocess H.264 encoder, NAL unit parsing, codec config extraction
- `nvfbc_capture.py` - NvFBC zero-copy GPU framebuffer capture with x11grab fallback
- `webrtc_track.py` - CarlaVideoTrack (MediaStreamTrack) for H.264 streaming via aiortc
- `model_manager.py` - AI model loading (PilotNet/Alpamayo)

**Infrastructure:**
- `v3/docker/Dockerfile` - Based on carlasim/carla:0.9.15 + Miniconda + PyTorch + FFmpeg NVENC
- `v3/docker/entrypoint.sh` - Starts CARLA (as carla user) + race server + cloudflare tunnel
- `v3/api/gpu/start.ts` - Vast.ai provisioning with onstart script
- `.github/workflows/docker-build.yml` - Auto Docker build on push

---

## "Let's Play" Workflow

When the user says "let's play", "let's test", or similar, follow these steps **in order**:

### Prerequisites (user must do once per login session)
The sandbox cannot access `~/.ssh/id_ed25519` directly (macOS restriction), but it **can** use the shared SSH agent socket. The user must run `ssh-add ~/.ssh/id_ed25519` once in any terminal. After that, Claude can SSH freely for the rest of the session.

If `ssh-add -l` shows "no identities", tell the user: `ssh-add ~/.ssh/id_ed25519` — nothing else.

### Steps Claude performs
1. **Check SSH key**: Run `ssh-add -l` — if no identities, ask user to run `ssh-add ~/.ssh/id_ed25519` and wait.
2. **Find GPU instance**: Query Vast.ai API for running instances. If none, tell user to rent one.
3. **Check race server**: `ssh -p <PORT> root@<HOST> 'pgrep -af race_server'` — if not running, start it.
4. **Set idle timeout**: `ssh -p <PORT> root@<HOST> "sed -i 's/IDLE_TIMEOUT_SECONDS = 10 \* 60/IDLE_TIMEOUT_SECONDS = 60 * 60/' /opt/shadow-driver/server/race_server.py"` (only if server was restarted).
5. **Start SSH tunnel**: `ssh -o StrictHostKeyChecking=no -N -L 8765:localhost:8765 -p <PORT> root@<HOST> &` (background).
6. **Start Vite**: `cd v3 && npx vite --host &` if not already on :5173.
7. **Verify**: Check `lsof -i :8765` and `lsof -i :5173` both show LISTEN.
8. **Tell user**: "Open http://localhost:5173/race?ws=ws://localhost:8765"

### Alternative: User runs play.sh
The script `v3/play.sh` does all of the above in one command:
```bash
cd v3 && ./play.sh
```
It auto-detects the Vast.ai instance (no args needed), loads SSH key, starts tunnel + Vite.

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

### SSH port forward (when tunnels fail)
If Cloudflare and ngrok both fail, use SSH port forwarding + local dev server:
```bash
# Terminal 1: SSH tunnel
ssh -N -L 8765:localhost:8765 -p <PORT> root@<IP>

# Terminal 2: Local frontend
cd v3 && npm run dev

# Open: http://localhost:5173/race?ws=ws://localhost:8765
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

### Issue: Cloudflare tunnel unreliable
**Cause:** Quick tunnels (`cloudflared tunnel --url ...`) die within minutes, DNS expires, sometimes corrupt WebSocket upgrade headers (`invalid Connection header: keep-alive`). QUIC connections timeout on some Vast.ai datacenters.
**Fix:** Use `--protocol http2` flag with cloudflared to avoid QUIC issues. Use SSH port forwarding for dev (`ssh -N -L 8765:localhost:8765 -p <PORT> root@<IP>` + `cd v3 && npm run dev` + open `http://localhost:5173/race?ws=ws://localhost:8765`), or use ngrok for production (more stable, but requires valid auth token).

### Issue: Mock WebSocket server blocking SSH tunnel
**Cause:** A test mock server (`node test/mock_ws_server.mjs`) running on port 8765 intercepts connections meant for the SSH tunnel
**Fix:** Kill the mock server (`kill <pid>`) and verify only the SSH process is on port 8765 (`lsof -i :8765`)

### Issue: NVENC black screen — frame size mismatch (FIXED)
**Cause:** NVENC encoder was initialized at streaming resolution (1280x720 from `config.streaming`) but CARLA camera produces frames at camera resolution (1920x1080 from `config.camera.chase`). Every frame failed with `Frame size mismatch: got 8294400, expected 3686400`, resulting in 548 errors, 0 actual frames, and a black screen.
**Fix (applied):** Changed `_start_nvenc_encoder()` to use `config.camera.chase.width/height` instead of `config.streaming.width/height`. Now NVENC encodes at 1920x1080 matching the actual frame data. Result: 1180 frames encoded, 0 errors, 30 FPS.

### Issue: Car feels drifty / fishtails with high latency
**Cause:** At 280ms SSH tunnel latency, input delay causes overcorrection. The rear tires had lower friction (3.2 vs 3.8 front) creating intentional oversteer that becomes uncontrollable at high latency. Countersteer assist threshold (15°) and strength (0.25) were too low to compensate.
**Fix (applied):** Increased rear tire friction to 3.8 (matching front), raised lateral stiffness (rear 17→20, front 20→22), lowered center of mass (-0.3→-0.4), strengthened countersteer assist (10° threshold, 0.35 max correction). **Still TODO:** latency-adaptive steering limits (reduce steer_limit based on measured RTT).

### Issue: Screen tilt/shake/blur makes high-latency play nauseating
**Cause:** CSS transforms (steering prediction rotation, G-force tilt, frame extrapolation, motion blur, screen shake) fight with 280ms-delayed server frames, making the visual feed disorienting.
**Fix (applied):** Disabled all CSS transforms on the video feed except basic FOV scale. Disabled screen shake on collisions. These can be re-enabled when latency drops below ~100ms.

---

## Environment Variables

**Vercel (shadow-driver-v3 project):**
```
VASTAI_API_KEY              - Vast.ai API key for GPU provisioning
NGROK_AUTHTOKEN             - ngrok auth token for low-latency tunnels (free at https://ngrok.com)
```

**GitHub (repository secrets):**
```
DOCKERHUB_USERNAME          - Docker Hub username (rkshah09)
DOCKERHUB_TOKEN             - Docker Hub access token
VERCEL_TOKEN                - Vercel deploy token (from https://vercel.com/account/tokens)
VERCEL_ORG_ID               - Vercel org/team ID (from Project Settings > General)
VERCEL_PROJECT_ID           - Vercel project ID (from Project Settings > General)
```

**Vast.ai instance (set via start.ts env or manually):**
```
NGROK_AUTHTOKEN             - ngrok auth token (passed from Vercel env, or set manually)
```

---

## Testing Workflow

### Quick test after deploy (automated)
Run a WebSocket health check from local machine through SSH tunnel:
```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8765');
ws.on('open', () => ws.send(JSON.stringify({type:'handshake', client:'shadow-driver-v3'})));
ws.on('message', (data) => { console.log('OK:', JSON.parse(data).type); ws.close(); process.exit(0); });
ws.on('error', (e) => { console.log('Error:', e.message); process.exit(1); });
setTimeout(() => { console.log('Timeout'); process.exit(1); }, 5000);
"
```

### Server performance check
After the user plays, check the race log for performance data:
```bash
ssh -p <PORT> root@<IP> 'grep -E "perf|adaptive|latency|encode" /tmp/race.log | tail -20'
```

### Key things to verify before telling user to play
1. Race server process is running: `pgrep -af race_server`
2. SSH tunnel is forwarding port 8765: `lsof -i :8765`
3. Vite dev server is running: `lsof -i :5173`
4. WebSocket handshake works (node test above)
5. Idle timeout is set to 60+ minutes (not 10 min default)

### Common pitfalls
- **Server auto-shutdown**: Default is 10 min. Always increase to 60 min after deploy: `sed -i 's/IDLE_TIMEOUT_SECONDS = 10 \* 60/IDLE_TIMEOUT_SECONDS = 60 * 60/' /opt/shadow-driver/server/race_server.py`
- **Port 8765 zombie**: After killing server, port may stay bound. Fix: `fuser -k 8765/tcp` or find PID via `/proc/net/tcp`
- **React StrictMode**: Removed from main.tsx (was causing double-mount WebSocket drops in dev mode)
- **SSH tunnel dies silently**: Re-establish with `ssh -N -L 8765:localhost:8765 -p <PORT> root@<IP> &`
