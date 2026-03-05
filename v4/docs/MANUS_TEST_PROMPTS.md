Here are the Manus prompts for testing Shadow Driver v3. Paste each one into manus.im.

## Prompt 1: Full Gameplay Test (paste this first)

Go to http://localhost:5173/race?ws=ws://localhost:8765

This is a cloud-streamed racing game called Shadow Driver. Click "Start Race" to begin.

Play for 60 seconds using keyboard controls:
- W = accelerate (hold down), A = steer left, D = steer right
- S = brake (while moving) or reverse (while stopped)
- R = respawn if stuck

Test sequence:
1. First 30 seconds: Drive forward aggressively. Hold W, steer with A/D around corners. Try to reach maximum speed (check speedometer bottom-left).
2. Seconds 30-40: Test braking. Release W, press S. How fast does the car stop?
3. Seconds 40-50: Test reverse. After stopping, press S again. Does the car go backward? Is it fast? Press A/D while reversing — does steering feel correct?
4. Seconds 50-60: Press W to exit reverse and accelerate forward.

IMPORTANT: Take a screen recording video at the HIGHEST FPS possible throughout the entire test. You need to analyze frame-by-frame.

After playing, provide a JSON bug report:
```json
{
  "overall_score": <1-10>,
  "video_fills_viewport": <true/false>,
  "max_speed_kmh": <number from speedometer>,
  "fps_estimate": <number from tab title>,
  "reverse_works": <true/false>,
  "reverse_steering_intuitive": <true/false>,
  "hud_visible": {
    "speedometer": <true/false>,
    "input_bars_THR_BRK_STR": <true/false>,
    "minimap": <true/false>,
    "gap_timer": <true/false>,
    "checkpoint_arrow": <true/false>
  },
  "graphics_quality": {
    "macroblocking": "<none/mild/moderate/severe>",
    "color_shifts": "<none/mild/severe>",
    "brightness_stable": <true/false>,
    "frame_freezes": <count>
  },
  "top_3_bugs": [
    {"severity": "<critical/major/minor>", "description": "..."}
  ],
  "what_works_well": ["...", "..."],
  "connection_drops": <count>,
  "ai_car_visible": <true/false>,
  "notes": "<any other observations>"
}
```

---

## Prompt 2: Reverse Gear Deep Test (use after Prompt 1)

Go to http://localhost:5173/race?ws=ws://localhost:8765 and click Start Race.

This test focuses on REVERSE GEAR behavior. Take a high-FPS screen recording.

1. Hold W for 10 seconds to build speed (aim for 100+ km/h)
2. Release W, press and hold S to brake. Note how many seconds to stop.
3. Once speed shows 0 on speedometer: release S completely, wait 1 second
4. Press S again — the car should enter reverse. Note:
   - Does the gear indicator show "R" or "-1"?
   - How fast does the car go in reverse? (check speedometer)
   - Is reverse speed reasonable or painfully slow?
5. While in reverse, press D (right) — does the car's rear go RIGHT on screen?
6. While in reverse, press A (left) — does the car's rear go LEFT on screen?
7. Press W to exit reverse — does the car smoothly switch to forward?

Report your findings as JSON with screenshots of each step.

---

## Prompt 3: Graphics & Visual Quality Analysis (use after driving around)

Go to http://localhost:5173/race?ws=ws://localhost:8765 and click Start Race.

Take a HIGH FPS screen recording (30+ FPS minimum) for 60 seconds while driving.

Focus specifically on VISUAL QUALITY:
1. Drive fast (hold W) and look for:
   - Macroblocking/pixelation during camera turns (H.264 compression artifacts)
   - Frame freezes (video pauses but HUD timer keeps going)
   - Color shifts (scene suddenly turns blue/orange/dark)
   - Brightness oscillation (screen dims then brightens)
2. Look at the road surface — is it detailed or muddy/blurred?
3. Check shadow quality — smooth or flickering?
4. Drive through different areas (open road, under bridges, near buildings)
5. Note the FPS shown in the tab title throughout

Rate each visual aspect 1-10 and compare to what you'd expect from a modern racing game (like Forza Horizon or Gran Turismo). Be brutally honest.

---

## Prompt 4: HUD & Controls Verification (quick test)

Go to http://localhost:5173/race?ws=ws://localhost:8765 and click Start Race.

Verify each HUD element is visible and working. Take a screenshot of each:

1. Speedometer (bottom-left): Arc with needle, km/h number, gear indicator
2. Input bars (bottom-left): THR (green), BRK (red), STR (blue) — press each key and verify the bars respond
3. Gap timer (top-center): Shows time difference to AI (+XX.Xs or -XX.Xs)
4. Minimap (bottom-right): Shows track layout, your position (green dot), AI position (blue dot)
5. Checkpoint arrow (center): Green circle with arrow pointing to next checkpoint
6. Lap counter (top): Shows P1 Lap X/Y
7. Race timer (bottom-center): Current time counting up

Press ~ (tilde) to toggle the debug overlay. Screenshot it — shows FPS, latency, codec info.

Report which elements are visible, which are missing, and screenshot evidence.
