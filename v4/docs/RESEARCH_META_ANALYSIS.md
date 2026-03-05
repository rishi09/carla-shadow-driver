# Research Meta-Analysis: 7 Directions for Shadow Driver v3

**Date:** February 23, 2026
**Author:** Systems architecture review
**Context:** Shadow Driver v3 streams CARLA simulator video from Vast.ai GPUs to browsers via WebSocket. Current pipeline: CARLA render -> Python BGRA frame -> FFmpeg subprocess NVENC H.264 -> WebSocket -> WebCodecs -> WebGL2 canvas. Latency: ~142ms (SSH tunnel). FPS: 20-30. Gemini gameplay score: 5/10.

---

## Executive Summary

After reading all research artifacts, PoC scripts, benchmark code, and documentation across 7 research directions, the highest-leverage improvements for Shadow Driver v3 are:

1. **GStreamer in-process encoding** (replace FFmpeg subprocess) -- immediate 2-5ms latency reduction per frame, dynamic bitrate, force-keyframe, elimination of IPC overhead and reader thread.
2. **Safari gameplay automation** -- enables objective, repeatable quality measurement that compounds across all other improvements.
3. **AV1 NVENC** -- 30-50% bitrate savings but blocked on RTX 4090 availability; prepare the negotiation protocol now.

Neural style transfer, WebTransport, and PyNvVideoCodec are interesting but either premature (WebTransport, PyNvVideoCodec) or orthogonal to the core playability problem (style transfer).

---

## Direction-by-Direction Analysis

### 1. PyNvVideoCodec -- Zero-Copy GPU Encoding

**Artifacts reviewed:**
- `v3/scripts/bench_pynvvideocodec.py` (727 lines) -- Benchmark comparing PyNvVideoCodec CPU input, GPU input (CuPy), VALI (python_vali), and FFmpeg subprocess.

**Verdict: EVALUATE**
**Impact: 5/10**
**Effort: 2-3 days**
**Key finding:** PyNvVideoCodec eliminates subprocess IPC and enables true zero-copy GPU encoding when frames stay in GPU memory, but CARLA sensor frames arrive as CPU numpy arrays, negating the zero-copy benefit.
**Risk:** PyNvVideoCodec requires specific NVIDIA driver/CUDA version combinations and is not well-documented for containerized environments; the benchmark has not been run on actual hardware yet.

**Detailed analysis:**

The benchmark script is thorough -- it tests 4 encoding paths with proper latency measurement and comparison tables. The theoretical advantage of PyNvVideoCodec is compelling for the GPU-resident frame path: if frames never leave GPU memory, encoding is a pure GPU operation with sub-millisecond overhead.

However, Shadow Driver's current frame source is `carla.Image.raw_data`, which arrives as a Python bytes object in CPU memory. The frame flow is:

```
CARLA GPU render -> sensor callback (CPU copy) -> Python bytes -> [encode]
```

For PyNvVideoCodec to provide a meaningful advantage over the FFmpeg subprocess, the frame would need to stay on the GPU. This requires either:
- NvFBC capture (already implemented in `nvfbc_capture.py`, but rarely active)
- A hypothetical CARLA CUDA buffer sharing API (does not exist in CARLA 0.9.15)

With CPU-origin frames, PyNvVideoCodec still eliminates the subprocess IPC overhead (~2-5ms per frame from pipe writes), but GStreamer achieves the same in-process encoding with better ecosystem support, dynamic bitrate, and force-keyframe capabilities.

**When to revisit:** If NvFBC capture becomes the primary frame source (making frames GPU-resident), PyNvVideoCodec + CuPy becomes the optimal path. At that point, combine with direction 7 (GStreamer) via `cudaupload + cudaconvert + nvh264enc`.

---

### 2. WebTransport / HTTP/3

