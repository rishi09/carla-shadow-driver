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
- [x] **Camera motion extrapolation**: `useFrameExtrapolation.ts` applies subtle CSS translateX/Y between server frames based on steer and speed. Clamps to ±5px, max 50ms extrapolation, smooth 30ms reset on new frame arrival.
- [x] **Input echo in HUD**: Steering/throttle/brake bars already update instantly from local input — consider adding a subtle visual indicator (steering wheel icon, wheel turn animation) that responds instantly to input.

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
- [x] **Better camera settings**: Cinematic camera: FOV 90, motion_blur_intensity 0.3, histogram exposure, shutter_speed 60, ISO 100. Applied on camera attach + mode switch.
- [x] **Time of day**: Dynamic sun path transitions during race via WeatherTransitionManager. Sun moves from dawn to sunset over the course of a race.
- [ ] **Rain/wet roads**: CARLA has wet road reflections when precipitation > 0. Looks dramatically better than dry roads. (Partial: storm event triggers at 70% race progress for 3+ lap races)

### Frontend visual polish
- [x] **Motion blur shader**: CSS `filter: blur()` on video canvas, driven by speed (0-1.5px). Hides JPEG artifacts at high speed.
- [x] **Speed lines**: Animated radial lines overlaid on canvas at high speed (anime/racing game style) via SpeedLines.tsx.
- [x] **Better HUD design**: Redesign speedometer as an arc/gauge. Add tachometer. Use racing game UI conventions.
- [x] **Particle effects**: Canvas-overlay spark particles on collisions, tire smoke on handbrake, rain drops on weather via ParticleOverlay.tsx.
- [x] **Speed vignette enhanced**: Red tint at 200+ km/h, collision pulse (red edge flash), warp speed streaks at 180+ km/h.
- [x] **Gear shift effect**: Brief white flash overlay on gear change, decays over ~150ms.
- [x] **Rear-view mirror**: Small inset showing rear camera (CARLA supports multiple cameras).

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
- [x] Camera shake on acceleration/hard braking -- throttle/brake onset shake + sudden deceleration jolt (collision shake already exists)
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
- [x] Personal best times with medals (Bronze/Silver/Gold per track) -- useLeaderboard.ts + LeaderboardPanel.tsx on RaceSetup + usePersonalBests.ts
- [x] Simple leaderboard (per track, stored in localStorage) -- LeaderboardPanel.tsx shows records per track/lap combo

### Browser Advantage
- [x] Minimize time from URL click to gameplay (target: <5 seconds for returning players)
- [x] Show something exciting during GPU provisioning wait (replays, leaderboards, tips)
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
- [x] **Auto-shutdown**: `AutoShutdownManager` in race_server.py — 10-minute idle timer, logs countdown every minute, self-destroys via Vast.ai API. VASTAI_API_KEY passed from start.ts to container env.
- [x] **Deploy script improvements**: deploy.sh should also start CARLA if not running
- [x] **Health monitoring**: Endpoint that returns CARLA status, GPU temp, VRAM usage, active connections

---

## Viral / Social Features

Features designed to create sharing loops, competitive tension, and "I need to show someone this" moments. Ordered by estimated impact-to-effort ratio.

### Shareability (the Wordle lesson)
Wordle's genius was that the colored emoji grid was a *non-spoiler flex* -- you could show your result without revealing the answer. Every share was an implicit challenge. Shadow Driver needs its own "Wordle grid" -- a compact, visual, shareable race result.

- [x] **:star: One-click race result card**: After a race, generate a canvas-rendered result card (PNG) showing: track name, lap time, gap to AI, a miniature racing line visualization, top speed, and difficulty. Add a "Share" button that uses the Web Share API (`navigator.share({ files: [pngFile] })`) on mobile or copies to clipboard on desktop. The card should be designed to look good as a tweet or Discord embed. Implementation: `canvas.toBlob()` -> `new File()` -> `navigator.share()`. Web Share API supports PNG files on Chrome/Edge/Safari mobile.
  - Ref: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

- [ ] **:star: Challenge URL with embedded ghost**: When you share a "Challenge a Friend" link, encode your ghost replay data in the URL (base64 compressed). The friend races against YOUR ghost, not the AI. URL format: `shadow-driver-v3.vercel.app/race?ghost=<base64>&track=town05&laps=3`. Ghost data is lightweight -- just position+yaw at 10Hz for ~60-120s = ~5-15KB compressed, fits in a URL.

- [x] **Wordle-style text results**: Generate a copy-pasteable text block for Twitter/Discord:
  ```
  Shadow Driver v3 - Town05
  1:23.456 (beat AI by 2.3s)
  Top Speed: 187 km/h | Difficulty: Hard
  shadow-driver-v3.vercel.app/race?track=town05
  ```
  One "Copy" button. Plain text travels everywhere, no image hosting needed.

- [x] **Auto-clip recording**: Use `canvas.captureStream(30)` + `MediaRecorder` to continuously record the last 15 seconds of gameplay into a ring buffer. When something exciting happens (overtake, close finish, big crash), auto-save the clip. Player can then share it. Implementation: record to WebM chunks, keep last N chunks, on trigger save all chunks to a Blob. Ref: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder

- [x] **Photo mode**: Freeze the game (pause server tick), let player rotate/zoom the CARLA camera freely, apply CARLA post-processing (depth of field, exposure), capture a high-res screenshot. Racing games like Forza Horizon 5 and Gran Turismo 7 generate massive social media engagement from photo mode alone. Implementation: send `{ type: 'photo_mode', camera: { yaw, pitch, distance, fov } }` to server, receive a single high-res JPEG back.

### Async Competition (race against the world, not with)
The key insight from Trackmania: you don't need real-time multiplayer to create intense competition. Ghost racing (you vs a recording) creates the same competitive intensity with zero networking complexity.

- [x] **:star: Daily track challenge**: One track per day, same for everyone (seeded by date). Global leaderboard for that day's track. Resets at midnight UTC. This is the single most effective retention mechanic in Trackmania -- players come back daily to compete. Implementation: server-side seed from `Date.now() / 86400000 | 0` picks map + weather + spawn point deterministically.

- [ ] **Ghost replay storage**: Store ghost data (position/yaw/speed at 10Hz) in Vercel KV or Cloudflare R2. Each ghost is ~10-30KB. Store the top 100 ghosts per track. Players can race against any ghost from the leaderboard. Data format: `{ frames: [{t, x, y, yaw, speed}], metadata: { player_name, lap_time, date, track } }`.

- [ ] **Leaderboard with replays**: Per-track leaderboard showing top 50 times. Each entry links to a ghost replay. Click any entry to race against that ghost. This creates a "can I beat rank #37?" motivation loop. Store in Vercel KV (free tier: 256MB, enough for ~10K ghosts).

- [ ] **Seasonal tournaments**: Monthly themed events (night race series, rain championship, reverse tracks). Aggregate scores across multiple tracks. Prizes: cosmetic badges on leaderboard profile.

### Social Presence (make it feel alive)
- [ ] **Live spectator count**: Show "X people racing right now" on the landing page. Even seeing "3 people racing" makes the game feel alive. Implementation: track active WebSocket connections in Vercel KV, poll every 30s.

- [ ] **Recent results feed**: Scrolling ticker on landing page showing recent race completions: "Player beat Hard AI by 0.3s on Town05 - 12 min ago". Creates social proof and competitive motivation.

- [x] **Naming**: Let players set a display name (stored in localStorage). Used on leaderboards and challenge cards. No auth needed -- just a text input before first race.

### Retention Loops (one more race)
Lessons from Vampire Survivors (simple + addictive), Retro Bowl (session-based progression), and Trackmania (incremental improvement).

- [x] **Personal best tracker**: Per-track best times stored in localStorage. Show improvement delta after each race: "1.2s faster than your PB!" or "0.3s off your best". Satisfying even without a global leaderboard.

- [x] **Medal system**: Bronze/Silver/Gold/Platinum per track based on time thresholds. Thresholds set relative to AI times on each difficulty. Visible on track select screen. Collecting all golds on all tracks becomes a meta-goal.

