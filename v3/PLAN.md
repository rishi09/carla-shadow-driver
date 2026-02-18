# V3 Implementation Plan: Head-to-Head CARLA Racing

## Status: IN PROGRESS - Core complete, polish phase

## Architecture

```
Browser (Vercel)                      Cloud GPU (Vast.ai)
+-----------------+                   +----------------------------------+
| React + Tailwind|   WebSocket/      | CARLA Simulator (headless)       |
|                 |   Cloudflare      |   +-- Player car (WASD+Space)    |
| <canvas> video  |<--Tunnel--------->|   +-- AI car (model inference)   |
| React HUD       |                   |   +-- Chase camera               |
| SpeedEffects    |                   |                                  |
| Model selector  |                   | Race Server (Python)             |
|                 |                   |   +-- CARLA control loop ~30fps  |
| useGPUConnection|  POST/GET         |   +-- Model inference            |
| (adapted v2)    |------------------>|   +-- JPEG encode + WS send      |
+-----------------+                   +----------------------------------+
        |
        v
  carla-shadow-driver.vercel.app (API - reused from v2)
  shadow-driver-v3.vercel.app (Frontend - new Vercel project)
```

## Key URLs
- Frontend: https://shadow-driver-v3.vercel.app
- API: https://carla-shadow-driver.vercel.app (reused from v2)
- GitHub branch: https://github.com/rishi09/carla-shadow-driver/tree/v3

## Completed Features

### Core (Phase 1)
- [x] React + TypeScript + Tailwind v4 + Vite frontend
- [x] WebSocket with binary JPEG frames + JSON race state
- [x] VideoCanvas rendering via createImageBitmap
- [x] RaceHUD with position, lap, speed, timer
- [x] GPU provisioning flow (start/poll/connect)
- [x] Model selector (PilotNet, Alpamayo)
- [x] Race results screen with lap breakdown
- [x] Docker image (CARLA + PyTorch + cloudflared)
- [x] Race server with dual-car management
- [x] AI model inference loop
- [x] Mock WebSocket server for testing

### Game Feel (Phase 2 - Implemented)
- [x] Progressive steering with speed sensitivity
- [x] Throttle/brake ramping (smooth, not binary)
- [x] Handbrake support (Space key)
- [x] Speed lines overlay (above 80 km/h)
- [x] Vignette effect scaling with speed
- [x] Cinematic 3-2-1-GO countdown with traffic lights
- [x] Gap timer (+/- seconds vs AI)
- [x] Extended telemetry (gear, RPM, throttle, brake, steer)
- [x] Input visualization bars (THR/BRK/STR)
- [x] Latency display from ping/pong
- [x] 30fps server tick rate (up from 20fps)

### Protocol Fixes
- [x] pong handler for latency measurement
- [x] model_switched handler for UI feedback
- [x] Nullable finish times (RaceFinished.player_time/ai_time)

## In Progress

- [ ] Weather/time-of-day selector (CARLA presets)
- [ ] Track selector (Town01-Town10HD)
- [ ] Human-friendly model difficulty labels
- [ ] Double-buffered VideoCanvas
- [ ] Race progress bar (both car positions)

## Remaining TODO

### Phase 3: Audio
- [ ] Engine sound synthesis (Web Audio API, RPM-based pitch)
- [ ] Tire screech on high lateral-G
- [ ] Collision impact sounds
- [ ] Countdown beeps
- [ ] Background music with intensity scaling

### Phase 4: Polish
- [ ] Screen shake on collision (needs collision sensor)
- [ ] Ghost car replay
- [ ] Post-race racing line visualization
- [ ] Camera mode toggle (chase/hood/bumper)
- [ ] Car reset/respawn (R key if stuck)
- [ ] Minimap with car positions

### Phase 5: Performance
- [ ] Decouple telemetry rate from frame rate (60Hz JSON, 30Hz JPEG)
- [ ] Adaptive JPEG quality based on latency
- [ ] Client-side HUD interpolation at 60fps

### Deployment
- [ ] Build and push Docker image to Docker Hub
- [ ] Fix Vercel production branch (change to v3)
- [ ] Full end-to-end test with GPU
- [ ] Verify API endpoints return JSON (not HTML)

## Directory Structure
```
v3/
+-- docker/Dockerfile, entrypoint.sh
+-- server/race_server.py, carla_manager.py, model_manager.py, model.py, frame_encoder.py, race_logic.py
+-- src/App.tsx, pages/{Home,Race}.tsx
+-- src/components/{VideoCanvas,RaceHUD,SpeedEffects,GPUConnectionModal,ModelSelector,RaceResults,RaceSetup,RaceProgressBar}.tsx
+-- src/hooks/useGPUConnection.ts, src/types/index.ts
+-- api/gpu/{start,status,callback,stop}.ts
+-- configs/race.yaml
+-- test/mock_ws_server.mjs
+-- PLAN.md, LEARNINGS.md
```

## WebSocket Protocol
- Binary messages = JPEG frames (server -> browser)
- JSON messages = race_state, race_finished, control, handshake, ping/pong, model_switched, error
- Browser sends: { type: "control", keys: { w, a, s, d, space } }
- Server sends: { type: "race_state", player: { speed_kmh, lap, checkpoint, gear, rpm, throttle, brake, steer, gap_seconds, ... }, ai: {...}, model, race_status, fps }

## Testing Strategy (No Browser Available)
1. TypeScript compilation: npx tsc --noEmit
2. Vite build: npm run build
3. Python syntax: python3 -c "import ast; ast.parse(...)" on each file
4. Mock WS server: node v3/test/mock_ws_server.mjs
5. Cross-check WS protocol types between server and frontend
6. Curl deployed Vercel URLs for HTML/JSON responses

## Ralph Wiggum Loop
When bugs are found:
1. Identify the bug
2. Fix it
3. Write learning to LEARNINGS.md
4. Re-run verification (tsc + vite build + Python syntax)
5. Repeat until clean