**Artifacts reviewed:**
- `v3/poc/webtransport/server.py` (298 lines) -- aioquic-based WebTransport server with datagram video + reliable telemetry stream
- `v3/poc/webtransport/client.html` (385 lines) -- Dashboard comparing WebTransport datagrams vs WebSocket TCP
- `v3/poc/webtransport/setup.sh` (64 lines) -- One-command setup
- `v3/poc/webtransport/README.md` (62 lines)

**Verdict: HOLD**
**Impact: 7/10 (theoretical), 3/10 (current environment)**
**Effort: 3-5 days (integration), 1-2 weeks (production)**
**Key finding:** WebTransport eliminates TCP head-of-line blocking by sending video frames as unreliable QUIC datagrams, which is the theoretically optimal transport for real-time video -- but Safari does not support WebTransport (as of Feb 2026), the PoC requires self-signed certs with special Chrome flags, and the 50KB frame fragmentation across ~46 QUIC datagrams per frame introduces reassembly complexity and chunk loss risk.
**Risk:** Safari has no WebTransport support; Vast.ai tunnel infrastructure (Cloudflare, ngrok) does not support QUIC/HTTP3; the PoC sends fake 50KB blobs, not real H.264 NALs, so actual encoding integration is untested.

**Detailed analysis:**

The PoC is well-implemented. The server correctly fragments 50KB frames into ~1100-byte QUIC datagrams with a 16-byte header (frame_id, chunk_idx, total_chunks, timestamp), and the client reassembles them with stale-frame eviction and chunk loss tracking. The telemetry path via reliable unidirectional QUIC stream is elegant -- it separates reliable data (game state, scores) from lossy data (video frames) at the transport level.

However, there are three blocking problems:

1. **Safari exclusion.** Safari does not support WebTransport as of Feb 2026. This is a hard blocker for any user on macOS Safari, which is a meaningful fraction of the audience.

2. **Tunnel incompatibility.** Shadow Driver's primary deployment uses Cloudflare quick tunnels or SSH port forwarding. Neither supports QUIC/HTTP3. WebTransport requires a direct QUIC connection to the server, which means either direct IP access (no tunnel) or a QUIC-aware proxy. This conflicts with the current infrastructure.

3. **Fragmentation overhead.** At 1080p30 H.264 with 8 Mbps CBR, each frame is ~33KB on average (keyframes larger). Fragmenting into 1100-byte datagrams means ~30 datagrams per frame. If any single datagram is lost, the entire frame is lost. At 1% network packet loss, this means ~26% frame loss (`1 - 0.99^30`). This is worse than TCP's in-order reliable delivery for all but the most extreme head-of-line blocking scenarios.

The right time for WebTransport is when: (a) Safari adds support, (b) Shadow Driver uses direct IP connections (not tunnels), and (c) the frame delivery protocol is redesigned to use error-resilient coding (e.g., FEC or temporal scalability layers where each datagram is independently decodable).

---

### 3. AV1 NVENC

**Artifacts reviewed:**
- `v3/scripts/av1_codec_benchmark.py` (191 lines) -- Benchmark comparing h264_nvenc, av1_nvenc, hevc_nvenc, and libsvtav1
- `v3/scripts/av1_decode_test.html` (65 lines) -- Browser WebCodecs decode support detection for AV1/HEVC/H.264
- `v3/docs/RESEARCH_AV1_NVENC_GAME_STREAMING.md` (636 lines) -- Comprehensive research report

**Verdict: TRIAL (prepare protocol now, deploy on RTX 4090 later)**
**Impact: 6/10**
**Effort: 1 day (protocol), 2-3 days (full integration)**
**Key finding:** AV1 NVENC delivers 30-50% bitrate savings at equivalent quality (15-25% at ULL preset), but is only available on RTX 4090 (Ada Lovelace), not the current RTX 3090 (Ampere); browser decode support is 84% (Chrome/Firefox) with Safari excluding older devices.
**Risk:** RTX 4090 instances on Vast.ai cost more ($0.80-1.50/hr vs $0.40-0.80/hr for 3090); Safari on pre-M3 Macs and pre-iPhone 15 Pro devices will fall back to H.264, creating a two-codec maintenance burden.

