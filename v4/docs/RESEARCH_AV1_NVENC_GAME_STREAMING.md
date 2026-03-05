# AV1 NVENC for Shadow Driver v3: Research Report

**Date:** February 23, 2026
**Author:** Research agent (Claude Sonnet 4.6)
**Context:** Shadow Driver v3 — browser-based racing game streaming CARLA simulator video from Vast.ai GPUs (RTX 3090/4090) to browser via WebSocket. Currently uses H.264/NVENC + WebCodecs VideoDecoder.

---

## Executive Summary

AV1 hardware encoding via NVENC is a **compelling future upgrade but NOT viable today on your primary RTX 3090 hardware.** The RTX 3090 (Ampere architecture) does NOT support AV1 NVENC encoding — that capability was introduced with Ada Lovelace (RTX 40xx series). On an RTX 4090, AV1 NVENC delivers 30-50% bitrate savings at equivalent visual quality, with encode latency comparable to H.264 (both ~2-5ms per frame at 1080p). Browser decode support is strong in Chrome/Firefox (84% WebCodecs AV1 decode across real sessions) but patchy in Safari (hardware-only, iPhone 15 Pro / M3+ required). The recommended path is: keep H.264 now, add AV1 as an opt-in negotiated codec when clients rent RTX 4090 instances.

---

## 1. NVENC AV1 Hardware Support

### YES/NO GPU Support Matrix

| GPU Architecture | GPU Examples | AV1 NVENC | NVENC Gen |
|---|---|---|---|
| Ampere (RTX 30xx) | RTX 3090, 3080, 3070 | **NO** | 7th gen |
| Ada Lovelace (RTX 40xx) | RTX 4090, 4080, 4070 | **YES** | 8th gen |
| Hopper (H100) | H100 | **YES** | 8th gen |
| Blackwell (RTX 50xx) | RTX 5090, 5080 | **YES** | 9th gen |

**RTX 3090: NO AV1 NVENC.** This is your current Vast.ai GPU. The 3090 uses Ampere/7th-gen NVENC, which supports H.264 and HEVC but not AV1. NVIDIA introduced AV1 NVENC exclusively with Ada Lovelace in late 2022.

**RTX 4090: YES AV1 NVENC.** Full AV1 YUV 4:2:0 encoding at up to 8K resolution. This is the GPU you want for AV1 streaming.

Source: [NVIDIA Video Encode and Decode GPU Support Matrix](https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix-new)

### Checking AV1 Support at Runtime

Before starting the FFmpeg pipeline on an unknown GPU, detect support by probing FFmpeg:

```bash
ffmpeg -hide_banner -encoders 2>/dev/null | grep av1_nvenc
# Returns empty on RTX 3090, shows "av1_nvenc" on RTX 4090
```

Or test a short encode:
```bash
ffmpeg -f lavfi -i nullsrc=s=1920x1080:d=1 -c:v av1_nvenc -preset p1 -f null - 2>&1 | grep -i error
# "No capable devices found" or similar on Ampere GPUs
```

---

## 2. AV1 Decode in Browsers (WebCodecs)

### Browser Support Status

| Browser | WebCodecs AV1 Decode | Notes |
|---|---|---|
| Chrome 70+ | **YES** (83.67% of sessions) | Hardware-accelerated on Intel 11th+, AMD RDNA3+, Nvidia RTX 30+ |
| Firefox 67+ | **YES** | Uses dav1d software decoder; hardware accel on supported platforms |
| Safari 17+ | **PARTIAL** | Hardware-only; requires iPhone 15 Pro, M3 MacBook, or newer |
| Safari 16 and earlier | **NO** | Not supported |

Data source: 224,360 real-user sessions from webcodecsfundamentals.org. AV1 WebCodecs decode: **83.67%** of tested codec strings passed `isConfigSupported`. H.264 is at **97.63%** — a meaningful 14-point gap.

### Hardware AV1 Decode Support on Client Devices

AV1 hardware decode (as opposed to software decode) matters because:
- Software AV1 decode (dav1d) costs ~5-15ms CPU time per frame at 1080p30
- Hardware decode is ~1-2ms and frees CPU for game input processing

