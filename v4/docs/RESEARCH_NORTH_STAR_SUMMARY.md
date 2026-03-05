# North Star Research Summary: Shadow Driver v3 Visual & Latency Quality

**Date:** February 26, 2026
**Branch:** v3
**Purpose:** Synthesize findings from four parallel research efforts into a single actionable reference for bringing Shadow Driver v3's look and feel closer to commercial racing games (Forza Horizon, Gran Turismo, GeForce NOW).

---

## Executive Summary

Shadow Driver v3 streams a CARLA simulator racing experience from a cloud GPU to a browser over WebSocket. Four parallel research tracks investigated how to close the gap between our current experience and commercial racing games:

1. **Forza/GT Racing Criteria** -- A 15-criterion rubric covering physics feel and graphics quality, establishing what "good" looks like.
2. **Visual Wow Factors** -- 10 ranked browser-side and server-side enhancements, prioritized by impact-to-effort ratio. Six of ten have been applied.
3. **Cloud Gaming Latency** -- Industry latency budgets, commercial service benchmarks, and seven concrete improvements for Shadow Driver. Our current 150-280ms end-to-end latency is 2-4x worse than GeForce NOW; even small reductions yield disproportionate feel improvements at our operating point.
4. **CARLA Visual Settings** -- Engine.ini overrides, weather presets, camera tuning, and map selection to maximize CARLA's visual output before it ever hits the encoder.

**Bottom line:** The biggest remaining gaps are (a) latency (150-280ms vs. industry 40-80ms), (b) AI opponent visibility (autopilot routes to wrong roads), and (c) H.264 macroblocking on fast camera motion. The highest-leverage next steps are datacenter selection (potentially -30 to -80ms latency), AV1 encoding (30-50% bitrate savings), night racing preset (visual wow + better H.264 compression), and fixing the AI opponent.

---

## 1. Forza/GT North Star Criteria (15-Criterion Rubric)

This rubric defines what a browser racing game must deliver to feel "real." Each criterion should be evaluated during gameplay testing.

### Physics & Dynamics (7 Criteria)

| # | Criterion | What "Good" Looks Like | Shadow Driver v3 Status |
|---|-----------|----------------------|------------------------|
| 1 | **Acceleration curve** | 0-100 km/h feels progressive, not instant. Engine note rises with RPM. | Partial -- car reaches 140-168 km/h, but throttle response is binary (no analog unless gamepad). Engine sound tied to speed. |
| 2 | **Braking distance** | Car slows realistically over distance. Weight shifts forward visibly. | Partial -- brake response ~60ms. No visible weight shift (camera is fixed chase cam). |
| 3 | **Cornering** | Car leans, slides, or grips through turns depending on speed and surface. | Good -- tire grip tuned (front 4.0, rear 3.8), countersteer assist active. Drifting possible but not encouraged at high latency. |
| 4 | **Weight transfer** | Car feels heavy, not floaty. Momentum carries through direction changes. | Partial -- CoM lowered to -0.4, lateral stiffness tuned. High latency masks subtlety. |
| 5 | **Speed perception** | 200 km/h FEELS fast via motion cues (blur, FOV, road detail streaming past). | Partial -- FOV scales 1.0 to 1.05x at 150+ km/h. Motion blur applied server-side (0.30 intensity). Overlays (speed lines, vignette) mostly disabled for MVP. |
| 6 | **Collision response** | Car bounces or crumples, screen shakes, audio impact. | Minimal -- CARLA physics handles collision, but screen shake is disabled (nauseating at high latency). No crumple model. |
| 7 | **Reverse feel** | Reversing feels natural with intuitive steering direction. | OK -- reverse threshold 3 km/h (lowered from 15), automatic transmission enforced. |

### Graphics (8 Criteria)