**Detailed analysis:**

The research report is exceptionally thorough. The key facts are:

- **RTX 3090: NO AV1 NVENC.** This is the current GPU. AV1 encoding is impossible.
- **RTX 4090: YES AV1 NVENC.** Encode latency is ~2-4ms (vs ~1.5-3ms for H.264), comfortably within the 5ms budget.
- **Quality advantage narrows at ULL preset.** At p1/tune=ull, AV1 saves 15-25% bitrate (not the headline 30-50%). The advanced tools (IBC, palette mode) are disabled at ULL for latency reasons.
- **WebCodecs AV1 decode: 84% coverage.** The 14-point gap vs H.264's 98% is real. Safari hardware-only decode (M3+, iPhone 15 Pro+) is the main gap.
- **The FFmpeg command is nearly identical.** Just swap `h264_nvenc` to `av1_nvenc` and `-f h264` to `-f av1`. Integration effort is minimal once the protocol supports codec negotiation.

The report provides production-ready code snippets for: GPU capability detection, OBU header parsing (AV1 equivalent of NAL unit parsing), WebCodecs AV1 configuration, and client-server codec negotiation. The `av1_decode_test.html` is immediately usable for client capability testing.

The codec benchmark script is well-structured but has not been run on actual hardware (it generates synthetic frames). The PSNR measurement via FFmpeg is a nice touch for objective quality comparison.

**Recommended action:** Implement codec negotiation in the handshake protocol now (zero risk, useful for HEVC too). Deploy AV1 when RTX 4090 prices drop or when a specific user reports bandwidth constraints that H.264 cannot satisfy.

**HEVC intermediate step:** The research correctly identifies HEVC as available on RTX 3090 with 20-25% savings. However, Firefox excludes HEVC entirely (patent issues), making this a non-starter for a public game. If the audience is known to be Chrome/Safari only, HEVC is worth a trial.

---

### 4. Real-Time Style Transfer

**Artifacts reviewed:**
- `v3/research/neural_enhance/poc_c_style_transfer.py` (488 lines) -- FastStyleNet implementation with cinematic filter fallback
- Output images in `v3/research/neural_enhance/output_style/` (7 images at various alpha levels)

**Verdict: HOLD**
**Impact: 4/10 (visual novelty), 0/10 (playability)**
**Effort: 1-2 weeks (training + integration)**
**Key finding:** A compact FastStyleNet (~500K params, 4 residual blocks) can run at 3-8ms on RTX 3090 at 480p with alpha blending, which fits within the frame budget -- but the model ships untrained (random weights), requires a training dataset of CARLA-to-racing-game image pairs that does not exist, and the cinematic filter (CLAHE + color grading, <2ms, zero ML) achieves "80% of the visual punch" according to the PoC's own assessment.
**Risk:** CARLA + PyTorch + NVENC on the same RTX 3090 (24GB VRAM) risks memory pressure; training requires a curated dataset that does not exist; the visual improvement is cosmetic while core playability problems (missing HUD, no countdown, invisible AI) remain unsolved.

**Detailed analysis:**

The PoC is well-engineered. It benchmarks three approaches:

1. **Cinematic filter** (no ML): CLAHE + LAB warmth + saturation boost + S-curve + vignette = <2ms/frame, always available.
2. **Full-resolution neural style** (1920x1080): ~15-25ms on RTX 3090 with CUDA -- marginally real-time at 30fps but leaves no headroom.
3. **Reduced-resolution + alpha blend** (480x270): ~3-8ms -- easily real-time, produces a "style hint" overlaid on the original.

The fundamental problem is that the model is untrained. With random weights, the output is meaningless noise blended with the original. Training requires:
- A curated dataset of CARLA screenshots paired with equivalent racing game screenshots (Forza, GT7, etc.)
- Or: An unpaired style transfer approach (CycleGAN, etc.) which is even slower and harder to train
- Training compute time: hours to days on a GPU

