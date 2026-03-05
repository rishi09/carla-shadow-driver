# Shadow Driver v3 — Road to Forza-Quality Cloud Streaming

## North Star: Forza Horizon 5 (Xbox Cloud Gaming)

Forza Horizon 5 on xCloud achieves:
- 1080p60 with HDR
- ~40-60ms total input-to-pixel latency
- Bloom, volumetric lighting, godrays, wet road reflections
- Advanced post-processing (motion blur, DoF, lens flare)
- Physical-based rendering with high-quality assets

**Our achievable target**: Match the visual STYLE (lighting, atmosphere, post-processing) even though CARLA's assets are lower-fidelity than Forza's hand-crafted art. With the right engine settings + encoding pipeline, we can look like "a very good indie racing game" rather than "a research simulator."

---

## Current State (Test 3: 6/10 Gemini)

| Component | Current | Problem |
|-----------|---------|---------|
| **Rendering** | 1920x1080 Epic quality | Bloom OFF, AO OFF in DefaultEngine.ini. Our bloom_intensity setting does nothing. |
| **Encoding** | JPEG q80 at 720p | NVENC broken (5 frames), falling back to JPEG with downscale. Blocky artifacts. |
| **Connection** | SSH tunnel, 155ms RTT | TCP-over-TCP retransmission storms. 5-7x the playable threshold for racing. |
| **Client** | WebGL2 passthrough | All shader effects disabled. No contrast, no saturation, no depth. |
| **HUD** | Partial | Input bars, countdown, AI visibility all broken. |

---

## Implementation Tiers

### Tier 1: Quick Wins (2-3 hours, massive impact)

#### 1A. Fix NVENC H.264 Encoding
**File:** `v3/server/nvenc_encoder.py`

Add `-surfaces 1 -delay 0` to FFmpeg command. These two flags fix the encoder starvation.

```python
# Add before '-g', '60':
'-surfaces', '1',       # Reduce pipeline depth to 1 frame (was 4+)
'-delay', '0',          # No output delay
```

Also add at the duplicate command (~line 262):
```python
'-surfaces', '1',
'-delay', '0',
```

**Why it matters:**
- NVENC at 10 Mbps looks dramatically better than JPEG q80
- Native 1080p (no 720p downscale)
- Temporal compression = no per-frame blocking artifacts
- Single biggest visual quality improvement

**Source:** Sunshine (LizardByte/Sunshine) uses identical settings: `surfaces=1, delay=0, zerolatency=1, tune=ull, rc=cbr, forced-idr=1`

#### 1B. Patch CARLA DefaultEngine.ini
**File:** `v3/docker/entrypoint.sh` (add before CARLA launch)

```bash
# Patch DefaultEngine.ini for visual quality
INI="/home/carla/CarlaUE4/Config/DefaultEngine.ini"
if [ -f "$INI" ]; then
    sed -i 's/r.DefaultFeature.Bloom=False/r.DefaultFeature.Bloom=True/' "$INI"
    sed -i 's/r.DefaultFeature.AmbientOcclusion=False/r.DefaultFeature.AmbientOcclusion=True/' "$INI"
    sed -i 's/r.DefaultFeature.AntiAliasing=2/r.DefaultFeature.AntiAliasing=1/' "$INI"
    grep -q 'r.ScreenPercentage' "$INI" || \
        sed -i '/\[\/Script\/Engine.RendererSettings\]/a r.ScreenPercentage=125' "$INI"
    echo "[entrypoint] DefaultEngine.ini patched (bloom, AO, FXAA, 125% supersampling)"
fi
```

