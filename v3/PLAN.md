# V3 Implementation Plan: Head-to-Head CARLA Racing

## Status: IN PROGRESS - Performance & deployment phase

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

### Setup & Selection (Phase 2.5 - Implemented)
- [x] Weather/time-of-day selector (CARLA presets)
- [x] Track selector (Town01-Town10HD)
- [x] Human-friendly model difficulty labels
- [x] Double-buffered VideoCanvas
- [x] Race progress bar (both car positions)

### Audio (Phase 3 - Implemented)
- [x] Engine sound synthesis (Web Audio API, RPM-based pitch)
- [x] Tire screech on high lateral-G
- [x] Countdown beeps

### Polish (Phase 4 - Implemented)
- [x] Car reset/respawn (R key if stuck)
- [x] Minimap with car positions

### Performance (Phase 5 - Implemented)
- [x] Adaptive JPEG quality based on latency
- [x] Client-side HUD interpolation at 60fps

## Remaining TODO

### Audio (Remaining)
- [ ] Collision impact sounds
- [ ] Background music with intensity scaling

### Polish (Remaining)
- [ ] Screen shake on collision (needs collision sensor)
- [ ] Ghost car replay
- [ ] Post-race racing line visualization
- [ ] Camera mode toggle (chase/hood/bumper)

### Performance (Remaining)
- [ ] Decouple telemetry rate from frame rate (60Hz JSON, 30Hz JPEG)

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
+-- src/components/{VideoCanvas,RaceHUD,SpeedEffects,GPUConnectionModal,ModelSelector,RaceResults,RaceSetup,RaceProgressBar,Minimap}.tsx
+-- src/hooks/{useGPUConnection,useEngineSound,useInterpolatedState}.ts
+-- src/types/index.ts
+-- api/gpu/{start,status,callback,stop}.ts
+-- configs/race.yaml
+-- test/mock_ws_server.mjs
+-- PLAN.md, LEARNINGS.md
```

## WebSocket Protocol
- Binary messages = JPEG frames (server -> browser)
- JSON messages = race_state, race_finished, control, handshake, ping/pong, model_switched, respawn_ack, camera_mode_changed, error

### Browser -> Server
- `{ type: "control", keys: { w, a, s, d, space }, latency: number }` - Player input with measured latency
- `{ type: "handshake" }` - Initial connection
- `{ type: "ping", timestamp: number }` - Latency measurement
- `{ type: "start_race", track: string, laps: number, weather: string }` - Begin race with settings
- `{ type: "switch_model", model: string }` - Change AI model
- `{ type: "respawn" }` - Reset player car to last checkpoint (R key)
- `{ type: "camera_mode", mode: string }` - Switch camera perspective

### Server -> Browser
- `{ type: "race_state", player: { speed_kmh, lap, total_laps, checkpoint, lap_time, best_lap, position, finished, gear, rpm, throttle, brake, steer, gap_seconds, x, y, checkpoints, jpeg_quality, collisions }, ai: { ... }, model, race_status, fps, countdown, winner, camera_mode }`
- `{ type: "race_finished", winner, player_time, ai_time, player_laps, ai_laps }`
- `{ type: "handshake_ack", server, models }`
- `{ type: "pong", timestamp }`
- `{ type: "model_switched", model, success }`
- `{ type: "respawn_ack", checkpoint: number }` - Confirms respawn, includes checkpoint index
- `{ type: "camera_mode_changed", mode: string }` - Confirms camera mode switch
- `{ type: "error", message }` - Error notification

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