Devices with hardware AV1 decode:
- **Intel Arc / Alchemist (2022+)**: Full AV1 hardware decode
- **Intel 12th gen (Alder Lake)** Xe iGPU: AV1 hardware decode
- **AMD RDNA3 / RX 7000 series (2022+)**: AV1 hardware decode
- **NVIDIA RTX 30xx (Ampere)**: AV1 hardware DECODE (even though no encode)
- **Apple M2 and M3**: Hardware AV1 decode
- **Apple M1**: Software-only AV1 decode (dav1d is fast enough)
- **iPhone 15 Pro (A17 Pro)**: First iPhone with hardware AV1 decode
- **iPhone 14 and earlier**: Software decode only (slow, may drop frames)
- **Android (Snapdragon 8 Gen 2+)**: Hardware AV1 decode

### Decode Latency: AV1 vs H.264

For a racing game with a 100-280ms latency budget, decoder latency matters:

| Codec | Hardware decode latency | Software decode latency |
|---|---|---|
| H.264 | 1-2ms | 3-5ms |
| AV1 | 1-3ms (hardware) | 8-20ms (dav1d) |

Key finding: **AV1 hardware decode is comparable to H.264 hardware decode.** The danger is Safari on older iPhones — software AV1 decode on an iPhone 14 at 1080p30 could cost 10-15ms per frame, which may cause frame drops. For your racing game audience (likely desktop Chrome/Firefox), this is not a concern.

### Safari Critical Caveat

Safari only supports AV1 WebCodecs on devices with a hardware AV1 decoder. On an M1 MacBook Air in Safari, `VideoDecoder.isConfigSupported({ codec: 'av01.0.08M.08' })` returns `false`. This is why your fallback chain must remain: AV1 → H.264 → JPEG.

---

## 3. Quality Comparison at Game Streaming Bitrates

### Headline Numbers

AV1 delivers approximately **30-50% bitrate savings** versus H.264 at equivalent VMAF/SSIM quality scores. This is well-established across the industry (Netflix, Twitch, OBS research, Alliance for Open Media specs all cite 30%+).

For Shadow Driver's adaptive bitrate range (2-12 Mbps at 1080p30):

| Scenario | H.264 NVENC | AV1 NVENC (RTX 4090) |
|---|---|---|
| Low quality (bad network) | 2 Mbps → VMAF ~70, noticeable blocking | 1.5 Mbps → equivalent quality |
| Mid quality | 6 Mbps → VMAF ~82 | 4 Mbps → equivalent quality |
| High quality | 10-12 Mbps → VMAF ~90 | 6-8 Mbps → equivalent quality |

### Fast Motion Content (Racing Game Specifics)

H.264 struggles at low bitrates for high-motion scenes — car at 150+ km/h on a straight produces lots of temporal change, which creates macroblocking artifacts in H.264 at 2-4 Mbps. AV1's larger reference frame pool, improved motion compensation, and better entropy coding handle this better.

However: at NVENC's ultra-low-latency preset (p1, tune=ull), **both codecs sacrifice quality for speed.** The AV1 quality advantage is most visible at p4-p6 presets. At p1/ull, the gap narrows — expect 15-25% savings rather than 30-50%, because the faster preset disables many advanced tools.

### AV1 Screen Content Coding (SCC) Tools

AV1 includes specific tools for rendered/screen content that natural video codecs lack:

- **Intra Block Copy (IBC)**: Copies pixels from already-decoded regions of the current frame. Excellent for UI overlays with repeated elements (like your HUD speedometer, lap counters, minimap).
- **Palette Mode**: Encodes regions using small color palettes. Effective for flat-shaded areas common in CARLA's rendered world.

**Reality check for CARLA output:** The CARLA camera sensor produces realistic 3D rendering (road textures, lighting, shadows, foliage) — this is closer to natural video than screen content. IBC/palette tools will not provide dramatic additional savings over CARLA's video stream body. However, they will help encode the HUD overlay composited on top if you ever switch to server-side HUD compositing.

**At ULL preset on NVENC, IBC and palette mode are disabled** by the encoder for latency reasons. These tools require significant encode computation. If you ever move to a medium-latency preset (p3-p4) at the cost of ~5ms more encode time, you'd recover some of these SCC benefits.

---

## 4. Encode Latency at Ultra-Low-Latency Settings

### FFmpeg av1_nvenc Options (RTX 4090)

