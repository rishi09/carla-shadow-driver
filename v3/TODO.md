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
- [ ] **Skip unchanged frames**: If car is stationary and camera hasn't moved, skip encoding entirely. Send a "no-change" signal instead.
- [ ] **Adaptive quality**: Drop JPEG quality to 30 when latency spikes >150ms, raise to 60 when stable <80ms. Frontend sends latency back in telemetry.
- [ ] **Resolution downscale at speed**: At 200+ km/h you can't see detail anyway — drop to 960x540 at high speed, full res when slow/stopped.

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
- [ ] Let player rev engine during countdown (throttle input accepted, car doesn't move)
- [ ] Camera starts wider/higher, pulls into gameplay position on GO
- [ ] Screen shake or zoom burst on GO
- [ ] Hide HUD during countdown, fade in on GO
- [ ] Engine rev sound builds through 3-2-1

### Post-Race / Retention
- [ ] "Race Again" button that's instant — no menus (Trackmania-style)
- [ ] Ghost replay of your previous best lap
- [ ] Personal best times with medals (Bronze/Silver/Gold per track)
- [ ] Simple leaderboard (per track, stored in KV or DB)
- [ ] "Challenge a Friend" button that copies a ready-to-play URL with same track/settings

### Browser Advantage
- [ ] Minimize time from URL click to gameplay (target: <5 seconds for returning players)
- [ ] Show something exciting during GPU provisioning wait (replays, leaderboards, tips)
- [ ] Make the `?ws=` URL shareable — post-race "Share this track" button

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