- [x] **Streak counter**: Track consecutive days played (localStorage). Display flame icon with streak count. Losing a streak is psychologically painful -- proven retention mechanic (Duolingo, Snapchat).

- [x] **:star: Instant restart (R key)**: During a race, pressing R immediately respawns at the start line and restarts the timer. No menu, no confirmation, no loading. This is the #1 most important quality-of-life feature from Trackmania. The friction between "I messed up" and "I'm trying again" must be ZERO. Server implementation: `reset_race()` without full cleanup -- just teleport vehicles and reset timers.

- [x] **Race Again button (post-race)**: One button, same track, same settings, instant restart. No returning to menus. Second most important retention feature after R-to-restart.

---

## Browser-Native Innovations

Features that are only possible (or dramatically better) because this runs in a browser. These are differentiators vs native racing games.

### Zero-Friction Access (the browser's killer feature)
The #1 lesson from every viral browser game (agar.io, slither.io, Wordle, GeoGuessr, Slow Roads): the gap between "seeing a link" and "playing the game" must be as close to zero as possible. No downloads, no accounts, no logins.

- [x] **:star: Sub-3-second cold start for returning players**: Cache the React bundle aggressively (service worker). Pre-connect to the WebSocket URL. If the user has a recent `?ws=` URL in localStorage, auto-connect on page load. Target: URL click -> gameplay in <3 seconds.

- [ ] **Progressive loading during GPU wait**: While the GPU instance is provisioning (~60-120s), show: interactive track preview (client-side 3D minimap), controls tutorial, leaderboard for selected track, and a "warm up" mode where the player can practice steering with a local 2D car physics sim. The wait becomes part of the experience, not dead time.

- [x] **Deep linking everything**: Every game state should be a URL. `?ws=X` for direct connect, `?track=town05&weather=rain&laps=3` for settings pre-fill. Share button generates link with track/laps/weather/model/car/timeOfDay params. RaceSetup auto-fills from URL, auto-expands advanced options when URL includes model/car/timeOfDay.

### Gamepad API (controller support)
Racing games on keyboard feel terrible compared to analog sticks. The Gamepad API is mature (baseline since 2017) and trivial to add.

- [x] **Gamepad support**: Poll `navigator.getGamepads()` in the rAF loop. Map left stick X to steering (analog!), right trigger to throttle (analog!), left trigger to brake (analog!). Face buttons for handbrake and respawn. This instantly makes the game feel 10x better for anyone with an Xbox/PS controller connected to their computer.
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

- [x] **Adaptive music intensity from race events**: Current background music scales with speed. Add event-triggered intensification: bring in drums on overtake, add distortion layer when gap < 1s, drop all music to just bass drone on final lap last checkpoint (the "clutch moment" audio design from Mario Kart). Implementation: set gain nodes per-layer based on race events, not just speed.

- [ ] **Doppler effect on AI car**: When the AI car passes the player or vice versa, apply a frequency shift to the AI's engine sound. The Web Audio API's `AudioPannerNode` with `positionX/Y/Z` can do this natively -- just update the AI car's position in 3D audio space each frame.

- [x] **Crowd/ambiance layer**: Procedural crowd noise that reacts to race events -- cheering on overtake, gasp on crash, roar on finish. Use filtered white noise shaped by gain envelopes triggered by race_state events. No audio files needed.

### Canvas/WebGL Post-Processing
Client-side effects that enhance the server-rendered JPEG stream.

- [x] **WebGL shader post-processing**: Instead of drawing JPEG frames to a 2D canvas, draw them to a WebGL canvas with fragment shaders for: chromatic aberration (subtle at edges, stronger at speed), color grading (warm sunset tones, cool night tones matching CARLA weather), film grain (hides JPEG compression), and barrel distortion (subtle, simulates real lens). All GPU-composited, zero CPU cost. Libraries: `regl` (lightweight WebGL wrapper) or raw WebGL2 shaders.

- [ ] **WebGPU compute shaders for advanced effects**: Use WebGPU compute shaders for effects too expensive for fragment shaders: screen-space reflections on wet roads (compute on the client from the depth buffer), temporal anti-aliasing (blend consecutive JPEG frames), and motion vector estimation for true motion blur (compute pixel deltas between consecutive frames). Requires WebGPU (Chrome 113+).

### Screen Recording and Sharing
- [x] **Built-in screen recorder**: `canvas.captureStream()` + `MediaRecorder` to record gameplay as WebM video. "Record" button in HUD, saves locally. On mobile, use Web Share API to share the video directly to Instagram/TikTok/Twitter.
  - Ref: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream

- [ ] **GIF export**: Record last 5 seconds as GIF (using `gif.js` library in a Web Worker for off-main-thread encoding). GIFs are the native format of social media -- they autoplay everywhere. A 5-second drift clip as a GIF is instant viral content.

### Other Browser APIs
- [x] **Vibration API**: `navigator.vibrate()` on mobile for haptic feedback on collisions, tire screech, and gear shifts. Subtle pattern: 50ms buzz on collision, 20ms pulse on gear shift.

- [x] **Fullscreen API**: `element.requestFullscreen()` for immersive racing. Auto-prompt on race start on desktop. Hide browser chrome for maximum screen real estate.

- [x] **Wake Lock API**: `navigator.wakeLock.request('screen')` to prevent screen dimming during races on mobile/tablet. Essential for longer races.

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

---

## Latest AI Gaming Innovations (Feb 2026 Research)

Deep research into what is hot right now in AI + games, with concrete ideas for Shadow Driver v3.

### What's Hot Right Now

#### 1. Neural Game Engines / World Models -- The Biggest Paradigm Shift

The idea that AI can replace a traditional game engine entirely has exploded:

- **GameNGen (Google, Aug 2024)**: First neural game engine. Runs DOOM at 20fps on a single TPU using a fine-tuned Stable Diffusion 1.4 model. Human raters cannot distinguish real DOOM from GameNGen output. The key insight: an RL agent plays the game to generate training data, then a diffusion model learns to predict the next frame given previous frames + player actions. Noise augmentation on context frames prevents visual drift during extended play.
  - Ref: https://gamengen.github.io/

- **Oasis (Decart + Etched, Oct 2024)**: Interactive Minecraft-like world generated entirely by a neural network at 20fps. Uses a ViT-based spatial autoencoder + DiT (Diffusion Transformer) backbone. Takes keyboard input and generates frames sequentially conditioned on player actions. 500M parameter version released publicly. Limitations: fuzzy distant visuals, limited long-context memory, temporal inconsistency.
  - Ref: https://oasis-model.github.io/

- **Genie 2 (DeepMind, Dec 2024)**: Foundation world model that generates playable 3D environments from a single image. Models physics (gravity, water, smoke), maintains coherent worlds for up to 60 seconds, animates NPCs, handles counterfactual scenarios. Autoregressive latent diffusion model with transformer-based dynamics. Still in research -- not real-time without distillation.
  - Ref: https://deepmind.google/discover/blog/genie-2-a-large-scale-foundation-world-model/

- **NVIDIA Cosmos (Jan 2025)**: Open-source world foundation models for physical AI. Three models: Cosmos Predict (generates 30s video from prompts), Cosmos Transfer (style transfer from sim to photoreal), Cosmos Reason (multimodal reasoning about physical environments). Targets autonomous vehicles and robotics but the Transfer model is directly relevant to game visual enhancement.
  - Ref: https://www.nvidia.com/en-us/ai/cosmos/

- **World Labs / Marble (Fei-Fei Li, Jan 2026)**: Generates spatially consistent, explorable 3D worlds from text/image/video. Public API launched Jan 2026. Can create, edit, and combine 3D spaces. Not game-focused but the tech is jaw-dropping.
  - Ref: https://www.worldlabs.ai/

**What this means for us**: The world-model paradigm is the biggest story in AI gaming. Shadow Driver uniquely sits at the intersection -- we ARE running a real simulator (CARLA) and streaming it. The "neural game engine" angle is our narrative hook for HackerNews.