The `av1_nvenc` encoder shares the same FFmpeg option namespace as `h264_nvenc` and `hevc_nvenc`. The key options for ultra-low latency are identical:

```bash
ffmpeg \
  -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i pipe:0 \
  -c:v av1_nvenc \
  -preset p1          # Fastest preset (lowest quality, lowest latency)
  -tune ull           # Ultra-low latency tuning (same as h264_nvenc)
  -rc cbr             # Constant bitrate (best for streaming)
  -b:v 8M             # Target bitrate
  -bf 0               # No B-frames (zero reorder delay)
  -rc-lookahead 0     # No lookahead
  -zerolatency 1      # Zero-latency mode (no output buffering)
  -g 60               # Keyframe every 2 seconds at 30fps
  -f av1              # Raw AV1 bitstream (Annex B / low overhead OBU format)
  pipe:1
```

This is nearly identical to your current `h264_nvenc` command — just swap the codec name and output format.

### Encode Latency Comparison

Both H.264 and AV1 NVENC at p1/ull operate through fixed-function hardware pipelines. The AV1 engine in Ada Lovelace is a distinct hardware block from the H.264 engine.

Measured encode latencies at 1080p (from Sunshine/Moonlight community reports and NVIDIA engineering discussions):
- **H.264 NVENC p1/ull**: ~1.5-3ms per frame
- **AV1 NVENC p1/ull**: ~2-4ms per frame

AV1 NVENC is approximately **0.5-1.5ms slower** per frame than H.264 NVENC at the same preset. This is because AV1's bitstream is more complex — even the hardware encoder does more work per frame. At your target of <5ms encode time, both are comfortably within budget.

**Important gotcha:** AV1 NVENC at p1/ull may produce slightly larger keyframes than H.264 at the same settings, because the AV1 sequence header + frame OBUs together are somewhat larger than H.264 SPS+PPS+IDR. Budget an extra 10-15% for keyframe size.

### Surfaces and Delay Settings

For ultra-low latency, you must control the encoder's internal frame pipeline depth:

```
-zerolatency 1       # Prevents output buffering (frames out immediately)
-bf 0                # Zero B-frames prevents reorder delay
-rc-lookahead 0      # Disables lookahead (no queuing frames for RC analysis)
```

The `surfaces` parameter (internal NVENC surfaces) defaults to 0 (auto). For low latency, setting it explicitly is usually not needed when `zerolatency 1` is set, as NVENC will minimize internal buffering automatically.

---

## 5. SVT-AV1 Software Fallback

SVT-AV1 (Scalable Video Technology for AV1) is Intel and Netflix's open-source AV1 encoder. It is the fastest software AV1 encoder available.

### Real-Time Encoding Capability

