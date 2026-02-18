# V3 Learnings (Ralph Wiggum Loop)

Shared learnings file. Every agent writes here when they find and fix a bug.
Format: `## [timestamp] Category: Short description`

---

## [2026-02-17 21:10] Bootstrap: Project initialized
- Created v3 branch from v2-game-overhaul
- Created directory structure
- Vercel project configured at shadow-driver-v3.vercel.app with root dir `v3`
- API env vars (VASTAI_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN) copied from carla-shadow-driver project

---

## [2026-02-17 21:30] Build: PostCSS config was CSS not JS
- **Bug**: `postcss.config.js` contained `@import "tailwindcss"` (CSS syntax) instead of a JS config object
- **Symptom**: Vite build failed with `SyntaxError: Invalid or unexpected token` on `index.css`
- **Fix**: Changed to `export default { plugins: { '@tailwindcss/postcss': {} } }`
- **Rule**: PostCSS config files are JavaScript, not CSS. The `@import "tailwindcss"` goes in the CSS file, the plugin config goes in `postcss.config.js`

## [2026-02-17 21:30] Build: Clean build achieved
- TypeScript: 0 errors
- Vite build: successful (37 modules, 216KB JS, 20KB CSS)
- All files compile and bundle correctly

## [2026-02-17 21:35] Deploy: Vercel production branch mismatch
- **Issue**: `shadow-driver-v3.vercel.app` returns 404 after push to `v3` branch
- **Cause**: Vercel production branch is set to `main` (default). Our code is on branch `v3`.
- **Fix needed**: User must change production branch from `main` to `v3` in Vercel Settings > Git
- **Workaround**: Preview deployments from v3 branch pushes have auto-generated URLs visible in Vercel dashboard
- **TODO for user**: Go to Vercel > shadow-driver-v3 > Settings > Git > Production Branch and change to `v3`

---

## [2026-02-18 06:00] Protocol Cross-Check: pong message not handled by frontend
- **Bug**: Backend sends `pong` messages in response to `ping`, but frontend WebSocket handler had no case for message type `pong`
- **Severity**: Low
- **Symptom**: Pong messages silently dropped; latency measurement not possible
- **Fix**: Added `pong` handler in frontend WebSocket message processing
- **Rule**: Every message type the backend can send must have a corresponding handler in the frontend

## [2026-02-18 06:00] Protocol Cross-Check: model_switched message not handled by frontend
- **Bug**: Backend sends `model_switched` message after a model switch completes, but frontend had no handler for it
- **Severity**: Medium
- **Symptom**: User clicks model switch, backend confirms it, but frontend never updates UI to reflect the new model
- **Fix**: Added `model_switched` handler in frontend to update state and provide user feedback
- **Rule**: For every request-response pair in the protocol (e.g., switch_model -> model_switched), both sides must be implemented

## [2026-02-18 06:00] Protocol Cross-Check: RaceFinished player_time/ai_time nullable mismatch
- **Bug**: `RaceFinished` message types declared `player_time` and `ai_time` as `number` in TypeScript, but the backend can send `null` when a racer DNFs or disconnects
- **Severity**: Medium
- **Symptom**: TypeScript assumes non-null, so UI code like `player_time.toFixed(2)` would crash at runtime on null values
- **Fix**: Changed types to `number | null` and added null guards in rendering logic
- **Rule**: Always check the backend's actual serialization behavior for nullable fields; don't trust that "number" means "always present"

---

## [2026-02-18 06:00] Research Agent: Progressive steering with speed sensitivity
- **Implemented**: Replaced binary on/off steering with progressive steering that reduces turning radius at higher speeds
- **Rationale**: Real cars have reduced steering authority at speed; binary input felt arcade-like and caused overcorrection
- **Effect**: Smoother cornering, less fishtailing at high speed, more nuanced control

## [2026-02-18 06:00] Research Agent: Throttle/brake ramping
- **Implemented**: Added input ramping — throttle ramps up over ~300ms, brake ramps up over ~100ms
- **Rationale**: Instant full-throttle/full-brake felt unnatural and caused jerky movement. Brake ramps faster than throttle for safety realism.
- **Effect**: Smoother acceleration curves, more natural driving feel

## [2026-02-18 06:00] Research Agent: Handbrake support (Space key)
- **Implemented**: Space key now sends handbrake input to backend
- **Rationale**: Handbrake enables drifting and emergency stops, core mechanics for a racing game
- **Effect**: Players can initiate controlled drifts around tight corners

## [2026-02-18 06:00] Research Agent: Speed lines + vignette visual effects (SpeedEffects.tsx)
- **Implemented**: New `SpeedEffects.tsx` component renders speed lines and screen-edge vignette that intensify with velocity
- **Rationale**: Visual speed cues are standard in racing games; they communicate velocity without requiring the player to read the speedometer
- **Effect**: Stronger sense of speed, more immersive experience

## [2026-02-18 06:00] Research Agent: Cinematic countdown (traffic light 3-2-1-GO)
- **Implemented**: Race start uses a traffic-light style countdown: 3 (red) → 2 (red) → 1 (yellow) → GO (green)
- **Rationale**: Standard racing game convention; builds anticipation and gives clear start signal
- **Effect**: Polished race-start experience, prevents premature input

## [2026-02-18 06:00] Research Agent: Gap timer (shows +/- seconds vs opponent)
- **Implemented**: Real-time gap display showing time delta between player and AI opponent
- **Rationale**: In racing, knowing your gap to the opponent is more actionable than knowing absolute positions
- **Effect**: Players can see if they're gaining or losing ground, adding competitive tension

## [2026-02-18 06:00] Research Agent: Extended telemetry (gear, RPM, throttle, brake, steer)
- **Implemented**: Telemetry HUD now shows gear, RPM, throttle %, brake %, and steering angle
- **Rationale**: Extended telemetry helps players understand vehicle state and improve driving technique
- **Effect**: More informative HUD, better player feedback loop

## [2026-02-18 06:00] Research Agent: Input visualization bars (THR/BRK/STR)
- **Implemented**: Visual bars showing current throttle, brake, and steering input levels
- **Rationale**: With ramped inputs, players need to see their actual input values, not just whether a key is pressed
- **Effect**: Clear feedback on input state, especially useful for understanding ramping behavior

## [2026-02-18 06:00] Research Agent: Latency display from pong messages
- **Implemented**: Ping/pong round-trip time measured and displayed in HUD
- **Rationale**: For a real-time streamed game, latency awareness is critical for player expectations
- **Effect**: Players can see connection quality; useful for debugging performance issues

## [2026-02-18 06:00] Research Agent: Tick rate increased from 20fps to 30fps
- **Implemented**: Game loop tick rate changed from 20fps to 30fps
- **Rationale**: 20fps felt sluggish for real-time control input; 30fps is the minimum for responsive game feel without excessive bandwidth
- **Effect**: Noticeably smoother input response and frame updates

---