Meanwhile, the cinematic filter (`apply_cinematic_filter`) is immediately deployable and could be integrated into the server-side pipeline or the client-side GLSL shader. The GLSL shader approach (already existing in `WebGLCanvas.tsx`) is the right place for color grading -- it's free on the GPU and does not consume CARLA's compute budget.

**Recommendation:** Deploy the cinematic filter's color grading logic as GLSL shader uniforms (contrast=1.08, saturation=1.10, warm temperature shift). Skip neural style transfer until the game reaches 7+/10 Gemini score and visual polish becomes the bottleneck.

---

### 5. Selkies GStreamer

**Artifacts reviewed:**
- `v3/docs/RESEARCH_GSTREAMER_SELKIES.md` (522 lines) -- Comprehensive analysis of Selkies-GStreamer architecture, encoder configuration, and comparison with Shadow Driver

**Verdict: EVALUATE (as reference architecture, not as dependency)**
**Impact: 3/10 (direct use), 7/10 (as design inspiration for direction 7)**
**Effort: N/A (reference only)**
**Key finding:** Selkies validates that `appsrc -> nvh264enc -> appsink` is production-grade for cloud gaming at 60fps/1080p in containers, and its encoder configuration best practices (preset, rc-mode, vbv-buffer-size, zerolatency, force-keyframe events) are directly applicable -- but Selkies itself is a complete remote desktop solution with X11 capture and WebRTC delivery, making it unsuitable as a library dependency for Shadow Driver's raw-frame-in/WebSocket-out architecture.
**Risk:** None (reference only, no code dependency).

**Detailed analysis:**

The research report extracts the key insights from Selkies without proposing to use Selkies as a dependency. This is the correct approach. The valuable takeaways are:

1. **Encoder configuration:** `nvh264enc preset=low-latency-hq rc-mode=cbr bframes=0 aud=false rc-lookahead=0 zerolatency=true vbv-buffer-size=<1.5x per-frame budget>`. These properties are directly used in the GStreamer PoC (direction 7).

2. **Dynamic bitrate:** `encoder.set_property("bitrate", kbps)` on a running pipeline. No restart needed. This is a significant advantage over the current FFmpeg subprocess approach, which requires killing and restarting the process (200ms+ disruption).

3. **Force keyframe:** `GstForceKeyUnit` custom event. This enables instant video start for late-joining clients and recovery from decode errors, without waiting for the next GOP boundary (2 seconds at the current 60-frame GOP).

4. **CUDA colorspace conversion:** `cudaupload + cudaconvert` keeps frames on GPU from upload through encoding, eliminating the CPU `videoconvert` step (~1-2ms savings per frame).

5. **Container compatibility:** Selkies' Docker images prove that GStreamer nvcodec works on Vast.ai-style GPU instances with NVIDIA Container Toolkit.

The report correctly concludes that a thin custom GStreamer wrapper (the `game-streamer` library concept) is more appropriate than adopting Selkies as a dependency.

---

### 6. Safari Gameplay Automation

**Artifacts reviewed:**
- `v3/test/grader.py` (886 lines) -- Screenshot quality grading: black frame detection, frozen frame detection (SSIM), HUD element detection, composite quality scoring
- `v3/test/run_test.sh` (389 lines) -- CI runner: prerequisite checks, gameplay test execution, grader integration, pass/fail verdict
- `v3/test/gameplay_test.py` and `v3/scripts/e2e_gameplay_test.py` (referenced but not the primary focus)

**Verdict: ADOPT**
**Impact: 8/10**
**Effort: 1-2 days (to first working test run)**
**Key finding:** The grader provides objective, repeatable visual quality measurement (sharpness via Laplacian variance, colorfulness via Hasler-Suesstrunk, contrast, HUD detection via Sobel edge density) that can be run in CI -- this is the missing feedback loop that prevents the "Coding Blind" anti-pattern documented in CLAUDE.md.
**Risk:** Safari automation via safaridriver requires macOS with Remote Automation enabled; initial setup has friction (safaridriver port, Vite dev server, WebSocket server all need to be running).

**Detailed analysis:**