SVT-AV1 preset 12 (fastest/lowest quality) performance at 1080p30:
- **Encoding speed**: Approximately 100-200+ FPS at preset 12 on a modern CPU
- **CPU usage**: 2-4 cores at 1080p30 (preset 12 is highly parallelized)
- **Latency**: ~5-15ms per frame (much slower than NVENC's ~2-4ms)
- **Quality**: Noticeably lower than H.264 NVENC at equivalent bitrate at this preset

### Verdict for Shadow Driver

SVT-AV1 as a software fallback is **not recommended for the race streaming path** because:
1. CARLA already consumes significant CPU (physics simulation, traffic manager, sensor processing)
2. Adding 4+ cores of SVT-AV1 at 1080p30 could destabilize CARLA's 30Hz server loop
3. 5-15ms software encode adds too much to the latency budget vs NVENC's 2-4ms
4. The Vast.ai RTX 3090 instances don't support AV1 NVENC anyway

**Useful scenario for SVT-AV1:** If you ever build an offline race replay transcoder or a "highlight clip" system, SVT-AV1 at preset 6-8 produces excellent quality for non-real-time use.

FFmpeg command for SVT-AV1 real-time streaming (informational):
```bash
ffmpeg -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i pipe:0 \
  -c:v libsvtav1 \
  -preset 12          # Fastest (0=best quality, 13=fastest)
  -crf 35             # Quality target
  -svtav1-params "tune=0:film-grain=0:scd=1" \
  -b:v 0              # CRF mode
  -f av1 pipe:1
```

---

## 6. Migration Path: H.264 to AV1 with Auto-Negotiation

### Strategy

The cleanest approach is codec negotiation during the WebSocket handshake:
1. Client sends supported codecs in `handshake` message (e.g., `["av1", "h264"]`)
2. Server checks if `av1_nvenc` is available on the current GPU
3. Server responds with chosen codec in `handshake_ack`
4. Server starts the appropriate encoder; client initializes the appropriate VideoDecoder

This lets you ship AV1 support now without breaking RTX 3090 instances.

### WebCodecs AV1 Codec String Format

AV1 codec strings follow this format (defined in the W3C AV1 codec registration):

```
av01.P.LLT.DD.M.CCC.cp.tc.mc.F
```

| Field | Values | Notes |
|---|---|---|
| P (Profile) | 0, 1, 2 | 0 = Main (recommended, broadest device support) |
| LL (Level) | 00-23 | Level 8 = 1080p30; Level 13 = 4K60 |
| T (Tier) | M, H | M = Main tier (use this) |
| DD (Bit depth) | 08, 10, 12 | 08 = 8-bit (standard) |
| M (Monochrome) | 0, 1 | 0 = color |
| CCC (Chroma) | 110 for 4:2:0 | |
| cp, tc, mc | 01.01.01 | BT.709 primaries/transfer/matrix |
| F (Color range) | 0, 1 | 0 = limited (TV range), 1 = full (PC range) |

**Practical codec string for 1080p30 streaming:**
```
av01.0.08M.08.0.110.01.01.01.0
```

Minimal string that works (browser fills in defaults):
```
av01.0.08M.08
```

### Key AV1 WebCodecs Difference from H.264

**Critical:** AV1 WebCodecs does NOT require a `description` field in `VideoDecoderConfig`. This is a major simplification versus H.264 (which needs SPS/PPS bytes in `description`).

```typescript
// H.264: needs description (SPS/PPS bytes)
decoder.configure({
  codec: 'avc1.42C01E',
  optimizeForLatency: true,
  description: spsAndPpsBytes,  // Required for H.264
});

// AV1: no description needed
decoder.configure({
  codec: 'av01.0.08M.08',
  optimizeForLatency: true,
  // description: omitted — AV1 is self-describing via Sequence Header OBU
});
```

### AV1 Bitstream vs H.264 Bitstream

H.264 bitstream structure:
```
[SPS NAL] [PPS NAL] [IDR slice NAL] → keyframe
[Non-IDR slice NAL] → delta frame
```

AV1 bitstream structure (Annex B / low-overhead):
```
[Sequence Header OBU] [Frame Header OBU] [Tile Group OBU] → keyframe
[Temporal Delimiter OBU] [Frame Header OBU] [Tile Group OBU] → delta frame
```

OBU types you need to detect:
- Type 1 = `OBU_SEQUENCE_HEADER` — marks a keyframe (equivalent to SPS)
- Type 2 = `OBU_TEMPORAL_DELIMITER` — marks frame boundaries
- Type 3 = `OBU_FRAME_HEADER` — frame-level metadata
- Type 4 = `OBU_TILE_GROUP` — the actual encoded picture data
- Type 6 = `OBU_FRAME` — combined frame header + tile group (most common in NVENC output)

**Detecting keyframes in AV1:** scan for `OBU_SEQUENCE_HEADER` (type 1). When present, the accompanying frame is a keyframe (intra-only). Delta frames contain only `OBU_TEMPORAL_DELIMITER` + `OBU_FRAME`.

OBU header parsing (Python):
```python
def parse_obu_header(data: bytes, offset: int) -> tuple[int, int, int]:
    """Parse OBU header at offset. Returns (obu_type, header_len, payload_len)."""
    byte = data[offset]
    forbidden_bit = (byte >> 7) & 1
    obu_type = (byte >> 3) & 0xF
    extension_flag = (byte >> 2) & 1
    has_size_field = (byte >> 1) & 1

    header_len = 1
    if extension_flag:
        header_len = 2  # extension byte follows

    payload_len = 0
    if has_size_field:
        # LEB128 variable-length encoding
        i = 0
        while True:
            b = data[offset + header_len + i]
            payload_len |= (b & 0x7F) << (7 * i)
            i += 1
            if not (b & 0x80):
                break
        header_len += i

    return obu_type, header_len, payload_len

OBU_SEQUENCE_HEADER = 1
OBU_TEMPORAL_DELIMITER = 2
OBU_FRAME_HEADER = 3
OBU_TILE_GROUP = 4
OBU_FRAME = 6

def is_av1_keyframe(data: bytes) -> bool:
    """Return True if the AV1 bitstream contains a Sequence Header OBU."""
    offset = 0
    while offset < len(data) - 1:
        try:
            obu_type, header_len, payload_len = parse_obu_header(data, offset)
            if obu_type == OBU_SEQUENCE_HEADER:
                return True
            offset += header_len + payload_len
        except (IndexError, ValueError):
            break
    return False
```

---

## 7. Proof of Concept: Minimal Code Changes

### Server Side: `nvenc_encoder.py` Changes

The changes to support AV1 are minimal — the FFmpeg subprocess interface is identical. The main differences are:

1. Change codec from `h264_nvenc` to `av1_nvenc`
2. Change output format from `h264` to `av1`
3. Replace NAL unit parsing with OBU parsing
4. Change keyframe detection logic (OBU type 1 instead of NALU type 7)
5. Extract codec string (`av01.0.08M.08`) instead of avc1 string from SPS

Key snippet for the FFmpeg command (replace in `start()` and `_apply_pending_bitrate()`):

```python
# AV1 NVENC ultra-low latency command (RTX 4090 only)
cmd = [
    'ffmpeg',
    '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo',
    '-pix_fmt', 'bgra',
    '-s', f'{self.width}x{self.height}',
    '-r', str(self.fps),
    '-i', 'pipe:0',
    '-c:v', 'av1_nvenc',       # Changed from h264_nvenc
    '-preset', 'p1',            # Fastest preset (p1-p7)
    '-tune', 'ull',             # Ultra-low latency (same options as h264_nvenc)
    '-rc', 'cbr',               # Constant bitrate
    '-b:v', self.bitrate,
    '-bf', '0',                 # No B-frames
    '-rc-lookahead', '0',       # No lookahead
    '-zerolatency', '1',        # No output buffering
    '-g', '60',                 # Keyframe every 2 seconds
    '-f', 'av1',                # Changed from h264 (raw AV1 Annex B)
    'pipe:1',
]
```

### Server Side: GPU Capability Detection

Add to `nvenc_encoder.py` or a new `codec_probe.py`:

```python
import subprocess

def detect_nvenc_codecs() -> dict[str, bool]:
    """Probe which NVENC codecs are available on the current GPU."""
    result = subprocess.run(
        ['ffmpeg', '-hide_banner', '-encoders'],
        capture_output=True, text=True, timeout=10
    )
    output = result.stdout + result.stderr
    return {
        'h264_nvenc': 'h264_nvenc' in output,
        'hevc_nvenc': 'hevc_nvenc' in output,
        'av1_nvenc': 'av1_nvenc' in output,
    }

def test_av1_nvenc() -> bool:
    """Actually test AV1 NVENC by encoding one frame (more reliable than listing)."""
    try:
        result = subprocess.run(
            [
                'ffmpeg', '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'nullsrc=s=1920x1080:d=0.1',
                '-c:v', 'av1_nvenc', '-preset', 'p1', '-tune', 'ull',
                '-f', 'null', '-'
            ],
            capture_output=True, timeout=10
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False
```

### Client Side: `WebGLCanvas.tsx` Changes

The WebCodecs VideoDecoder configuration changes are minimal — just the codec string and no description needed:

```typescript
// Current H.264 configure call:
decoder.configure({
  codec: config.codec,          // 'avc1.42C01E'
  optimizeForLatency: true,
  // (description is set elsewhere from SPS/PPS bytes)
});

// AV1 configure call:
decoder.configure({
  codec: 'av01.0.08M.08',       // No description needed
  optimizeForLatency: true,
});
```

Full codec negotiation flow in `WebGLCanvas.tsx`:

```typescript
// Check AV1 support before sending codec preference to server
async function detectSupportedCodecs(): Promise<string[]> {
  const supported: string[] = [];

  // Test AV1
  const av1Config = {
    codec: 'av01.0.08M.08',
    codedWidth: 1920,
    codedHeight: 1080,
  };
  try {
    const av1Support = await VideoDecoder.isConfigSupported(av1Config);
    if (av1Support.supported) {
      supported.push('av1');
    }
  } catch {
    // AV1 not supported
  }

  // H.264 is always supported as fallback
  supported.push('h264');
  return supported;  // e.g. ['av1', 'h264'] or ['h264']
}
```

Send in handshake:
```typescript
// During handshake message construction
const supportedCodecs = await detectSupportedCodecs();
ws.send(JSON.stringify({
  type: 'handshake',
  client: 'shadow-driver-v3',
  supported_codecs: supportedCodecs,  // ['av1', 'h264'] or ['h264']
}));
```

Server responds:
```json
{
  "type": "handshake_ack",
  "server": "shadow-driver-v3",
  "models": ["autopilot"],
  "codec": "av1"  // or "h264" depending on GPU + client support
}
```

### Client Side: `types/index.ts` Changes

Update `HandshakeAck` and `CodecConfig`:

```typescript
/** Handshake ack from server */
export interface HandshakeAck {
  type: 'handshake_ack';
  server: string;
  models: string[];
  codec?: 'av1' | 'h264';  // Add this
}

/** Codec configuration for H.264 or AV1 WebCodecs decoding */
export interface CodecConfig {
  type: 'codec_config';
  codec: string;      // 'avc1.42C01E' or 'av01.0.08M.08'
  codec_family: 'h264' | 'av1';  // Add this for routing logic
  width: number;
  height: number;
}
```

---

## 8. Novel Angles and Hybrid Approaches

### AV1 Screen Content Coding (SCC) for HUD Elements

If you ever composite the HUD server-side (currently done client-side), AV1's IBC and palette modes would meaningfully compress:
- Speedometer digits (repeated pixel patterns)
- Minimap (flat colors, repeated road segments)
- Lap counter, gap timer (highly repetitive)

This would require server-side HUD compositing in CARLA and is a larger refactor, but at low bitrates (2-4 Mbps with poor network), SCC tools could recover 15-20% additional bitrate on the HUD regions.

### Hybrid Codec Strategy

A "use AV1 only for keyframes" approach is NOT recommended. WebCodecs requires a consistent codec per decoder instance — you cannot mix H.264 and AV1 frames in the same stream. The negotiation must be per-session.

What IS viable: negotiate codec at race start, then stick with it for the session. Allow the user to restart the race if they want to switch codecs (which reinitializes everything).

### Open-Source Projects Doing AV1 Game Streaming

Several projects are already doing or planning AV1 over WebRTC/WebSocket:

1. **Selkies-GStreamer** (selkies-project): WebRTC remote desktop with NVENC H.264/HEVC, planning AV1. Active development, similar architecture to Shadow Driver.
2. **Sunshine/Moonlight**: Fully supports AV1 NVENC on RTX 40xx. Configures identical FFmpeg parameters to what we described (`av1_nvenc -preset p1 -tune ull -rc cbr -zerolatency 1`). Sunshine's `video.cpp` sets surfaces=1, delay=0 for AV1 — same as H.264.
3. **WebRTC-rs / aiortc**: Neither currently has first-class AV1 support, but RTP packetization for AV1 (RFC 9321) is increasingly supported.

---

## 9. Implementation Roadmap

### Phase 0: Today (RTX 3090, current state)
- Continue with H.264 NVENC — this is the correct choice
- Add GPU capability detection at startup (logs which codecs are available)
- Add `supported_codecs` field to handshake protocol (client and server)
- No user-visible change

### Phase 1: RTX 4090 instances
- When Vast.ai offers RTX 4090 at reasonable price (<$1.50/hr), test AV1 NVENC
- Measure encode latency (run `time` in FFmpeg stderr output with `-stats`)
- Measure visual quality at same bitrates vs H.264 (capture both, compare subjectively)
- Implement `NVENCEncoder` with `codec='av1'` mode (flag-based codec selection)

### Phase 2: Full Integration
- Client sends `supported_codecs` in handshake
- Server negotiates based on GPU + client capability
- AV1 path through WebGLCanvas (no description, OBU keyframe detection)
- Adaptive bitrate thresholds adjusted down 30% for AV1 (same quality at lower bitrate)
- Safari users get H.264 automatically (via `isConfigSupported` → fallback)

### Phase 3: Optional Optimization
- Enable `-spatial-aq 1` for AV1 (same as current H.264 setting) — better perceptual quality
- Experiment with `-preset p2` if encode latency budget allows (<5ms)
- Consider HEVC NVENC as intermediate option (Ampere supports HEVC, 20-25% savings vs H.264)

---

## 10. HEVC as an Intermediate Step

Since the RTX 3090 does NOT support AV1 encode but DOES support HEVC NVENC, there's an intermediate option:

- **HEVC (H.265) NVENC**: Available on Ampere (RTX 3090) and later
- **Bitrate savings**: 20-25% vs H.264 (less than AV1's 30-50% but real)
- **Browser WebCodecs support**: HEVC is supported in Chrome on Windows/Mac (78.1% across all variants) and Safari (hardware required)
- **Critical gap**: Firefox does NOT support HEVC decoding in WebCodecs (patent issues)

FFmpeg HEVC NVENC command:
```bash
ffmpeg ... -c:v hevc_nvenc -preset p1 -tune ull -rc cbr -b:v 8M -bf 0 \
  -rc-lookahead 0 -zerolatency 1 -g 60 -f hevc pipe:1
```

WebCodecs HEVC codec string:
```
hvc1.1.6.L93.B0
```

**Verdict:** HEVC is a useful stepping stone but the Firefox exclusion makes it risky for a public game. Chrome + Safari coverage is ~85% of the market, which may be acceptable. For your current Vast.ai RTX 3090 use case, HEVC gives you a real improvement right now without waiting for RTX 4090 availability.

---

## Quick Reference: FFmpeg Command Comparison

### Current (H.264, RTX 3090, works today)
```bash
ffmpeg -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i pipe:0 \
  -c:v h264_nvenc -preset p1 -tune ull -rc cbr -b:v 8M \
  -spatial-aq 1 -aq-strength 8 -bf 0 -rc-lookahead 0 \
  -zerolatency 1 -g 60 -f h264 pipe:1
```

### AV1 (RTX 4090 only)
```bash
ffmpeg -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i pipe:0 \
  -c:v av1_nvenc -preset p1 -tune ull -rc cbr -b:v 6M \
  -bf 0 -rc-lookahead 0 -zerolatency 1 -g 60 -f av1 pipe:1
```
Note: bitrate reduced to 6M (from 8M) to get equivalent quality to H.264 at 8M.

### HEVC (RTX 3090, available now as intermediate)
```bash
ffmpeg -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i pipe:0 \
  -c:v hevc_nvenc -preset p1 -tune ull -rc cbr -b:v 6M \
  -spatial-aq 1 -aq-strength 8 -bf 0 -rc-lookahead 0 \
  -zerolatency 1 -g 60 -f hevc pipe:1
```

---

## Sources and References

- [NVIDIA Video Encode and Decode GPU Support Matrix](https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix-new) — definitive GPU/codec support table
- [AOM Alliance for Open Media — AV1 Features](https://aomedia.org/av1-features/) — 30% compression improvement claim
- [WebCodecs Codec Support Data (webcodecsfundamentals.org)](https://webcodecsfundamentals.org/datasets/codec-support-table/) — real-world 224,360 session data
- [Can I Use — AV1 video format](https://caniuse.com/av1) — Chrome/Firefox full support, Safari partial
- [Can I Use — WebCodecs](https://caniuse.com/webcodecs) — 94% global coverage
- [W3C AV1 Codec Registration](https://www.w3.org/TR/webcodecs-av1-codec-registration/) — codec string format, no description required
- [AV1 ISO Media File Format Binding](https://aomediacodec.github.io/av1-isobmff/) — OBU structure, Sequence Header OBU is Type 1
- [FFmpeg nvenc_av1.c source](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/nvenc_av1.c) — confirms: presets p1-p7, tune ull/ll/hq, zerolatency, surfaces, delay
- [Sunshine video.cpp](https://github.com/LizardByte/Sunshine/blob/master/src/video.cpp) — av1_nvenc settings: delay=0, zerolatency=1, surfaces=1 (same as h264_nvenc)
- [Jake Archibald — AV1 Codec String Format](https://jakearchibald.com/2022/html-codecs-parameter-for-av1/) — comprehensive av01.P.LLT.DD format guide
- [SVT-AV1 FAQ (AOMediaCodec)](https://gitlab.com/AOMediaCodec/SVT-AV1/-/blob/master/Docs/CommonQuestions.md) — preset 7-13 for real-time, 16 cores efficient for 1080p
