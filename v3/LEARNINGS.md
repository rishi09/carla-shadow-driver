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

## [2026-02-18 08:00] Engine sound synthesis (Web Audio API oscillator banks)
- **Implemented**: RPM-based engine sound using Web Audio API oscillator nodes in `useEngineSound.ts`
- **Approach**: Multiple oscillators at harmonic intervals (fundamental + overtones) with gain envelopes shaped by RPM. The fundamental frequency maps linearly from ~80Hz at idle (800 RPM) to ~250Hz at redline (~6000 RPM). Two additional oscillators at 2x and 3x frequency with decreasing gain simulate engine harmonics.
- **Key detail**: Oscillators are created once on user interaction (to satisfy browser autoplay policy) and their frequency/gain are updated every animation frame via `setTargetAtTime()` for smooth transitions without audio clicks.
- **Tire screech**: A filtered white noise node activates when lateral G-force (derived from speed and steering angle) exceeds a threshold. Bandpass filter centered at ~3kHz gives a realistic screech character.
- **Countdown beeps**: Short sine wave beeps (440Hz for 3/2/1, 880Hz for GO) triggered by countdown state changes.
- **Lesson**: Never call `oscillator.start()` / `oscillator.stop()` repeatedly -- create oscillators once and control volume via gain nodes to avoid the "cannot restart a stopped AudioNode" error.

## [2026-02-18 08:00] Minimap auto-scaling (bounding box normalization)
- **Implemented**: `Minimap.tsx` component that renders both car positions and checkpoint markers on a small canvas overlay
- **Approach**: On each frame, compute the axis-aligned bounding box of all relevant points (player position, AI position, all checkpoints). Normalize all coordinates into [0, 1] range using `(val - min) / (max - min)` for both axes. Scale to the minimap canvas dimensions with padding.
- **Key detail**: Added a minimum bounding box size (e.g., 50 world units) to prevent extreme zoom-in when cars are close together. The bounding box expands symmetrically if either axis is below the minimum.
- **Lesson**: Without the minimum bounding box guard, the minimap becomes unusable when both cars are near the same checkpoint -- dots jump wildly because tiny coordinate differences get amplified to full canvas width.

## [2026-02-18 08:00] Adaptive JPEG quality (latency-based thresholds)
- **Implemented**: Client reports its measured latency in the `control` message (`{ type: 'control', keys: {...}, latency: number }`). Server adjusts JPEG encode quality based on latency thresholds.
- **Thresholds**: >150ms latency -> reduce quality (down to 30 minimum), <50ms -> increase quality (up to 90 maximum). Changes are gradual (5 down, 2 up per tick) to avoid oscillation.
- **Rationale**: High latency often correlates with bandwidth saturation. Reducing JPEG quality lowers frame size, which reduces transmission time and helps the connection recover. Increasing slowly on good latency prevents aggressive quality bumps that re-saturate bandwidth.
- **Frontend display**: Current `jpeg_quality` value is included in the race_state so the HUD can optionally show it as a connection quality indicator.
- **Lesson**: Symmetric up/down step sizes cause oscillation at the threshold boundary. Use asymmetric steps (fast decrease, slow increase) for stable convergence.

## [2026-02-18 08:00] HUD interpolation (lerp between server updates)
- **Implemented**: `useInterpolatedState.ts` hook that interpolates numeric HUD values (speed, RPM, gap timer, steering angle) between server ticks at 60fps using `requestAnimationFrame`.
- **Approach**: Store the previous and current server state snapshots with timestamps. On each animation frame, compute `t = (now - lastUpdateTime) / expectedTickInterval`, clamp to [0, 1], and lerp: `displayed = prev + (current - prev) * t`.
- **Key detail**: Only numeric fields are interpolated. Discrete values (lap number, position, gear) snap immediately to avoid showing impossible intermediate values like "lap 1.5".
- **Benefit**: At 30fps server tick rate, the HUD visually updates at 60fps, making the speedometer and gap timer feel smooth rather than stepping in 33ms increments. This is especially noticeable for the analog-style speed display.
- **Lesson**: Do not interpolate past `t = 1.0` (extrapolation). If the next server tick is late, clamp at the last known value. Extrapolation causes overshooting that looks worse than holding steady.

## [2026-02-18 08:00] Collision detection via CARLA sensor
- **Implemented**: CARLA's built-in `sensor.other.collision` is attached to both the player and AI vehicles. Collision events are forwarded in the race_state as a `collisions` array.
- **Data format**: Each collision entry contains `{ other_actor: string, intensity: number, timestamp: number }`. The `other_actor` is the CARLA blueprint ID of the object hit (e.g., `static.prop.streetbarrier`, `vehicle.tesla.model3`). The `intensity` is the impulse magnitude in Newtons.
- **Frontend use**: The collisions array enables future features like screen shake (scale by intensity), collision impact sounds (pitch by intensity), and post-race collision count statistics.
- **Mock server**: Generates random collision events with ~0.2% probability per frame for the player and ~0.1% for AI, using realistic CARLA actor names and intensity ranges (200-1000N).
- **Lesson**: CARLA's collision sensor fires for every physics contact, including ground scraping. Filter by intensity threshold (>100N) to avoid spamming the WebSocket with trivial contacts.

---

## [2026-02-18 10:00] Ghost car replay (binary search interpolation + best lap recording)
- **Implemented**: `race_logic.py` records the player's position (x, y, yaw, time_in_lap) every frame during each lap. On lap completion, if the lap time is the best so far, the recording is saved as `_best_lap_recording`. On subsequent laps, `get_ghost_position(time_in_current_lap)` looks up the ghost car's position at the given timestamp.
- **Approach**: Uses binary search (`lo`/`hi` with `while lo < hi - 1`) to find the two recorded frames bracketing the requested time, then linearly interpolates x, y, and yaw between them. Edge cases handled: if the requested time is before the first frame or after the last frame, the nearest endpoint is returned.
- **Data flow**: The ghost position is included in the `race_state` JSON under the `ghost` key (`{ x, y, yaw }`), which the frontend's Minimap can render as a third dot on the track.
- **Lesson**: Linear search through the recording array would be O(n) per frame with potentially thousands of entries per lap. Binary search makes it O(log n), which matters at 60Hz telemetry rate. Always use binary search when looking up a sorted time-series by timestamp.