The grader is the most immediately valuable artifact in the research set. Here is why:

Shadow Driver's CLAUDE.md explicitly identifies the "Coding Blind" problem: "The AI agent edits code it cannot see the output of. It edits GLSL shaders but cannot see what they render." The grader solves this by providing machine-readable quality scores from actual gameplay screenshots.

The quality metrics are well-chosen:
- **Sharpness** (Laplacian variance): Directly measures encoding quality. JPEG q80 at 720p will score low; H.264 at 1080p will score high.
- **Colorfulness** (Hasler-Suesstrunk): Detects washed-out video (low saturation from bad color grading or excessive compression).
- **HUD detection** (Sobel edge density in predefined regions): Checks for speedometer, top bar, minimap presence. The regions are calibrated to Shadow Driver's layout.
- **Frozen frame detection** (SSIM > 0.99): Catches encoder starvation (the exact bug that produced 5 frames in 54 seconds in Test 1).
- **Black frame detection** (mean pixel < 10): Catches NVENC black screen bugs.

The composite scoring (0-100 with per-metric weights) enables trend tracking across gameplay tests. The HTML report with embedded thumbnails is a nice touch for human review.

The `run_test.sh` runner is production-ready: it checks prerequisites (Python packages, safaridriver, WebSocket server), runs the gameplay test, parses results, runs the grader, and produces a structured pass/fail verdict with exit codes suitable for CI.

**Recommended action:** Run the test pipeline against the current deployment immediately. The quality scores will provide baseline metrics for evaluating all other improvements. Even without the full Safari automation, the grader can be run manually on screenshots captured during gameplay testing.

---

### 7. GStreamer Pipeline (In-Process nvh264enc)

**Artifacts reviewed:**
- `v3/scripts/gstreamer_poc.py` (1081 lines) -- Complete GStreamer vs FFmpeg encoder comparison with WebSocket streaming demo
- `v3/lib/game-streamer/game_streamer.py` (1149 lines) -- Pip-installable library wrapping GStreamer + FFmpeg with WebSocket transport
- `v3/lib/game-streamer/pyproject.toml` (48 lines) -- Package configuration
- `v3/lib/game-streamer/benchmark.py` (316 lines) -- Comparison benchmark
- `v3/lib/game-streamer/viewer.html`, `test_streamer.py`, `setup.sh`, `Dockerfile` (referenced)

**Verdict: ADOPT**
**Impact: 7/10**
**Effort: 2-3 days (integration into race_server.py)**
**Key finding:** GStreamer's in-process `nvh264enc` eliminates 2-5ms of IPC overhead per frame (pipe write/read, NALU parsing, reader thread), enables dynamic bitrate changes without subprocess restart (200ms+ disruption eliminated), and supports force-keyframe events for instant client sync -- all validated by Selkies-GStreamer's production use at 60fps/1080p.
**Risk:** GStreamer nvcodec plugin requires GStreamer >= 1.18, but the CARLA Docker image (Ubuntu 18.04) ships GStreamer 1.14; installation via conda-forge is recommended but untested on the actual Docker image.

**Detailed analysis:**

This is the most impactful direction for the current state of Shadow Driver. The PoC and library are both substantial, well-documented artifacts.

**The PoC (`gstreamer_poc.py`)** implements:
- A complete `GStreamerEncoder` class with pipeline construction, frame pushing (`appsrc.push_buffer`), encoded frame pulling (`appsink.try_pull_sample`), dynamic bitrate (`encoder.set_property("bitrate")`), and force-keyframe (`GstForceKeyUnit` event).
- An `FFmpegSubprocessEncoder` class for baseline comparison, with reader thread, NAL parsing, and frame queue -- essentially a cleaner version of the current `nvenc_encoder.py`.
- A benchmark runner that tests both encoders on synthetic frames and produces a comparison table.
- A bonus WebSocket streaming server with embedded HTML viewer for end-to-end testing.

