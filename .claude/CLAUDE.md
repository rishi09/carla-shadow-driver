# Shadow Driver v3 - Project Instructions

## Project Overview

Shadow Driver is a browser-based racing game where you race against an AI car in CARLA simulator running on a cloud GPU. The frontend is a React/Vite app deployed on Vercel. The backend is a Python WebSocket server running inside a Docker container on Vast.ai GPU instances, streaming H.264 video from CARLA via NVENC hardware encoding (with JPEG fallback).

**Key URLs:**
- Game (v3): https://shadow-driver-v3.vercel.app
- Docker image: rkshah09/shadow-driver-v3:latest
- GitHub: https://github.com/rishi09/carla-shadow-driver

**Active branch:** `v3`

---

## Meta-Rules (Read First)

> **"Written ≠ Working."** If nobody tested it in gameplay, it's not done — it's a hypothesis. Never mark a feature "Working" or a bug "Fixed" without verifiable evidence from actual gameplay. Commit messages must describe what was verified, not what was intended.

> **"Coding Blind."** The AI agent edits code it cannot see the output of. It edits GLSL shaders but cannot see what they render. It changes frame delivery logic but cannot see the FPS the user experiences. Documentation amplifies this blindness across sessions: Session 1 writes "disabled ✓", Session 2 reads it and skips re-verification, Session 3 the user reports it's still broken. Three sessions of compounding false confidence.

### Layer Checklist (Visual Changes)
When disabling or modifying any visual effect, verify ALL 4 layers:
1. **CSS transforms** — React component `style={}` props (steering prediction, G-force tilt, shake)
2. **GLSL shader uniforms** — WebGLCanvas.tsx fragment shader (barrel distortion, chromatic aberration, radial blur, film grain, color grading, vignette)
3. **CSS overlays** — SpeedEffects.tsx (vignette, collision flash), SpeedLines.tsx (radial lines), ParticleOverlay.tsx (sparks, smoke)
4. **Server camera config** — carla_manager.py post-processing (depth of field, bloom, exposure)

### Metric Trust Rules
1. Always verify which **codec path** is active before trusting `encode_ms` or `fps` stats. Server may log JPEG encoder stats while NVENC is the active codec — making `fps=29` a lie when real delivery is 3 FPS.
2. `total_frames` in session summary is the **ground truth** for delivery — not per-second `fps`.
3. Tab title FPS is **client-measured truth** — if it disagrees with server stats, client wins.
4. When reporting metrics, always state the source: "(JPEG path)", "(NVENC path)", "(client-measured)".

### Pre-Play Testing Checklist
Before telling the user to play, ALL must pass:
- [ ] Server: `total_frames` increasing at 15+ per second in logs
- [ ] Server: `skip` count < 5 per second in `[stats]` line
- [ ] Server: rear mirror frames NOT being sent (bandwidth waste)
- [ ] Client: tab title shows 15+ fps
- [ ] Client: no visible shader effects (barrel distortion, chromatic aberration, blur)
- [ ] Client: countdown 3-2-1-GO displays when race starts
- [ ] Client: input bars (throttle/brake/steer) visible and responding to keys
- [ ] Client: gap timer shows numbers, not "---"
- [ ] Client: debug overlay toggles with ~ key

---

## Current Status (Feb 23, 2026)

### Gameplay Test History
| Test | Date | Score | Key Changes | Key Findings |
|------|------|-------|-------------|--------------|
| 1 | Feb 23 | 3/10 | Baseline | 3.1 FPS, all shader effects active, no HUD, car crawls |
| 2 | Feb 23 | 4/10 | Shaders disabled, NVENC fallback | Clean video 10/10, but still 7.9 FPS, TC/auto-brake throttle car |
| 3 | Feb 23 | 6/10 | TC/auto-brake disabled, quality raised, delta skip disabled, overlays removed | 21-30 FPS, sharp video, car drives fast. Missing: input bars, countdown, AI visibility |