| # | Criterion | What "Good" Looks Like | Shadow Driver v3 Status |
|---|-----------|----------------------|------------------------|
| 8 | **Road surface detail** | Visible asphalt texture, lane markings, puddles. | Good on Town10HD_Opt. Wet road reflections via weather preset (wetness: 50). |
| 9 | **Lighting consistency** | No sudden brightness shifts between areas. | Improved -- manual exposure mode prevents auto-exposure oscillation. Golden hour preset provides consistent warm lighting. |
| 10 | **Shadow quality** | Smooth, stable shadows. No flickering. | Decent -- CARLA's cascaded shadow maps. Low sun angle (8 deg) creates long dramatic shadows. |
| 11 | **Draw distance** | No visible pop-in of buildings or objects. | Good -- Town10HD_Opt has optimized LODs. DoF blur (fstop 2.5) hides distant LOD transitions. |
| 12 | **Frame rate consistency** | No stutters or micro-freezes during gameplay. | Problem area -- 23-30 FPS server-side, but NVENC starvation fallback to JPEG causes occasional hitches. Macroblocking on turns. |
| 13 | **Color palette** | Consistent warm/cool tone throughout. | Good -- ACES filmic tone mapping applied in GLSL. Golden hour preset gives warm orange palette. |
| 14 | **Weather effects** | Rain, fog, wet roads look convincing. | Applied -- precipitation_deposits: 75 creates wet roads. Full rain/fog not yet tested in gameplay. |
| 15 | **Car paint/reflections** | Car body has visible reflections and paint depth. | Limited -- CARLA's default PBR materials. SSR enabled via Engine.ini but quality depends on CARLA version. |

---

## 2. Visual Wow Factors (10 Ranked Enhancements)

Ranked by impact-to-effort ratio. Status reflects what has been deployed and verified.

| Rank | Enhancement | Effort | Impact | Status |
|------|------------|--------|--------|--------|
| 1 | **Cinematic Sunset Weather Preset** | 10 lines | Transforms entire visual feel. Golden light, wet reflections, lens flare, atmospheric haze. | APPLIED |
| 2 | **20Mbps Bitrate + Keyframe Interval 15** | Config change | Eliminates macroblocking on turns. 0.5s error recovery. | PARTIALLY APPLIED (bitrate at 20Mbps, keyframe interval done) |
| 3 | **ACES Filmic Tone Mapping (GLSL)** | 6 lines GLSL | Cinematic S-curve color response. Compresses highlights, crushes blacks. Hides macroblocking in bright areas. | APPLIED |
| 4 | **Depth of Field (fstop 2.5, focal 800cm)** | Server config | Car sharp, background soft. Dramatically improves H.264 compression (blurred bg = 80%+ fewer bits). | APPLIED |
| 5 | **Speed Vignette + Warp Streaks** | CSS/Canvas | Darkens edges at speed (0ms latency cost). Warp streaks above 150 km/h. | PARTIALLY APPLIED (GLSL vignette active, CSS warp streaks still disabled) |
| 6 | **Contrast-Adaptive Sharpening (CAS)** | 12 lines GLSL | AMD FidelityFX CAS. Sharpens based on local contrast without amplifying compression noise. Counteracts H.264 softness. | APPLIED (sharpness=0.25) |
| 7 | **Night Racing with Enhanced Bloom** | Weather preset + bloom config | Neon-noir aesthetic. Streetlight bloom halos. H.264 encodes dark scenes efficiently. | NOT APPLIED |
| 8 | **AV1 Encoding (RTX 4090)** | Protocol change, 1 day | 30-50% bitrate savings. 5Mbps AV1 matches 12-15Mbps H.264. Chrome/Edge HW decode. Safari needs M3+. | NOT APPLIED |
| 9 | **NFS Unbound-Style Overlays** | High art effort | Cel-shaded drift smoke, impact lines, speed lines. Canvas 2D at 60fps over WebGL. | NOT APPLIED |
| 10 | **Barrel Distortion at Speed** | Already in shader | Enable only above 180 km/h at very small values, and only when latency < 120ms. | NOT APPLIED (keep disabled) |

### Visual Enhancement Details

**Cinematic Sunset Preset (Rank 1):**
```
sun_altitude_angle: 8      # Very low sun, golden hour
sun_azimuth_angle: 250     # West, car lit from side
cloudiness: 55             # Partial clouds for dramatic sky
precipitation_deposits: 75 # Wet road reflections
wetness: 50                # Glistening surfaces
mie_scattering: 0.08       # Atmospheric haze
scattering_intensity: 1.0  # Visible light shafts
```

