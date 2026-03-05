# Shadow Driver v3 Gameplay Foundations Audit (2026-03-05)

Status: In progress
Owner: Codex
Branch: audit/v3-gameplay-foundations-2026-03-04

## Scope
- Drivability (lag/bumpiness/reverse/controls feel)
- Streaming quality & latency pipeline
- User-visible gameplay quality from test artifacts

## Method
- Parallel technical + UX audit
- Code references + artifact-backed findings only
- Prioritized action plan for non-technical execution

## Live Findings Log

### Track A — Controls/Drivability
1. **Reverse engages with aggressive throttle floor (0.7-0.85)**
   - File: `v3/server/carla_manager.py` (`apply_player_control`, reverse block)
   - Impact: reverse feels jumpy and can immediately re-hit walls/fences.
2. **Auto-unstuck can still miss prolonged wall-grind cases**
   - File: `v3/server/carla_manager.py` (`stuck_stationary`, `wall_grind`)
   - Impact: user-visible “stuck for too long” persists in artifacts.
3. **High-latency steering authority reduction + ramping can feel mushy/late**
   - File: `v3/server/carla_manager.py` (`latency_factor`, `ramp_ms`)
   - Impact: understeer/late correction at ~130-170ms RTT produces bumpy wall contact.

### Track B — Video/Network/Perf
1. **Startup black screen is reproducible (~3s+)**
   - Seen in artifacts: `init.png` frames + user screenshots (“Waiting for video feed…”).
2. **WSS tunnel path disables WebRTC data channel controls**
   - File: `v3/src/hooks/useGPUConnection.ts` (`if (wsUrl.startsWith('ws://')) setupDataChannel(...)`)
   - Impact: tunnel sessions stay on WS controls; higher perceived input lag.
3. **ABR remains disabled (known)**
   - File: `v3/server/race_server.py` (`_handle_network_quality` returns early)
   - Impact: bitrate can’t adapt dynamically; quality/latency tradeoffs are static.

### Track C — UX/Gameplay Artifacts
1. **Over-bright / washed image persists**
   - Seen in screenshots from user + Manus folders.
2. **Ghosting/double-image artifacts visible while turning**
   - Seen in provided screenshots.
3. **AI visibility/race coherence still poor (huge gap)**
   - Seen in HUD gaps (`+53s`, `+68s`, `+192s`) while AI not visible on track.

## Synthesis
Top 3 fundamentals still blocking “good demo” feel:
1. **Visual pipeline is still stylizing too aggressively** (ACES + vignette + sharpening + overlays)
2. **Control path remains high-latency in tunnel mode** (no data channel over `wss://`)
3. **Recovery/route behavior not robust enough** (wall-stick + AI route divergence)

## Must-Fix-Now Checklist
1. Remove remaining visual stylization for baseline quality pass:
   - Disable ACES/color-grade/vignette/sharpen in `WebGLCanvas.tsx`
   - Disable `SpeedEffects` in `Race.tsx`
2. Reduce reverse aggressiveness and improve unstuck reliability in `carla_manager.py`.
3. Add startup UX mask for black-screen interval (loading skeleton + explicit stream state) and optimize first-frame path.
4. Prioritize local `ws://localhost:8765` test flow for latency-sensitive validation; treat tunnel/wss as degraded mode.

## Nice-to-Fix-Later
1. Re-enable effects behind a latency gate (<80-100ms) only.
2. Restore ABR only after codec config re-send is implemented robustly.
3. AI route fix (manual waypoint-following / teleport guardrails).

## Verification Plan
- Re-run CDP/Manus on localhost URL (`http://localhost:5173/race?ws=ws://localhost:8765`)
- Require:
  - No startup black frame beyond 1s
  - No visible ghost trails on turns
  - Stable 25+ FPS in title
  - Reverse enter/exit + fence recovery <3s