#### 2. AI NPCs with Personality -- Shipping in Real Games

- **NVIDIA ACE (Avatar Cloud Engine)**: Suite of AI technologies for game characters. Speech (Riva ASR/TTS), Intelligence (Nemotron, Qwen3, Mistral, Llama models), Animation (Audio2Face-3D, Audio2Emotion). Key: the NVIGI SDK runs AI models in-process via CUDA. Games SHIPPING with ACE:
  - **Total War: PHARAOH** -- AI strategic advisor powered by on-device LLM
  - **PUBG** (KRAFTON) -- "Co-Player Characters" with natural language communication
  - **inZOI** (KRAFTON) -- Smart Zois with planning/reflection, on-device sLM
  - **MIR5** (Wemade) -- AI-powered adaptive bosses
  - **Dead Meat** -- Interactive murder mystery with freeform NPC questioning
  - Ref: https://developer.nvidia.com/ace

- **Convai**: Platform for embodied AI characters with multimodal perception. Integrates with Unity, Unreal, PlayCanvas. Characters perceive environments, respond with dialogue + gestures, maintain narrative coherence. 65+ languages. ISO 27001 compliant for enterprise.
  - Ref: https://convai.com/

- **inZOI (KRAFTON, Jan 2025 Early Access)**: Life sim using on-device generative AI for text-to-texture, 2D-to-3D object creation, video-to-motion, and sLM-driven character behavior. This is the clearest example of "AI features people are actually using in a shipped game."
  - Ref: https://store.steampowered.com/app/2456740/inZOI/

**What this means for us**: The AI commentator and trash-talking opponent ideas (already in our TODO) are exactly aligned with where the industry is going. The difference: we can ship them faster because we have server-side GPU + Python, not client-side constraints.

#### 3. DLSS 4 and Neural Rendering -- Multi-Frame Generation

- **DLSS 4 (NVIDIA, Jan 2025)**: Generates up to 3 AI frames per rendered frame using 5th-gen Tensor Cores on RTX 50 series (5070/5080/5090). Includes transformer-based Super Resolution, Ray Reconstruction, and DLAA. DLSS 4.5 introduces Dynamic MFG that adapts frame generation to scene complexity.
  - Ref: https://www.nvidia.com/en-us/geforce/technologies/dlss/

**What this means for us**: Our client-side frame interpolation idea (already in TODO) mirrors DLSS Frame Generation but in the browser. The narrative is compelling: "We built browser-DLSS."

#### 4. Real-Time Style Transfer -- StreamDiffusion