**ACES Tone Mapping (Rank 3):**
Uses the Narkowicz 2016 approximation (same curve as UE4's "Filmic" tonemapper). Produces the signature cinematic look where highlights compress smoothly and shadows have depth, rather than the flat, washed-out look of linear output.

**CAS Sharpening (Rank 6):**
AMD FidelityFX Contrast-Adaptive Sharpening analyzes local contrast before sharpening, so it enhances real detail (road texture, car body panels) without amplifying H.264 compression artifacts. Starting conservatively at sharpness=0.25.

**Night Racing (Rank 7) -- Not Yet Applied:**
```
sun_altitude_angle: -30    # Full night
temp: 7000K                # Cool blue ambient
bloom_intensity: 1.0       # Streetlight halos
toe: 0.65                  # Crush blacks for drama
```
Night scenes compress extremely well with H.264 because large dark areas require near-zero bits, freeing bitrate for the illuminated car and road.

---

## 3. Cloud Gaming Latency Analysis

### Industry Latency Thresholds for Racing Games

| Total E2E Latency | Player Experience |
|---|---|
| 0-20ms | Imperceptible -- feels like local play |
| 20-50ms | Barely perceptible -- only skilled drivers notice |
| 50-100ms | Noticeable -- requires conscious adaptation |
| 100-150ms | "Floaty" steering -- Shadow Driver current best case |
| 150-250ms | Degraded -- wall-riding begins, overcorrection common |
| 250ms+ | Survival mode -- playable only with heavy assist |

**Key insight:** Shadow Driver operates at 150-280ms, which is the "degraded" to "survival" zone. Even a 30ms improvement at this operating point produces disproportionately large feel improvements ("non-linear amplification" -- a 10ms reduction at 150ms feels 5-10x more impactful than the same reduction at 50ms).

### Commercial Service Benchmarks

| Service | Best Case E2E | Typical E2E | Codec | Resolution/FPS |
|---|---|---|---|---|
| GeForce NOW Ultimate | 40-60ms | 60-80ms | AV1/H.265 | 4K 120fps |
| Xbox Cloud Gaming | 60-100ms | 80-130ms | H.264 | 1080p 60fps |
| PS Remote Play (LAN) | 25-45ms | 30-60ms | H.264 | 1080p 60fps |
| **Shadow Driver v3 (SSH)** | **100-139ms** | **150-280ms** | **H.264** | **1080p 30fps** |

### GeForce NOW Latency Budget Breakdown

| Stage | Time |
|---|---|
| Game render | ~8ms (at 120fps) |
| NVENC encode | 2-5ms |
| Network one-way | 20-40ms (edge datacenter) |
| Client hardware decode | 5-15ms |
| Display scanout | 8-16ms |
| **Total** | **35-76ms** |

### Shadow Driver's NVENC Settings

Our NVENC configuration already matches the gold standard used by Sunshine/Moonlight (the open-source game streaming stack):

```
-preset p1 -tune ull -bf 0 -rc-lookahead 0 -delay 0
-forced-idr 1 -surfaces 1 -zerolatency 1
```

This means our encode latency is already near-optimal. The remaining latency gap is dominated by network path (no edge datacenter) and 30fps frame time (33ms vs. 8ms at 120fps).

### Actionable Latency Improvements (Priority Order)

| # | Improvement | Effort | Expected Savings | Status |
|---|------------|--------|-----------------|--------|
| 1 | Keyframe interval `-g 15` | 30 min | Faster error recovery (0.5s vs 1s) | APPLIED |
| 2 | GStreamer in-process encoding | 2-3 days | 2-5ms/frame (eliminates FFmpeg subprocess pipe overhead) | NOT APPLIED |
| 3 | Closed GOP flag (`-flags +cgop`) | 5 min | Marginal decode improvement | APPLIED |
| 4 | Engine audio from local input | 2 hours | 0ms perceived audio latency (sound responds to keypress, not server state) | NOT APPLIED |
| 5 | Client-predicted speedometer | 1 day | Eliminates 150ms display delay on speed readout | NOT APPLIED |
| 6 | Datacenter selection (US West/East edge) | 1 hour | Potentially 30-80ms reduction (biggest single win) | NOT APPLIED |
| 7 | AV1 codec | 1 day | 15-25% bitrate savings at same quality, or same bitrate at higher quality | NOT APPLIED |

---

## 4. CARLA Visual Settings

### Engine.ini Overrides

CARLA disables bloom and ambient occlusion by default. These can be re-enabled via Engine.ini on the server:

```ini
[/Script/Engine.RendererSettings]
r.DefaultFeature.Bloom=True
r.DefaultFeature.AmbientOcclusion=True
r.DefaultFeature.AntiAliasing=2
r.DefaultFeature.MotionBlur=True
```

### Camera Settings (Cinematic Preset)

| Parameter | Value | Purpose |
|-----------|-------|---------|
| fstop | 2.5 | Shallow depth of field -- car sharp, background soft |
| focal_distance | 800cm | Focus point at ~8m ahead of camera |
| bloom_intensity | 0.85 | Subtle glow on bright surfaces |
| lens_flare_intensity | 0.20 | Sun flare when facing light |
| motion_blur_intensity | 0.30 | Helps H.264 encode fast motion smoothly |
| tone_mapping slope | 0.88 | UE4 cinematic default |
| tone_mapping toe | 0.55 | Shadow rolloff |
| tone_mapping shoulder | 0.26 | Highlight compression |

### Recommended Map: Town10HD_Opt

- Highest quality assets in CARLA's map library
- Urban environment with varied lighting scenarios (open streets, tunnels, overpasses)
- Optimized LODs for good draw distance
- Good for demonstrating visual quality in screenshots and video

### Manual Exposure Mode

CARLA's default auto-exposure causes brightness oscillation when driving between sunlit and shadowed areas. Setting manual exposure with fixed compensation provides consistent lighting throughout the race, which also helps H.264 encoding (fewer sudden brightness changes = fewer bits wasted on scene-wide luminance shifts).

### Night Racing Settings (Not Yet Applied)

```
sun_altitude_angle: -30
temp: 7000K               # Cool blue ambient cast
toe: 0.65                 # Crush blacks for dramatic contrast
bloom_intensity: 1.0      # Streetlight halos and neon glow
```

Night racing is both visually striking and H.264-friendly: large dark areas compress to near-zero bits, freeing the entire bitrate budget for the illuminated car, headlight cones, and road surface.

---

## 5. What We Applied (Verified in Gameplay)

These changes have been deployed and confirmed working through gameplay testing:

| Change | Category | Test Verified |
|--------|----------|--------------|
| Cinematic sunset weather preset | CARLA Settings | Test 3+ |
| ACES filmic tone mapping (GLSL) | Client Shader | Test 5+ |
| Contrast-adaptive sharpening (GLSL, 0.25) | Client Shader | Test 5+ |
| Depth of field (fstop 2.5, focal 800cm) | CARLA Camera | Test 4+ |
| NVENC H.264 at 20Mbps, keyframe interval 15 | Encoder | Test 6 |
| Closed GOP flag | Encoder | Test 6 |
| NVENC settings matching Sunshine/Moonlight | Encoder | Test 6 |
| All distortion shaders disabled (barrel, CA, radial blur, film grain) | Client Shader | Test 3+ |
| All CSS motion effects disabled (shake, tilt, steering prediction) | Client CSS | Test 3+ |
| All overlay components removed (SpeedLines, ParticleOverlay, DriftScore) | Client Components | Test 3+ |
| GLSL vignette at speed | Client Shader | Test 5+ (Gemini could not confirm visible) |
| Engine.ini bloom + AO + TAA + motion blur | CARLA Engine | Applied but not independently verified |
| Manual exposure mode | CARLA Camera | Applied but not independently verified |

---

## 6. What's Left To Do (Priority Order)

### High Priority (Biggest Impact)

| # | Task | Category | Effort | Expected Impact |
|---|------|----------|--------|----------------|
| 1 | **Fix AI opponent visibility** | Gameplay | 1-2 days | Currently invisible -- autopilot routes to wrong roads. Gap timer works but opponent is never on screen. Replace `set_path()` with manual waypoint following or periodic teleportation. |
| 2 | **Datacenter selection** | Latency | 1 hour | Select Vast.ai instances in US West/East for 30-80ms latency reduction. Single biggest latency win available. |
| 3 | **Night racing weather preset** | Visual | 2 hours | Dramatic visual upgrade. Neon-noir aesthetic with bloom halos. Excellent H.264 compression efficiency. |
| 4 | **AV1 encoding** | Quality + Latency | 1 day | 30-50% bitrate savings. 5Mbps AV1 matches 12-15Mbps H.264. Requires WebCodecs AV1 path on client. RTX 4090 has hardware AV1 encoder. Safari needs M3+. |

### Medium Priority (Meaningful Improvement)

| # | Task | Category | Effort | Expected Impact |
|---|------|----------|--------|----------------|
| 5 | **Client-predicted speedometer** | Perceived Latency | 1 day | Speed readout updates instantly from local input state rather than waiting 150ms for server telemetry round-trip. |
| 6 | **Engine audio from local input** | Perceived Latency | 2 hours | Engine note responds to keypress immediately, not to server-reported speed. Eliminates 150ms audio delay. |
| 7 | **Re-enable speed warp streaks** | Visual | 1 hour | CSS/Canvas overlay above 150 km/h. Zero latency cost. Already implemented in SpeedEffects.tsx, just disabled. |
| 8 | **GStreamer in-process encoding** | Latency | 2-3 days | Saves 2-5ms/frame by eliminating FFmpeg subprocess pipe overhead. Replaces stdin pipe with in-process API call. |

### Low Priority (Polish)

| # | Task | Category | Effort | Expected Impact |
|---|------|----------|--------|----------------|
| 9 | **NFS Unbound-style overlays** | Visual | 3-5 days | Cel-shaded drift smoke, impact lines. High art effort, distinctive look. |
| 10 | **Barrel distortion at speed** | Visual | 30 min | Already in shader. Enable only above 180 km/h at tiny values, only when latency < 120ms. |
| 11 | **Fix ABR (adaptive bitrate)** | Quality | 1 day | Currently disabled because encoder restart produces new SPS/PPS headers that freeze WebCodecs. Need to re-send codec_config after restart. |
| 12 | **60fps rendering** | Latency + Visual | Unknown | Halves frame time from 33ms to 16ms. Requires CARLA to sustain 60fps at 1080p on RTX 4090 (may need resolution reduction). |

---

## 7. Key Takeaways

1. **Latency is the dominant problem.** At 150-280ms E2E, we are 2-4x slower than commercial cloud gaming. Every millisecond saved has outsized impact at our operating point due to non-linear amplification. Datacenter selection is the single biggest win (potentially 30-80ms) with minimal effort.

2. **Visual quality is already surprisingly good.** The cinematic sunset preset, ACES tone mapping, CAS sharpening, and depth of field combine to produce a look that screenshots well. The gap is in motion -- macroblocking on turns and frame rate inconsistency.

3. **AV1 is the next codec leap.** RTX 4090 has hardware AV1 encoding. At equivalent quality, AV1 uses 30-50% less bandwidth than H.264, which would eliminate macroblocking at our current bitrate or allow us to drop bitrate for faster transmission. The blocker is client-side: WebCodecs AV1 decode support and Safari compatibility (M3+ only).

4. **Night racing is free visual impact.** A night weather preset with bloom would be visually dramatic AND encode more efficiently (dark areas = near-zero bits). This is high-impact, low-effort.

5. **"Perceived latency" tricks matter.** Client-predicted speedometer and local engine audio can mask 150ms of latency for two of the most latency-sensitive feedback channels (speed readout and engine note), even though the actual input-to-video latency remains unchanged.

6. **The AI opponent is the biggest gameplay gap.** The game is a race, but the opponent is invisible. Fixing AI visibility (via manual waypoint following or teleportation) would transform the experience from "solo time trial" to "competitive race."

7. **Our NVENC settings are already optimal.** We match Sunshine/Moonlight's gold-standard low-latency encoding config. Further encode-side gains require switching codecs (AV1) or encoding pipelines (GStreamer in-process).