**The library (`game_streamer.py`)** takes this further:
- `GStreamerEncoder`: Adds CUDA-accelerated colorspace conversion path (`cudaupload + cudaconvert`), proper GLib MainLoop thread management, `new-sample` signal-based frame delivery (vs polling), and `GST_BUFFER_FLAG_DELTA_UNIT` keyframe detection.
- `FFmpegEncoder`: Full fallback implementation with NAL unit parsing.
- `WebSocketTransport`: Async broadcast server with codec config auto-detection from SPS, ping/pong latency measurement, and quality request callbacks.
- `GameStreamer`: High-level API (`send_frame`, `set_bitrate`, `metrics`) that selects the best available backend automatically.
- `StreamerMetrics`: Rolling-window FPS, bitrate, encode time tracking.

The library is packaged with `pyproject.toml`, has proper optional dependencies (`PyGObject` for GStreamer, `psutil` for benchmarking), and includes a benchmark script that compares GStreamer-NVENC, FFmpeg-NVENC, and FFmpeg-x264 with percentile latency stats.

**Concrete benefits over current FFmpeg subprocess:**

| Capability | FFmpeg subprocess (current) | GStreamer in-process |
|---|---|---|
| IPC overhead | 2-5ms (pipe write 8.3MB BGRA + read) | 0ms (in-process buffer wrap) |
| Dynamic bitrate | Kill + restart subprocess (200ms+) | `set_property("bitrate", kbps)` (instant) |
| Force keyframe | Not supported (wait for GOP) | `GstForceKeyUnit` event (next frame) |
| Reader thread | Required (parse NALs from stdout) | Not needed (pull_sample or signal callback) |
| NAL parsing | 200 LOC custom Python | `h264parse` element (C, zero-cost) |
| Colorspace convert | FFmpeg internal (measured separately) | `cudaconvert` on GPU (1-2ms saving) |
| Error recovery | Kill + restart + wait for keyframe | Send force-keyframe event |

**Docker compatibility concern:** The CARLA Docker image uses Ubuntu 18.04, which ships GStreamer 1.14 (no nvcodec). The research report recommends `conda install -c conda-forge gstreamer gst-plugins-bad pygobject`. This adds ~200MB to the Docker image but is the least disruptive path. The alternative (upgrading the Docker base to Ubuntu 22.04+) requires CARLA compatibility testing.

---

## Ranking Summary

| # | Direction | Verdict | Impact | Effort | Key Blocker |
|---|---|---|---|---|---|
| 7 | **GStreamer pipeline** | **ADOPT** | 7/10 | 2-3 days | Docker GStreamer version |
| 6 | **Safari automation** | **ADOPT** | 8/10 | 1-2 days | macOS setup friction |
| 3 | **AV1 NVENC** | **TRIAL** | 6/10 | 1 day (protocol) | RTX 4090 availability |
| 5 | **Selkies reference** | **EVALUATE** | 3-7/10 | N/A | None (reference only) |
| 1 | **PyNvVideoCodec** | **EVALUATE** | 5/10 | 2-3 days | CPU-origin frames |
| 4 | **Style transfer** | **HOLD** | 4/10 | 1-2 weeks | Untrained model, wrong priority |
| 2 | **WebTransport** | **HOLD** | 3/10 | 3-5 days | Safari, tunnels, fragmentation |

---

## Synergy Map

```
GStreamer Pipeline (7) ──────────────── AV1 NVENC (3)
     │  GStreamer's nvav1enc element      │
     │  is the natural AV1 encoder.       │
     │  Same appsrc -> encoder -> appsink │
     │  pattern, just swap element.       │
     │                                    │
     ├── Selkies Reference (5)            │
     │   Design patterns extracted        │
     │   from Selkies directly inform     │
     │   GStreamer encoder config.        │
     │                                    │
     ├── PyNvVideoCodec (1)               │
     │   If NvFBC capture is active,      │
     │   GStreamer's cudaupload +          │
     │   cudaconvert + nvh264enc          │
     │   achieves the same zero-copy      │
     │   benefit without PyNvVideoCodec.  │
     │                                    │
     └── Safari Automation (6)            │
         Grader measures the quality      │
         delta from encoding changes.     │
         Without the grader, encoding     │
         improvements cannot be           │
         objectively verified.            │
                                          │
WebTransport (2) ──── Independent ────────┘
     Not synergistic with other directions.
     Requires different transport layer.

Style Transfer (4) ──── Independent
     Orthogonal to encoding/transport.
     Would run between CARLA capture
     and encoding, adding latency.
```

