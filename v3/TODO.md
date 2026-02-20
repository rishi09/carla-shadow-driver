# Shadow Driver v3 - TODO

## Latency & Streaming (the #1 problem)

### Current bottleneck analysis
The perceived lag stack when turning:
1. **Server-side steering ramp**: ~40ms (was ~130ms, fixed)
2. **JPEG encode**: ~5-10ms (quality=50, 1280x720)
3. **Network transit**: ~30-60ms (SSH tunnel) or ~80-140ms (Cloudflare tunnel)
4. **Browser JPEG decode + canvas paint**: ~5-15ms
5. **rAF sync wait**: 0-16ms (requestAnimationFrame)
**Total: ~80-140ms (SSH) or ~120-220ms (Cloudflare)**

### Transport: Kill the Cloudflare middleman
- [x] **Ngrok tunnel (primary)**: Replaced Cloudflare quick tunnel with ngrok as primary tunnel. Free tier: 1 agent, valid TLS certs, WebSocket support, ~10-20ms overhead (vs Cloudflare's ~40-80ms). Requires `NGROK_AUTHTOKEN` env var. Cloudflare kept as automatic fallback.
- [ ] **WSS via self-signed cert on GPU**: Generate self-signed TLS cert on instance boot, serve `wss://` directly on port 8765. Browser will warn about self-signed cert but `wss://` won't be blocked by mixed content. Add a "trust this GPU" interstitial page.
- [ ] **Tailscale/WireGuard tunnel**: Set up Tailscale on GPU instance — gives stable hostname + encrypted tunnel with ~2ms overhead vs Cloudflare's ~40-80ms.
- [ ] **Direct Vast.ai with SSL**: Rent instances with "Direct" network mode, use Let's Encrypt or Caddy for auto-TLS on a custom domain pointing to the GPU IP.

### Encoding: Faster frame pipeline
- [ ] **NVENC JPEG encoding**: Replace OpenCV JPEG with `nvjpeg` (CUDA JPEG encoder). Drops encode from ~5-10ms to <1ms. Available via `pip install pynvjpeg` or PyTorch's `torchvision.io.encode_jpeg` with CUDA tensors.
- [ ] **WebRTC with direct UDP**: Test on Vast.ai "Direct" mode with UDP ports exposed. This is the real WebRTC win — browser hardware H.264 decode + no rAF sync.
- [x] **Skip unchanged frames**: Frame delta detection using block-mean perceptual hash (8x8 blocks, <0.5ms overhead). When frames are similar, sends lightweight `no_change` JSON instead of re-encoding JPEG. Combined with position-based skip for stationary cars.
- [x] **Adaptive quality**: Four-tier latency-based quality: >150ms->q25/960x540, 80-150ms->q40/720p, 50-80ms->q60/720p, <50ms->q75/720p. Asymmetric stepping (fast down=8/call, slow up=2/call) prevents oscillation. Auto-reduces quality if average encode time >15ms.
- [x] **Resolution downscale at speed**: At 200+ km/h, drops to 960x540. Restores at <150 km/h (50 km/h hysteresis gap prevents flapping).
- [x] **Performance monitoring**: Rolling 30-frame averages for encode time and frame size. `perf_stats` message sent to client every 3s for debug overlay. Server logs enhanced with pos_skip/delta_skip counts and auto-reduction flags.

### Client-side prediction (biggest perceived improvement)
- [x] **Steering prediction overlay**: When A/D pressed, immediately rotate the canvas by a few degrees in the steering direction BEFORE the next server frame arrives. Speed-dependent: matches server's steer limits (2.8deg at <30km/h, 0.56deg at >150km/h). Smooth rAF interpolation with attack/release curves. Also includes pitch tilt on W/S and lateral translateX shift.
- [ ] **Camera motion extrapolation**: Use current velocity vector to shift the camera view by `velocity * dt` between server frames. Smooth interpolation, corrected on next frame.
- [ ] **Input echo in HUD**: Steering/throttle/brake bars already update instantly from local input — consider adding a subtle visual indicator (steering wheel icon, wheel turn animation) that responds instantly to input.

### WebRTC (Phase 2-4 from original plan)
- [ ] Test with Vast.ai "Direct" network mode (UDP ports 10000-10010 exposed)
- [ ] Tune H.264 bitrate (start 1.5 Mbps, auto-adjust via WebRTC congestion control)
- [ ] NVENC via GStreamer pipeline if CPU x264 can't sustain 30fps
- [ ] TURN server for tunnel compatibility (Metered.ca free tier: 50GB/month)
- [ ] Measure actual latency improvement vs JPEG baseline
- [ ] Remove FrameEncoder class once WebRTC is stable

---

## Graphics & Visual Quality

### CARLA rendering improvements (server-side)
- [ ] **Higher render resolution**: Render at 1920x1080 on server, downscale to 1280x720 for streaming (supersampling anti-aliasing). CARLA supports arbitrary camera resolution.
- [ ] **Post-processing effects**: Enable CARLA's built-in post-processing — motion blur, bloom, lens flare via `carla.ColorConverter` or UE4 post-process settings.
- [ ] **Better camera settings**: Tune FOV, exposure, gamma. CARLA cameras support `fov`, `shutter_speed`, `iso`, `fstop`, `gamma` attributes.
- [x] **Time of day**: Dynamic sun path transitions during race via WeatherTransitionManager. Sun moves from dawn to sunset over the course of a race.
- [ ] **Rain/wet roads**: CARLA has wet road reflections when precipitation > 0. Looks dramatically better than dry roads. (Partial: storm event triggers at 70% race progress for 3+ lap races)

### Frontend visual polish
- [x] **Motion blur shader**: CSS `filter: blur()` on video canvas, driven by speed (0-1.5px). Hides JPEG artifacts at high speed.
- [x] **Speed lines**: Animated radial lines overlaid on canvas at high speed (anime/racing game style) via SpeedLines.tsx.
- [ ] **Better HUD design**: Redesign speedometer as an arc/gauge. Add tachometer. Use racing game UI conventions.
- [x] **Particle effects**: Canvas-overlay spark particles on collisions, tire smoke on handbrake, rain drops on weather via ParticleOverlay.tsx.
- [x] **Speed vignette enhanced**: Red tint at 200+ km/h, collision pulse (red edge flash), warp speed streaks at 180+ km/h.
- [x] **Gear shift effect**: Brief white flash overlay on gear change, decays over ~150ms.
- [ ] **Rear-view mirror**: Small inset showing rear camera (CARLA supports multiple cameras).

---

## Vehicle Physics Tuning
- [x] Faster throttle ramp (~80ms, was ~300ms) and brake ramp (~60ms, was ~100ms)
- [x] Faster steering ramp (~40ms, was ~130ms)
- [x] Reverse threshold raised to 15 km/h (was 5 km/h)
- [x] Vehicle physics: reduced mass, boosted torque, increased tire friction, lowered center of mass
- [x] Add countersteer assist (auto-correct when sliding) -- smoothstep-scaled correction based on heading vs velocity divergence, 15-45deg range, disabled during handbrake
- [x] Add traction control (reduce throttle on wheel spin) -- detects launch spin and mid-speed traction loss, gradually caps throttle at 0.3-0.4
- [x] Drift mode: handbrake reduces rear tire friction for controlled slides -- 30% friction on press, restore on release, state-transition only (no per-frame physics apply)
- [x] Better tire friction model: front/rear split (3.8/3.2), lateral stiffness tuned (front 20, rear 17), stiffer damping
- [x] Smooth speed-dependent steering: exponential curve replaces step-function thresholds (0.08 + 0.42 * exp(-speed/70))

## Game Feel / Juice
- [x] Camera FOV scaling at speed (subtle 1.0→1.05x zoom at 150+ km/h)
- [x] Let player pick their car from 6 vehicles (Tesla, Mustang, Charger, Audi TT, Mini Cooper, Impala)
- [x] Speed vignette: GPU-accelerated CSS radial gradient, scales with speed
- [ ] Camera shake on acceleration/hard braking (collision shake already exists)
- [x] Impact sparks and tire smoke (CSS/canvas overlay particles) -- ParticleOverlay.tsx
- [x] Gear shift animation/sound -- visual flash in SpeedEffects.tsx
- [x] Drift scoring (angle * speed * duration = points) -- DriftDetector in race_logic.py, DriftScore.tsx overlay

---

## First-Time User Experience (FTUE)
Learnings from Forza Horizon 5, Mario Kart, Trackmania, Slow Roads, agar.io.

### Landing Page
- [x] Animated canvas background with speed streaks, perspective grid, vanishing point (SpeedCanvas)
- [x] One-line value prop: "Race an AI. In your browser. On a real GPU."
- [x] One big "RACE NOW" button with pulse glow animation + hover bloom
- [x] Lean into the "this runs in a BROWSER?!" disbelief factor
- [x] Feature cards with scroll-reveal animations (IntersectionObserver)
- [x] "How it works" 3-step section
- [x] Technical flex section: stats (30 FPS, <100ms lag, 720p, 24GB VRAM), powered-by badges, GitHub link
- [x] Responsive design (mobile-first)
- [x] Dark cinematic theme (#030308 base, cyan/green/blue accents)
- [ ] Show CARLA gameplay video as hero background (requires video asset)

### Countdown Sequence
- [x] Let player rev engine during countdown (W key accepted, plays engine rev sound, car doesn't move)
- [x] Camera starts wider/higher (scale 0.95, translateY -10px), pulls into gameplay position on GO
- [x] Screen shake burst on GO (6px magnitude, 250ms duration)
- [x] Hide HUD during countdown, staggered fade-in on GO (0-350ms delays per element)
- [x] Engine rev sound builds through 3-2-1 (W key controls rev intensity via oscillator banks)
- [x] Enhanced countdown visuals: huge numbers (clamp 10rem-16rem), slam-in scale animation, radial gradient flash behind each number, "GO!" explode-outward animation with bright green flash, traffic light dots with pulse animation

### Post-Race / Retention
- [x] "Race Again" button that's instant -- same settings, skip setup (Trackmania-style)
- [x] Enter key shortcut for instant race again on results screen
- [x] Post-race stats comparison: total time, best lap, worst lap, top speed, avg speed, distance, collisions (player vs AI)
- [x] Victory/defeat celebration: "VICTORY" green glow + confetti particle burst, "DEFEATED" red pulse
- [x] Staggered reveal animation: stats slide in one-by-one (150ms intervals, 10 steps)
- [x] Lap-by-lap breakdown with per-lap winner highlighting (green bold)
- [x] Time difference callout (e.g., "-2.3s ahead" / "+1.5s behind")
- [x] Share button: copies URL with track/laps/weather/model pre-filled
- [ ] Ghost replay of your previous best lap
- [ ] Personal best times with medals (Bronze/Silver/Gold per track)
- [ ] Simple leaderboard (per track, stored in KV or DB)

### Browser Advantage
- [ ] Minimize time from URL click to gameplay (target: <5 seconds for returning players)
- [ ] Show something exciting during GPU provisioning wait (replays, leaderboards, tips)
- [x] Make the `?ws=` URL shareable -- post-race "Share this race" button copies URL with settings

---

## AI Opponent
- [x] Distance-based rubber banding (50m threshold, per-difficulty scaling: easy strong, hard minimal)
- [x] AI mistake injection (easy: every 10-15s, medium: 20-30s, hard: 60s) — creates overtaking windows
- [x] Hard mode: 55% over speed limit, aggressive random lane changes
- [ ] Load PilotNet weights from HuggingFace (sergiopaniego/OptimizedPilotNet, 200x66 input)
- [ ] Hook up Medium difficulty to use PilotNet steering + rule-based throttle
- [ ] Test if PilotNet + CARLA + WebRTC all fit on 24GB GPU

---

## Infrastructure & DevOps
- [ ] **Auto-provisioning e2e test**: Test the full Play Game → Vast.ai provision → callback → tunnel → connect flow
- [ ] **Instance cost tracking**: Log GPU cost per session, alert if spending > $X/day
- [ ] **Auto-shutdown**: Kill GPU instance after 10min of no WebSocket connections
- [ ] **Deploy script improvements**: deploy.sh should also start CARLA if not running
- [ ] **Health monitoring**: Endpoint that returns CARLA status, GPU temp, VRAM usage, active connections

---

## Viral / Social Features

Features designed to create sharing loops, competitive tension, and "I need to show someone this" moments. Ordered by estimated impact-to-effort ratio.

### Shareability (the Wordle lesson)
Wordle's genius was that the colored emoji grid was a *non-spoiler flex* -- you could show your result without revealing the answer. Every share was an implicit challenge. Shadow Driver needs its own "Wordle grid" -- a compact, visual, shareable race result.

- [ ] **:star: One-click race result card**: After a race, generate a canvas-rendered result card (PNG) showing: track name, lap time, gap to AI, a miniature racing line visualization, top speed, and difficulty. Add a "Share" button that uses the Web Share API (`navigator.share({ files: [pngFile] })`) on mobile or copies to clipboard on desktop. The card should be designed to look good as a tweet or Discord embed. Implementation: `canvas.toBlob()` -> `new File()` -> `navigator.share()`. Web Share API supports PNG files on Chrome/Edge/Safari mobile.
  - Ref: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

- [ ] **:star: Challenge URL with embedded ghost**: When you share a "Challenge a Friend" link, encode your ghost replay data in the URL (base64 compressed). The friend races against YOUR ghost, not the AI. URL format: `shadow-driver-v3.vercel.app/race?ghost=<base64>&track=town05&laps=3`. Ghost data is lightweight -- just position+yaw at 10Hz for ~60-120s = ~5-15KB compressed, fits in a URL.

- [ ] **Wordle-style text results**: Generate a copy-pasteable text block for Twitter/Discord:
  ```
  Shadow Driver v3 - Town05
  1:23.456 (beat AI by 2.3s)
  Top Speed: 187 km/h | Difficulty: Hard
  shadow-driver-v3.vercel.app/race?track=town05
  ```
  One "Copy" button. Plain text travels everywhere, no image hosting needed.

- [ ] **Auto-clip recording**: Use `canvas.captureStream(30)` + `MediaRecorder` to continuously record the last 15 seconds of gameplay into a ring buffer. When something exciting happens (overtake, close finish, big crash), auto-save the clip. Player can then share it. Implementation: record to WebM chunks, keep last N chunks, on trigger save all chunks to a Blob. Ref: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder

- [ ] **Photo mode**: Freeze the game (pause server tick), let player rotate/zoom the CARLA camera freely, apply CARLA post-processing (depth of field, exposure), capture a high-res screenshot. Racing games like Forza Horizon 5 and Gran Turismo 7 generate massive social media engagement from photo mode alone. Implementation: send `{ type: 'photo_mode', camera: { yaw, pitch, distance, fov } }` to server, receive a single high-res JPEG back.

### Async Competition (race against the world, not with)
The key insight from Trackmania: you don't need real-time multiplayer to create intense competition. Ghost racing (you vs a recording) creates the same competitive intensity with zero networking complexity.

- [ ] **:star: Daily track challenge**: One track per day, same for everyone (seeded by date). Global leaderboard for that day's track. Resets at midnight UTC. This is the single most effective retention mechanic in Trackmania -- players come back daily to compete. Implementation: server-side seed from `Date.now() / 86400000 | 0` picks map + weather + spawn point deterministically.

- [ ] **Ghost replay storage**: Store ghost data (position/yaw/speed at 10Hz) in Vercel KV or Cloudflare R2. Each ghost is ~10-30KB. Store the top 100 ghosts per track. Players can race against any ghost from the leaderboard. Data format: `{ frames: [{t, x, y, yaw, speed}], metadata: { player_name, lap_time, date, track } }`.

- [ ] **Leaderboard with replays**: Per-track leaderboard showing top 50 times. Each entry links to a ghost replay. Click any entry to race against that ghost. This creates a "can I beat rank #37?" motivation loop. Store in Vercel KV (free tier: 256MB, enough for ~10K ghosts).

- [ ] **Seasonal tournaments**: Monthly themed events (night race series, rain championship, reverse tracks). Aggregate scores across multiple tracks. Prizes: cosmetic badges on leaderboard profile.

### Social Presence (make it feel alive)
- [ ] **Live spectator count**: Show "X people racing right now" on the landing page. Even seeing "3 people racing" makes the game feel alive. Implementation: track active WebSocket connections in Vercel KV, poll every 30s.

- [ ] **Recent results feed**: Scrolling ticker on landing page showing recent race completions: "Player beat Hard AI by 0.3s on Town05 - 12 min ago". Creates social proof and competitive motivation.

- [ ] **Naming**: Let players set a display name (stored in localStorage). Used on leaderboards and challenge cards. No auth needed -- just a text input before first race.

### Retention Loops (one more race)
Lessons from Vampire Survivors (simple + addictive), Retro Bowl (session-based progression), and Trackmania (incremental improvement).

- [ ] **Personal best tracker**: Per-track best times stored in localStorage. Show improvement delta after each race: "1.2s faster than your PB!" or "0.3s off your best". Satisfying even without a global leaderboard.

- [ ] **Medal system**: Bronze/Silver/Gold/Platinum per track based on time thresholds. Thresholds set relative to AI times on each difficulty. Visible on track select screen. Collecting all golds on all tracks becomes a meta-goal.

- [ ] **Streak counter**: Track consecutive days played (localStorage). Display flame icon with streak count. Losing a streak is psychologically painful -- proven retention mechanic (Duolingo, Snapchat).

- [ ] **:star: Instant restart (R key)**: During a race, pressing R immediately respawns at the start line and restarts the timer. No menu, no confirmation, no loading. This is the #1 most important quality-of-life feature from Trackmania. The friction between "I messed up" and "I'm trying again" must be ZERO. Server implementation: `reset_race()` without full cleanup -- just teleport vehicles and reset timers.

- [ ] **Race Again button (post-race)**: One button, same track, same settings, instant restart. No returning to menus. Second most important retention feature after R-to-restart.

---

## Browser-Native Innovations

Features that are only possible (or dramatically better) because this runs in a browser. These are differentiators vs native racing games.

### Zero-Friction Access (the browser's killer feature)
The #1 lesson from every viral browser game (agar.io, slither.io, Wordle, GeoGuessr, Slow Roads): the gap between "seeing a link" and "playing the game" must be as close to zero as possible. No downloads, no accounts, no logins.

- [ ] **:star: Sub-3-second cold start for returning players**: Cache the React bundle aggressively (service worker). Pre-connect to the WebSocket URL. If the user has a recent `?ws=` URL in localStorage, auto-connect on page load. Target: URL click -> gameplay in <3 seconds.

- [ ] **Progressive loading during GPU wait**: While the GPU instance is provisioning (~60-120s), show: interactive track preview (client-side 3D minimap), controls tutorial, leaderboard for selected track, and a "warm up" mode where the player can practice steering with a local 2D car physics sim. The wait becomes part of the experience, not dead time.

- [ ] **Deep linking everything**: Every game state should be a URL. `?ws=X` for direct connect, `?track=town05&weather=rain&laps=3` for settings, `?ghost=base64` for challenge mode, `?replay=id` for watching replays. URLs are the browser's native sharing primitive.

### Gamepad API (controller support)
Racing games on keyboard feel terrible compared to analog sticks. The Gamepad API is mature (baseline since 2017) and trivial to add.

- [ ] **Gamepad support**: Poll `navigator.getGamepads()` in the rAF loop. Map left stick X to steering (analog!), right trigger to throttle (analog!), left trigger to brake (analog!). Face buttons for handbrake and respawn. This instantly makes the game feel 10x better for anyone with an Xbox/PS controller connected to their computer.
  - Implementation: ~50 lines of code. `gamepad.axes[0]` for steering, `gamepad.buttons[7].value` for RT (throttle), `gamepad.buttons[6].value` for LT (brake). Send analog values directly to server instead of binary keyboard on/off.
  - Ref: https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API

### Client-Side AI Inference (WebGPU / ONNX Runtime Web)
Run a small neural network IN THE BROWSER for local features that don't need the GPU server.

- [ ] **Client-side PilotNet for ghost cars**: Export PilotNet (~1MB ONNX model) and run it client-side via ONNX Runtime Web with WebGPU backend. Use it to drive ghost/preview cars on the track select screen. The model takes a 200x66 image and outputs a steering angle -- small enough for real-time browser inference.
  - Setup: `import * as ort from 'onnxruntime-web/webgpu'` -> `session = await ort.InferenceSession.create('pilotnet.onnx', { executionProviders: ['webgpu'] })`. WebGPU supported in Chrome 113+, Edge 113+, covering ~78% of browsers.
  - Ref: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html

- [ ] **Neural network visualization overlay**: While racing, show a real-time visualization of what the AI "sees" -- a small inset showing the PilotNet input image with attention heatmap (Grad-CAM). This is the "wow factor" for HackerNews: you can literally see the AI thinking as it drives. Implementation: run Grad-CAM on the server (cheap with PyTorch hooks), send the heatmap as a low-res (50x33) image alongside the main frame.
  - Inspiration: Radu Mariescu-Istodor's self-driving car neural network visualization (github.com/gniziemazity/Self-driving-car) -- shows the network graph and activations live as the car drives. Massively popular YouTube series with millions of views.

### Web Audio API (procedural audio that reacts to gameplay)
Already have engine sound + background music, but there's more untapped potential.

- [ ] **Adaptive music intensity from race events**: Current background music scales with speed. Add event-triggered intensification: bring in drums on overtake, add distortion layer when gap < 1s, drop all music to just bass drone on final lap last checkpoint (the "clutch moment" audio design from Mario Kart). Implementation: set gain nodes per-layer based on race events, not just speed.

- [ ] **Doppler effect on AI car**: When the AI car passes the player or vice versa, apply a frequency shift to the AI's engine sound. The Web Audio API's `AudioPannerNode` with `positionX/Y/Z` can do this natively -- just update the AI car's position in 3D audio space each frame.

- [ ] **Crowd/ambiance layer**: Procedural crowd noise that reacts to race events -- cheering on overtake, gasp on crash, roar on finish. Use filtered white noise shaped by gain envelopes triggered by race_state events. No audio files needed.

### Canvas/WebGL Post-Processing
Client-side effects that enhance the server-rendered JPEG stream.

- [ ] **WebGL shader post-processing**: Instead of drawing JPEG frames to a 2D canvas, draw them to a WebGL canvas with fragment shaders for: chromatic aberration (subtle at edges, stronger at speed), color grading (warm sunset tones, cool night tones matching CARLA weather), film grain (hides JPEG compression), and barrel distortion (subtle, simulates real lens). All GPU-composited, zero CPU cost. Libraries: `regl` (lightweight WebGL wrapper) or raw WebGL2 shaders.

- [ ] **WebGPU compute shaders for advanced effects**: Use WebGPU compute shaders for effects too expensive for fragment shaders: screen-space reflections on wet roads (compute on the client from the depth buffer), temporal anti-aliasing (blend consecutive JPEG frames), and motion vector estimation for true motion blur (compute pixel deltas between consecutive frames). Requires WebGPU (Chrome 113+).

### Screen Recording and Sharing
- [ ] **Built-in screen recorder**: `canvas.captureStream()` + `MediaRecorder` to record gameplay as WebM video. "Record" button in HUD, saves locally. On mobile, use Web Share API to share the video directly to Instagram/TikTok/Twitter.
  - Ref: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream

- [ ] **GIF export**: Record last 5 seconds as GIF (using `gif.js` library in a Web Worker for off-main-thread encoding). GIFs are the native format of social media -- they autoplay everywhere. A 5-second drift clip as a GIF is instant viral content.

### Other Browser APIs
- [ ] **Vibration API**: `navigator.vibrate()` on mobile for haptic feedback on collisions, tire screech, and gear shifts. Subtle pattern: 50ms buzz on collision, 20ms pulse on gear shift.

- [ ] **Fullscreen API**: `element.requestFullscreen()` for immersive racing. Auto-prompt on race start on desktop. Hide browser chrome for maximum screen real estate.

- [ ] **Wake Lock API**: `navigator.wakeLock.request('screen')` to prevent screen dimming during races on mobile/tablet. Essential for longer races.

- [ ] **Web Bluetooth (stretch)**: Connect BLE steering wheels/controllers. The Web Bluetooth API is experimental with limited browser support (Chrome only, not Firefox/Safari). Use as progressive enhancement, not primary input. Ref: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API

---

## AI as a Game Mechanic (not just opponent)

### "Teach Your AI" Mode
The most HackerNews-viral concept: let players train their own AI driver, then pit trained AIs against each other.

- [ ] **Imitation learning from player**: Record the player's inputs (steering, throttle, brake) alongside camera frames during every race. After N laps, offer to "train your AI clone" -- fine-tune PilotNet on the player's driving data. The AI clone then races for you in async challenges. Implementation: save input-frame pairs to a replay buffer on the server, fine-tune PilotNet with a few gradient steps (takes ~30s on the GPU). Export the fine-tuned weights as a ~1MB file linked to the player's name.

- [ ] **AI evolution visualization**: Show the neural network learning in real-time. Inspired by Keiwan's Evolution simulator (keiwan.itch.io/evolution) -- creatures learn to walk/run through genetic algorithms, and you watch them improve. For Shadow Driver: show a split screen where the AI drives the track, getting better each generation. Visualize the neural network graph with activation colors. This is mesmerizing to watch and deeply shareable.

- [ ] **AI vs AI tournament**: Players submit their trained AI clones. The system runs automated races between them (server-side, no player input). Results posted to a leaderboard. This creates a metagame: players optimize their driving to produce the best AI, not just the fastest lap time. Similar to GT Sophy (Gran Turismo's AI that achieved superhuman racing via reinforcement learning, published in Nature 2022) but democratized -- anyone can train a driver.

- [ ] **Neural network explainability HUD**: Real-time display showing: what the AI "sees" (attention heatmap on camera image), what the AI "thinks" (steering/throttle prediction bar), and confidence level (how certain the model is). Toggle with a hotkey. This makes the AI transparent and educational, not a black box.

### AI-Generated Content
- [ ] **AI race commentary**: Use an LLM (Claude API or local small model) to generate live race commentary based on telemetry events. "And the player takes the inside line through turn 3! The AI is closing the gap -- only 1.2 seconds behind now!" Displayed as subtitles or spoken via Web Speech API (`window.speechSynthesis`). This is both entertaining and highly shareable (imagine a clip with AI commentary).

- [ ] **AI-suggested racing line**: Before the race starts, show a visualization of the optimal racing line (computed by the AI from its learned behavior). Player can try to follow it. Post-race, overlay the player's actual line vs the AI's suggested line for comparison.

---

## Top 5 Ideas by Impact/Effort Ratio

These are marked with :star: above. Summary:

1. **Instant restart (R key)** -- Near-zero effort (server teleport + timer reset), eliminates the #1 friction point in the retry loop. Every fast-paced racing game needs this.

2. **One-click race result card** -- ~2 hours of work (canvas rendering + Web Share API). Creates a sharing primitive that works on every platform. The visual result card IS the viral vector.

3. **Challenge URL with embedded ghost** -- ~4 hours (ghost serialization + URL encoding + ghost renderer). Turns every race into a social challenge. The URL IS the game invite.

4. **Daily track challenge** -- ~3 hours (date-seeded track selection + simple KV leaderboard). Creates daily retention without any infrastructure cost. The leaderboard IS the competition.

5. **Sub-3-second cold start** -- ~2 hours (service worker + auto-reconnect). Eliminates the "do I want to wait for this to load?" decision. The speed IS the feature.

---

## AI-Powered Features (Deep Research, Feb 2026)

Comprehensive research into AI in games beyond self-driving, with concrete implementation plans for Shadow Driver v3. Each item includes who's done it, technical requirements, feasibility on our 24GB GPU, and impressiveness to first-time players.

### TOP 5 AI Features -- Build ASAP

#### :star: 1. AI Race Commentary (LLM + TTS) -- The Showstopper
- **What**: Real-time race announcer that calls out events: "He's closing the gap in turn 3!", "Massive collision!", "New fastest lap!", "The AI is pulling away on the straight!"
- **Who's done it**: No racing game has done this with generative AI. This would be a genuine first. Sports broadcasting AI is emerging (see NVIDIA ACE's suite for game character speech) but nobody has applied it to live race commentary.
- **How it works**:
  - Server-side: Feed race telemetry (speed, gap, collisions, overtakes, lap times) into an LLM with a system prompt defining an excitable motorsport commentator persona.
  - **LLM options**: Claude Haiku ($1/$5 per MTok, ~500ms latency, 0 VRAM) or local Qwen-2.5-3B via llama.cpp (~200ms latency, ~6GB VRAM -- tight but fits alongside CARLA's ~8-10GB).
  - **TTS options**: Kokoro-82M (open source, 35-100x realtime speed on GPU, ~300ms first-token latency via streaming, ~350MB VRAM, supports emotion markers like [laughter] and emphasis via CAPS). Alternative: Bark by Suno (transformer-based, ~12GB VRAM for full model -- too heavy; smaller variants available). Cloud: ElevenLabs API (~500ms latency, high quality, per-character pricing, WebSocket streaming support).
  - Event-driven, not continuous: commentary triggered by overtakes, collisions, gap changes, fastest laps. Max 1 line per 5 seconds.
  - Audio streamed to browser as PCM/opus chunks via WebSocket binary frames.
- **VRAM budget**: Kokoro-82M (~350MB) is trivial. Claude Haiku API uses 0 VRAM. Local 3B LLM (~6GB) is tight but possible on 24GB with CARLA.
- **Impressiveness**: 10/10. A first-time player hearing an AI announcer calling their race live would be jaw-dropping. Best demo feature by far.
- **References**: Kokoro-FastAPI (github.com/remsky/Kokoro-FastAPI), NVIDIA ACE (developer.nvidia.com/ace), Bark (github.com/suno-ai/bark)
- **Implementation plan**:
  - [ ] Define commentary event triggers in race_logic.py: overtake, collision, fastest_lap, close_gap (<1s), large_gap (>5s), final_lap, race_finish, high_speed_moment (>180km/h)
  - [ ] Create commentary prompt template: excited British F1-style commentator persona, 10-30 word responses, reference driver positions and track features
  - [ ] Integrate Claude Haiku API call from race_server.py (simplest path -- add `anthropic` pip package)
  - [ ] Integrate Kokoro-82M for TTS (pip install kokoro, load model once at server start)
  - [ ] Stream audio chunks to browser via WebSocket (binary frames with 1-byte type prefix: 0x01=JPEG, 0x02=audio)
  - [ ] Frontend: Web Audio API playback with AudioBufferSourceNode, queue chunks for gapless playback
  - [ ] Rate-limit: max 1 commentary line per 5 seconds, priority queue (overtakes > collisions > gap changes)
  - [ ] Fallback: if TTS too slow, send text-only commentary as toast notifications on HUD

#### :star: 2. AI Driving Coach (Post-Race Analysis) -- The Easy Win
- **What**: After each race, analyze player telemetry and generate specific coaching tips: "You lost 1.8s in Turn 3 -- you braked 15m too early" or "Your racing line was 3m wider than optimal through the chicane."
- **Who's done it**: iRacing has basic telemetry overlays. No game generates natural-language coaching from race data. AWS DeepRacer (now open source as of Dec 2025) shows training metrics but not coaching.
- **How it works**:
  - All telemetry data is ALREADY recorded (ghost car recording has per-frame position, speed, steer, throttle, brake at every checkpoint).
  - After race ends, compute sector split times (time between each checkpoint) for player vs AI.
  - Send telemetry summary to Claude Haiku API: "You are a professional racing coach. Here are the player's sector times vs the AI. Give 3 specific, actionable tips."
  - Display tips in RaceResults.tsx alongside the existing racing line visualization.
  - Highlight problem corners on the racing line viz with red sections.
- **Feasibility**: 9/10. Zero VRAM cost (API call). All data already exists. Just need a prompt template and one API call after race_finished. Claude Haiku processes full lap data in <1s.
- **Impressiveness**: 8/10. Creates a retention loop -- "I'll try that tip on my next lap." Makes players feel like they have a personal coach.
- **Implementation plan**:
  - [ ] Collect sector split times (time between each checkpoint) for player and AI -- data already in race_logic.py
  - [ ] Compute per-corner metrics: braking point (position where brake first applied), apex position (closest point to inside of corner), exit speed
  - [ ] Build analysis prompt: sector data + track layout + player vs AI comparison
  - [ ] Call Claude Haiku API from race_server.py after race_finished event
  - [ ] Return coaching tips (3-5 bullet points) in race_finished WebSocket message
  - [ ] Display tips in RaceResults.tsx below the racing line visualization
  - [ ] Color-code racing line sections: green (faster than AI), red (slower than AI), with time delta labels

#### :star: 3. Ghost Car AI Clone (Imitation Learning) -- The Unique Differentiator
- **What**: Train a small neural network on YOUR driving data, then race against a ghost car that drives exactly like you. "Can you beat yourself?"
- **Who's done it**:
  - **Forza Drivatar** (Microsoft Research): Records player behavior across millions of players, creates AI opponents that mimic individual driving styles. Uses neural networks trained on per-player telemetry.
  - **GT Sophy** (Sony AI, Nature 2022): Superhuman racing RL, trained in Gran Turismo Sport. Used deep RL with multi-agent league (similar to AlphaStar's approach). Key innovation: reward shaping for clean racing (not just speed).
  - **PilotNet** (NVIDIA): 5 conv + 4 FC layers, ~250K params, <10MB. Trained on steering angle from camera images. Pre-trained weights available at HuggingFace (sergiopaniego/OptimizedPilotNet, 200x66 input).
- **How it works**:
  - Record (downscaled_camera_frame, player_controls) pairs during each race. Already have frames from JPEG encoding + controls from WebSocket messages.
  - After N laps (~1000 frames), fine-tune PilotNet on the player's data using behavioral cloning (supervised learning: predict controls from frames).
  - Training: ~2-5 minutes on RTX 3090 for 50 epochs on 1000 samples. ~2GB VRAM for training.
  - On subsequent races, clone drives using the trained model: receives camera frame, outputs steering/throttle/brake.
  - Display as visible ghost car on minimap or as a second CARLA vehicle.
- **Challenge**: Keyboard input is binary (0 or 1 for each key), making imitation learning harder than analog controller data. Mitigation: use the ramped/smoothed control values (post-ramping) as training targets, not raw key states.
- **Impressiveness**: 9/10. "Race against an AI that drives like you" is an incredible hook for social sharing and retention.
- **Implementation plan**:
  - [ ] Record (200x66 downscaled frame, smoothed controls) pairs in race_server.py during gameplay
  - [ ] Store recordings per player session (in-memory ring buffer, cap at 5000 frames)
  - [ ] Build training pipeline: PilotNet architecture from sergiopaniego weights, MSE loss for steer + BCE for throttle/brake, Adam optimizer lr=1e-4
  - [ ] Add "Train My Clone" button on RaceResults screen
  - [ ] Train for 50 epochs on recorded data (~2-3 min on RTX 3090, ~2GB VRAM)
  - [ ] Run clone inference in race loop: feed camera frame -> model -> controls at 30Hz
  - [ ] Show clone car on minimap + spawn as translucent CARLA vehicle in 3D view

#### :star: 4. Optimal Racing Line Overlay -- The Educational Feature
- **What**: Show the mathematically optimal racing line as a glowing guide path, color-coded by target speed.
- **Who's done it**:
  - **TUMFTM global_racetrajectory_optimization** (github.com/TUMFTM/global_racetrajectory_optimization): Open source Python, uses CVXPY for convex optimization. Supports 4 objectives: shortest path, minimum curvature, minimum time, and minimum time with powertrain modeling. Takes track boundaries as input, outputs optimal waypoints.
  - **F1TENTH / RoboRacer**: Autonomous 1/10 scale racing community with extensive racing line optimization research.
  - iRacing, Assetto Corsa: Have community-created racing line overlays as training aids.
- **How it works**:
  - Extract track centerline and boundaries from CARLA's OpenDRIVE map data (XML format).
  - Run minimum-curvature optimization offline (TUMFTM optimizer, Python + CVXPY).
  - Store result as JSON: array of {x, y, target_speed} waypoints.
  - Server sends racing line data in race_config message at race start.
  - Frontend renders on Minimap.tsx as colored polyline: green = full throttle, yellow = lift off, red = braking zone.
  - Phase 2: project racing line into 3D camera view as AR-style overlay using CARLA's world-to-screen projection matrix.
- **Feasibility**: 9/10. TUMFTM optimizer is ready to use. Minimap rendering is trivial (add polyline to existing component). Pre-compute once per track.
- **Impressiveness**: 7/10. Educational and helpful for new players. The "learning the line" experience is core to real racing.
- **Implementation plan**:
  - [ ] Extract track centerline and boundaries from CARLA OpenDRIVE map data (carla.Map.get_topology() + get_waypoints())
  - [ ] Run TUMFTM minimum-curvature optimization (pip install cvxpy, ~10 seconds per track)
  - [ ] Store optimal line as JSON: server/data/racing_lines/{map_name}.json
  - [ ] Send racing line data in race_config message at race start
  - [ ] Render on Minimap.tsx as colored polyline (green/yellow/red by target speed)
  - [ ] Add "Show Racing Line" toggle in RaceSetup.tsx (on by default for Easy, off for Hard)
  - [ ] Phase 2: 3D projection into camera view using CARLA sensor calibration matrix

#### :star: 5. AI Trash-Talking Opponent -- Zero-Cost Fun
- **What**: AI opponent sends chat messages during races: taunts when winning, excuses when losing, congratulations on good moves. Personality-driven -- not generic.
- **Who's done it**: No racing game has an AI opponent with generated personality chat. NVIDIA ACE provides personality-driven NPC systems with emotion detection, but for conversation NPCs, not racing rivals.
- **How it works (zero runtime AI cost)**:
  - Pre-generate a bank of 50-100 lines per event type offline using Claude. Each line fits the AI's racing personality (cocky, competitive, grudgingly respectful).
  - At runtime, pick a random line on event trigger: overtake, collision, gap change, final lap.
  - Display as a speech bubble toast on the HUD, near the AI position indicator.
  - Phase 2: use Kokoro TTS to voice the trash talk (adds ~300ms but sounds incredible).
- **Feasibility**: 10/10. Pre-generate lines offline (5 minutes of Claude prompting), store as JSON, zero runtime cost.
- **Impressiveness**: 7/10. Gives the AI personality and makes racing feel social even in single-player. Players will screenshot and share funny taunts.
- **Implementation plan**:
  - [ ] Define event types: ai_overtakes, player_overtakes, player_crashes, ai_crashes, close_gap, big_lead, final_lap, race_start, race_finish_win, race_finish_lose
  - [ ] Generate 10-15 lines per event type using Claude with racing rival persona
  - [ ] Store as server/data/trash_talk.json
  - [ ] Pick random line on event trigger in race_logic.py, send as {type: 'ai_chat', text: '...'} message
  - [ ] Frontend: render as animated speech bubble toast, auto-dismiss after 3 seconds
  - [ ] Phase 2: voice the trash talk using Kokoro TTS (run on server, stream audio chunk)

---

### Additional AI Features by Category

#### AI Opponents & Racing Intelligence

**Reinforcement Learning Racing Agent (GT Sophy-Inspired)**
- **Background**: GT Sophy (Sony AI + Polyphony Digital, Nature 2022) achieved superhuman Gran Turismo racing using deep RL with a multi-agent league system. AlphaStar (DeepMind) used the same league concept for StarCraft II -- training diverse agents that counter each other produces more robust strategies than training against one opponent. OpenAI Five demonstrated PPO at massive scale (128K CPUs, 256 GPUs) for Dota 2. Learn-to-Race (ICCV 2021) trained Soft Actor-Critic agents that complete laps using only visual features. DreamerV3 (Danijar Hafner) learns from pixels via world models -- first to collect diamonds in Minecraft without human data. AWS DeepRacer (now open source Dec 2025) uses RL for 1/18 scale racing.
- **For Shadow Driver**: Train PPO agent (Stable Baselines 3) on one CARLA track. Observation: (speed, heading, centerline_distance, boundary_distances, curvature, checkpoint_bearing). Action: continuous (steer, throttle, brake). Reward: +track_progress, -centerline_deviation, -collision, +speed_bonus.
- **VRAM**: Training ~4-6GB (small MLP policy), inference <500MB. Fits alongside CARLA.
- **Feasibility**: 3/10. Needs days of GPU training time. But a basic "stays on track" agent is achievable in hours.
- [ ] Define observation/action spaces for CARLA racing
- [ ] Implement Gym wrapper around CARLA (observation from world state, not camera -- faster training)
- [ ] Train with PPO (Stable Baselines 3) in headless CARLA
- [ ] Target: consistent lap completion on one track after ~100K episodes
- [ ] Deploy as "Extreme" difficulty opponent

**Adaptive AI That Learns Mid-Race**
- **What**: AI adjusts behavior based on player skill during the race, not just preset difficulty. Different from rubber-banding (which adjusts speed) -- this changes driving quality (braking precision, cornering lines, mistake frequency).
- Track player metrics over first 1-2 laps: average speed, cornering efficiency, collision rate.
- Compute skill score, map to AI parameters. Keep gap competitive (1-3 seconds).
- **Feasibility**: 8/10. No ML needed -- just heuristics on existing telemetry. The data is already there.
- [ ] Compute rolling skill metrics from existing telemetry
- [ ] Map skill score to autopilot speed factor + mistake frequency + cornering adherence
- [ ] Adjust every 30 seconds, smooth transitions
- [ ] Never let adaptation feel punitive

**AI Personality / Emotion System**
- **What**: AI has emotional states that affect driving and are visible to the player.
- States: CONFIDENT (leading comfortably, clean driving), AGGRESSIVE (just overtaken, pushing hard, risky), NERVOUS (close racing, more braking, occasional mistakes), DESPERATE (far behind on last lap, all-out speed, high crash risk).
- NVIDIA ACE provides Audio2Emotion for NPC emotional modeling, but nobody has applied this to racing AI.
- **Feasibility**: 7/10. Parameterize existing autopilot with emotional state modifiers. Show emotion in HUD (icon or text). Feed emotion state to the commentary LLM for richer narration.
- [ ] Define emotion state machine with event-triggered transitions
- [ ] Map emotional states to autopilot parameter overrides
- [ ] Add emotion indicator to race_state telemetry + HUD display
- [ ] Feed AI emotion to commentary LLM for context-aware narration

#### AI-Generated Content

**Dynamic Weather Reacting to Race State**
- CARLA's weather API (carla.WeatherParameters) supports real-time changes: cloudiness, precipitation, sun_altitude, fog_density, wetness, wind_intensity. Changes are instant API calls.
- Map race state to weather moods: CALM (clear, big lead), TENSE (overcast + wind, gap closing), DRAMATIC (rain + fog, final lap), EPIC (storm + sunset, close finish).
- Smooth parameter interpolation over 10-30 seconds prevents jarring transitions.
- **Feasibility**: 8/10. Trivial to implement -- just add weather transitions to race_logic.py.
- [ ] Define weather mood presets with CARLA parameter values
- [ ] Map race events to weather transitions (close gap -> TENSE, final lap -> DRAMATIC)
- [ ] Interpolate weather parameters smoothly (lerp over 10-30 seconds)
- [ ] Add weather state to telemetry for frontend rain/fog overlay effects

**AI-Generated Music Stems (Reactive Soundtrack)**
- Pre-generate stems using Meta's MusicGen (text-to-music with melodic conditioning, MIT code / CC-BY-NC weights) or Stability AI's Stable Audio (text-to-audio, audio-to-audio, inpainting, leading inference speed, enterprise licensing required).
- Generate 4 mood stem sets offline: cruise, chase, final_lap, victory. Each set has 4 layers: drums, bass, pad, lead (~30s WAV loops).
- At runtime, crossfade between stem layers based on race state using Web Audio API. This is what AAA games actually do (dynamic stems, not real-time generation).
- Real-time AI music generation is NOT feasible at game latency.
- **Feasibility**: 6/10. Pre-generating stems is free. Runtime crossfading is straightforward with existing Web Audio infrastructure.
- [ ] Generate stem sets using MusicGen or Stable Audio Open (offline)
- [ ] Load stems as AudioBuffers at race start
- [ ] Crossfade layers based on race intensity (gap, speed, lap number)
- [ ] Sync transitions to bar boundaries for musical coherence
- [ ] Replace current oscillator-based background music

#### AI for Streaming & Visual Quality

**Client-Side Frame Upscaling (Browser Neural Super Resolution)**
- Stream 640x360 from server (50% smaller = 50% less bandwidth = lower latency), upscale to 1280x720 in browser via neural network on client's GPU.
- NVIDIA DLSS uses transformer-based super resolution with temporal data (motion vectors + history frames) for up to 8x frame rate boost. RIFE does frame interpolation at 30+fps for 720p on a 2080Ti.
- **Browser stack**: ONNX Runtime Web (supports WebGPU, all ONNX operators via WASM, GPU subset via WebGPU). Need a tiny super-res model: FSRCNN (~12K params) or ESPCN (sub-pixel convolution). Real-ESRGAN is too heavy.
- **Feasibility**: 3/10. Groundbreaking if it works. Challenge is finding a model small enough for 30fps browser inference. Need to benchmark.
- [ ] Research and benchmark smallest viable super-resolution models (FSRCNN, ESPCN)
- [ ] Export to ONNX, quantize to int8
- [ ] Benchmark ONNX Runtime Web + WebGPU at 640x360->1280x720 (target: <15ms)
- [ ] If viable: add upscaling pipeline in VideoCanvas.tsx

**Client-Side Frame Interpolation (Pseudo-60fps)**
- Between 30fps server frames, generate intermediate frame for perceived 60fps.
- Three approaches (easy to hard): (1) alpha-blend crossfade between consecutive frames, (2) velocity-based pixel shifting using telemetry speed+steering to compute 2D motion vector, (3) small optical flow network in ONNX Runtime Web.
- DLSS Frame Generation creates up to 3 extra frames per rendered frame; Oasis (Decart + Etched) generates entire game worlds at 20fps via Diffusion Transformer -- but both require dedicated GPU hardware.
- **Feasibility**: 4/10 for neural approach, 6/10 for motion-compensated blending.
- [ ] Implement simple alpha-blend crossfade at 60fps in VideoCanvas.tsx
- [ ] Implement velocity-based pixel shifting using telemetry motion vector
- [ ] Benchmark and evaluate visual quality vs native 30fps

**Neural Style Transfer (Visual Themes)**
- Apply artistic styles in real-time: comic book, neon wireframe, watercolor, pixel art.
- ONNX model zoo has fast_neural_style models (~6MB). Load in browser via ONNX Runtime Web + WebGPU.
- Offer style selection in RaceSetup: Normal, Comic, Neon, Retro.
- Alternative: apply server-side on GPU via TensorRT (NVIDIA, up to 36x faster than CPU inference, supports FP8/INT8 quantization). Would add ~10ms latency but guarantee performance.
- **Feasibility**: 5/10. Depends on WebGPU inference speed at 720p.
- [ ] Download fast_neural_style ONNX models
- [ ] Benchmark in browser with ONNX Runtime Web + WebGPU
- [ ] If viable (<20ms per frame), integrate as toggle

#### AI Replay & Social

**AI Replay Highlights**
- Automatically identify highlight moments from telemetry: overtakes, close gaps (<0.5s), high-speed sections, collisions, final corner.
- Ring-buffer last 5 seconds of frames in server memory (~7.5MB per highlight at 30fps * 50KB).
- After race, send highlight clips to frontend, play sequentially with commentary overlay.
- **Feasibility**: 5/10. Memory pressure from frame buffering. Medium complexity.
- [ ] Define highlight criteria from telemetry patterns
- [ ] Implement ring-buffer for recent frames in server memory
- [ ] Snapshot buffer on highlight event
- [ ] Frontend playback with transition effects

#### Wild / Experimental Ideas

**Live RL Training Visualization** -- "Watch an AI learn to race in 5 minutes"
- Show the RL agent going from crashing into walls to completing laps. DreamerV3 learns from pixels across 150+ tasks with a single configuration. GameNGen generates DOOM via diffusion at 20fps on TPU. Oasis generates interactive Minecraft at 20fps using ViT spatial autoencoder + Diffusion Transformer.
- Could pre-record training progression and play back as time-lapse, or use world-model approach (DreamerV3) for faster convergence.
- **Impressiveness**: 10/10. Watching AI learn is inherently fascinating and viral.
- **Feasibility**: 2/10. Needs extensive engineering.

**Multiplayer with Secret AI Players** -- Turing Test Racing
- Some opponents are AI bots trained on real player data (Drivatar-style). Players can't tell who's human.
- Requires multiplayer infrastructure + convincing AI behavior.
- **Feasibility**: 3/10. Multiplayer first, then AI integration.

**AI Track Generator** -- "Describe your dream track"
- LLM generates checkpoint sequences on existing CARLA maps from natural language.
- Full custom maps would need OpenDRIVE XML generation -- CARLA map format is complex.
- More practical: generate different "tracks" (checkpoint routes) on the same CARLA map.
- **Feasibility**: 4/10 for checkpoint routes, 2/10 for full map generation.

---

### Technical Reference: AI Infrastructure

#### VRAM Budget (24GB RTX 3090)
| Component | VRAM Usage | Notes |
|-----------|-----------|-------|
| CARLA 0.9.15 (headless, 1 camera) | ~8-10GB | Base requirement |
| PilotNet inference (200x66 input) | ~50MB | Tiny model |
| Kokoro-82M TTS | ~350MB | Open source, 35-100x realtime |
| PPO training (small MLP policy) | ~2-4GB | Stable Baselines 3 |
| Qwen-2.5-3B (local LLM, llama.cpp) | ~6GB | For frequent commentary |
| SDXL Turbo (image generation) | ~10GB | Won't fit alongside CARLA |
| Bark TTS (full model) | ~12GB | Won't fit; use smaller variant |
| **Comfortable total** | **~12-14GB** | CARLA + PilotNet + Kokoro + Claude API |

#### On-Device vs Cloud AI Inference Tradeoffs
| Approach | Latency | Cost | VRAM | Best For |
|----------|---------|------|------|----------|
| Claude Haiku API | ~500ms | $1/$5 MTok | 0 | Commentary text, coaching, analysis |
| Local 3B LLM (llama.cpp) | ~200ms | Free | ~6GB | Frequent short responses |
| Kokoro-82M TTS (server) | ~300ms 1st token | Free | ~350MB | Voice commentary, trash talk |
| ElevenLabs API (cloud) | ~500ms | Per-char | 0 | Highest quality voice |
| ONNX Runtime Web (browser) | 5-20ms/frame | Free | Client GPU | Super-res, style transfer |
| TensorRT (server) | 1-5ms/frame | Free | ~1-2GB | Fast model inference |
| Transformers.js (browser) | Varies | Free | Client GPU | Text models, CLIP, Whisper |
| Web-LLM (browser WebGPU) | ~200ms/tok | Free | Client GPU | Full LLM client-side |

#### Browser AI Stack Reference
- **ONNX Runtime Web**: Runs ONNX models via WebGPU/WASM. All operators via WASM, GPU subset via WebGPU. Best for vision models.
- **Transformers.js** (HuggingFace, 15K+ stars): ONNX backend, supports BERT/CLIP/Whisper and many more. Quantization: fp16, q8, q4. npm install @huggingface/transformers.
- **Web-LLM** (MLC-AI): Full LLMs in browser via WebGPU. Supports Llama/Phi/Gemma/Mistral/Qwen. OpenAI-compatible API. Could run commentary entirely client-side.
- **WebGPU**: Chrome 113+, Edge 113+, Firefox (behind flag), Safari (partial). ~78% browser coverage. Enables near-native GPU compute.

#### Priority Matrix (All AI Features)
| Feature | Impact | Feasibility | Build When |
|---------|--------|-------------|------------|
| AI Race Commentary (LLM+TTS) | 10/10 | 6/10 | NOW -- top priority |
| AI Driving Coach (post-race) | 8/10 | 9/10 | NOW -- easiest win |
| AI Clone Ghost Car | 9/10 | 5/10 | NOW -- unique differentiator |
| Optimal Racing Line | 7/10 | 9/10 | NOW -- educational, easy |
| AI Trash-Talk Messages | 7/10 | 10/10 | NOW -- zero cost |
| Adaptive AI Difficulty | 6/10 | 8/10 | Soon |
| AI Emotion System | 6/10 | 7/10 | Soon |
| Dynamic Weather | 5/10 | 8/10 | Soon |
| AI-Generated Music Stems | 6/10 | 6/10 | Later |
| Client-Side Super Resolution | 9/10 | 3/10 | Research |
| Frame Interpolation | 7/10 | 4/10 | Research |
| Neural Style Transfer | 5/10 | 5/10 | Nice-to-have |
| RL Racing Agent (PPO) | 8/10 | 3/10 | Long-term |
| Live Training Viz | 9/10 | 2/10 | Dream |
| AI Track Generator | 6/10 | 2/10 | Dream |