### Working (verified via Gemini video analysis, Test 3)
- CARLA 0.9.15 running on Vast.ai GPU (RTX 3090, root privilege fix applied)
- Direct WebSocket connection via `?ws=<tunnel_url>` query parameter
- H.264 video via NVENC hardware encoding + WebCodecs decode. Falls back to JPEG when NVENC starves (>100ms without frame) or is unavailable.
- NVENC encoder matched to camera resolution (1920x1080)
- NVENC spatial-AQ for 10-15% better perceived quality at zero latency cost
- **Video feed: 21-30 FPS, sharp image quality** (Gemini: 8/10 video, 7/10 smoothness)
- **Car speed and physics: fast acceleration, 140+ km/h achievable** (Gemini: 9/10)
- Player car controls: WASD + Space (handbrake), R (respawn), C (camera toggle)
- Car selection: 6 vehicles (Tesla Model 3, Ford Mustang, Dodge Charger, Audi TT, Mini Cooper, Chevrolet Impala)
- AI opponent using CARLA autopilot with 3 difficulty levels (Easy/Medium/Hard)
- AI rubber banding, mistake injection, personality system, trash talk
- Steering: progressive ramping (~100-130ms attack, ~130-200ms release), speed-limited (0.7 low, 0.15 high)
- Faster throttle (~150ms) and brake (~60ms) response; reverse threshold 15 km/h
- Traction control **DISABLED** for high-latency playability (was capping throttle at 63-77%)
- Auto-brake **DISABLED** for high-latency playability (was applying 30% brake during turns)
- Countersteer assist active (10° threshold, 0.35 max correction)
- Tire grip tuned for high-latency stability: front friction 4.0, rear 3.8, matched lateral stiffness, CoM -0.4
- Race HUD: speedometer (verified), gap timer (verified, shows numbers), minimap (verified)
- Engine sound + background music with speed-based intensity
- Camera FOV scaling at speed (1.0→1.05x at 150+ km/h)
- All overlay effects **REMOVED for MVP** (SpeedLines, SpeedEffects, ParticleOverlay, DriftScore, checkpoint flash, etc.) — re-enable after 7+/10 rating
- Screen shake, motion blur, steering prediction transforms, G-force tilt all **disabled** at CSS layer
- GLSL shader effects all **disabled** (barrel distortion=0, CA=0, radial blur=0, film grain removed, color grading=identity)
- Rear-view mirror camera (disabled client + server — server no longer sends rear frames)
- Frame delta detection **DISABLED** (was skipping 12+ frames/sec due to block-mean hash sensitivity)
- Debug overlay (~ key): FPS, latency, quality, resolution, encode time, codec
- Tab title stats: shows FPS and latency during racing
- Health check script, server session metrics, GitHub Actions Docker auto-build
- NvFBC zero-copy GPU framebuffer capture (with x11grab fallback, then CARLA sensor fallback)
- Adaptive bitrate (2-12 Mbps), CARLA DoF presets, Visual Style selector
- Adaptive quality tiers for SSH tunnels: >500ms->q60/540p, 150-500ms->q80/720p, 80-150ms->q85/720p, <80ms->q90/1080p
- Frame skip: min 2fps guarantee, disabled during countdown, 0.5m position delta threshold
- `v3/play.sh` — one-command local play setup

### Not Working / TODO (priority order)
- **Input bars (throttle/brake/steer) not visible** — Gemini Test 3 confirmed missing. RaceHUD renders them but they may not be receiving data or may be hidden by layout.
- **Countdown (3-2-1-GO) not appearing** — Gemini Test 3 confirmed race starts abruptly with no countdown. Code exists in Race.tsx and race_logic.py but isn't triggering.
- **AI opponent not visible on track** — Gap timer works (+53.5s) but AI car never appears in the camera view. May be on a different route or too far ahead.
- **Latency ~155ms still causes wall-riding** — Down from 280ms but still causes late turns. Latency-adaptive steering (dynamic steer_limit based on RTT) is the right fix.
- **Re-enable overlay effects post-MVP** — SpeedLines, SpeedEffects, ParticleOverlay, DriftScore, checkpoint flash, drift boost, etc. were all removed from Race.tsx for MVP. Bring back selectively after reaching 7+/10 Gemini rating. Code is in git history.
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

### Vast.ai API Key
The API key is stored in `v3/.vercel/.env.development.local` (pulled from Vercel env vars). Read `VASTAI_API_KEY` from that file. It is also cached at `~/.config/vastai/api_key`. The Vast.ai API requires trailing slashes on endpoints (e.g., `/api/v0/instances/?owner=me`).

### Steps Claude performs
1. **Check SSH key**: Run `ssh-add -l` — if no identities, ask user to run `ssh-add ~/.ssh/id_ed25519` and wait.
2. **Find GPU instance**: Query Vast.ai API for running instances. If none, provision one (RTX 3090/4090, image `rkshah09/shadow-driver-v3:latest`, 40GB disk, NA datacenter preferred). **IMPORTANT**: Only use `verified` hosts. Filter with `"verified":{"eq":true}`. Blocked hosts (CDI errors): 85323, 189245, 344939. Blocked machines: 16146, 32581, 42700, 52157. These fail with "failed to inject CDI devices" OCI runtime errors.
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

### Issue: NVENC encoder starvation — 5 frames in 54 seconds (FIXED)
**Cause:** When H.264 was negotiated, `_send_frame()` entered the NVENC path and returned early even if `get_encoded_frame()` returned None. No JPEG fallback existed for the H.264 path. Combined with aggressive frame skipping (position delta < 0.1m skipping 28/30 frames when car is slow/stationary), resulted in 3.1 FPS delivered despite server logging `fps=29` from the JPEG encoder metrics. The JPEG metrics masked the NVENC starvation because they measured the wrong codec path.
**Fix (applied):** Added JPEG fallback when NVENC starves (>100ms without frame). Added `_nvenc_consecutive_empty` counter — after 10 empty polls, temporarily disables H.264 for 5 seconds. Raised frame skip position delta from 0.1m to 0.5m. Added minimum frame rate guarantee (never skip if >500ms since last frame). Disabled frame skipping during countdown.

### Issue: GLSL shader effects still active despite "disabled" in docs (FIXED)
**Cause:** Visual effects exist at 4 independent layers: CSS transforms, GLSL shader, CSS overlays, server camera config. Previous fix only disabled CSS transforms and documented "effects disabled" — but barrel distortion, chromatic aberration, radial blur, film grain, and speed-based color grading were all still active in the GLSL fragment shader in WebGLCanvas.tsx. The AI agent couldn't see the rendered output, so it trusted its own documentation from the previous session.
**Fix (applied):** Disabled ALL GLSL shader effects: barrel distortion=0.0, chromatic aberration=0.0, radial blur=0.0, film grain removed, color grading set to identity (no-op). Added Layer Checklist to CLAUDE.md to prevent recurrence.

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
