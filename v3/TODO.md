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
- [ ] **Time of day**: Add sunset/sunrise/night race options. CARLA's weather system supports sun altitude/azimuth for dramatic lighting.
- [ ] **Rain/wet roads**: CARLA has wet road reflections when precipitation > 0. Looks dramatically better than dry roads.

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
- [ ] Drift scoring (angle * speed * duration = points)

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
