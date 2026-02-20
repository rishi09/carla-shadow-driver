# AGENT CONTEXT - Shared State for All Agents
# =============================================
# EVERY agent MUST read this file before starting work.
# EVERY agent MUST update this file when they create/modify files.
# This prevents merge conflicts and ensures coordination.
#
# Last updated: 2026-02-20T07:00:00Z

## Active Agent Registry
<!-- Agents: add yourself here when starting, remove when done -->

| Agent | Task | Files Owned | Status |
|-------|------|-------------|--------|
| a3ea552 | AI Trash Talk | server/data/trash_talk.json, components/AIChatBubble.tsx | running |
| ad71eb4 | Gamepad API | hooks/useGamepad.ts | running |
| a6e8ef0 | Instant Restart + Browser APIs | (modifying Race.tsx, race_server.py) | running |
| a091a86 | Race Result Card | components/RaceResultCard.tsx | running |
| a70dc41 | Daily Challenge + Adaptive Music | hooks/useDailyChallenge.ts | running |
| a6eff8e | Deep Research AI in Games | TODO.md, LEARNINGS.md (append only) | running |
| a574fb9 | Magical Auto-Start Flow | (modifying RaceSetup.tsx, Race.tsx) | running |
| a3b4efc | HUD Fixes | (modifying RaceHUD.tsx, Race.tsx) | running |
| a481b89 | About Page | pages/About.tsx | running |
| a86b897 | Racing Fun Research | TODO.md, LEARNINGS.md (append only) | running |
| aa730d6 | WebGL Shaders | components/WebGLCanvas.tsx | running |
| a05c344 | Photo Mode | components/PhotoMode.tsx | running |
| a24e472 | Replay Recording | hooks/useReplayRecorder.ts, components/ClipPreview.tsx | running |
| a9709dc | Rear-View Mirror | components/RearMirror.tsx | running |
| a42a709 | Dynamic Weather | components/WeatherOverlay.tsx | running |
| ad4b4b9 | Streaks + Naming | hooks/useStreak.ts, hooks/usePlayerName.ts | running |

## File Ownership Rules

### NEW FILES (no conflicts - each agent creates its own)
Each agent should create NEW files for their feature. This avoids merge conflicts:
- New hooks go in `v3/src/hooks/`
- New components go in `v3/src/components/`
- New pages go in `v3/src/pages/`
- New server modules go in `v3/server/`
- New data files go in `v3/server/data/`

### SHARED FILES (conflict risk - use integration agent)
These files are modified by many agents. Changes should be MINIMAL:
- `v3/src/pages/Race.tsx` - THE main integration point. Agents should export hooks/components, the integration agent wires them in.
- `v3/src/types/index.ts` - Add types at the END of the file only
- `v3/src/hooks/useGPUConnection.ts` - Add message handlers at the END
- `v3/server/race_server.py` - Add message handlers at the END
- `v3/server/carla_manager.py` - Add methods at the END
- `v3/TODO.md` - Append only, never modify existing content
- `v3/LEARNINGS.md` - Append only, never modify existing content

### INTEGRATION PATTERN
Agents should:
1. Create their new files (hooks, components, etc.)
2. Export everything cleanly
3. Write a small INTEGRATION.md file in their feature directory explaining how to wire it up
4. The lead agent runs integration after each batch

## Architecture Quick Reference

```
Frontend Stack: React 19 + Vite + Tailwind v4 + TypeScript
Backend Stack: Python 3 + asyncio + websockets + CARLA 0.9.15
Deployment: Vercel (frontend) + Vast.ai GPU (backend)
Connection: WebSocket (JSON messages + binary JPEG frames)
```

### Message Flow (Client → Server)
```json
{ "type": "start_race", "track": "Town05", "laps": 3, ... }
{ "type": "player_input", "keys": {"w": true, "a": false, ...} }
{ "type": "restart_race" }
{ "type": "respawn" }
```

### Message Flow (Server → Client)
```json
{ "type": "handshake_ack", ... }
{ "type": "race_state", "player": {...}, "ai": {...}, "lap": 1, ... }
{ "type": "race_finished", ... }
{ "type": "drift_event", ... }
// Binary: JPEG frames (raw bytes, no JSON wrapper)
```

### Key Interfaces (from types/index.ts)
- `RaceState`: player/ai RacerState, lap, checkpoint, gap, status
- `RacerState`: position, speed_kmh, heading, steer, throttle, brake
- `RaceConfig`: track, laps, weather, difficulty, player_car
- `GPUConnectionState`: connected, raceState, sendControls(), sendMessage()

## Current Feature Status (what's already built and working)
- ✅ WebSocket streaming (JPEG frames at 30fps)
- ✅ WASD controls with progressive steering ramp
- ✅ AI opponent (CARLA autopilot with rubber banding)
- ✅ Race HUD (speed, laps, gap, inputs, compass)
- ✅ Minimap with player/AI positions
- ✅ Countdown overlay (3-2-1-GO)
- ✅ Collision effects (screen shake + sound)
- ✅ Engine sound + background music
- ✅ Drift scoring + drift overlay
- ✅ Speed effects (vignette, speed lines, motion blur)
- ✅ Particle effects (sparks, smoke)
- ✅ Personal bests + leaderboard (localStorage)
- ✅ Time-of-day presets
- ✅ Frame extrapolation
- ✅ Adaptive JPEG quality
- ✅ Auto-shutdown (10min idle)
