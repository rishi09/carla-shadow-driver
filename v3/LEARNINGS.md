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