**Strongest synergy pair:** GStreamer (7) + Safari Automation (6). GStreamer changes the encoding pipeline; the grader measures whether the change improved or degraded visual quality. This is the build-measure-learn loop.

**Second strongest synergy:** GStreamer (7) + AV1 NVENC (3). GStreamer's `nvav1enc` element uses the same `appsrc -> encoder -> appsink` pattern as `nvh264enc`. Once the GStreamer encoder is integrated, adding AV1 is a single element swap with runtime GPU capability detection.

**Anti-synergy:** WebTransport (2) + everything else. WebTransport changes the transport layer, which is orthogonal to encoding improvements and requires tunnel infrastructure changes that conflict with the current deployment model.

---

## Top 3 Directions to Implement Next

### Priority 1: Safari Gameplay Automation (Direction 6)

**Why first:** The grader provides the objective quality baseline needed to evaluate all subsequent changes. Without it, every encoding or pipeline change is a hypothesis, not a verified improvement. This directly addresses the "Coding Blind" and "Written != Working" meta-rules in CLAUDE.md.

**Implementation steps:**
1. Run `v3/test/run_test.sh --ws ws://localhost:8765 --grade --html` against the current deployment.
2. Capture baseline quality scores (sharpness, colorfulness, HUD visibility, frozen frames).
3. Store the baseline report as `v3/test-results/baseline/`.
4. Run the grader after every subsequent change to track quality deltas.

**Definition of done:** A baseline quality report exists with per-frame scores and an HTML visualization. The grader runs successfully on at least 30 screenshots from a 60-second gameplay session.

### Priority 2: GStreamer In-Process Encoding (Direction 7)

**Why second:** This is the highest-impact encoding change. It eliminates 2-5ms per frame of IPC overhead, enables dynamic bitrate (no subprocess restart), and provides force-keyframe for instant client recovery. The PoC and library code are substantially complete.

**Implementation steps:**
1. Add GStreamer to Docker image: `conda install -c conda-forge gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad pygobject`
2. Copy `gstreamer_poc.py` to the Vast.ai instance and verify `nvh264enc` is available: `gst-inspect-1.0 nvh264enc`
3. Run `gstreamer_poc.py --compare` to measure latency difference vs FFmpeg subprocess on the actual hardware.
4. Create `v3/server/gstreamer_encoder.py` as a drop-in replacement for `nvenc_encoder.py`, using the `GStreamerEncoder` class from the library.
5. Update `race_server.py` to use `GStreamerEncoder` with fallback to `NVENCEncoder`.
6. Run the Safari grader (Priority 1) before and after to verify quality is maintained.

**Definition of done:** The GStreamer encoder is the primary encoding path on the Vast.ai instance. The grader shows quality >= baseline. Server logs show dynamic bitrate changes completing in <1ms (vs 200ms+ subprocess restart).

### Priority 3: AV1 Codec Negotiation Protocol (Direction 3)

**Why third:** The protocol change is low-risk and low-effort (1 day), and prepares the system for AV1 deployment when RTX 4090 instances become cost-effective. The code snippets in the research report are production-ready.

**Implementation steps:**
1. Add `supported_codecs` field to the client handshake message: `["av1", "h264"]` or `["h264"]`.
2. Add browser capability detection using `VideoDecoder.isConfigSupported()` for `av01.0.08M.08`.
3. Add server-side GPU codec detection: probe `av1_nvenc` in FFmpeg encoders list.
4. Add `codec` field to `handshake_ack` response.
5. On RTX 3090, server always responds `"codec": "h264"` (AV1 unavailable). No behavior change.
6. When deployed on RTX 4090, server responds `"codec": "av1"` for capable clients.
7. Update `nvenc_encoder.py` (or `gstreamer_encoder.py`) to accept a `codec` parameter.

