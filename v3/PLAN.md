# V3 Implementation Plan: Head-to-Head CARLA Racing

## Status: IN PROGRESS

## Architecture

```
Browser (Vercel)                      Cloud GPU (Vast.ai)
+-----------------+                   +----------------------------------+
| React + Tailwind|   WebSocket/      | CARLA Simulator (headless)       |
|                 |   Cloudflare      |   +-- Player car (WASD)          |
| <canvas> video  |<--Tunnel--------->|   +-- AI car (model inference)   |
| React HUD       |                   |   +-- Chase camera               |
| Model selector  |                   |                                  |
|                 |                   | Race Server (Python)             |
| useGPUConnection|  POST/GET         |   +-- CARLA control loop ~20fps  |
| (adapted v2)    |------------------>|   +-- Model inference            |
+-----------------+                   |   +-- JPEG encode + WS send      |
        |                             +----------------------------------+
        v
  carla-shadow-driver.vercel.app (API - reused from v2)
  shadow-driver-v3.vercel.app (Frontend - new Vercel project)
```

## Key URLs
- Frontend: https://shadow-driver-v3.vercel.app
- API: https://carla-shadow-driver.vercel.app (reused from v2)

## Directory Structure
```
v3/
+-- docker/Dockerfile, entrypoint.sh
+-- server/race_server.py, carla_manager.py, model_manager.py, model.py, frame_encoder.py, race_logic.py
+-- src/App.tsx, pages/{Home,Race}.tsx, components/{VideoCanvas,RaceHUD,GPUConnectionModal,ModelSelector,RaceResults}.tsx
+-- src/hooks/useGPUConnection.ts, src/types/index.ts
+-- api/gpu/{start,status,callback,stop}.ts
+-- configs/race.yaml
+-- package.json, tsconfig.json, vite.config.ts, tailwind.config.js, vercel.json
```

## WebSocket Protocol
- Binary messages = JPEG frames (server -> browser)
- JSON messages = race_state, control, handshake, ping/pong
- Browser sends: { type: "control", keys: { w, a, s, d } }
- Server sends: { type: "race_state", player: {...}, ai: {...}, model, race_status, fps }

## API Base URL
- Frontend calls API at: https://carla-shadow-driver.vercel.app
- This is the SAME API project as v2 (shared Upstash Redis, same VASTAI_API_KEY)
- v3 API routes are deployed under the v3 Vercel project for start.ts changes only
- status/callback/stop reuse v2's deployed endpoints

## Files Reused from v2
- model_manager.py, model.py: copied as-is
- carla_client.py: reference for carla_manager.py (extended for 2 cars)
- useGPUConnection.ts: adapted for binary frames + race state
- API routes: status.ts, callback.ts, stop.ts copied; start.ts adapted

## Testing Strategy (No Browser Available)
1. TypeScript compilation: npx tsc --noEmit
2. Vite build: npm run build
3. Python syntax: python3 -m py_compile on each file
4. Curl deployed Vercel URL for HTML/JSON responses
5. Mock WebSocket server for frontend testing
6. Cross-check WS protocol types between server and frontend

## Ralph Wiggum Loop
When bugs are found:
1. Identify the bug
2. Fix it
3. Write learning to LEARNINGS.md
4. Re-run verification
5. Repeat until clean
