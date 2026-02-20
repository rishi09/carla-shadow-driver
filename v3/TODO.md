# Shadow Driver v3 - TODO

## WebRTC Migration (JPEG/WebSocket → H.264/WebRTC)

Goal: Reduce perceived input lag by ~15-40ms by switching video streaming from JPEG-over-WebSocket to H.264-over-WebRTC. Controls and telemetry stay on WebSocket.

### Phase 1: Basic WebRTC video stream
- [x] Add `aiortc` to `docker/requirements.txt`
- [x] Add system deps to Dockerfile (conda-forge `av` for FFmpeg compat with Ubuntu 18.04)
- [x] Create `CarlaVideoTrack(MediaStreamTrack)` in server — reads from `CameraBuffer`, returns `av.VideoFrame`
- [x] Add WebRTC offer/answer handling to `race_server.py` — `webrtc_offer` → `RTCPeerConnection` + video track + H.264 → `webrtc_answer`
- [x] Frontend: add `RTCPeerConnection` setup in `useGPUConnection.ts` — offer via WebSocket, handle answer, capture remote stream
- [x] Frontend: create `WebRTCVideo.tsx` component — `<video>` element with `srcObject = remoteStream`
- [x] Skip `_send_frame()` when WebRTC active (JPEG fallback still works when `self.pc is None`)
- [x] Add performance instrumentation (server frame_prep + browser RTCPeerConnection.getStats)
- [ ] Test with direct Vast.ai port exposure (UDP ports 10000-10010) instead of Cloudflare tunnel for media

### Phase 2: Optimize latency
- [x] Force H.264 codec via `force_codec(pc, sender, "video/H264")` with baseline profile
- [x] Set browser-side `playoutDelayHint = 0.02` (20ms) on the video receiver to minimize jitter buffer
- [ ] Tune H.264 bitrate (start 1.5 Mbps, auto-adjust via WebRTC congestion control)
- [ ] Remove `FrameEncoder` class (no more JPEG encoding needed)
- [ ] Measure actual latency improvement vs JPEG baseline

### Phase 3: GPU encoding (NVENC) — aiortc vs GStreamer decision
- [ ] Deploy WebRTC, check server logs for `effective_fps` — if consistently <30, software x264 is the bottleneck
- [ ] Check browser console `[WebRTC stats]` — high jitter or low framesReceived confirms encode bottleneck
- [ ] **Decision: stick with aiortc or switch to GStreamer?**
  - **aiortc (current):** `pip install`, simple Python API, but software x264 only (~15-30ms encode). No way to use NVENC without forking aiortc or feeding pre-encoded NAL units.
  - **GStreamer + webrtcbin:** Pipeline-based, uses `nvh264enc` for NVENC (~9ms encode), battle-tested WebRTC stack. But: heavier install (~200-400MB), GObject boilerplate, replaces aiortc entirely.
  - **Hybrid hack:** Encode with FFmpeg `h264_nvenc` externally, pipe NAL units into a custom aiortc MediaStreamTrack that skips re-encoding. Fragile but avoids full GStreamer switch.
- [ ] If switching to GStreamer: prototype pipeline `appsrc → videoconvert → nvh264enc → rtph264pay → webrtcbin`
- [ ] Validate no VRAM contention with CARLA on RTX 3090 (NVENC uses dedicated hardware encoder chip, should be fine)
- [ ] Expected improvement: encoding drops from ~15-30ms (CPU x264) to ~9ms (NVENC)

### Phase 4: Production readiness
- [ ] Add TURN server for Cloudflare tunnel compatibility (WebRTC needs UDP, Cloudflare tunnels only do TCP)
- [ ] Add JPEG/WebSocket fallback if WebRTC negotiation fails
- [ ] Close `RTCPeerConnection` on client disconnect (add to cleanup/reconnect flow)
- [ ] Adaptive bitrate monitoring via `pc.getStats()`

### Key gotcha: Cloudflare tunnel + WebRTC
Cloudflare quick tunnels do NOT support UDP. Options:
1. **Direct port exposure on Vast.ai** (best latency, exposes IP) — expose UDP 10000-10010
2. **TURN relay over TCP/TLS** (works through tunnel, adds some overhead)
3. **Hybrid** — try direct first, fall back to TURN

### Latency comparison (estimated)
| Stage | Current (JPEG/WS) | WebRTC (H.264) |
|-------|-------------------|----------------|
| H.264/JPEG encode | 5-10ms (JPEG) | 8-15ms CPU / 2ms NVENC |
| Network transit | 30-100ms | 30-100ms |
| Browser decode | 5-15ms (JPEG blob) | 1-3ms (hardware H.264) |
| Display sync | 0-16ms (rAF wait) | 0ms (video compositor) |
| **Total overhead** | **40-141ms** | **39-118ms (CPU) / 33-105ms (NVENC)** |

---

## Vehicle Physics Tuning
- [x] Faster throttle ramp (~150ms, was ~300ms) and brake ramp (~60ms, was ~100ms)
- [x] Reverse threshold raised to 15 km/h (was 5 km/h)
- [ ] Tune vehicle physics via `vehicle.get_physics_control()`: increase tire friction, stiffen suspension, lower center of mass for less floaty feel
- [ ] Add countersteer assist (auto-correct when sliding)
- [ ] Add traction control (reduce throttle on wheel spin)

## Game Feel / Juice
- [x] Camera FOV scaling at speed (subtle 1.0→1.05x zoom at 150+ km/h)
- [x] Let player pick their car from 6 vehicles (Tesla, Mustang, Charger, Audi TT, Mini Cooper, Impala)
- [x] Speed vignette: GPU-accelerated CSS radial gradient, scales with speed
- [ ] Camera shake on acceleration/hard braking (collision shake already exists)

## First-Time User Experience (FTUE) — Future
Learnings from Forza Horizon 5, Mario Kart, Trackmania, Slow Roads, agar.io.

### Landing Page
- [ ] Show CARLA gameplay running as background on landing page (video or live canvas)
- [ ] One-line value prop: "Race an AI that learned to drive. In your browser."
- [ ] One big "RACE NOW" button with smart defaults — hide advanced options behind toggle
- [ ] Lean into the "this runs in a BROWSER?!" disbelief factor

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

## AI Opponent
- [x] Distance-based rubber banding (50m threshold, per-difficulty scaling: easy strong, hard minimal)
- [x] AI mistake injection (easy: every 10-15s, medium: 20-30s, hard: 60s) — creates overtaking windows
- [x] Hard mode: 55% over speed limit, aggressive random lane changes
- [ ] Load PilotNet weights from HuggingFace (sergiopaniego/OptimizedPilotNet, 200x66 input)
- [ ] Hook up Medium difficulty to use PilotNet steering + rule-based throttle
- [ ] Test if PilotNet + CARLA + WebRTC all fit on 24GB GPU