**Definition of done:** The handshake protocol carries codec negotiation fields. On RTX 3090, the system behaves identically to today. The `av1_decode_test.html` page confirms client AV1 support detection works.

---

## Recommended Implementation Sequence (3 Sessions)

### Session 1: Measurement Foundation
- Run the Safari grader on the current deployment (baseline).
- Fix any grader issues (safaridriver setup, screenshot capture timing).
- Document baseline scores in a structured format.
- **Time budget:** 2-3 hours
- **Outcome:** Objective quality baseline exists. All future changes can be measured.

### Session 2: Encoding Pipeline Upgrade
- Install GStreamer in Docker image (conda-forge).
- Verify nvh264enc on Vast.ai instance.
- Run PoC benchmark (`gstreamer_poc.py --compare`).
- Integrate `GStreamerEncoder` into `race_server.py`.
- Re-run grader. Verify quality >= baseline.
- Deploy and gameplay test.
- **Time budget:** 4-6 hours
- **Outcome:** In-process NVENC encoding with dynamic bitrate and force-keyframe. 2-5ms latency reduction per frame.

### Session 3: Codec Future-Proofing
- Add codec negotiation to handshake protocol (client + server).
- Add `av1_decode_test.html` capability detection.
- Add GPU codec probe on server startup.
- Test on RTX 3090 (should negotiate H.264, no behavior change).
- If RTX 4090 instance is available, test AV1 NVENC end-to-end.
- Re-run grader.
- **Time budget:** 3-4 hours
- **Outcome:** Protocol supports codec negotiation. AV1 is ready to activate when RTX 4090 becomes the default GPU.

---

## Appendix: Artifacts Inventory

| File | Lines | Direction | Status |
|---|---|---|---|
| `v3/scripts/bench_pynvvideocodec.py` | 727 | 1. PyNvVideoCodec | Benchmark ready, not run on hardware |
| `v3/scripts/av1_codec_benchmark.py` | 191 | 3. AV1 NVENC | Benchmark ready, not run on hardware |
| `v3/scripts/av1_decode_test.html` | 65 | 3. AV1 NVENC | Client-side detection page, ready to deploy |
| `v3/docs/RESEARCH_AV1_NVENC_GAME_STREAMING.md` | 636 | 3. AV1 NVENC | Complete research report |
| `v3/scripts/gstreamer_poc.py` | 1081 | 7. GStreamer | PoC with benchmark + WebSocket demo |
| `v3/docs/RESEARCH_GSTREAMER_SELKIES.md` | 522 | 5. Selkies / 7. GStreamer | Complete research report |
| `v3/poc/webtransport/server.py` | 298 | 2. WebTransport | Working PoC server |
| `v3/poc/webtransport/client.html` | 385 | 2. WebTransport | Working PoC client |
| `v3/poc/webtransport/setup.sh` | 64 | 2. WebTransport | Setup script |
| `v3/poc/webtransport/README.md` | 62 | 2. WebTransport | Documentation |
| `v3/lib/game-streamer/game_streamer.py` | 1149 | 7. GStreamer | Pip-installable library |
| `v3/lib/game-streamer/benchmark.py` | 316 | 7. GStreamer | Comparison benchmark |
| `v3/lib/game-streamer/pyproject.toml` | 48 | 7. GStreamer | Package config |
| `v3/test/grader.py` | 886 | 6. Safari automation | Screenshot quality grader |
| `v3/test/run_test.sh` | 389 | 6. Safari automation | CI test runner |
| `v3/research/neural_enhance/poc_c_style_transfer.py` | 488 | 4. Style transfer | PoC with untrained model |
| `v3/docs/ROADMAP_VISUAL_QUALITY.md` | 267 | Context | Visual quality roadmap |