## [2026-02-18 10:00] Post-race racing line visualization (RacingLineViz.tsx)
- **Implemented**: Canvas-based component that renders both the player and AI driving paths after a race ends. Paths are arrays of `[x, y]` world coordinates recorded every 5th frame during the race.
- **Approach**: Collects all points from both paths (and optionally checkpoints) to compute an axis-aligned bounding box. Adds an 8% margin, then computes a uniform scale factor (`min(drawWidth/rangeX, drawHeight/rangeY)`) to fit the paths into the canvas while preserving aspect ratio. Each point is mapped from world coordinates to canvas coordinates via `toCanvas()`.
- **Glow effect**: Each path is drawn twice -- first a wider, semi-transparent stroke (4px at 30% opacity) for the glow, then a thinner stroke (2px at 80% opacity) for the main line. Player is green (#22C55E), AI is blue (#3B82F6).
- **High-DPI**: Uses `window.devicePixelRatio` to scale the canvas resolution while keeping CSS dimensions fixed, preventing blurry rendering on Retina displays.
- **Lesson**: Without the margin around the bounding box, paths that touch the edges get clipped by the canvas border. The 8% padding (`Math.max(rangeX, rangeY) * 0.08`) ensures all paths are fully visible.

## [2026-02-18 10:00] Race statistics tracking (distance, max speed, collisions)
- **Implemented**: `RaceState` in `race_logic.py` accumulates three statistics during the race: max speed, total distance traveled, and collision count. These are included in the `race_finished` message and displayed in the `RaceResults.tsx` component.
- **Distance calculation**: On each `update_player()` / `update_ai()` call, computes the Euclidean distance from the previous position to the current position (`sqrt(dx^2 + dy^2)`) and adds it to a running total. Previous position is stored in `_player_prev_x` / `_player_prev_y`.
- **Max speed**: Simple running maximum -- `if speed_kmh > self.player_max_speed: self.player_max_speed = speed_kmh` on each update.
- **Collision count**: Incremented via `report_player_collision()` each time a significant collision event (>100N) is forwarded from the `carla_manager`.
- **Display**: The `RaceResults.tsx` renders a comparison grid with color-coded cells -- the player with the higher top speed gets green text, the other gets red.
- **Lesson**: Distance from frame-to-frame position deltas is slightly noisy due to physics micro-jitter, but over a full race it converges to a reasonable approximation. For display purposes, rounding to 0.1m and formatting as km above 1000m works well.

## [2026-02-18 10:00] Camera mode toggle (destroy + re-attach CARLA sensor)
- **Implemented**: `set_camera_mode()` in `carla_manager.py` switches the chase camera between three preset views: `chase` (behind-car, x=-6 z=3 pitch=-15), `hood` (over-hood, x=0.5 z=1.4 pitch=-5), and `bumper` (front bumper, x=2.0 z=0.8 pitch=-3). Triggered by pressing 'C' in the frontend.
- **Approach**: CARLA sensors cannot have their transform changed after creation. The only way to reposition a camera is to destroy the existing sensor and spawn a new one with the desired transform. The method calls `chase_cam.stop()` then `chase_cam.destroy()`, removes it from the actor cleanup list, then calls `_attach_camera()` with the new transform parameters.
- **Key detail**: The actor must be removed from `_actors` list before destroying it, otherwise the cleanup method will try to destroy it again. The new camera is immediately added back to `_actors`.
- **Protocol**: Frontend sends `{ type: 'camera_mode', mode: 'hood' }`, backend responds with `{ type: 'camera_mode_changed', mode: 'hood' }`. The frontend displays the current mode as a pill badge in the top-left corner.
- **Lesson**: Never try to modify a CARLA sensor's transform in-place. The CARLA Python API does not support `sensor.set_transform()` for attached sensors. You must destroy and recreate. Budget ~1 frame of black between the destroy and the new camera's first callback.

## [2026-02-18 10:00] Background music (procedural synthesis via Web Audio API)
- **Implemented**: `useBackgroundMusic.ts` hook generates ambient racing music entirely through Web Audio API oscillators -- no audio file assets needed.
- **Layers**: Four layers, each activated at different intensity thresholds:
  1. **Bass drone**: Sine wave at 55Hz (A1) with an LFO pulsing the gain at the current tempo. Always audible.
  2. **Chord pad**: Three triangle oscillators forming an Am chord (A2=110Hz, C3=131Hz, E3=165Hz) with a slow 0.25Hz tremolo LFO. Fades in at any intensity.
  3. **Rhythm pulse**: Square wave through a lowpass filter (150Hz cutoff, Q=8) producing a kick-drum effect. Activates above 0.3 intensity.
  4. **Hi-hat**: White noise buffer source through a highpass filter at 8kHz, triggered in short 30ms bursts at 8th-note intervals via `setInterval`. Activates above 0.5 intensity.
- **Tempo**: Scales with intensity from ~96 BPM (1.6 beats/sec) to ~144 BPM (2.4 beats/sec). Affects the bass LFO rate, rhythm oscillator frequency, and hi-hat interval.
- **Intensity mapping**: Driven by `speedFactor = speed_kmh / 150` plus a bonus +0.3 when the gap to the opponent is under 3 seconds. This makes the music more urgent during close racing.
- **Master volume**: Set to 0.18 so it stays behind the engine sound. Fade in over 2 seconds, fade out over 1 second.
- **Lesson**: The hi-hat layer uses a pre-generated 1-second `AudioBuffer` of white noise and creates a new `BufferSource` for each burst (since `BufferSource` nodes are single-use). Do not try to reuse a stopped `BufferSource` -- the Web Audio API throws `InvalidStateError`.

## [2026-02-18 10:00] Screen shake (CSS transform with decaying random offsets)
- **Implemented**: When collisions are received in `Race.tsx`, the game container's CSS `transform` is set to random x/y pixel offsets that decay over 300ms.
- **Approach**: On collision, compute a shake magnitude proportional to the collision intensity (capped at 10px via `Math.min(10, intensity / 500)`). Start a `requestAnimationFrame` loop that runs for 300ms. On each frame, compute `decayFactor = 1 - elapsed / 300`, multiply by the original magnitude, and set new random offsets: `x = (Math.random() - 0.5) * 2 * currentMag`. The shake is applied via `style={{ transform: translate(${shakeX}px, ${shakeY}px) }}` on the racing view container.
- **Key detail**: Previous shake animations are cancelled (`cancelAnimationFrame`) before starting a new one, so rapid collisions don't stack indefinitely. The shake resets to (0, 0) when the duration expires.
- **Lesson**: Using CSS transforms for screen shake is simpler and more performant than repositioning the canvas. The browser compositor handles the translation without triggering layout recalculation.

## [2026-02-18 10:00] Decoupled telemetry (separate asyncio tasks for frames vs JSON)
- **Implemented**: `race_server.py` runs two concurrent asyncio tasks during a race: `_race_loop()` at 30fps for JPEG frame encoding/sending, and `_telemetry_loop()` at 60Hz for JSON race state updates.
- **Rationale**: JPEG encoding is CPU-expensive (~5-10ms per frame). Coupling telemetry to the frame loop meant the HUD could only update at 30fps. By decoupling, the telemetry (speed, RPM, lap time, gap) updates at 60Hz while frames stay at 30fps, giving the frontend smoother HUD values to interpolate.
- **Implementation**: `asyncio.create_task(self._race_loop())` and `self._telemetry_task = asyncio.create_task(self._telemetry_loop())` are spawned in `_start_race()`. The telemetry loop reads vehicle state from CARLA's getters (which work between ticks) and sends a `race_state` JSON message. The frame loop handles CARLA ticks, control application, and JPEG encoding.
- **Cleanup**: When the race ends, the frame loop cancels the telemetry task via `self._telemetry_task.cancel()` and awaits it with a `CancelledError` catch.
- **Lesson**: CARLA's `vehicle.get_velocity()`, `vehicle.get_transform()`, and `vehicle.get_control()` return the latest physics state even between `world.tick()` calls. This makes it safe to read telemetry at a higher rate than the simulation tick rate.

## [2026-02-18 10:00] Auto-detecting interpolation interval (EMA smoothing)
- **Implemented**: `useInterpolatedState.ts` was enhanced to auto-detect the server's update interval rather than hardcoding 33ms (30fps). Each time the `serverValue` changes, it measures `delta = performance.now() - lastUpdateTime`. The measured delta is smoothed using an exponential moving average (EMA) with a smoothing factor of 0.3: `estimated = estimated * 0.7 + delta * 0.3`.
- **Edge cases**: Deltas below 1ms or above 500ms are rejected as outliers (e.g., tab backgrounding, initial render). The first valid delta is used directly without EMA to bootstrap the estimate. A default interval of 33ms (30fps) is used until the first measurement arrives.
- **Effect**: The interpolation automatically adapts to different server rates. If the server sends telemetry at 60Hz the interval converges to ~16ms; at 30Hz it converges to ~33ms. This means the same hook works correctly for both the 30fps frame loop and the 60Hz telemetry loop without configuration.
- **Lesson**: Raw delta measurements between updates jitter due to event loop scheduling and network variance. Without EMA smoothing, the interpolation overshoots or undershoots erratically. The 0.3 smoothing factor provides a good balance between responsiveness (adapts within ~5 updates) and stability (filters out one-off spikes).

## [2026-02-18 10:00] Docker requirements.txt (pinned versions + separate CUDA torch)
- **Implemented**: `docker/requirements.txt` pins all Python dependencies to exact versions (e.g., `websockets==14.1`, `opencv-python-headless==4.10.0.84`, `numpy==1.26.4`). PyTorch and torchvision are intentionally excluded from requirements.txt and installed separately in the Dockerfile via `pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu121`.
- **Rationale**: The CUDA-enabled PyTorch wheels are not on the default PyPI index. Installing them requires `--index-url` pointing to the PyTorch CUDA 12.1 wheel repository. If torch were in requirements.txt, pip would pull the CPU-only version from PyPI, which would not have GPU acceleration.
- **Build order**: The Dockerfile installs torch first (as a separate `RUN` layer) before the requirements.txt layer. This maximizes Docker layer caching -- the ~2GB torch download is cached and only re-downloaded if the base image or CUDA version changes, not when adding a new small dependency to requirements.txt.
- **Key packages**: `opencv-python-headless` (not `opencv-python`) avoids pulling in Qt/GTK GUI dependencies that are unnecessary in a headless Docker container. `accelerate` and `transformers` provide the model loading/inference pipeline.
- **Lesson**: Always use `opencv-python-headless` in Docker/server environments. The full `opencv-python` package tries to link against system GUI libraries (libgtk, libQT) which may not be present and cause cryptic import errors.

## [2026-02-18 10:00] VideoCanvas loading state (React state flag on first frame)
- **Implemented**: `VideoCanvas.tsx` uses a `hasFirstFrame` React state flag (initialized to `false`) that flips to `true` when the first JPEG frame is successfully decoded via `createImageBitmap()`. A ref (`firstFrameReceivedRef`) prevents the state setter from firing on every subsequent frame.
- **UI effect**: While `hasFirstFrame` is false, an overlay div with "Waiting for video feed..." (pulsing animation) is rendered on top of the canvas. Once the first frame arrives, the overlay disappears and the canvas content becomes visible.
- **Why not just check the canvas**: The canvas is initialized with a dark fill and "Waiting for video feed..." text drawn directly via `fillText()`. However, this is a canvas-only visual -- React components layered on top (like HUD elements) cannot read canvas state. Using a React state flag allows the overlay to participate in the normal component tree.
- **Lesson**: Always provide a clear loading indicator for streamed content. Without it, users see a blank dark rectangle and cannot tell whether the connection is working, the GPU is still starting, or the video feed has failed. The transition from loading overlay to live video gives a clear "it's working" signal.

## [2026-02-18 11:00] SPA routing fix (vercel.json catch-all rewrite)
- **Bug**: Navigating to `/race` on the deployed Vercel site returned `404: NOT_FOUND`
- **Severity**: Critical -- the game was completely broken on production
- **Root cause**: `vercel.json` only had an API rewrite (`/api/(.*)`), with no SPA catch-all. Vercel tried to serve a static file at `/race/index.html`, which doesn't exist in a single-page app.
- **Fix**: Added `{ "source": "/((?!api/).*)", "destination": "/index.html" }` rewrite to `vercel.json`. The negative lookahead `(?!api/)` ensures API routes still go to their serverless functions.
- **Discovery method**: E2E testing with SafariDriver -- navigated to `/race` and took a screenshot showing the 404 page.
- **Rule**: Every Vite/React SPA deployed on Vercel MUST have a catch-all rewrite to `/index.html` for client-side routing to work. Always verify non-root routes work after deployment.

---

## [2026-02-18 12:00] Code Review: RaceProgressBar off-by-one (1-indexed laps)
- **Bug**: Server sends `player.lap` as 1-indexed (race_logic.py: `self.player_lap + 1`), but `RaceProgressBar` used raw `playerLap` in its formula `(playerLap * totalCheckpoints + playerCheckpoint) / totalSegments`. At race start, lap=1 checkpoint=0 gives 33% progress on a 3-lap race instead of 0%.
- **Severity**: High -- both car dots appear one full lap ahead of actual position.
- **Fix**: Changed to `(playerLap - 1) * totalCheckpoints + playerCheckpoint` to convert back to 0-indexed before computing progress.
- **Rule**: When the server sends display-friendly 1-indexed values, always convert back to 0-indexed for arithmetic. Document the indexing convention at the type level.

## [2026-02-18 12:00] Code Review: Countdown green light activates one second early
- **Bug**: Traffic light green dot condition was `countdown === 1 || isGo` instead of just `isGo`. This turned the green light on during "1" (one second before GO), breaking the red→amber→green sequence.
- **Severity**: Medium -- visually confusing, doesn't match standard racing countdown.
- **Fix**: Changed condition to just `isGo` (countdown === 0).
- **Rule**: Traffic light sequence is red (3, 2), amber (1), green (GO/0). Each light should activate at exactly one phase, not overlap.

## [2026-02-18 12:00] Code Review: SpeedEffects useEffect tears down 60x/sec
- **Bug**: `SpeedEffects.tsx` had `[speedKmh]` in its useEffect dependency array. Since speed updates at 60Hz from the telemetry loop, the entire canvas setup (ResizeObserver + RAF loop) was torn down and recreated 60 times per second.
- **Severity**: Medium -- performance waste, potential visual flicker.
- **Fix**: Store `speedKmh` in a ref (`speedRef`), read from ref inside the draw loop, and use `[]` as the dependency array so the effect runs only once.
- **Rule**: For animation loops that read rapidly changing values, always use refs instead of putting the value in the useEffect dependency array. The RAF loop reads the ref on each frame without triggering effect teardown.

## [2026-02-18 12:00] Code Review: totalCheckpoints hardcoded to 10 in progress bar
- **Bug**: `RaceHUD` passed `playerLap`, `playerCheckpoint`, etc. to `RaceProgressBar` but never passed `totalCheckpoints`. The prop defaulted to 10, but the actual checkpoint count depends on the map and is available in `raceState.checkpoints`.
- **Severity**: Medium -- progress bar positions are wrong on maps with != 10 checkpoints.
- **Fix**: Added `totalCheckpoints={raceState.checkpoints?.length ?? 10}` to the RaceProgressBar props in RaceHUD.

## [2026-02-18 12:00] Code Review: No CUDA version filter in GPU provisioning
- **Bug**: `api/gpu/start.ts` filtered GPUs by VRAM, reliability, and price but not CUDA version. The Docker image installs `cu121` (CUDA 12.1) PyTorch wheels. GPUs supporting only CUDA 11.x would fail to initialize PyTorch.
- **Severity**: High -- silent model inference failure on older GPUs.
- **Fix**: Added `o.cuda_max_good >= 12.1` to the GPU filter.
- **Rule**: Always filter cloud GPU offers by the CUDA version your software requires. Mismatched CUDA versions produce cryptic errors at runtime.

## [2026-02-18 12:00] Code Review: Docker ENTRYPOINT + onstart double execution
- **Bug**: The Dockerfile sets `ENTRYPOINT ["/opt/shadow-driver/entrypoint.sh"]` and the Vast.ai `onstart` script also called `/opt/shadow-driver/entrypoint.sh`. On Vast.ai, `onstart` runs inside the already-started container (after the entrypoint). This would start CARLA, the race server, and cloudflared twice, causing port conflicts.
- **Severity**: Critical -- container would crash with port-already-in-use errors.
- **Fix**: Changed `onstart` to only report status (a single curl), not call entrypoint.sh. The Docker ENTRYPOINT handles everything.
- **Rule**: Never duplicate startup logic between Docker ENTRYPOINT and cloud provider onstart scripts. Pick one mechanism and use the other only for lightweight status reporting.

---

## [2026-02-18 10:00] E2E testing with safaridriver (Selenium + Safari Technology Preview)
- **Implemented**: `scripts/safari_test.py` and `scripts/browser_test.py` run end-to-end game tests using Safari Technology Preview via Selenium WebDriver. The safaridriver binary is started manually on port 4445 (`safaridriver -p 4445`), and Selenium connects as a Remote WebDriver.
- **Approach**: The tests navigate to the deployed game URL, click through the menu flow (Race Against Computer -> Choose Track -> Start Race -> Local AI), wait for the countdown, then programmatically control the car using `driver.execute_script()` to call the Phaser game engine's `setExternalInput()` API directly. This bypasses keyboard event simulation, which is unreliable in Safari's WebDriver implementation.
- **Car control**: `set_car_input(driver, throttle, brake, steer)` injects JavaScript that finds the Phaser game instance via `Phaser.GAMES[0]`, gets the `RaceScene`, and calls `raceScene.setExternalInput({ throttle, brake, steer })`. This gives direct, reliable control over the car without depending on keyboard event dispatch.
- **Race loop**: The test runs for up to 90 seconds at 10 updates/second, applying pre-computed steering for an oval track (straight sections with 0.8 right turns at the ends). It periodically scrapes the page text to check speed and lap progress.
- **Why not Playwright**: Playwright was also attempted (`playwright_test.py` using headless Firefox) but Safari-specific testing required safaridriver. Safari's WebDriver has quirks -- keyboard events via `send_keys()` are often swallowed by the canvas, so the `setExternalInput()` API injection approach was essential.
- **Lesson**: For testing canvas-based games in the browser, do not rely on simulated keyboard events via WebDriver. Instead, expose a programmatic input API on the game engine and call it via `execute_script()`. This is both more reliable and allows precise analog control values (fractional throttle/steer) that binary key events cannot express.

---

## [2026-02-19 01:00] Steering sensitivity: the Goldilocks problem
- **History**: `dt * 6.5` attack felt sluggish (130ms to full lock). `dt * 18` was too aggressive — reached max steer in 1 frame, causing constant drifting. `dt * 10` is the sweet spot (~80ms).
- **Root cause of drifting**: The steer LIMITS were too high, not just the ramp rate. With binary keyboard input, you either have 0% or 100% key press — the steer limit IS your actual steering angle. Old limit of 0.7 at low speed was way too much lock.
- **New limits**: 0.5 (low speed) / 0.3 (medium) / 0.18 (high) / 0.10 (very high). These prevent over-rotation while keeping the car maneuverable.
- **Rule**: For keyboard-controlled racing, steer limits matter more than ramp rate. Keep limits low enough that holding A/D at max produces stable cornering, not drifting.

## [2026-02-19 01:00] Cloudflare tunnel latency dominates everything else
- **Measured**: With Cloudflare quick tunnel, total round-trip latency was ~120-200ms. Via SSH tunnel (`ws://localhost:8765`), it dropped to ~50-80ms.
- **Implication**: The ~40-80ms overhead of Cloudflare proxying was larger than ALL our JPEG encoding + physics optimizations combined. No amount of JPEG quality reduction or steering tuning will make the game feel good through Cloudflare.
- **Rule**: Measure end-to-end latency FIRST before optimizing sub-components. The transport layer was the bottleneck, not encoding.
- **Next step**: Need `wss://` (TLS WebSocket) directly to the GPU, bypassing Cloudflare. Options: ngrok, Tailscale, self-signed cert, or Vast.ai Direct mode.

## [2026-02-19 01:00] Mixed content blocking kills direct WebSocket
- **Bug**: `ws://66.115.179.154:50187` from `https://shadow-driver-v3.vercel.app` is blocked by Chrome's mixed content policy.
- **Exception**: `ws://localhost:*` is allowed from HTTPS pages (browser treats localhost as secure).
- **SSH tunnel workaround**: `ssh -L 8765:localhost:8765 -p PORT root@IP` maps the GPU's port 8765 to localhost:8765, which Chrome allows.
- **Rule**: HTTPS pages can ONLY connect to `wss://` or `ws://localhost`. Direct `ws://` to any non-localhost IP is blocked. Plan for TLS from the start.

## [2026-02-19 01:00] Minimap z-index covering HUD
- **Bug**: Minimap (z-20, bottom-4 right-4) covered the FPS/latency display (z-10, bottom-4 right-4).
- **Fix**: Moved minimap to `bottom-24` to sit above the latency panel.
- **Rule**: When adding overlay components at the same corner, check z-index stacking. Use Tailwind spacing utilities to offset them.

---

## [2026-02-19 10:00] Client-side steering prediction: speed-dependent CSS transforms

- **Implemented**: `useSteeringPrediction.ts` hook applies immediate CSS transforms (rotateY + translateX for steering, rotateX for throttle/brake pitch) to the video canvas wrapper the instant the player presses A/D/W/S, before any server frame arrives.
- **Speed-dependent scaling**: The rotation/shift magnitude is scaled by a factor that mirrors the server's speed-dependent steer limits (`carla_manager.py`). At low speed (<30 km/h, steer_limit=0.5), the client applies up to ~2.8 degrees of yaw rotation and ~18px lateral shift. At high speed (>150 km/h, steer_limit=0.10), the rotation drops to ~0.56 degrees and ~3.6px shift. The transitions between speed bands are linearly interpolated rather than stepped, avoiding visual pops when crossing thresholds.
- **Why speed matters**: Without speed-dependent scaling, the prediction applies the same visual shift at 200 km/h as at 10 km/h. But the server barely turns the wheels at high speed (steer_limit=0.10), so the server frame would show almost no turn -- causing a jarring correction snap. By matching the server's steering authority curve, the prediction always looks proportional to the actual turn.
- **Interpolation via rAF**: The yaw and pitch values are smoothly interpolated using exponential moving average in a `requestAnimationFrame` loop (attack rate 0.08, release rate 0.055 per frame). This prevents instant snapping when keys are pressed/released. Speed is read from a ref (not a dependency) to avoid re-mounting the rAF loop on every speed change.
- **Perspective transform for depth**: Using `perspective(800px) rotateY(...)` instead of flat `rotate(...)` gives a subtle 3D "looking into the turn" effect rather than a flat image rotation. Combined with `translateX(...)`, it simulates the camera panning into the corner.
- **Rule**: For client-side prediction overlays, always match the server's authority curves. The prediction's visual magnitude must be proportional to what the server will actually do -- otherwise the correction snap when the real frame arrives is MORE disorienting than the latency you're trying to mask.
- **Rule**: Store rapidly-changing values (like speed) in refs, not effect dependencies. Putting `speedKmh` in the useEffect dependency array would tear down and restart the rAF loop on every speed update (60Hz), defeating the purpose of smooth animation.

---

## [2026-02-19 12:00] Drift detection: heading vs velocity direction

- **Implemented**: `DriftDetector` class in `race_logic.py` detects drifting by comparing vehicle heading (yaw) vs velocity direction (atan2 of velocity components). When the angle between them exceeds 15 degrees and speed is above 30 km/h, a drift is registered.
- **Scoring formula**: `base_score = avg_angle * avg_speed * duration * 0.1`. Multipliers: chain bonus (1.5x for consecutive drifts within 2s), high-speed bonus (1.5x for avg >120 km/h), reverse entry bonus (2x for drifting in the opposite direction of the previous drift).
- **Frontend display**: `DriftScore.tsx` shows three elements: (1) live "DRIFT!" label with growing score counter during active drift, (2) floating score popup that rises and fades when drift ends, (3) persistent total drift score counter.
- **Key detail**: The velocity components (`velocity_x`, `velocity_y`) are added to the telemetry dict in `carla_manager.py`. Without these, drift detection would require computing heading change rate, which is noisier.
- **Lesson**: For drift detection, comparing heading vs velocity direction is more reliable than using lateral G-force or steering angle. Heading vs velocity captures the actual slip angle, while steering angle can be zero during a sustained drift (countersteering).
- **Lesson**: Drift chain combos need a timeout (2s) between drifts to be fun. Too short and players can't chain; too long and every drift is a "chain."

## [2026-02-19 12:00] AI race commentary: event-driven toast messages

- **Implemented**: `RaceCommentary` class in `race_logic.py` monitors race events and queues contextual text messages. Events tracked: race start quality, position changes (overtakes), gap changes, collisions, best lap improvements, final lap, close finishes, and notable drifts.
- **Cooldown**: 4-second minimum between messages to avoid spamming. Messages are priority-sorted so important events (overtakes, final lap) preempt less urgent ones.
- **Frontend**: `CommentaryOverlay.tsx` renders messages as animated toast notifications centered at the top of the screen. Each message slides in, holds for 4 seconds, then auto-removes via setTimeout.
- **Message categories**: Each message has a category (`positive`, `warning`, `critical`, `collision`, `drift`, `info`) that determines its color scheme and icon.
- **Lesson**: Commentary messages must be carefully timed. During countdown: silence (don't distract). During racing: 4-second cooldown prevents message fatigue. Highest-priority events (overtake, final lap) jump the queue.

## [2026-02-19 12:00] Dynamic weather transitions: sun path across the sky

- **Implemented**: `WeatherTransitionManager` in `weather_transitions.py` gradually shifts CARLA's sun position as the race progresses. For clear/cloudy/rain presets, the sun moves from dawn (east, -5 altitude) through noon (top, 70 altitude) to sunset (west, 2 altitude). For night preset, the moon moves with a hint of dawn at finish.
- **Smoothstep interpolation**: Sun position is interpolated between keyframes using `t * t * (3 - 2t)` for smooth transitions rather than linear interpolation, which would make the sun appear to "accelerate" through the middle of its path.
- **Storm event**: At 65-80% race progress on 3+ lap races, a brief rain storm triggers (60% intensity, 80% cloud coverage, 50% wind). This creates a dramatic mid-race challenge.
- **Update throttling**: Weather is only updated every 15 frames (~0.5s at 30fps) and only if progress changed by >0.5% to avoid excessive CARLA API calls.
- **Lesson**: Weather transitions must be gradual. Instant weather changes are visually jarring. The smoothstep curve ensures the golden hour periods (dawn, sunset) are lingered on while noon passes quickly -- matching how real sunrises/sunsets feel longer than midday.

## [2026-02-19 12:00] Personal bests and leaderboard: localStorage persistence

- **Implemented**: Two hooks for leaderboard functionality. `useLeaderboard.ts` stores the last 100 race results per track/lap combo with full stats (time, best lap, max speed, drift score, difficulty, car). `usePersonalBests.ts` stores only the single best time per track/lap combo for quick lookup.
- **Medal system**: `useLeaderboard` awards medals based on fixed par times per track (Gold = par, Silver = +30%, Bronze = +70%). `usePersonalBests` awards medals relative to personal best (Gold = within 5%, Silver = within 15%, Bronze = finished).
- **Frontend**: `LeaderboardPanel.tsx` renders in the RaceSetup page showing the personal best for the selected track/lap combo, with recent results and medal targets.
- **Race results integration**: `Race.tsx` saves results to both hooks when a race finishes. The `RaceResults.tsx` page shows drift statistics (total score, best drift, drift count).
- **Lesson**: Two separate storage mechanisms (full history + single best) serve different purposes. Full history enables "recent races" lists and statistics. Single best enables instant "is this a PB?" checks without scanning arrays.

---

## [2026-02-19 12:00] Landing page: cinematic dark theme with canvas speed streaks

- **Implemented**: Full-page landing at `/` with animated SpeedCanvas background, scroll-reveal feature cards, "How it works" steps, technical stats, and "Powered by" badges. Zero external assets -- everything is CSS, SVG, and canvas.
- **SpeedCanvas**: Renders 50 light streaks radiating from a vanishing point at ~42% viewport height, simulating driving toward a horizon. Uses three hue channels (cyan, green, blue) matching the app's accent palette. Each streak has independent speed, length, opacity, and fade-in/fade-out curves. A subtle perspective grid (16 radial lines + 10 horizontal lines) provides depth.
- **Scroll-reveal with IntersectionObserver**: A reusable `useReveal()` hook returns a ref and a `visible` boolean. On mount, it creates an IntersectionObserver with `threshold: 0.15`. When the element scrolls into view, `visible` flips to `true` and the observer disconnects (fire-once). Each card/section uses CSS `transition` with staggered `delay` values (0s, 0.1s, 0.2s, 0.3s) for a cascade effect.
- **Performance**: Canvas animation runs a single `requestAnimationFrame` loop with delta-time normalization (`dt / 16.67` for 60fps baseline). No React state updates during animation -- all mutation is on plain arrays and objects.
- **Typography trick**: Using `Impact` font-family with `-0.05em` letter-spacing and `leading-[0.85]` line-height gives the title a condensed, racing-poster feel without importing a custom web font.
- **CTA glow**: The "RACE NOW" button uses a CSS `box-shadow` keyframe animation (`cta-pulse`) that breathes between 20px and 35px green glow. On hover, a separate `blur-2xl` span with a gradient from green to cyan creates a bloom effect behind the button.
- **Rule**: For landing page canvas animations, keep particle/streak counts modest (~50) and avoid per-particle DOM elements. A single canvas with a RAF loop is far more performant than 50 animated `<div>` elements and gives pixel-level control over gradients and fading.
- **Rule**: `useMemo` pre-computed random values prevent flicker on React re-renders. For streaks defined inline in JSX, use `useMemo([])` with an empty dep array so the random values are stable across renders.
- **Rule**: `IntersectionObserver` with `disconnect()` on first intersection is the correct pattern for fire-once scroll-reveal. Do not use a continuous observer that re-evaluates on every scroll frame.

---

## [2026-02-19 12:00] Tunnel comparison: ngrok vs Cloudflare quick tunnels

- **Problem**: Cloudflare quick tunnels added 40-80ms overhead to every WebSocket message, making total round-trip latency 120-220ms. This was the single largest source of perceived lag -- bigger than JPEG encoding, physics, and steering ramp combined.
- **Options evaluated**:
  1. **ngrok** (chosen): Free tier gives 1 HTTP tunnel with valid TLS certs. WebSocket fully supported. ~10-20ms overhead. Requires auth token (free signup at https://ngrok.com).
  2. **bore.digital**: TCP-only, no TLS. Would give `ws://` not `wss://`, so mixed content blocking still applies. Ruled out.
  3. **localtunnel**: Free, gives HTTPS, but extremely unreliable -- frequent disconnections. Not suitable for real-time gaming.
  4. **serveo.net**: SSH-based, free, gives HTTPS. Has been intermittently down for extended periods. Reliability concern.
  5. **Tailscale**: Requires client-side install. Not viable for a browser-only game.
  6. **Cloudflare named tunnels**: Still routes through Cloudflare's edge network, so core latency issue remains.
- **Implementation**: ngrok is now the primary tunnel in `entrypoint.sh` and `deploy.sh`. Cloudflare is kept as an automatic fallback when `NGROK_AUTHTOKEN` is not set.
- **ngrok URL extraction**: ngrok exposes a local API at `localhost:4040`. The tunnel URL is extracted via `curl -s http://localhost:4040/api/tunnels | python3 -c "..."`. This is more reliable than parsing log output.
- **Free tier WebSocket note**: ngrok's free tier shows a "Visit Site" interstitial for HTTP GET requests to the tunnel URL. This does NOT affect WebSocket upgrade requests -- the `wss://` connection goes through cleanly.
- **Auth token setup**: Set `NGROK_AUTHTOKEN` as an env var. For Vast.ai auto-provisioning, add it to Vercel env vars so `start.ts` passes it through. For manual deploys, pass as 3rd arg to `deploy.sh` or set as env var.
- **Expected improvement**: Total round-trip latency should drop from ~120-220ms (Cloudflare) to ~80-140ms (ngrok), a ~40-80ms improvement. This is the equivalent of eliminating all JPEG encoding overhead twice over.
- **Rule**: When choosing a tunnel for real-time applications, latency overhead is the primary criterion, not features. A tunnel with 10ms overhead and fewer features beats a tunnel with 60ms overhead and more features every time. Measure latency, not just "does it work."
- **Rule**: Always keep the previous tunnel as a fallback. If the new tunnel's auth token isn't configured or the service is down, the system should degrade gracefully to the working (if slower) alternative.

---

## [2026-02-19] Visual polish: SpeedEffects, ParticleOverlay, motion blur, gear shift flash

### Enhanced SpeedEffects (SpeedEffects.tsx)
- **Red-tinted vignette at high speed**: The existing black vignette now blends to a red tint above 150 km/h, ramping to full red-tinted edges at 250 km/h. Implemented as an interpolated `rgba(R,0,0,...)` in the radial gradient, where R scales from 0 to 100 based on speed.
- **Collision pulse overlay**: When collisions arrive, a red edge-flash div (radial gradient, transparent center, red edges) appears and decays over ~250ms via a ref-based decay in the RAF loop. This provides immediate "damage" visual feedback without obscuring the center of the screen.
- **Gear shift flash**: When `gear` changes (excluding initial gear 0), a brief white translucent overlay (`rgba(255,255,255,0.07)`) flashes and decays over ~150ms. This simulates the visual "clunk" of a gear change without being distracting.
- **Warp speed streaks**: At 180+ km/h, a second canvas layer draws radial lines from ~60% screen radius outward toward edges. Line count scales from 12 to 40, speed and length scale with intensity. Uses per-line linear gradients for a streak/trail effect. At extreme speeds (250+ km/h), a blue-tinted radial glow is added to screen edges.
- **Rule**: The collision pulse and gear flash are driven by refs decayed in the RAF loop, with React state (`setCollisionFlash`, `setGearFlashOpacity`) updated from the RAF loop only when the value changes. This avoids re-rendering on every animation frame while still allowing the CSS overlay divs to appear/disappear.

### ParticleOverlay (ParticleOverlay.tsx) -- New component
- **Collision sparks**: 15-40 particles spawned per collision, originating from the lower-center screen area. Orange-yellow color palette (R=255, G=120-255, B=0-50). Particles have gravity (800 px/s^2 downward), air resistance (velocity *= 0.97/frame), and shrink as they die. Each spark has a glow via `ctx.shadowBlur`.
- **Tire smoke**: On handbrake (Space key) while speed > 20 km/h, 3 white/gray smoke puffs spawn per frame near the bottom of the screen. They rise (vy=-40 to -120), expand (radius triples over lifetime), and fade (max alpha 0.25). This gives the visual impression of tire smoke during drifts.
- **Rain particles**: When weather is 'rain' or 'storm', 3-6 rain drops spawn per frame. Each drop is drawn as a diagonal line (using `atan2(vy, vx)` for angle) falling at 600-1000 px/s with a lateral component of 80-350 px/s. Storm mode has larger, faster, more numerous drops.
- **Performance**: Single canvas with a 200-particle cap. Particles are removed via `splice` when dead (iterating backwards). All prop values are read from refs to avoid effect teardown. Canvas uses `devicePixelRatio` scaling via ResizeObserver for crisp rendering on Retina displays.
- **Rule**: When using `ctx.shadowBlur` for glow effects on canvas particles, always reset `ctx.shadowBlur = 0` after drawing glowing particles. Otherwise the shadow setting leaks to subsequent draw calls (smoke, rain) and tanks performance.

### CSS Motion Blur (Race.tsx)
- **Implementation**: A `filter: blur(Npx)` is applied to the video feed container, where N scales linearly from 0 at rest to 1.5px at 200+ km/h. The blur is applied to the same div that handles FOV scaling and steering prediction transforms.
- **Performance**: CSS `filter: blur()` is GPU-composited in all modern browsers. Combined with `transition: filter 0.3s ease-out`, the blur transitions smoothly without layout thrashing. At rest (speed=0), the filter is set to `'none'` to avoid any compositor overhead.
- **Subtlety**: 1.5px max blur is intentionally subtle -- it hides JPEG compression artifacts at high speed while giving a sensation of motion. Stronger blur would obscure gameplay.

### TypeScript narrowing in canvas useEffect (all canvas components)
- **Bug**: TypeScript does not carry null-narrowing from an outer scope into inner function declarations. `const ctx = canvas.getContext('2d'); if (!ctx) return;` narrows `ctx` in the effect body, but the inner `function draw()` does not inherit this narrowing -- so `ctx.clearRect(...)` errors with "possibly null".
- **Fix**: After the null guard, re-assign to an explicitly typed const: `const ctx: CanvasRenderingContext2D = c;`. This creates a new binding with a non-nullable type that inner functions can close over safely.
- **Rule**: In canvas-based React components, always use the pattern `const c = ref.getContext('2d'); if (!c) return; const ctx: CanvasRenderingContext2D = c;` to get correct types in inner functions without non-null assertions.

---

## [2026-02-19 14:00] Vehicle physics: five driving assists for keyboard control

### Countersteer assist (auto-recovery from slides)
- **Implemented**: `_compute_countersteer()` in `carla_manager.py` compares the vehicle's heading (yaw from `get_transform().rotation.yaw`) against its velocity direction (atan2 of `get_velocity()`). When these diverge by more than 15 degrees, it returns a steering correction toward the velocity direction.
- **Scaling**: Uses a smoothstep curve (3t^2 - 2t^3) mapping from 0 at 15 degrees to max correction (0.25) at 45+ degrees. This gives a gentle onset that ramps to strong correction as the drift gets worse. At speeds above 100 km/h, the correction is further scaled down (min 0.3x at 300 km/h) to prevent high-speed overcorrection.
- **Handbrake bypass**: Countersteer is disabled when handbrake is active, so players can intentionally drift without the assist fighting them.
- **Angle normalization**: The heading-velocity angle difference is wrapped to [-180, 180] using a while loop. This handles the CARLA yaw wraparound at +/-180 degrees correctly.
- **Rule**: For keyboard racing games, subtle auto-assists are essential. Binary input (key pressed = max steering) makes it nearly impossible to manually countersteer at the right angle. The assist acts as an invisible safety net, not a driving override.

### Traction control (anti-wheelspin)
- **Implemented**: `_apply_traction_control()` detects wheel spin by comparing expected vs actual acceleration. Two conditions: (1) launch spin -- at <10 km/h with >0.5 throttle, if acceleration is less than 20% of expected, cap throttle to 0.3. (2) Mid-speed traction loss -- at <50 km/h with >0.6 throttle, if speed is DROPPING (acceleration < -5 km/h/s), cap throttle to 0.4.
- **Gradual cap**: The throttle cap (`_tc_throttle_cap`) ramps down at `dt * 4.0` (fast cut) and back up at `dt * 2.0` (slow restore). This creates a natural "engine management" feel rather than binary on/off.
- **No CARLA wheel queries**: The implementation avoids calling `get_physics_control()` every frame (which would be expensive). Instead, it infers wheel spin from the discrepancy between throttle input and actual speed change -- a robust heuristic that works regardless of road surface.
- **Rule**: For traction control, "expected vs actual acceleration" is a more reliable signal than trying to read wheel angular velocity. CARLA's physics queries are expensive, and the acceleration delta captures the same information indirectly.

### Better tire friction model (front/rear split)
- **Implemented**: Replaced uniform `tire_friction >= 3.5` with differentiated front/rear values: front wheels at 3.8, rear wheels at 3.2. Additionally set lateral stiffness values: front `lat_stiff_max_load=3.0, lat_stiff_value=20.0`, rear `lat_stiff_max_load=2.5, lat_stiff_value=17.0`.
- **Rationale**: Higher front friction gives responsive turn-in and grip. Lower rear friction creates a mild oversteer tendency (rear slides slightly before front), which is more fun and more forgiving than understeer for keyboard drivers. The 3.8/3.2 split (15% difference) is subtle enough that the car still feels stable but rewards skilled driving.
- **Lateral stiffness**: `lat_stiff_value` controls how much lateral force the tire generates at a given slip angle. Higher front values mean the car turns in crisply; lower rear values mean the rear slides more gradually at the limit. `lat_stiff_max_load` sets the normal force at which lateral grip maxes out.
- **Original friction stored**: `_original_rear_friction` is captured after physics setup for the handbrake drift system to restore correct values.
- **Rule**: For racing games, slight rear-biased grip loss (mild oversteer) is always more fun than understeer. Understeer feels unresponsive; oversteer feels alive. Keep the front/rear friction gap small (10-20%) to stay on the fun side without making the car undrivable.

### Smooth speed-dependent steering (exponential curve)
- **Implemented**: Replaced the step-function steering limits (`if speed < 30: 0.5, elif < 80: 0.3, ...`) with a continuous exponential decay: `steer_limit = 0.08 + 0.42 * exp(-speed / 70)`.
- **Why exponential**: Linear interpolation (lerp) felt unnatural because equal speed increments caused equal steering changes. In reality, steering sensitivity drops off rapidly at low-to-medium speeds (where most cornering happens) and barely changes at high speed. The exponential curve `e^(-x/70)` naturally captures this: 65% of the change happens in the first 70 km/h.
- **Values match**: At 0 km/h: 0.50 (same as old <30 bucket). At 70 km/h: 0.23 (between old 0.3 and 0.18). At 200 km/h: 0.10 (same as old >150 bucket). The curve passes through similar values as the old steps but eliminates the discontinuities.
- **Frontend sync**: Updated `useSteeringPrediction.ts` `getSteerFactor()` to use the same exponential formula (`0.08 + 0.42 * Math.exp(-speed / 70)`) / 0.50. This keeps client-side visual prediction aligned with server-side steering authority.
- **Rule**: When mapping a continuous input (speed) to a continuous output (steer limit), use a continuous function. Step functions create perceptible jumps at thresholds that players will notice as "the car suddenly steers differently." Exponential decay is a natural fit for diminishing sensitivity curves.

### Handbrake drift mechanics (dynamic friction)
- **Implemented**: `_apply_handbrake_friction()` modifies rear wheel tire friction on handbrake state transitions. On press: reduces to 30% of original. On release: restores to original values.
- **State-transition only**: The physics control is only applied when `handbrake_active != self._handbrake_was_active` (a boolean edge detector). This means `apply_physics_control()` is called at most once per handbrake press and once per release, not every frame. CARLA's `apply_physics_control()` is relatively expensive (~1-2ms) as it reconstructs the vehicle's tire model.
- **Why 30%**: At 30% of base rear friction (3.2 * 0.3 = 0.96), the rear tires have barely any lateral grip, causing them to slide out dramatically. This enables Mario Kart-style power slides where the rear swings wide while the front maintains grip. Values below 20% made the car completely uncontrollable; above 50% the drift effect was barely noticeable.
- **Friction restore**: Original rear friction values are stored in `_original_rear_friction` (a list, since left and right rear could theoretically differ) during `setup_race()`. On handbrake release, these exact values are restored, not the base 3.2 -- this handles the case where the original vehicle blueprint has asymmetric friction.
- **Rule**: Never call `apply_physics_control()` every frame. It's designed for one-time setup, not real-time animation. Use state-transition detection (edge trigger) to call it only when the physical model actually needs to change.

---

## [2026-02-19] Frame pipeline optimization: adaptive quality, delta detection, speed scaling, perf monitoring

### Adaptive JPEG quality (latency-driven, asymmetric stepping)
- **Rewritten**: `frame_encoder.py` `adapt_quality()` now uses four explicit latency tiers with asymmetric step sizes. Quality drops fast (step=8 per call) to react immediately to lag spikes, but rises slowly (step=2 per call) to prevent oscillation at threshold boundaries.
- **Tiers**: >150ms -> q25 + 960x540 (emergency), 80-150ms -> q40 + 1280x720, 50-80ms -> q60, <50ms -> q75 (best). MAX_QUALITY raised from 70 to 75 for better image quality on excellent connections.
- **Resolution changes**: Resolution drops are immediate (latency spikes need instant relief), but resolution increases wait until quality has stabilized near its target (prevents premature resolution jump while quality is still climbing).
- **Latency source**: Client piggybacks measured RTT on every control message (`{ type: 'control', keys: {...}, latency: <ms> }`). Also supported via dedicated `latency_report` message type.
- **Rule**: Asymmetric step sizes are essential for stable adaptive systems. If up and down steps are equal, the system oscillates at threshold boundaries as each adjustment pushes the metric across the threshold and triggers the opposite adjustment.

### Frame delta detection (block-mean perceptual hash)
- **Implemented**: `FrameEncoder.is_frame_similar()` computes a fast perceptual hash by converting the frame to grayscale (luminance weights 0.299R + 0.587G + 0.114B), reshaping into an 8x8 grid of blocks, and computing the mean luminance of each block. The mean absolute difference between the current and previous hash is compared against a threshold (3.0 on a 0-255 scale).
- **Performance**: Runs in <0.5ms on a 1280x720 frame because all operations are vectorized numpy (no loops). The hash is 64 float32 values = 256 bytes, trivial memory.
- **Integration with position-based skip**: Position-based skip (speed <2 km/h + position delta <0.1m + yaw delta <0.5deg) fires first and skips silently (no message sent). Frame delta detection fires second, after the position check passes but before encoding, and sends a lightweight `{ type: 'no_change' }` JSON message to keep the connection alive.
- **Why not pixel-exact**: Pixel-exact comparison would flag every frame as different because CARLA renders with floating-point precision and camera sensors have slight noise. The block-mean hash is robust to per-pixel jitter while still detecting meaningful scene changes.
- **Frontend handling**: The `no_change` message is received but ignored -- the VideoCanvas simply keeps displaying the last rendered frame. No action needed.
- **Rule**: For frame similarity detection, always use a perceptual hash (block means, average hash, pHash) rather than pixel-exact comparison. Renderer noise makes pixel-exact comparison useless for "is the scene the same?" detection.

### Speed-based resolution scaling
- **Implemented**: `FrameEncoder.update_speed_resolution()` drops render resolution from 1280x720 to 960x540 when player speed exceeds 200 km/h, and restores it when speed drops below 150 km/h.
- **Hysteresis gap**: The 50 km/h gap between the downscale threshold (200) and restore threshold (150) prevents flapping when speed oscillates around a single threshold. Without hysteresis, a player hovering at 200 km/h would trigger resolution changes every frame.
- **Interaction with latency-based resolution**: Speed-based downscaling overrides latency-based resolution. When speed drops back below 150 km/h, the resolution returns to whatever the latency adaptation has set (not necessarily 1280x720 -- if latency is >150ms, it stays at 960x540).
- **Rule**: Always use hysteresis for threshold-based state transitions in real-time systems. The gap should be large enough that normal oscillation around the operating point doesn't cross both thresholds.

### Performance monitoring (rolling averages + auto-reduction)
- **Rolling averages**: `FrameEncoder` now tracks the last 30 encode times and frame sizes using `collections.deque(maxlen=30)`. The encoder itself (not the race server) owns this data, which simplifies the server code.
- **Auto-reduction**: If the rolling average encode time exceeds 15ms (at 30fps, encoding should take <10ms to leave headroom), quality is automatically reduced by 5 points down to MIN_QUALITY. This provides a safety net for GPU instances where JPEG encoding competes with CARLA rendering for CPU time.
- **perf_stats message**: A new `perf_stats` message type is sent to the client every 3 seconds containing: avg_encode_ms, avg_frame_size_kb, quality, resolution, speed_downscaled flag, auto_reduced flag, samples count, fps, and frames_sent. The frontend logs this to console for debugging. Future: display in a debug overlay.
- **Server log format**: Enhanced from `encode=X.Xms, avg_encode=X.Xms, size=XKB, fps=X.X, quality=XX, skipped=X` to include resolution, separate position-skip and delta-skip counts, and an `[AUTO-REDUCED]` flag when the encoder has auto-reduced quality.
- **Rule**: Move performance tracking into the component that owns the data (the encoder, not the server). This follows the single-responsibility principle and prevents the server from needing to maintain parallel tracking state.

---

## [2026-02-19] FTUE: Enhanced countdown, post-race flow, HUD fade-in

### Enhanced Countdown (CountdownOverlay in RaceHUD.tsx)
- **Slam-in animation**: Numbers use `countdown-slam` keyframes: start at scale(2.5) opacity 0, slam down to scale(0.9), bounce to scale(1.05), settle at scale(1.0). The `cubic-bezier(0.34, 1.56, 0.64, 1)` easing creates an elastic overshoot feel.
- **GO! explode animation**: "GO!" uses a separate `go-text` keyframe that starts at scale(0.5) and punches up to scale(1.1) before settling. Behind it, a `go-flash` keyframe fires a bright green radial gradient that scales from 0.3 to 2.5 and fades to transparent, creating a flash-burst effect.
- **Screen shake on GO**: When countdown reaches 0, `triggerScreenShake(6, 250)` fires a 6px magnitude shake over 250ms using the existing RAF-based shake system. A `goShakeTriggeredRef` prevents double-firing.
- **Radial gradient flash**: Each number gets a radial gradient circle (400px diameter for numbers, 600px for GO) with the countdown color at 30% opacity center, fading to transparent. Uses `flash-burst` / `go-flash` keyframes.
- **Traffic light dots**: Enlarged from w-5 to w-7, with a `traffic-light-pulse` animation that scales 1.0 -> 1.3 -> 1.0 when each dot activates.
- **Font size**: Numbers are `clamp(10rem, 25vw, 16rem)` (responsive), GO is `clamp(8rem, 20vw, 14rem)`. `font-black` weight with multiple `text-shadow` layers for glow.
- **Rev hint**: "Hold W to rev" text shown with `animate-pulse` below the countdown numbers.
- **Rule**: Use CSS `clamp()` for responsive text sizing in full-screen overlays. Fixed `text-9xl` can be too small on large screens or overflow on mobile. Clamp provides a fluid range with min/max bounds.
- **Rule**: Always use a ref (`goShakeTriggeredRef`) to prevent one-shot effects from double-firing when React re-renders the effect due to related state changes.

### Engine Rev During Countdown (Race.tsx)
- **Approach**: During countdown, the keyboard handler only accepts the W key and sets `countdownRevRef.current = true/false`. The engine sound update loop (RAF) checks the race status: during countdown, it calls `engineSound.update(revRpm, revThrottle, 0, 0)` with synthetic values (RPM 4000, throttle 0.8 when W held, idle otherwise). No control messages are sent to the server during countdown.
- **Key detail**: Other keys (A, S, D, Space, R, C) are blocked during countdown via an early return. Only W is processed. The W key state is tracked in a ref (`countdownRevRef`), not in the `keysRef` that gets sent to the server, so the car never receives throttle during countdown.
- **Rule**: For countdown rev effects, reuse the existing oscillator-based engine sound by feeding it synthetic RPM/throttle values. Do not create separate audio nodes -- this avoids audio context management complexity and ensures the rev sound uses the same harmonics/filters as the actual engine.

### Camera Zoom Animation (Race.tsx)
- **During countdown**: The video feed wrapper gets `transform: scale(0.95) translateY(-10px)` with a 1.0s ease-out transition, creating a slightly pulled-back, aerial view.
- **On GO**: Transitions to `scale(1.0) translateY(0px)` with a 0.5s elastic easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`), creating a satisfying snap-in as the race begins.
- **Interaction with speed FOV**: During countdown, the countdown zoom style takes priority. Once racing, the existing speed-based FOV scale (`1.0 + speed/150 * 0.05`) and steering prediction transforms take over.
- **Rule**: When composing multiple CSS transform sources (countdown zoom, speed FOV, steering prediction), use a conditional that picks the active transform source rather than trying to compose all of them simultaneously. The countdown zoom and the speed FOV occupy the same `transform` property, so they must be mutually exclusive.

### HUD Fade-in on Race Start (RaceHUD.tsx)
- **Approach**: During countdown, all HUD elements (position bar, progress bar, checkpoint arrow, speedometer, lap timer, FPS/latency) get `opacity: 0` via a shared CSS class. When `race_status` transitions from `countdown` to `racing`, a state flag (`hudVisible`) flips to true.
- **Staggered timing**: Each HUD element has a different `transitionDelay` (0ms for top bar, 100ms for progress bar, 150ms for checkpoint arrow, 200ms for speedometer, 300ms for lap timer, 350ms for FPS/latency). Combined with `transition: opacity 500ms ease-out`, this creates a staggered reveal cascade.
- **Reconnect handling**: If the race status is already `racing` when the component mounts (e.g., reconnecting mid-race), `hudVisible` is set to true immediately without waiting for a countdown->racing transition.
- **Rule**: For staggered CSS transitions, use inline `style={{ transitionDelay: '...' }}` rather than dynamic Tailwind classes. Tailwind does not generate arbitrary delay classes by default, and using `style` gives precise control.
- **Rule**: Track the previous race status in a ref to detect specific transitions (countdown -> racing). React's `useEffect` fires on any change to the dependency, so without a ref-based previous value check, you cannot distinguish "just entered racing from countdown" from "re-rendered while racing."

### Post-Race Results Enhancement (RaceResults.tsx)
- **Victory/defeat**: "VICTORY" in green with a `victory-glow` animation (text-shadow pulsing), "DEFEATED" in red with a `defeat-pulse` animation. A `banner-slam` keyframe (scale 0.3 -> 1.1 -> 0.95 -> 1.0) gives the header a dramatic entrance.
- **Particle burst**: On victory, 30 colored particles (green/gold palette) burst from center using CSS custom properties (`--px`, `--py`) and a `particle-burst` keyframe. Each particle has random offset, size, duration, and delay for organic feel.
- **Staggered reveal**: 10 reveal steps at 150ms intervals. Each stat section uses a `revealStyle(step)` helper that returns `{ opacity, transform, transition }` based on whether the current `revealStep` has reached that step. Sections slide up from `translateY(20px)` to `0` with `opacity 0 -> 1`.
- **Extended stats**: Best lap, worst lap (only shown when >1 lap), top speed, average speed (computed from distance/time * 3.6), distance, collisions. Per-stat winner highlighting: the faster/higher value gets `text-green-400 font-bold`.
- **Time difference callout**: A pill badge showing the margin of victory/defeat (e.g., "-2.3s ahead" in green, "+1.5s behind" in red).
- **Instant Race Again**: "Race Again" button calls `onInstantReplay` which uses saved `lastRaceSettingsRef` to restart with identical settings. Enter key shortcut on results screen.
- **Share button**: Builds a URL with track, laps, weather, and model as query parameters, copies to clipboard via `navigator.clipboard.writeText()`.
- **Keyboard shortcut**: Enter key on results screen triggers instant replay via a dedicated `useEffect` listener.
- **Rule**: For staggered reveal animations, use a single incrementing counter (revealStep) with setTimeout rather than individual timers per element. This keeps the timing logic centralized and makes it easy to adjust the cascade speed.
- **Rule**: CSS custom properties (`--px`, `--py`) in animation keyframes enable per-element variation in a shared `@keyframes` rule. Without custom properties, you would need unique keyframes per particle, which scales poorly.

---

## [2026-02-19] Research: Viral game mechanics, browser superpowers, and AI-as-gameplay

### What makes browser games go viral (lessons from agar.io, Wordle, Slow Roads, GeoGuessr, Trackmania, PolyTrack)

**Zero-friction access is the prerequisite, not the feature.** Every viral browser game shares one trait: the gap between seeing a link and playing is zero. Agar.io: click link, type name, play. Wordle: click link, start guessing. Slow Roads: click link, start driving. No downloads, no accounts, no tutorials that block gameplay. For Shadow Driver, this means the GPU provisioning wait (60-120s) is the single biggest viral-loop killer. Solutions: pre-warm instances, progressive loading during wait, or demo mode with local rendering.

**Shareability must be designed, not added.** Wordle's colored emoji grid was not an afterthought -- it was the core viral mechanic. The grid showed your result without spoiling the answer, so every share was a non-spoiler flex AND an implicit challenge. For racing games, the equivalent is a compact visual result card (track, time, gap, racing line mini-viz) that looks good as a tweet. The Web Share API (`navigator.share()`) supports PNG files on mobile, enabling native sharing without any backend.

**Async competition beats real-time multiplayer for virality.** Trackmania's genius is ghost racing: you compete against recordings, not live players. This means no matchmaking, no lag compensation, no server costs, and races are always available. Ghost data is lightweight (~10-30KB per lap) and can be stored in Vercel KV or even embedded in URLs. Daily tracks (one track per day, global leaderboard) create "come back tomorrow" retention. PolyTrack (kodub.itch.io/polytrack) replicated this for browsers: low-poly Trackmania-inspired racing with a level editor and community tracks, 4.7/5 rating from ~500 players.

**The "just one more try" loop requires zero-cost restarts.** Trackmania's instant restart (press Enter, instantly back at start) is the most important retention mechanic. Every millisecond of friction between "I messed up" and "I'm trying again" kills the loop. For Shadow Driver: R key should teleport to start and reset timer with zero UI interaction. No confirmation dialog, no menu, no loading. Server implementation is trivial: teleport actors, reset timers, keep actors alive.

**Shareable moments > persistent progression.** Forza Horizon 5's photo mode generates more social media engagement than its actual racing. Gran Turismo 7's livery editor does the same. For browser games, the equivalent is clip recording: `canvas.captureStream(30)` + `MediaRecorder` for automatic WebM recording, or GIF export of the last 5 seconds for instant social sharing. GIFs autoplay everywhere -- they are the native format of social virality.

### Cloud gaming latency: what actually works

**Negative latency (Google Stadia concept):** The idea was to run the game engine slightly ahead of the player's input, rendering multiple speculative frames for different possible inputs, then selecting the correct one when input arrives. In practice, this is impractical for complex 3D games due to exponential branching. What DOES work: client-side prediction (we already do this with steering), input pre-buffering (send input predictions based on key-hold duration), and temporal frame interpolation (blend between server frames on the client).

**Transport overhead dominates encoding optimization.** Our measured data confirms this: Cloudflare tunnels added 40-80ms per message, more than all JPEG encoding + physics optimizations combined. Ngrok reduced this to 10-20ms. For the next leap: WebRTC with direct UDP (via Vast.ai Direct mode) eliminates the TCP head-of-line blocking penalty and enables browser hardware H.264 decode. Expected improvement: 30-50ms additional reduction.

**Client-side prediction is the highest-ROI latency mitigation.** Our steering prediction overlay (CSS transform on key press) makes the game feel 40-80ms more responsive without any server changes. The key insight: match the server's authority curves exactly. The client must apply the same speed-dependent steering limits as the server, otherwise the correction snap when the real frame arrives is MORE disorienting than the latency. Next opportunities: camera motion extrapolation (shift the viewport by velocity * dt between server frames) and HUD value extrapolation (already done via useInterpolatedState).

### Browser APIs we should be using

**Gamepad API (baseline since 2017):** Analog input is transformative for racing games. `navigator.getGamepads()` gives analog stick (-1.0 to 1.0) and trigger (0.0 to 1.0) values every frame. This means proportional steering and throttle instead of binary on/off. Implementation is ~50 lines. The single biggest "game feel" improvement available. Ref: https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API

**ONNX Runtime Web with WebGPU:** Runs neural network models directly in the browser with GPU acceleration. Import `onnxruntime-web/webgpu`, create session with `executionProviders: ['webgpu']`, run inference. PilotNet (~1MB ONNX model, 200x66 input, single steering output) is well within browser inference capability. Use cases: drive ghost cars on track preview, visualize AI decisions client-side, run client-side PilotNet for comparison overlay. WebGPU supported in Chrome/Edge 113+ (~78% of users). Ref: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html

**Web Share API:** `navigator.share({ files: [pngFile], title, text })` triggers the native OS share sheet on mobile. Supports PNG, WebM, and MP4 files. This means one-tap sharing of race result cards and gameplay clips to Twitter, Discord, Messages, etc. with zero backend infrastructure. Secure context (HTTPS) only, requires user gesture. Ref: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

**Canvas captureStream + MediaRecorder:** `canvas.captureStream(30)` returns a MediaStream of the canvas at 30fps. Feed it to `new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })`. Record gameplay as WebM video entirely client-side. Ring-buffer the last N chunks for "instant replay" style clip saving. Combine with Web Share API for one-tap clip sharing. Ref: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream

**Wake Lock API:** `navigator.wakeLock.request('screen')` prevents screen dimming during gameplay on mobile/tablet. Essential for longer races where the player isn't touching the screen (if using a gamepad). Trivial to implement, significant UX improvement.

**Fullscreen API:** `element.requestFullscreen()` hides browser chrome for immersive racing. Important on mobile where the URL bar consumes significant screen real estate.

**Web Bluetooth (experimental):** Can connect BLE steering wheels and controllers via `navigator.bluetooth.requestDevice()`. However, the API is experimental, Chrome-only, and not available in Firefox or Safari. Use as progressive enhancement only, not primary input. Ref: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API

### AI as a game mechanic (the HackerNews angle)

**The "teach your AI" concept is the most viral-potential feature.** Let players record their driving, train a PilotNet clone on their data (~30s of GPU fine-tuning), and export a personalized AI driver. The AI clone can then compete in async tournaments against other players' AI clones. This combines the appeal of creature-training games (like Keiwan's Evolution simulator at keiwan.itch.io/evolution, which lets users build creatures that learn to walk through genetic algorithms and neural networks) with competitive racing. The HackerNews crowd specifically loves: watching AI learn (mesmerizing visualization), understanding AI decisions (explainable AI overlay), and competing at a meta-level (optimizing the training process, not just driving).

**Neural network visualization is the "wow factor."** Radu Mariescu-Istodor's JavaScript self-driving car tutorial (github.com/gniziemazity/Self-driving-car) has millions of YouTube views specifically because it visualizes the neural network: you see the nodes light up, the connections fire, and the car respond. For Shadow Driver, showing a small inset with PilotNet's attention heatmap (Grad-CAM) while the AI drives would generate massive sharing. Implementation: compute Grad-CAM on the server (cheap with PyTorch register_backward_hook), downsample to 50x33, send as low-res JPEG alongside the main frame.

**GT Sophy (Nature, 2022) proved superhuman racing AI is compelling.** Sony AI's GT Sophy achieved superhuman performance in Gran Turismo via reinforcement learning. The published results and accompanying media generated enormous interest. Shadow Driver can democratize this: instead of a corporate-trained superhuman agent, let every player train their own agent. The gap between "watch a corporate demo" and "do it yourself in your browser" is the viral opportunity.

**AI race commentary is low-effort, high-delight.** Feed telemetry events (overtake, crash, close gap, final lap) to Claude API or Web Speech API for real-time commentary. "And the player takes the inside line through turn 3!" Shareable clips with AI commentary would be highly distinctive content. Implementation: batch telemetry events every 5 seconds, send to Claude with a "racing commentator" system prompt, display response as subtitles.

### Racing game design patterns worth stealing

**Mario Kart's rubber banding is invisible skill-floor management.** Items are weighted by position: last place gets blue shells, first place gets bananas. This keeps every race close without the player feeling cheated. Our existing distance-based rubber banding on the AI car serves the same purpose. Lesson: the best difficulty adjustment is one the player doesn't notice.

**Trackmania's daily tracks create appointment viewing.** One track per day, same for everyone, global leaderboard. This turns a single-player game into a daily social event. Players share their times, compare strategies, and come back tomorrow. Implementation is trivial: `Math.floor(Date.now() / 86400000)` as seed for track/weather/spawn selection.

**Forza Horizon 5 seasonal content prevents staleness.** Monthly themes (winter, spring, etc.) change the map, available events, and rewards. For Shadow Driver: monthly themed tournaments (night races, rain championship, reversed tracks) with aggregate scoring could serve the same purpose at much lower cost.

**Drift scoring (angle * speed * duration) creates a second game mode.** Nearly every arcade racer has a drift scoring system. It's orthogonal to lap time competition and appeals to a different player personality. Implementation: compute slip angle from heading vs velocity vector (we already do this for countersteer assist), multiply by speed and duration, accumulate points. Display as a combo counter that resets on crash or grip recovery.

---

## [2026-02-19] Deep Research: AI in Games -- Technical Insights

### GT Sophy and the state of superhuman racing AI

- **GT Sophy** (Sony AI + Polyphony Digital, Nature 2022 cover story) achieved superhuman performance in Gran Turismo Sport. Key technical insight: they used a multi-agent RL league training system, inspired by AlphaStar (DeepMind, StarCraft II). Instead of training against one opponent, they trained a "league" of diverse agents that continuously play each other. New agents branch from existing ones and discover counter-strategies, creating evolutionary pressure. The final agent represents the Nash distribution -- the optimal mixture of discovered strategies. This is why simple self-play (training against yourself) often leads to brittle strategies that fail against novel opponents.
- **AlphaStar** handled ~10^26 legal actions per timestep in StarCraft II using a deep neural network combining transformers (for game units), deep LSTM core, autoregressive policy head, and pointer networks. Two-stage training: supervised learning on human replays (95% win rate vs built-in Elite AI), then multi-agent RL league. The league approach is transferable to racing: train multiple AI drivers with different styles (aggressive, defensive, strategic) and let them compete.
- **Lesson for Shadow Driver**: Full GT Sophy-level training is infeasible (millions of episodes, weeks of GPU time). But a single PPO agent trained with Stable Baselines 3 on one CARLA track can learn to complete laps in days. Key: use state-based observations (speed, heading, centerline distance) rather than pixel observations for tractable training. Pixel-based RL (like DreamerV3) is possible but 10-100x slower to converge.
- **DreamerV3** (Danijar Hafner): World-model RL that learns entirely from pixels. First algorithm to collect diamonds in Minecraft from scratch without human data. Uses "imagination" -- learns an environmental model and improves behavior by simulating future scenarios. Robust across 150+ diverse tasks with a single configuration. Relevant for future Shadow Driver work: could train a vision-based racing agent that doesn't need hand-crafted state features.

### Imitation learning for racing (Drivatar and behavioral cloning)

- **Forza Drivatar** (Microsoft Research): Records player driving behavior across millions of players. Uses neural networks trained on per-player telemetry to create AI opponents that mimic individual driving styles. Each player's Drivatar learns their tendencies: aggressive braking, wide lines, tendency to block, etc. Other players then race against these Drivatars, creating a virtual community of driving styles.
- **Key challenge with keyboard input**: Imitation learning works best with analog input (joystick gives continuous steer values from -1.0 to 1.0). Keyboard input is binary (0 or 1), which creates noisy training signals. Mitigation: use the post-ramping smoothed control values as training targets (after our progressive steering ramp), not raw key states. The ramped values are continuous and more closely represent the player's intent.
- **PilotNet architecture**: 5 convolutional layers + 4 fully-connected layers, ~250K parameters, <10MB model. Takes 200x66 pixel camera image, outputs steering angle. Pre-trained weights at HuggingFace (sergiopaniego/OptimizedPilotNet). Training on ~1000 frame-action pairs takes ~2-5 minutes on RTX 3090. ~50MB VRAM for inference.
- **Behavioral cloning pitfall**: The model only sees states visited by the expert driver. If the clone drifts slightly off the expert's path, it enters a state never seen in training and produces increasingly bad actions (compounding error). Solutions: DAgger (Dataset Aggregation -- iteratively collect data from the trained policy), data augmentation (jitter the training images laterally), or add a recovery policy.
- **Rule**: For imitation learning from keyboard input, always train on smoothed/ramped control signals, not raw binary key states. Binary targets produce models that output extreme values (0 or 1) with no intermediate predictions.

### TTS for game commentary: the options

- **Kokoro-82M** (github.com/remsky/Kokoro-FastAPI): Open source, 82M parameters, ~350MB VRAM. Performance: 35-100x realtime speed on NVIDIA GPUs, ~300ms first-token latency for streaming. Supports emotion markers ([laughter], [sighs]) and emphasis (CAPITALIZATION). 100+ speaker presets across multiple languages. OpenAI-compatible API. Natural boundary detection for long-form content. This is the best option for Shadow Driver: small enough to run alongside CARLA, fast enough for near-real-time commentary, emotionally expressive enough for a sports commentator persona.
- **Bark** (github.com/suno-ai/bark, by Suno): Transformer-based text-to-audio model (not just TTS -- generates laughter, music, ambient sounds). Fully generative from text prompts. Uses GPT-style architecture + EnCodec quantized audio. Performance: "roughly real-time" on enterprise GPUs, significantly slower on older hardware. Full model needs ~12GB VRAM -- too heavy alongside CARLA. Smaller variants available with speed/quality tradeoff.
- **ElevenLabs API**: Cloud-based, highest quality voice synthesis. WebSocket streaming support for low-latency delivery. Per-character pricing. ~500ms latency. Zero VRAM cost. Best for production quality when cost is acceptable.
- **Web Speech API** (`window.speechSynthesis`): Built into browsers, zero cost, zero latency for text rendering. But voice quality is mediocre and robotic -- fine for prototype, not for "wow" demo.
- **Rule**: For game commentary TTS, streaming first-token latency matters more than total generation speed. A model that starts playing audio after 300ms (while still generating the rest) feels near-instant; a model that generates the entire utterance in 100ms but buffers before playing feels slower.

### Browser AI inference: what actually works today

- **ONNX Runtime Web**: The most mature option. Supports WebGPU, WebGL, and WASM backends. All ONNX operators work via WASM; only a subset work via WebGPU. Install: `npm install onnxruntime-web`. Use WebGPU for GPU models, WASM for CPU fallback. Key advantage: any model that can be exported to ONNX (PyTorch, TensorFlow, JAX) can run in the browser.
- **Transformers.js** (HuggingFace, 15K+ GitHub stars): Higher-level API that mirrors Python transformers library. Pipeline-based: `const pipe = await pipeline('text-classification', 'model-name')`. Uses ONNX Runtime under the hood. Supports quantization (fp32, fp16, q8, q4) for browser-optimized sizes. Covers NLP, vision, audio, and multimodal tasks. Install: `npm install @huggingface/transformers`.
- **Web-LLM** (MLC-AI): Runs full LLMs in the browser via WebGPU. Supports Llama 3, Phi 3, Gemma, Mistral, Qwen -- multiple model families at various sizes. OpenAI-compatible API (drop-in replacement). Could theoretically run commentary generation entirely client-side if the user has a decent GPU (8GB+ VRAM). First load downloads model weights to browser cache; subsequent loads are instant.
- **WebGPU availability**: Chrome 113+ (May 2023), Edge 113+. Firefox behind flag. Safari partial support. Covers ~78% of desktop browsers. Not available on most mobile browsers yet.
- **Performance reality check**: Browser inference is 2-5x slower than native GPU inference due to WebGPU API overhead, shader compilation, and memory management limitations. A model that runs at 10ms native might take 25-50ms in the browser. For real-time per-frame processing (super-resolution, style transfer), this means the model must be VERY small (<100K parameters) to hit 30fps in the browser.
- **Rule**: For browser AI inference, always benchmark the actual WebGPU performance before committing to a feature. The gap between "this model runs at X ms on native GPU" and "this model runs at Y ms in browser WebGPU" is consistently larger than expected. Plan for 3-5x slowdown.

### AI-generated music: what's practical for games

- **MusicGen** (Meta, AudioCraft): Generates music from text prompts with optional melodic conditioning. MIT-licensed code, CC-BY-NC model weights (non-commercial). Can generate 30-second clips from descriptions like "energetic electronic racing music with heavy bass."
- **Stable Audio** (Stability AI): Text-to-audio, audio-to-audio, and audio inpainting. Enterprise-grade, leading inference speeds. Supports fine-tuning on custom sound libraries. Generates both music and sound effects.
- **What AAA games actually do**: Stem-based adaptive music. Pre-compose (or pre-generate) multiple music layers (drums, bass, melody, ambience) for each mood. At runtime, crossfade layers based on game state. The layers are designed to work in any combination. This is dramatically simpler and more reliable than real-time generation.
- **Real-time AI music generation is NOT viable for games**: Even the fastest models (MusicGen) need seconds to generate audio. Games need <50ms audio state transitions. The solution is pre-generation + runtime mixing, not real-time synthesis.
- **Rule**: For adaptive game music, pre-generate stems offline using AI, then mix them at runtime with Web Audio API gain nodes. Never attempt real-time AI music generation during gameplay -- the latency is fundamentally incompatible with interactive audio.

### GameNGen, Oasis, and the future of neural game engines

- **GameNGen** (Google DeepMind): First demonstration of a diffusion model functioning as a real-time game engine. Simulates DOOM at 20fps on a single TPU. Two-stage pipeline: (1) RL agent plays the game to generate training data, (2) fine-tuned Stable Diffusion v1.4, conditioned on action history + previous frames. Human raters couldn't distinguish generated gameplay from real. PSNR of 29.4 (comparable to lossy JPEG). Key innovation: adding Gaussian noise to context frames during training allows error correction across long sequences.
- **Oasis** (Decart + Etched): Generates interactive Minecraft-like worlds at 20fps using ViT spatial autoencoder + Diffusion Transformer (DiT). "Dynamic noising" addresses temporal stability. The model generates each frame conditioned on player input, autoregressively. Over 100x faster than comparable text-to-video models.
- **Relevance to Shadow Driver**: These projects show the direction of the field (neural rendering), but they're NOT practical for Shadow Driver v3. Both require dedicated GPU/TPU resources and produce lower-fidelity output than CARLA's native Unreal Engine rendering. The value is conceptual: in the future, it may be possible to generate photorealistic driving environments without a traditional game engine.
- **Rule**: Neural game engines (GameNGen, Oasis) are research milestones, not production tools. For the next 2-3 years, traditional renderers (Unreal, Unity, CARLA) will produce better visuals with less GPU cost. The research is relevant for long-term roadmap, not immediate features.

### NVIDIA DLSS and AI-enhanced streaming

- **DLSS architecture**: Uses transformer-based AI models trained on NVIDIA supercomputers. Three components: (1) Super Resolution -- upscales lower-resolution frames using motion data and temporal history, (2) Frame Generation -- AI generates up to 3 extra frames per rendered frame (4x frame rate), (3) Ray Reconstruction -- AI replaces hand-tuned denoisers for ray-traced scenes.
- **Performance**: Combined DLSS can deliver up to 8x frame rate improvement. Requires NVIDIA RTX hardware (tensor cores).
- **TensorRT**: NVIDIA's inference optimizer. Achieves 6x faster PyTorch inference "with a single line of code" via Torch-TensorRT. Supports FP8, FP4, INT8, INT4 quantization. For Shadow Driver: could accelerate PilotNet inference from ~5ms to <1ms, or enable running larger models that wouldn't otherwise fit in the latency budget.
- **Relevance to Shadow Driver**: We can't use DLSS directly (it requires NVIDIA tensor cores on the client). But the CONCEPT of streaming low-res + client-side upscaling is directly applicable. If we can run a tiny super-resolution model in the browser via WebGPU (FSRCNN at ~12K params), we can stream 640x360 (50% bandwidth savings) and upscale to 720p on the client.
- **Rule**: DLSS-style temporal upscaling (using motion vectors + history frames) produces much better results than single-frame super resolution. If implementing browser-side upscaling, keep a 2-3 frame history buffer and use the telemetry velocity as a proxy for motion vectors.

### Optimal racing line computation

- **TUMFTM global_racetrajectory_optimization** (TU Munich, github.com/TUMFTM/global_racetrajectory_optimization): Open-source Python, uses CVXPY for convex optimization. Four optimization objectives: shortest path, minimum curvature (best general-purpose approximation of fast lines), minimum time (needs detailed vehicle dynamics), minimum time with powertrain (includes battery SOC, thermal effects for EVs). Takes track boundaries as input (centerline + left/right width), outputs optimal waypoints.
- **Minimum curvature is the sweet spot**: It's computationally cheap (~10 seconds per track), doesn't require vehicle dynamics parameters, and produces lines that are 90-95% as fast as the true minimum-time solution. The key insight: minimizing curvature minimizes the speed at which you need to negotiate each corner, which approximately minimizes lap time.
- **CARLA integration**: CARLA maps use OpenDRIVE format. Track boundaries can be extracted from `carla.Map.get_topology()` and `carla.Map.generate_waypoints(distance)`. Convert CARLA waypoints to the TUMFTM input format (centerline + left/right distances), run the optimizer offline, store results as JSON per track.
- **Rule**: For racing line optimization, start with minimum curvature (fast, no vehicle model needed). Only move to minimum time if you need absolute optimal lines and are willing to characterize the vehicle's acceleration/braking envelope (ggv diagrams).

---

## [2026-02-19] Drift Scoring System

**Drift detection uses heading-vs-velocity slip angle, not steering input.** The server computes slip angle as the difference between the vehicle's forward heading and its velocity vector. This is physically correct — a car can be drifting with zero steering input (momentum drift). Threshold: 15 degrees of slip angle at speed > 20 km/h triggers a drift. The detection runs server-side in `race_logic.py`'s `DriftDetector` class.

**Score formula: avg_angle × avg_speed × duration × 0.1.** Averaging angle and speed over the drift duration (rather than summing per-frame) produces stable, predictable scores that don't depend on frame rate. The 0.1 scaling factor keeps scores in a human-readable range (100-5000 points per drift). Multipliers for special situations: 1.5x chain bonus (new drift within 2 seconds of previous), 1.5x high-speed bonus (average speed > 120 km/h), 2x reverse-entry bonus (entering drift while in reverse).

**The frontend DriftScore component uses three visual layers.** Active drift display (bottom-center, shows live angle/speed/score while drifting), score popups (animated numbers that rise and fade on drift end), and a persistent total score counter (top area). CSS keyframe animations handle the visual feedback: `drift-score-pulse` for the active indicator, `drift-popup-rise` for the floating score numbers, `drift-total-bump` for the total counter update.

**Rule**: For drift scoring, average angle and speed over drift duration rather than summing per-frame values. Per-frame sums create frame-rate-dependent scores and produce unintuitive numbers. Averages × duration gives consistent results regardless of server tick rate.

---

## [2026-02-19] Auto-Shutdown for GPU Instances

**Cloud GPU instances must always have an auto-shutdown mechanism.** Without it, a forgotten instance can run for hours at $0.30-1.50/hr. The `AutoShutdownManager` in `race_server.py` tracks WebSocket connections and starts a 10-minute countdown when the last client disconnects. Any new connection cancels the timer.

**Self-destruct uses the Vast.ai API directly from within the container.** The instance calls `DELETE https://console.vast.ai/api/v0/instances/{instance_id}/` with its own API key and instance ID (both passed as environment variables via the onstart script). This is more reliable than an external watchdog because it works even if the callback URL is unreachable.

**Instance ID discovery is non-trivial on Vast.ai.** The container doesn't inherently know its own instance ID. We pass it via the `INSTANCE_ID` env var in the provisioning onstart script. Vast.ai also sets `VAST_CONTAINERLABEL` to `C.{instance_id}`, which serves as a fallback. The auto-shutdown manager tries both.

**Rule**: For cloud GPU instances, always implement auto-shutdown with an idle timer. 10 minutes is a good default — long enough to survive page refreshes and brief disconnects, short enough to prevent runaway costs. Pass the instance ID and API key as environment variables during provisioning.

---

## [2026-02-19] Camera Motion Extrapolation

**Client-side frame extrapolation reduces perceived choppiness between 30fps server frames.** The `useFrameExtrapolation` hook applies subtle CSS `translate()` transforms to the video canvas between server frame arrivals. Direction: lateral (X) based on current steering input × speed, vertical (Y) based on speed alone (simulating forward motion). The transform resets smoothly when a new server frame arrives.

**Maximum displacement must be tiny (±5px) to avoid visible artifacts.** Larger extrapolation causes visible "snapping" when the real frame arrives and doesn't match the prediction. At ±5px, the correction is imperceptible — the brain fills in the gap. The time delta is capped at 50ms to prevent large jumps after frame drops.

**Extrapolation compounds with existing CSS transforms.** Race.tsx already applies steering prediction (translateX) and speed-based FOV (scale) transforms. The extrapolation transform is combined via string concatenation: `translate(${steerX + extraX}px, ${extraY}px) scale(${fov})`. Order matters — translate before scale.

**Rule**: For frame extrapolation, keep maximum displacement to ±5px and time delta cap to 50ms. Larger values make the correction visible when real frames arrive. The goal is subliminal smoothness, not accurate prediction.

---

## [2026-02-19] Personal Best Times

**Personal bests use localStorage keyed by track and lap count.** Key format: `shadow-driver-pb` containing a JSON object keyed by `${track}_${laps}`. This means "Town01 3 laps" and "Town01 5 laps" have separate records. The `usePersonalBests` hook provides `saveBest()`, `getBest()`, and `getResult()` functions.

**Compare before saving to detect new records.** The `getResult()` function must be called BEFORE `saveBest()` — it returns the medal earned and whether a new PB was set by comparing the current time against the stored best. If you save first and then compare, you're comparing against yourself and will never detect improvement.

**Medal thresholds are percentage-based relative to personal best.** Gold: finish within 5% of PB (near-perfect run). Silver: within 15%. Bronze: completed the race. This system rewards consistency and improvement rather than absolute speed, which is appropriate for a game where track conditions and AI behavior vary.

**Rule**: When implementing personal best systems, always compare the new time against the old PB before saving. Call `getResult(time)` first to determine if it's a new record, then call `saveBest(time)` to persist it. Reversing this order means you always compare against your just-saved time.

---

## [2026-02-19] Time-of-Day Presets and Camera Settings

**CARLA's weather system controls sun position via sun_altitude_angle and sun_azimuth_angle.** Five presets implemented: Morning (altitude 15°, warm fog), Noon (altitude 90°, clear), Sunset (altitude 5°, azimuth 180°, orange clouds), Night (altitude -30°, dark), Storm (altitude 30°, heavy rain/clouds/wind). Each preset sets 10+ weather parameters including cloudiness, precipitation, fog density, wetness, and wind intensity.

**Cinematic camera settings significantly improve visual quality.** FOV 90 (wider than CARLA's default 70), motion_blur_intensity 0.3, exposure_mode histogram (auto-adjusts to scene brightness), shutter_speed 1/60, ISO 100. These are set as blueprint attributes on the camera sensor in `carla_manager.py`'s `_attach_camera()`. The histogram exposure mode is important — without it, night scenes are too dark and sunny scenes are blown out.

**The time-of-day selector uses a 5-column grid with themed colors.** Morning=amber, Noon=sky-blue, Sunset=orange, Night=indigo, Storm=gray. Each option has an emoji icon and descriptive subtitle. The selection is passed to the server as part of the `start_race` message and applied before the first frame renders.

**Rule**: When setting CARLA camera attributes, always use histogram exposure mode (`exposure_mode: "histogram"`) for scenes with varying lighting. Manual exposure breaks badly in night/dawn transitions. Also set shutter_speed and ISO explicitly — CARLA's defaults produce noisy images in low light.

---