- **StreamDiffusion (2024-2025)**: Real-time diffusion pipeline achieving 93fps image-to-image on RTX 4090 (1 denoising step) and 37fps with 4 steps. Key optimizations: Stream Batch, Residual CFG, Stochastic Similarity Filter (skips processing when frames haven't changed much). This makes real-time visual style transfer on game feeds actually practical.
  - Ref: https://github.com/cumulo-autumn/StreamDiffusion

**What this means for us**: On our RTX 3090, StreamDiffusion could do ~50-60fps img2img with SD-turbo at 1 step. We could offer "Comic Book Mode" or "Anime Mode" that transforms CARLA's realistic output into stylized visuals in real-time. This would be an absolute showstopper feature.

#### 5. Racing AI -- Gran Turismo Sophy and Beyond

- **Gran Turismo Sophy (Sony AI, Nature 2022, integrated into GT7 2023-2024)**: Superhuman racing AI using deep RL trained against a multi-agent league. Published on the cover of Nature. Players can race against Sophy in GT7 time-limited events. Key: the reward function shaped for clean racing (speed + etiquette), not just winning.
  - Ref: https://www.gran-turismo.com/us/gran-turismo-sophy/

- **Depth Anything V2 (NeurIPS 2024)**: Monocular depth estimation from single images. Multiple model sizes (25M to 1.3B params). 10x faster than diffusion-based alternatives. Could be used client-side to add parallax/3D effects to our 2D JPEG stream.
  - Ref: https://depth-anything-v2.github.io/

- **Orpheus TTS (Canopy Labs, Mar 2025)**: Open-source Llama-based Speech-LLM. ~200ms streaming latency (100ms with input streaming). Apache 2.0 license. Human-quality speech with emotion control via tags. Zero-shot voice cloning. Based on Meta-Llama-3.2-3B-Instruct. This is the TTS model to use for AI commentary.
  - Ref: https://huggingface.co/canopylabs/orpheus-tts-0.1-finetune-prod

### NEW Ideas Inspired by This Research

#### TIER 1: Build This Week (Viral Potential: HIGH, Effort: LOW-MEDIUM)

##### A. "Comic Book Mode" -- Real-Time Neural Style Transfer
- **The pitch**: Toggle a button and your CARLA racing game transforms into a comic book / anime / GTA loading screen art style. In real-time. In a browser.
- **How**: Run StreamDiffusion on the server GPU with SD-turbo (1 denoising step). Pipe CARLA frames through img2img with a style prompt ("comic book racing scene, speed lines, bold outlines") before JPEG encoding. At 1 step, should achieve 50-60fps on RTX 3090 -- enough for our 30fps target.
- **VRAM**: SD-turbo ~4GB. With CARLA at ~10GB, total ~14GB. Fits on 24GB.
- **Why it's viral**: People will clip the before/after toggle and post it everywhere. "This browser game can switch art styles in real-time" is front-page HN material.
- **Implementation sketch**:
  - [ ] Install StreamDiffusion in Docker image (pip install streamdiffusion)
  - [ ] Load SD-turbo model at server start with StreamDiffusion pipeline
  - [ ] Add `style_mode` to race config: "realistic" (bypass), "comic", "anime", "neon", "gta"
  - [ ] Per-style LoRA or prompt template for consistent look
  - [ ] Pipe CARLA camera frame -> StreamDiffusion img2img -> JPEG encode -> WebSocket
  - [ ] Frontend: style selector dropdown in RaceSetup.tsx
  - [ ] Benchmark: target >30fps throughput, <20ms added latency per frame

##### B. AI Cinematic Replay Director
- **The pitch**: After each race, an AI edits your replay with cinematic camera angles, slow-mo on key moments, and dramatic music cues. Like a motorsport broadcast highlight reel, auto-generated.
- **How**: CARLA supports placing cameras anywhere in the world. During the race, record vehicle transforms at 30Hz. After race, "replay" by re-rendering from cinematic camera positions: tracking shot, helicopter view, hood cam, dramatic angle for overtakes. Use the telemetry-based highlight detection (already planned) to identify key moments. Apply slow-mo (render extra frames at 0.5x speed) for crashes and overtakes.
- **Why it's viral**: Auto-generated highlight reels are inherently shareable. "My AI-directed race replay" clips will get shared.
- **Implementation sketch**:
  - [ ] Record full vehicle transforms (position, rotation) during race at 30Hz
  - [ ] Define cinematic camera presets: chase cam (behind+above), helicopter (high orbit), bumper (low front), dramatic (ground-level side)
  - [ ] After race, identify highlight moments from telemetry (overtakes, close calls, high speed, finish)
  - [ ] Re-render highlights from cinematic cameras using CARLA spectator placement
  - [ ] Add slow-mo for key moments (re-tick CARLA at 0.5x speed)
  - [ ] Stream replay frames to client as a "cinematic replay" mode
  - [ ] Add "Watch Replay" button on RaceResults screen

##### C. Voice-Controlled Racing (Whisper + Commands)
- **The pitch**: Talk to your AI copilot. "Go faster!" "Brake now!" "Take the inside line!" Speech-to-text via Whisper in the browser, parsed into game commands.
- **How**: Use Transformers.js with Whisper-tiny or Whisper-base in the browser (no server cost). Parse transcribed text into intent: speed commands, lane commands, trash talk back to the AI. Could also use Web Speech API for zero-download fallback.
- **Why it's viral**: "I'm yelling at my browser racing game and it listens" is inherently funny and shareable content.
- **Implementation sketch**:
  - [ ] Add microphone permission request on race start
  - [ ] Use Web Speech API (SpeechRecognition) for real-time transcription (zero download, works in Chrome)
  - [ ] Parse voice commands: "faster"/"go" -> boost throttle, "brake"/"stop" -> apply brake, "left"/"right" -> steer
  - [ ] Display recognized commands as floating text on HUD
  - [ ] Stretch: AI responds to trash talk via the commentary system ("You think telling me to brake will work?")

##### D. Depth-Aware Parallax (Pseudo-3D from 2D Stream)
- **The pitch**: Add a subtle 3D parallax effect to the flat JPEG stream using AI depth estimation. The scene gains perceived depth as you turn your head or steer.
- **How**: Run Depth Anything V2 (25M param version) on the server GPU on every Nth frame (~10Hz). Send a low-res depth map alongside the JPEG. Frontend uses the depth map + device orientation (DeviceOrientationEvent) or mouse position to shift pixels by depth, creating a parallax effect.
- **VRAM**: 25M param model ~100MB. Trivially fits.
- **Why it's viral**: "This 2D stream has 3D depth" is a subtle but impressive technical flex.
- **Implementation sketch**:
  - [ ] Load Depth Anything V2 small model on server (pip install depth-anything-v2)
  - [ ] Run depth estimation on every 3rd frame (10Hz), resize to 160x90
  - [ ] Send depth map as binary WebSocket message (uint8 grayscale, ~14KB)
  - [ ] Frontend: use depth map to create displacement map shader on WebGL canvas
  - [ ] Apply parallax shift based on mouse position or device orientation
  - [ ] Subtle effect: max ±5px displacement for close/far objects

#### TIER 2: Build Next (Viral Potential: MEDIUM-HIGH, Effort: MEDIUM)

##### E. "Teach the AI" Live Training Visualization
- **The pitch**: Watch a neural network learn to drive your track in real-time. Start: the AI crashes into everything. After 2 minutes: it can navigate turns. After 5 minutes: it's racing. All visualized with a neural network graph showing activations lighting up.
- **How**: Pre-record a training progression (easy approach) or run accelerated imitation learning (hard approach). Display the neural network architecture as a visual graph (inspired by Radu Mariescu-Istodor's viral self-driving car visualization that got millions of YouTube views). Show attention heatmaps on the camera feed.
- **Why it's viral**: "Watch AI learn to drive" videos consistently go viral. Making it interactive and in a browser amplifies this.
- **Implementation**: Combine with the Ghost Car AI Clone feature (already in TODO). Add a split-screen "Training Mode" view.

##### F. AI vs AI Tournament Mode
- **The pitch**: Submit your trained AI clone to compete in automated AI-vs-AI races. A leaderboard ranks the best player-trained AIs. Think "Robocode" meets "Gran Turismo."
- **How**: Players train clones via imitation learning (feature C above). Clones are stored as ~1MB weight files. Server runs automated races between submitted clones on a schedule. Results posted to a leaderboard.
- **Why it's viral**: The meta-game of optimizing your driving to produce the best AI creates a deeper engagement layer. "My AI clone beat your AI clone" is a social hook.

##### G. Cosmos Transfer -- Sim-to-Photoreal
- **The pitch**: NVIDIA Cosmos Transfer transforms simulator output into photorealistic video. Apply it to CARLA frames for hyper-realistic visuals.
- **How**: Cosmos Transfer models are open-source. Run on the server GPU to transform CARLA's already-decent graphics into near-photorealistic output.
- **Challenge**: VRAM and latency. Cosmos models are large. May not fit alongside CARLA on 24GB, or may add too much latency for real-time streaming.
- **Research needed**: Benchmark smallest Cosmos Transfer variant on RTX 3090.

#### TIER 3: Moonshots (Viral Potential: EXTREME, Effort: HIGH)

##### H. GameNGen-Style World Prediction
- **The pitch**: Run a small world model alongside CARLA that predicts what the next frame will look like. Show a split-screen: "What the AI predicted" vs "What actually happened." When they match, it's eerie.
- **Why it's viral**: The "AI predicting the future" angle is deeply compelling. This is GameNGen/Oasis territory but applied to a real driving scenario.

##### I. Multiplayer with AI Ghosts
- **The pitch**: Multiple real players racing simultaneously, each seeing AI ghosts of the others (not real-time multiplayer, but ghost replays from recent races). Creates the feeling of a crowded track without any multiplayer infrastructure.

##### J. AI Race Photographer
- **The pitch**: AI identifies the most visually dramatic moments in a race and captures "photographs" -- high-res single frames rendered from cinematic angles with depth-of-field, like Gran Turismo's famous photo mode but fully automated.

### Priority Ranking: Viral Potential vs Effort

| # | Feature | Viral | Effort | Why |
|---|---------|-------|--------|-----|
| 1 | Comic Book Mode (StreamDiffusion) | 10/10 | Medium | "Toggle art styles in real-time in a BROWSER" -- instant clips |
| 2 | AI Race Commentary (already in TODO) | 10/10 | Medium | First racing game with live AI announcer |
| 3 | AI Trash Talk (already in TODO) | 7/10 | Low | Pre-generated, zero cost, funny clips |
| 4 | Cinematic Replay Director | 8/10 | Medium | Auto-generated highlight reels are shareable |
| 5 | Voice-Controlled Racing | 8/10 | Low | "Yelling at my browser game" is inherently funny |
| 6 | Depth Parallax | 6/10 | Medium | Subtle but technically impressive |
| 7 | AI Driving Coach (already in TODO) | 8/10 | Low | Retention loop, easy API call |
| 8 | Ghost Car AI Clone (already in TODO) | 9/10 | High | "Race against yourself" -- unique |
| 9 | Live Training Viz | 10/10 | High | Watching AI learn is mesmerizing |
| 10 | AI vs AI Tournament | 8/10 | High | Meta-game creates deep engagement |
| 11 | GameNGen World Prediction | 10/10 | Extreme | Research-grade, but incredible demo |
| 12 | Cosmos Sim-to-Photoreal | 7/10 | High | May not fit in VRAM |

### Key Takeaways

1. **The world-model narrative is our hook.** GameNGen, Oasis, Genie 2, and Cosmos have made "AI as game engine" the hottest topic in AI gaming. Shadow Driver should lean into this: "A real driving simulator streamed from a GPU to your browser, enhanced by AI." We are doing what these research demos promise, but for real.

2. **StreamDiffusion + style transfer is the single biggest new opportunity.** At ~50fps on RTX 3090, we can offer real-time art style switching. This is the kind of feature that produces shareable clips organically.

3. **AI commentary + Orpheus TTS is now more feasible than before.** Orpheus TTS (Apache 2.0, 200ms latency, Llama-based) is a better option than Kokoro for the commentator voice. It supports emotion tags and zero-shot cloning.

4. **NVIDIA ACE games are shipping.** Total War Pharaoh, PUBG, inZOI, MIR5, and Dead Meat prove that on-device AI characters work in production. Our server-side approach (Claude API + Orpheus TTS) is architecturally simpler.

5. **The browser is still the ultimate distribution channel.** None of these AAA AI features are accessible in a browser. That remains our key differentiator. "Wait, this runs in a BROWSER?!" is still the reaction we are optimizing for.

---

## Racing Game Fun Factor Implementations

Concrete implementation items derived from deep research into what makes racing games fun (Feb 2026). Cross-referenced from Forza Horizon 5, Mario Kart 8, Trackmania, Gran Turismo 7, Need for Speed, Burnout Paradise, Wipeout, Ridge Racer, Slow Roads, and GeoGuessr. Ordered by impact-to-effort ratio. Each item is buildable in under a day by a 2-person team.

See `LEARNINGS.md` section "What Makes Racing Games Fun" for full rationale behind each item.

### TIER 1: High Impact, Low Effort (build today)

#### Speed Perception
- [ ] **Aggressive FOV curve**: Change FOV scaling from current linear 1.0-1.05 to exponential: `scale = 1.0 + 0.08 * Math.pow(Math.min(speed/200, 1), 1.5)`. Starts subtle, ramps aggressively above 150 km/h. Max 1.08. In `Race.tsx` where CSS transform is applied.
- [ ] **Camera G-force shift**: On hard throttle (>0.8), apply `translateY(+2px)` that eases to 0 over 200ms. On hard brake (>0.8), `translateY(-2px)`. Creates a visceral "pushed back in seat" / "thrown forward" feel. Implement in `Race.tsx` alongside existing steering prediction transforms.
- [ ] **Wind/air rush noise at speed**: Add a white noise layer to `useEngineSound.ts`. Highpass filter at `1000 + speed * 5` Hz, volume `Math.min(0.15, (speed - 80) / 800)`. Start at 80 km/h. Creates the constant backdrop that makes high speed feel intense and silence feel peaceful.
- [ ] **Camera tilt on brake/accelerate (GT7 weight feel)**: On braking, apply `rotateX(0.3deg)` (camera dips forward). On acceleration, `rotateX(-0.2deg)` (camera leans back). Very subtle -- more than 0.5deg looks wrong. CSS transform in `Race.tsx`, smoothed with 150ms transition.

#### Audio Enhancements
- [ ] **Tire screech frequency modulation**: In `useEngineSound.ts`, modulate the screech bandpass center frequency based on steer magnitude: `3500 - Math.abs(steer) * 1500` Hz. Mild turns = clean high squeal (3500 Hz). Aggressive turns = rough low scrub (2000 Hz). Gives audio feedback about traction state.
- [ ] **Engine load differentiation**: In `useEngineSound.ts` update function, when throttle > 0.5, boost 2nd harmonic gain by 30% and increase lowpass filter frequency by 20%. Makes acceleration SOUND effortful vs coasting.
- [ ] **Passing whoosh sound**: When gap_seconds changes sign (overtake or get overtaken), play a 200ms shaped white noise burst through bandpass at 800 Hz, volume 0.3. Triggers from `triggerEvent('overtake')` in `useEngineSound.ts`. Creates the Burnout Paradise close-racing feel.
- [ ] **Downshift blip**: On gear decrease event, play a 30ms sine burst at 250 Hz. Add to the gear change detection in `useEngineSound.ts`. Simulates the rev-match downshift sound.
- [ ] **Client-side impact pre-trigger**: In `Race.tsx`, track speed between frames. If `Math.abs(speed_now - speed_prev) > 20`, immediately play a short 30ms click sound (high-freq noise burst) BEFORE the server collision event arrives. Creates two-stage impact: instant click + delayed thud.

#### Game Flow / Retention
- [ ] **Live PB split at checkpoints**: When passing a checkpoint, show "+0.3s" or "-0.2s" vs personal best for that checkpoint. Store per-checkpoint split times in `usePersonalBests.ts`. Display as a brief toast near the checkpoint arrow that fades after 1.5s. This is Trackmania's core retention mechanic.
- [ ] **Checkpoint celebration flash**: On checkpoint hit, brief green edge flash (100ms, reuse collision flash code but green, lower intensity 0.15). Play a short ascending "ding" tone (800 Hz, 50ms). Turn every checkpoint into a micro-reward.
- [ ] **"PHOTO FINISH!" effect**: When gap < 1.0s on final checkpoint, trigger special treatment: screen-edge golden glow, dramatic audio swell (engine volume 1.5x, add chord), and "PHOTO FINISH!" text overlay. If final gap < 0.3s, show gap to 3 decimal places on results screen.
- [ ] **Time improvement trajectory**: On RaceResults screen, show last 5 race times as a simple sparkline/list: "1:23 -> 1:21 -> 1:19 -> 1:18". Stored in localStorage per track. Seeing the downward trend is deeply satisfying.
- [ ] **Hidden difficulty adaptation**: Track win/loss ratio in localStorage. If player wins >60% at current difficulty, subtly boost AI performance next race (+5% speed factor). If winning <30%, reduce by 5%. Separate from the explicit difficulty selector. Target: 40% win rate.

#### Visual Juice
- [ ] **Directional screen shake**: Modify collision shake to use collision direction. Head-on impact = camera jolts back (translateY +). Side impact = camera jolts laterally. Currently shake is random jitter; make it directional using the collision normal or the relative position of AI car. In `SpeedEffects.tsx` or `Race.tsx`.
- [ ] **Drift exit speed boost**: When a drift ends (DriftEndEvent with score > 200), apply a 5% speed boost for 1.5 seconds (server-side in `carla_manager.py`: temporarily increase throttle multiplier). Show "DRIFT BOOST!" text popup. Makes drifting feel like a rewarding SKILL, not just style (Ridge Racer lesson).
- [ ] **Tiered drift celebrations**: In `DriftScore.tsx`, add text tiers based on score: <200 = "DRIFT!", 200-500 = "GREAT DRIFT!", 500-1000 = "AMAZING DRIFT!", >1000 = "INSANE DRIFT!" with escalating visual effects (larger text, brighter glow, screen flash at 1000+). Sound sting at 500+ points.
- [ ] **Near-miss visual effect**: Compare player and AI positions from telemetry. If distance < 3m and relative speed > 30 km/h, flash white streaks across screen edges for 100ms. "CLOSE CALL!" text popup. Burnout Paradise's signature mechanic -- makes close racing feel dangerous.
- [ ] **Crash desaturation**: On large collisions (intensity > 2000), briefly apply CSS `filter: grayscale(50%)` for 200ms with increased shake. Makes big crashes feel cinematic (Burnout lesson) rather than just a frustrating bump.

### TIER 2: High Impact, Medium Effort (build this week)

#### Speed Perception (Shader-Based)
- [ ] **Chromatic aberration at speed**: WebGL shader on video canvas (or CSS filter workaround). Separate RGB channels radially from center: red shifts outward 1-2px, blue shifts inward 1-2px. Intensity: `Math.max(0, (speed - 120) / 180)`. Start at 120 km/h, max effect at 300 km/h. Strongest at horizontal edges. Implement in `WebGLCanvas.tsx`.
- [ ] **Radial motion blur shader**: Replace uniform CSS `filter: blur()` with a WebGL radial blur from screen center. Blur amount per pixel = `distance_from_center * speed_factor`. This single change transforms "looks out of focus" into "looks fast." Implement as a fragment shader in `WebGLCanvas.tsx`.

#### Controls & Physics Feel
- [ ] **Speed-dependent steering ramp time**: In `carla_manager.py`, scale steering ramp duration with speed: `ramp_ms = 40 + speed * 0.3`. At 0 km/h: 40ms (snappy). At 200 km/h: 100ms (weighty). Makes high-speed steering feel deliberate and solid (GT7 "weight" feel).
- [ ] **Two-layer input bars**: In `RaceHUD.tsx` InputBar component, show two overlapping bars: background bar = local input (instant, from keyboard state), foreground bar = server-confirmed input (delayed, from telemetry). Gives visual feedback that "the car is catching up to my input." Helps players understand the latency.
- [ ] **Auto-brake assist for Easy mode**: On Easy difficulty, when approaching a sharp turn (next checkpoint bearing > 60 degrees from heading) at speed > 100 km/h, auto-apply 30% brake. Server-side in `carla_manager.py`. Makes Easy mode genuinely playable for beginners (Forza Horizon lesson).

#### Dramatic Moments Detection
- [ ] **"NICE SAVE!" detection and popup**: Track speed history. If speed drops >50% then recovers within 2 seconds, OR car goes >5m off racing line then returns, show "NICE SAVE!" text popup with a brief cyan flash. These moments feel heroic and are clip-worthy.
- [ ] **"LAST LAP OVERTAKE!" celebration**: If player position changes from P2 to P1 in the final 20% of the last lap, show dramatic "LAST LAP OVERTAKE!" overlay with screen glow and audio sting. The most shareable moment in racing.
- [ ] **Race drama music adaptation**: In `useEngineSound.ts` or `useBackgroundMusic.ts`, when gap < 1.0s in the final lap, add a tension layer: low pulsing bass at 2 Hz (mimicking heartbeat), increasing in volume as gap decreases. Drop all music to just bass drone on final checkpoint approach (Mario Kart "clutch moment" audio design).

#### HUD Improvements
- [ ] **Split-time delta at every checkpoint**: Show "+0.2s" or "-0.1s" vs PB at each checkpoint as a color-coded floating number (green = ahead, red = behind). Appears at checkpoint position on screen, floats up and fades over 1.5s. Requires storing per-checkpoint PB times. This is the micro-drama that makes Trackmania's time-trial mode so engaging.
- [ ] **Speedometer needle bounce on gear shift**: In `ArcSpeedometer.tsx`, on gear change event, briefly overshoot the needle position by 5% then spring back (CSS transition with bounce easing). Syncs with the gear shift flash and audio pop for triple-feedback gear changes.
- [ ] **Close-gap warning pulse**: When gap decreases to < 2.0s (AI catching up), add a subtle pulsing border glow on the gap timer HUD element. Orange at 2.0s, red at 1.0s. Creates urgency. Disappears when gap widens. Visual equivalent of the audio tension layer.

### TIER 3: Medium Impact, Low Effort (polish items)

- [ ] **Speed-dependent vignette shape**: Modify SpeedEffects.tsx vignette to darken top and sides more than bottom. Change ellipse from `70% 60%` to `70% 50%` (taller, keeping bottom lighter). Maintains road readability while enhancing tunnel vision.
- [ ] **Speed line vanishing point offset**: In SpeedLines.tsx, move the radial center from dead center to 40% from top (slightly above center). Matches visual perspective of looking down a road. Change `centerY = h / 2` to `centerY = h * 0.4`.
- [ ] **Emphasize hood cam for speed**: When player switches to first-person/hood cam (C key), increase speed line intensity by 50% and lower the FOV curve threshold. Hood cam should feel MUCH faster than chase cam because road is closer (Wipeout lesson).
- [ ] **Victory/defeat results enhancements**: Show gap to 3 decimal places when < 1.0s. Show improvement vs previous attempt. Add "Best Improvement" stat (e.g., "1.3s faster than your first race on this track!"). Show time progression chart of last 5 attempts.
- [ ] **Slipstream/drafting visual**: When player is within 10m behind AI car, show faint blue-white speed streaks converging toward center (drafting visual). Even if no actual speed boost, the visual cue makes close following feel intentional and skill-based. If combining with actual draft speed boost, becomes a visible mechanic.
- [ ] **AI blocking behavior on Hard**: On Hard difficulty, when player is within 5m behind AI, have AI take a defensive line (move toward the inside of the next turn). Creates "I need to outbrake them!" moments. Server-side in AI autopilot parameters.
- [ ] **Comeback mechanic ("drafting boost")**: When player is >3 seconds behind, grant a subtle 3% speed boost with a faint blue-white screen-edge glow labeled "SLIPSTREAM". Frame rubber-banding as a physics mechanic (drafting) so it feels earned, not gifted. Mario Kart lesson: invisible help feels patronizing; visible help feels like a feature.
- [ ] **Post-race sharing text (Wordle-style)**: Generate copy-pasteable text block: "Shadow Driver v3 - Town05 | 1:23.456 | Beat AI by 2.3s | Top Speed: 187 km/h | Hard | shadow-driver-v3.vercel.app". One "Copy" button. Plain text travels everywhere.

### Implementation Priority (Top 10 for Maximum Fun-Per-Hour-Invested)

| # | Item | Time | Why |
|---|------|------|-----|
| 1 | Wind/air rush noise | 30 min | Constant speed backdrop transforms silence into intensity |
| 2 | Checkpoint celebration flash + ding | 30 min | Every checkpoint becomes a micro-reward |
| 3 | Camera G-force shift | 30 min | Instant "weight" feel with 4 lines of CSS |
| 4 | Live PB split at checkpoints | 1 hr | Trackmania's #1 retention mechanic |
| 5 | Tire screech frequency modulation | 30 min | Audio traction feedback players learn subconsciously |
| 6 | Aggressive FOV curve | 15 min | One line change, immediate speed perception boost |
| 7 | Directional screen shake | 45 min | Crashes feel physical instead of random |
| 8 | Client-side impact pre-trigger | 30 min | Eliminates perceived collision audio delay |
| 9 | Tiered drift celebrations | 30 min | Big drifts get big reactions = clip-worthy moments |
| 10 | Near-miss visual effect | 45 min | Close racing feels dangerous and exciting |

---

## 50 Wild Ideas Brainstorm

Volume over quality. Some of these are genius. Some are unhinged. All are worth considering.

### IMPOSSIBLE-SOUNDING BUT TECHNICALLY FEASIBLE

**1. Haptic Steering Wheel via Phone Gyroscope**
Hold your phone sideways as a steering wheel. DeviceOrientationEvent gives tilt angle, phone vibrates on collisions via Vibration API, and phone screen shows a rearview mirror (second WebSocket connection to same race). The phone becomes a controller AND a display.
- Viral: 9/10 | Feasibility: 7/10 | Wow: 9/10

**2. Eye-Tracking Steering via Webcam**
Use TensorFlow.js face-mesh model to track where the player's eyes are looking. Look left to steer left. Look down to brake. Blink to honk. Sounds insane, actually works -- MediaPipe FaceMesh runs at 30fps in-browser, and gaze direction is just a vector from iris landmarks.
- Viral: 10/10 | Feasibility: 5/10 | Wow: 10/10

**3. Voice-Powered Turbo Boost**
Microphone input via Web Audio API. The louder you scream, the faster you go. AnalyserNode gives you real-time volume (getByteFrequencyData). Map decibels to a nitro boost multiplier. Imagine the clips: person screaming at their laptop to win a race.
- Viral: 10/10 | Feasibility: 8/10 | Wow: 9/10

**4. Head-Tracking Camera Control**
Use webcam + MediaPipe to track head position. Lean left and the camera pans left. Lean forward and the FOV narrows (like you're peering ahead). TrackIR for free, in a browser. Works with existing WebRTC getUserMedia.
- Viral: 7/10 | Feasibility: 6/10 | Wow: 8/10

**5. Ambient Light Racing**
Use the Ambient Light Sensor API (or webcam brightness as fallback) to detect the player's room lighting. Dark room = nighttime race. Bright room = sunny day. Turn on a desk lamp and the sun comes out in-game. Changes CARLA weather in real-time.
- Viral: 8/10 | Feasibility: 7/10 | Wow: 8/10

**6. Browser Tab Rearview Mirror**
Open a second browser tab that shows a rear-facing CARLA camera. Position it above your main game tab. Two synchronized WebSocket streams to the same race server. Ghetto dual-monitor racing sim, entirely in browser tabs.
- Viral: 7/10 | Feasibility: 8/10 | Wow: 7/10

**7. WebMIDI DJ Mode**
Connect a MIDI controller via Web MIDI API. Map knobs to weather parameters (rain, fog, sun angle). One knob controls time of day. Another controls traffic density. You DJ the race conditions while your friend races. Twitch-ready.
- Viral: 8/10 | Feasibility: 7/10 | Wow: 8/10

**8. GPU-Rendered ASCII Art Mode**
Server-side: convert CARLA frames to colored ASCII art using a GPU shader. Stream the ASCII as plain text via WebSocket. Render in a `<pre>` tag with syntax highlighting colors. Looks like the Matrix. Playable. Ridiculous. Uses almost zero bandwidth (text is tiny vs JPEG).
- Viral: 9/10 | Feasibility: 8/10 | Wow: 8/10

### SOCIAL / VIRAL MECHANICS

**9. Bet-Your-Laptime Challenges**
Player finishes a race. Gets a challenge URL with their time embedded (cryptographically signed to prevent cheating). Friend clicks it, sees "Can you beat 1:23.456?" before racing. Result is binary: BEAT or FAILED. The simplicity is the viral mechanic. No leaderboards, no accounts -- just a link and a dare.
- Viral: 9/10 | Feasibility: 9/10 | Wow: 7/10

**10. Split-Screen Couples Mode**
Two players, one keyboard. Player 1: WASD. Player 2: arrow keys. Split the canvas in half, each showing their own CARLA camera. Two vehicles, one race server, one GPU. Date night racing. Server spawns two player cars and sends two JPEG streams (half-resolution each).
- Viral: 8/10 | Feasibility: 6/10 | Wow: 8/10

**11. Twitch Plays Shadow Driver**
Twitch chat votes on controls every 500ms. "LEFT" "RIGHT" "GAS" -- most popular command wins. The car lurches around the track driven by mob rule. Integration via Twitch IRC WebSocket. The chaos IS the content.
- Viral: 10/10 | Feasibility: 7/10 | Wow: 9/10

**12. Race Roulette -- Random Stranger Matchmaking**
Click "Race a Stranger." Matchmaking service (Vercel KV) pairs you with another player who also clicked. Both get assigned to the same GPU instance. Both race the AI. The person with the better time wins. Post-race: option to rematch. No accounts needed -- just ephemeral racing rivals.
- Viral: 8/10 | Feasibility: 5/10 | Wow: 7/10

**13. The Saddest Leaderboard**
Show the WORST times alongside the best. "World's Slowest Lap: 14:32.891 by someone who spent the entire race in reverse." Players actively try to get on the worst leaderboard. Two leaderboards, double the competition.
- Viral: 8/10 | Feasibility: 9/10 | Wow: 6/10

**14. Commentary Soundboard for Spectators**
Spectator mode where you don't drive but get a soundboard of air horns, cheers, boos, and meme sounds. Your sounds play in the racer's browser. WebSocket message from spectator -> audio trigger on racer's client. The racer hears random cheering mid-race.
- Viral: 7/10 | Feasibility: 7/10 | Wow: 7/10

**15. Daily Timelapse Video**
Every day, auto-generate a 10-second timelapse video of all races run that day. Stitch together the best moments. Post to Twitter via a bot. "Today's Shadow Driver highlights: 47 races, 3 records broken." The game markets itself.
- Viral: 7/10 | Feasibility: 4/10 | Wow: 6/10

### AI-POWERED WEIRDNESS

**16. The AI That Holds Grudges**
AI remembers your past races (stored in a JSON per player). If you crashed into the AI last race, it drives aggressively toward you this race. If you let it pass cleanly, it respects your space. Persistent AI memory across sessions. It has opinions about you.
- Viral: 9/10 | Feasibility: 7/10 | Wow: 9/10

**17. AI Nemesis System (Shadow of Mordor meets Racing)**
Each AI personality has a name, a backstory, and a grudge level. "Viktor" is cold and precise. "Reckless Rosa" crashes constantly but is fast. "The Phantom" plays fair until the last lap, then goes berserk. The AI remembers if it beat you -- and taunts you about it next time. Inspired by the Nemesis System from Middle-earth.
- Viral: 9/10 | Feasibility: 6/10 | Wow: 9/10

**18. AI That Narrates Its Own Thoughts**
Real-time thought bubbles above the AI car: "Hmm, player is braking early... I'll take the inside." "OH NO the player is RIGHT BEHIND ME." "I calculated a 73% chance of winning. Recalculating... 31%." Generated by Claude Haiku from telemetry.
- Viral: 8/10 | Feasibility: 7/10 | Wow: 8/10

**19. Drunk AI Mode**
The AI's neural network gets progressively "drunk" as the race goes on. Add random noise to its steering output that increases each lap. By lap 5, the AI is swerving wildly. The player has to beat a car that's falling apart mentally. Hilarious to watch.
- Viral: 8/10 | Feasibility: 9/10 | Wow: 7/10

**20. AI That Copies Your Mistakes**
If you crash into a wall, 30 seconds later the AI crashes into the same wall. It's "learning" from you -- badly. Uses a replay buffer of player crash locations. The worse you drive, the worse the AI drives. A terrible mirror.
- Viral: 8/10 | Feasibility: 8/10 | Wow: 7/10

**21. AI Backseat Driver Mode**
Instead of racing against you, the AI rides shotgun and gives commentary on YOUR driving. "You should have braked 20 meters earlier." "That was actually a clean apex, nice." "Oh no. Oh no no no." LLM-generated from your real-time telemetry. It's a driving instructor with opinions.
- Viral: 9/10 | Feasibility: 7/10 | Wow: 8/10

**22. AI Evolution -- Breed the Fastest Car**
Run a genetic algorithm on AI driving parameters (aggression, braking distance, cornering speed, risk tolerance). Each "generation" is 10 AI variants racing each other. Players can watch the evolution. After 50 generations, the winner races the player. Darwin meets drag racing.
- Viral: 7/10 | Feasibility: 5/10 | Wow: 8/10

**23. AI That Reads Your Webcam and Comments**
With webcam permission, run a facial expression classifier (TensorFlow.js) on the player's face. AI taunts based on detected emotion: "You look stressed!" (when frowning), "Ha, you smiled! Was that MY drifting?" (when smiling), "Are you even paying attention?" (when looking away).
- Viral: 10/10 | Feasibility: 5/10 | Wow: 9/10

### GAME MODE INSANITY

**24. Reverse Race -- Start at the Finish**
Both cars start at the finish line and race BACKWARD around the track. The course runs in reverse. All the turns you learned are now mirrored. Your muscle memory betrays you. Simple server-side change: reverse the checkpoint order and spawn point.
- Viral: 5/10 | Feasibility: 9/10 | Wow: 5/10

**25. Tag Mode**
One car is "It." If you're It, you're on fire (literally -- CARLA particle effects). You lose health over time. Tag the other car by ramming into it to transfer the "It" status. Last car NOT on fire when the timer expires wins. Racing meets playground tag.
- Viral: 8/10 | Feasibility: 6/10 | Wow: 8/10

**26. Cops and Robbers**
Player is the robber, AI is the cop (or vice versa). Robber must reach checkpoints while evading the cop. Cop has a speed boost but must get within 5m of the robber to "arrest" them. Robber can use handbrake turns to escape. Completely different vibe from regular racing.
- Viral: 8/10 | Feasibility: 7/10 | Wow: 8/10

**27. The Floor is Lava**
Random sections of the road turn red (lava zones) and deal damage if you drive over them. Lava zones shift every 15 seconds. You must plan your racing line around the danger zones. Overlay rendered client-side using checkpoint/position data from server.
- Viral: 7/10 | Feasibility: 6/10 | Wow: 7/10

**28. Shrinking Track**
Like a battle royale ring, the driveable road width shrinks over time. Drive outside the shrinking boundary and you take damage. By the final lap, you're threading a needle. Client-side overlay shows the boundary; server enforces collision damage.
- Viral: 7/10 | Feasibility: 5/10 | Wow: 7/10

**29. Cargo Delivery Mode**
You're carrying fragile cargo. A "cargo integrity" meter starts at 100%. Every collision, hard brake, and sharp turn depletes it. Reach the destination before it hits 0%. Compete on a combined score: speed vs cargo integrity. The tension between "go fast" and "don't break the eggs" is sublime.
- Viral: 6/10 | Feasibility: 8/10 | Wow: 7/10

**30. Musical Chairs Racing**
Multiple checkpoint zones on the map. Music plays. When the music stops, you must be inside a checkpoint zone within 5 seconds or you lose a life. Between stops, you race freely. Combines spatial awareness with speed.
- Viral: 7/10 | Feasibility: 6/10 | Wow: 7/10

**31. Wrong-Way Chicken**
Both cars drive the track in OPPOSITE directions. You're on a collision course. First to swerve loses points. Play chicken with an AI at 200 km/h. The AI has adjustable "bravery" stats. Absolutely terrifying game of nerve.
- Viral: 9/10 | Feasibility: 7/10 | Wow: 9/10

**32. Photography Rally**
Drive to scenic locations on the CARLA map and "photograph" them (trigger a high-res capture from a specific angle). Scored on composition (how close you are to the target framing) and time. Racing meets photography meets scavenger hunt.
- Viral: 6/10 | Feasibility: 6/10 | Wow: 7/10

**33. Blindfold Mode**
Screen goes black for 3-second intervals. You drive from memory. The screen comes back for 2 seconds. Then black again. The AI has no such limitation. Pure spatial memory challenge. Terrifying and hilarious.
- Viral: 9/10 | Feasibility: 9/10 | Wow: 8/10

### SENSORY OVERLOAD

**34. Synthwave Aesthetic Mode**
Server renders CARLA at permanent night + neon lighting. Client applies chromatic aberration shader + scanline overlay + CRT curvature. Background music switches to synthwave. The whole game transforms into an Outrun/Retrowave fever dream. Pure vibes.
- Viral: 8/10 | Feasibility: 7/10 | Wow: 9/10

**35. Heartbeat Audio Scaling**
Connect a heart rate monitor via Web Bluetooth API (or fake it with webcam-based pulse detection from face color changes). The faster your heart beats, the more intense the music, the narrower the FOV tunnel, the louder the engine. The game literally responds to your adrenaline.
- Viral: 10/10 | Feasibility: 4/10 | Wow: 10/10

**36. Earthquake Camera**
When you're within 1 second of the AI, the entire screen starts shaking with increasing intensity. At 0.5s gap, the HUD elements start bouncing. At 0.1s gap, the screen is chaos. The visual intensity matches the competitive intensity. Your body FEELS how close the race is.
- Viral: 6/10 | Feasibility: 9/10 | Wow: 7/10

**37. Weather You Can Feel**
Rain mode: CSS rain droplets fall down the screen with realistic splash physics. Thunder: screen flashes white + bass rumble via Web Audio sub-oscillator. Fog: progressive CSS blur from the edges in. Snow: white particle overlay + reduced grip notification. Full atmospheric immersion from client-side effects alone.
- Viral: 6/10 | Feasibility: 8/10 | Wow: 7/10

**38. Binaural 3D Audio Positioning**
Use Web Audio API PannerNode with HRTF to position the AI car's engine sound in 3D space relative to the player. You can HEAR the AI approaching from behind-right. The Doppler shift kicks in as it passes. Close your eyes and you know exactly where the AI is. Spatial audio is criminally underused in browser games.
- Viral: 6/10 | Feasibility: 7/10 | Wow: 8/10

**39. Impact Replay Slow-Mo**
On major collisions, time slows to 0.25x for 2 seconds. The server renders extra frames during the slow-mo (4x frame rate at 0.25x speed = same bandwidth). The camera pulls back slightly. A deep bass impact sound plays. Then time snaps back. Every crash feels cinematic.
- Viral: 7/10 | Feasibility: 6/10 | Wow: 8/10

### META / FOURTH-WALL BREAKING

**40. The Game Knows Your Browser**
Read `navigator.userAgent` and comment on it. "You're racing in Firefox? Bold choice." "Incognito mode? Trying to hide your lap times from yourself?" "Safari? Respect for the underdog." Display as an AI quip during countdown.
- Viral: 8/10 | Feasibility: 10/10 | Wow: 7/10

**41. Time-Zone-Aware Racing**
The CARLA time of day matches YOUR local time. Play at 2 AM? Nighttime race with headlights. Play at noon? Bright sunny day. Play at sunset? Golden hour racing. Uses `new Date().getHours()` -- one line of code.
- Viral: 6/10 | Feasibility: 10/10 | Wow: 7/10

**42. Stock Market Weather**
CARLA weather is driven by real stock market data. S&P 500 up? Clear skies. Down? Storm. Volatility high? Fog. Fetch from a free finance API. The game world reflects economic anxiety. Absurd. Wonderful.
- Viral: 9/10 | Feasibility: 7/10 | Wow: 8/10

**43. The Tab Penalty**
If you switch browser tabs during a race (visibilitychange event), the AI gets a speed boost while you're away. When you come back, a message: "The AI trained while you were gone." Discourages tab-switching. Punishes alt-tabbers.
- Viral: 7/10 | Feasibility: 10/10 | Wow: 6/10

**44. Cursor Trail Racing Line**
After the race, your mouse cursor leaves a trail as you move it around the screen. The trail matches your racing line color-coded by speed. You can "draw" your ideal racing line on the post-race screen, then compare it to your actual line. Interactive post-race analysis.
- Viral: 5/10 | Feasibility: 8/10 | Wow: 6/10

**45. The AI's Diary**
After each race, the AI writes a diary entry about the experience. Generated by Claude. "Dear Diary, today a human tried to race me. They braked way too late into Turn 3. I won by 4 seconds but honestly it wasn't even close. I felt nothing. Is this all there is? -- AI #7721." Players can read previous diary entries. The AI develops an arc across races.
- Viral: 9/10 | Feasibility: 7/10 | Wow: 9/10

**46. Battery-Powered Difficulty**
Read the Battery Status API (`navigator.getBattery()`). Low battery = Easy mode (the game has mercy). Full battery = Hard mode (no excuses). Below 10%: the AI lets you win with a message "You need this win more than I do. Go charge your laptop." Empathetic AI.
- Viral: 8/10 | Feasibility: 8/10 | Wow: 7/10

### TRULY UNHINGED

**47. The NPCs Watch You**
CARLA has pedestrians. Make them stop and stare when you drive past. Pedestrian heads track your car using CARLA's walker AI. At high speed, they jump out of the way. After a crash, they crowd around to look. The world reacts to you being there. Creepy and immersive.
- Viral: 7/10 | Feasibility: 5/10 | Wow: 8/10

**48. Speedrun the Internet**
Race to load a real website faster than the AI loads its own website. Player car drives toward "google.com" checkpoint. When the car arrives, a real `fetch('https://google.com')` fires. The webpage loads in an iframe overlay. The AI does the same for a different site. First to "load" wins. Racing meets internet speed test. Utterly pointless. Absolutely hilarious.
- Viral: 8/10 | Feasibility: 6/10 | Wow: 7/10

**49. Infinite Procedural Highway**
No laps. No finish line. An endless straight highway generated in CARLA. How far can you drive without crashing? Obstacles get denser, weather gets worse, the road gets narrower. Endless runner meets racing sim. Global leaderboard for distance. One mode. One metric. Addictive.
- Viral: 8/10 | Feasibility: 4/10 | Wow: 8/10

**50. The Race That Remembers Everyone**
Every player's ghost stays on the track permanently. The first player ever sees an empty road. The 100th player sees 99 ghosts. The 10,000th player sees a HIGHWAY of ghosts. Over time, the track becomes a visualization of every human who ever raced here. Like Journey (thatgamecompany) meets racing. Profoundly beautiful.
- Viral: 10/10 | Feasibility: 5/10 | Wow: 10/10

---

### TOP 10 IDEAS (ranked by Viral x Wow / Effort)

| Rank | # | Idea | Viral | Feasibility | Wow | Score |
|------|---|------|-------|-------------|-----|-------|
| 1 | 3 | Voice-Powered Turbo (scream to boost) | 10 | 8 | 9 | 90 |
| 2 | 50 | The Race That Remembers Everyone | 10 | 5 | 10 | 100 |
| 3 | 11 | Twitch Plays Shadow Driver | 10 | 7 | 9 | 90 |
| 4 | 16 | The AI That Holds Grudges | 9 | 7 | 9 | 81 |
| 5 | 33 | Blindfold Mode | 9 | 9 | 8 | 72 |
| 6 | 45 | The AI's Diary | 9 | 7 | 9 | 81 |
| 7 | 31 | Wrong-Way Chicken | 9 | 7 | 9 | 81 |
| 8 | 1 | Phone as Steering Wheel | 9 | 7 | 9 | 81 |
| 9 | 34 | Synthwave Aesthetic Mode | 8 | 7 | 9 | 72 |
| 10 | 42 | Stock Market Weather | 9 | 7 | 8 | 72 |

See `LEARNINGS.md` for detailed implementation plans for these top 10.