**What each setting does:**
- `Bloom=True` — Warm lighting glow on headlights, streetlights, sun reflections. Currently OFF, making our bloom_intensity=0.4 camera setting completely ignored.
- `AmbientOcclusion=True` — Contact shadows where objects meet surfaces. Adds depth perception and realism. Currently OFF.
- `AntiAliasing=1` — Switches from TAA (broken on Linux camera sensors, GitHub #6986) to FXAA (works on captured frames). Fixes jagged edges on car hood and road edges.
- `ScreenPercentage=125` — Renders at 2400x1350, downsamples to 1080p. Start at 125%, bump to 150% if FPS stays at 30.

#### 1C. Direct WebSocket Connection (No Tunnel)
**Files:** `v3/docker/entrypoint.sh`, `v3/api/gpu/start.ts`

Inside the container, read `$VAST_TCP_PORT_8765` (the external mapped port) and `PUBLIC_IP`. Report `ws://IP:PORT` via callback. Connect from localhost dev server (`http://localhost:5173`).

Expected latency drop: 155ms → 15-30ms RTT (US domestic).

#### 1D. Fix 3 Missing HUD Elements
- **Input bars**: Verify `player.throttle` arrives in first telemetry message
- **Countdown**: Ensure telemetry loop starts before countdown timer, extend countdown to 5s
- **AI visibility**: Remove `if player_telem and ai_telem:` guard on `update_ai()` — update AI position independently

#### 1E. Client-Side Color Enhancement
**File:** `v3/src/components/WebGLCanvas.tsx`

Safe to re-enable at any latency (pure post-decode adjustments):
```glsl
float contrast = 1.08;    // was 1.0 — punchier midtones
float saturation = 1.10;  // was 1.0 — richer colors
```

---

### Tier 2: Medium Effort, High Reward (Tonight/Tomorrow)

#### 2A. CARLA Cinematic Post-Processing
**File:** `v3/server/carla_manager.py`

Switch default preset from "balanced" to "cinematic". Add atmospheric scattering:

```python
# In set_time_of_day() for all presets:
weather.scattering_intensity = 0.5      # atmospheric haze/depth
weather.mie_scattering_scale = 0.03     # sun glare/godrays
weather.precipitation_deposits = 30.0   # wet road reflections (even clear weather)
weather.wetness = 20.0                  # subtle road sheen
```

Add tone mapping attributes to cinematic preset:
```python
'cinematic': {
    # ... existing settings ...
    'slope': '0.88',          # S-curve steepness
    'toe': '0.55',            # Dark crush
    'shoulder': '0.26',       # Bright rolloff
    'temp': '5800.0',         # Slightly warm color temperature (Forza-like)
}
```

#### 2B. Re-enable WebRTC Data Channel for Direct Connections
**Files:** `v3/src/hooks/useGPUConnection.ts`, `v3/server/race_server.py`

Already fully implemented, disabled only for tunnel compat. When connecting via direct `ws://` URL (not `wss://` tunnel), auto-enable WebRTC DC for input. Input latency drops from ~30ms (WebSocket TCP) to ~15ms (UDP DataChannel).

#### 2C. WebCodecs `optimizeForLatency`
**File:** `v3/src/components/WebGLCanvas.tsx`

Add to VideoDecoder config:
```js
optimizeForLatency: true  // Tells browser to prefer immediate decode output
```

#### 2D. Verify NvFBC Zero-Copy Capture
**Check server logs** for NvFBC vs x11grab vs CARLA sensor fallback. If NvFBC is active, capture time is 1-2ms instead of 5-10ms.

#### 2E. Convert BGRA→NV12 Before NVENC Pipe
**File:** `v3/server/nvenc_encoder.py`

NVENC natively accepts NV12 (1.5 bytes/pixel) instead of BGRA (4 bytes/pixel). Converting before the pipe reduces write volume by 62% — from 8.3MB to 3.1MB per frame. Eliminates pipe backpressure.

```python
# In encode_frame(), before stdin write:
import cv2
nv12 = cv2.cvtColor(frame_bgra, cv2.COLOR_BGRA2YUV_I420)  # or NV12
```

Update FFmpeg input to `-pix_fmt nv12` or `-pix_fmt yuv420p`.

#### 2F. Latency-Adaptive Steering
**File:** `v3/server/carla_manager.py`

Server receives `latency_ms` from client on each control message. When RTT > 150ms, reduce `steer_limit` proportionally to prevent overcorrection wall-riding:

```python
# In apply_player_control():
latency_factor = max(0.3, 1.0 - (latency_ms - 80) / 300)  # 1.0 at 80ms, 0.3 at 280ms
effective_steer_limit = steer_limit * latency_factor
```

---

### Tier 3: Architectural Improvements

#### 3A. Direct NVENC API (Replace FFmpeg Subprocess)

**Why it's fundamentally superior:**

Our current pipeline:
```
CARLA GPU buffer → CPU copy (8.3MB) → Python stdin.write()
→ OS pipe (64KB buffer, 128 syscalls) → FFmpeg process
→ NVENC encode → FFmpeg stdout → OS pipe → Python read()
```

Professional pipeline (Sunshine/GFN/Parsec):
```
CARLA GPU buffer → NVENC GPU encode → encoded bytes in GPU memory → read
```

The difference is NOT incremental. It's 3-50ms vs 1-3ms encode latency, zero CPU memory copies, zero pipe overhead, zero process boundaries.

**Implementation:**
- Use `PyNvVideoCodec` (NVIDIA's official Python bindings) or `pynvenc`
- Replace `nvenc_encoder.py` subprocess with direct SDK calls
- Frame stays in GPU memory from CARLA render → NVENC encode
- ~100 lines of Python, replaces ~200 lines of subprocess management

#### 3B. Production TLS (Caddy Reverse Proxy)

**Why it's fundamentally superior to tunnels:**

Tunnel path: Browser → Cloudflare edge (hop 1, 30ms) → Cloudflare origin (hop 2, 50ms+) → Container
Direct path: Browser → Container (hop 1, 15-30ms)

Every packet saves 50-80ms each way. For a 30fps video stream, that's 50-80ms of freshness on every frame.

**Implementation:**
1. Buy a cheap domain ($2/yr from Namecheap)
2. Point DNS to Vast.ai instance IP (Cloudflare free DNS, or dynamic DNS)
3. Install Caddy in Docker container
4. Caddy auto-provisions Let's Encrypt TLS cert for `play.yourdomain.com`
5. `wss://play.yourdomain.com` → reverse proxy to `localhost:8765`

When instance IP changes (new rental), update DNS record via API.

#### 3C. CARLA Async Mode (Free the Event Loop)

**Why it matters:**

`carla.tick()` blocks the Python asyncio event loop for ~33ms. During that time, zero WebSocket messages can be sent or received. Moving CARLA to async mode or running the tick in a separate process frees the event loop to handle I/O continuously.

**Implementation:**
- Option A: Run CARLA in asynchronous mode (remove `synchronous_mode=True`), use sleep-based pacing
- Option B: Run CARLA tick in a separate process, communicate via shared memory for frames

---

## Visual Quality Stack: Current vs Target

| Layer | Current | Target (Forza-inspired) | Fix |
|-------|---------|------------------------|-----|
| **UE4 Engine** | Bloom OFF, AO OFF, TAA broken | Bloom ON, AO ON, FXAA, 125-150% supersampling | entrypoint.sh patch |
| **CARLA Camera** | balanced preset (bloom=0.4, light motion blur) | cinematic (bloom=0.5, DoF, motion blur, lens flare) | carla_manager.py |
| **Weather** | Default clear noon | Atmospheric scattering, wet road sheen, warm color temp | carla_manager.py |
| **Encoding** | JPEG q80, 720p, per-frame artifacts | H.264 10Mbps, 1080p, temporal compression | nvenc_encoder.py |
| **Transport** | SSH tunnel, 155ms, TCP-over-TCP | Direct WS, 15-30ms | entrypoint.sh + start.ts |
| **Client Shader** | All effects disabled | Contrast 1.08, saturation 1.10, subtle vignette | WebGLCanvas.tsx |

---

## Expected Outcome

After Tier 1 + 2 (all achievable in one session):
- **Resolution**: 720p JPEG → 1080p H.264
- **Latency**: 155ms → 15-30ms
- **Rendering**: Flat/aliased → Bloom, AO, FXAA, supersampled
- **Atmosphere**: Default clear → Atmospheric scattering, wet reflections
- **Color**: Washed out → Punchy contrast, warm tones
- **FPS**: 21-30 → 30 stable (H.264 is more efficient than JPEG)
- **Gemini target**: 6/10 → 8+/10

The gap between this and Forza will be:
1. Asset quality (CARLA's car models and textures are research-grade, not AAA)
2. Ray tracing (CARLA 0.9.15 doesn't support it)
3. HDR (browser WebGL doesn't support HDR output well)

These are hard limits of the CARLA simulator, not our streaming pipeline.

---

## Sources

- Sunshine source: `LizardByte/Sunshine/src/video.cpp` — NVENC settings, capture pipeline, latency tracking
- CARLA DefaultEngine.ini: `carla-simulator/carla/0.9.15/Unreal/CarlaUE4/Config/DefaultEngine.ini`
- CARLA GitHub #8317: DefaultEngine.ini patch for camera quality
- CARLA GitHub #6986: Linux TAA aliasing bug in camera sensor output
- CARLA GitHub #5894: ScreenPercentage not exposed via Python API
- Cloud gaming research: `v3/docs/RESEARCH_CLOUD_GAMING_LATENCY.md`
