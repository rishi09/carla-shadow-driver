#!/usr/bin/env python3
"""
Shadow Driver v3 — Automated Gameplay Testing via Safari + Selenium

Uses the webapp-testing skill: Safari Technology Preview on port 4445.
Prerequisite: safaridriver running in a separate terminal:
  /Applications/Safari\ Technology\ Preview.app/Contents/MacOS/safaridriver -p 4445

Usage:
  /usr/bin/python3 v3/test/gameplay_test.py                          # default: localhost
  /usr/bin/python3 v3/test/gameplay_test.py --ws ws://localhost:8765  # explicit WS URL
  /usr/bin/python3 v3/test/gameplay_test.py --url https://shadow-driver-v3.vercel.app/race?ws=wss://xxx.trycloudflare.com

What it does:
  1. Opens the game in Safari Technology Preview
  2. Waits for the RaceSetup screen to load
  3. Clicks "Start Race" with default settings
  4. Waits for WebSocket to connect + CARLA to load (up to 90s)
  5. Drives forward (W key) with periodic steering for N seconds
  6. Captures full-page screenshots via save_screenshot() at 2fps
  7. Samples metrics at 5Hz via JS: FPS, latency, speed, connection state
  8. Saves everything to test-results/<timestamp>/
  9. Prints a summary report

Key tricks:
- window.__e2eKeys (built into Race.tsx) injects key STATE into the 30Hz control
  loop. Setting {w: true} = W held down continuously until changed. This is
  fundamentally different from Selenium send_keys() which fires discrete events.
- Uses driver.save_screenshot() (full viewport capture) instead of canvas.toDataURL()
  because WebGL contexts with preserveDrawingBuffer=false return black from toDataURL.
  save_screenshot() captures the composited viewport and always works.
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.safari.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


# ─── Config ────────────────────────────────────────────────────────────────

DEFAULT_GAME_URL = "http://localhost:5173/race?ws=ws://localhost:8765"
SCREENSHOT_INTERVAL = 1.0       # seconds between save_screenshot() calls
METRICS_INTERVAL = 0.2          # seconds between metrics samples (5Hz)
RACE_DURATION = 60              # seconds of driving
SAFARIDRIVER_PORT = 4445
WS_CONNECT_TIMEOUT = 90         # seconds to wait for WebSocket to connect
RACING_DETECT_TIMEOUT = 30      # seconds to wait for racing state after WS connects


# ─── Driving Patterns ──────────────────────────────────────────────────────

def make_drive_sequence(duration_s: int):
    """
    Generate a driving input sequence that tests ALL controls:
    - Acceleration (W), braking (S), steering (A/D), handbrake (Space)
    - Reverse + steering (S+A, S+D — without W)
    - Respawn (R key dispatched separately)

    Keys are HELD (not tapped) — __e2eKeys sets state that the 30Hz game loop
    reads continuously. {w: true} = W held until the next state change.

    Returns list of {t, keys, [respawn], [label]} dicts.
    """
    seq = [
        # Phase 1: Acceleration test — full throttle forward
        {"t": 0.0,  "keys": {"w": True,  "a": False, "s": False, "d": False, "space": False}, "label": "full throttle"},
        # Phase 2: Brake test — full brake
        {"t": 6.0,  "keys": {"w": False, "a": False, "s": True,  "d": False, "space": False}, "label": "braking"},
        # Phase 3: Reverse + left steering (S+A, no W)
        {"t": 9.0,  "keys": {"w": False, "a": True,  "s": True,  "d": False, "space": False}, "label": "reverse+left"},
        # Phase 4: Reverse + right steering (S+D, no W)
        {"t": 12.0, "keys": {"w": False, "a": False, "s": True,  "d": True,  "space": False}, "label": "reverse+right"},
        # Phase 5: Accelerate forward again
        {"t": 15.0, "keys": {"w": True,  "a": False, "s": False, "d": False, "space": False}, "label": "full throttle"},
        # Phase 6: Sustained left turn
        {"t": 18.0, "keys": {"w": True,  "a": True,  "s": False, "d": False, "space": False}, "label": "throttle+left"},
        # Phase 7: Straight
        {"t": 22.0, "keys": {"w": True,  "a": False, "s": False, "d": False, "space": False}, "label": "full throttle"},
        # Phase 8: Sustained right turn
        {"t": 25.0, "keys": {"w": True,  "a": False, "s": False, "d": True,  "space": False}, "label": "throttle+right"},
        # Phase 9: Straight
        {"t": 29.0, "keys": {"w": True,  "a": False, "s": False, "d": False, "space": False}, "label": "full throttle"},
        # Phase 10: Slalom — quick left-right-left
        {"t": 31.0, "keys": {"w": True,  "a": True,  "s": False, "d": False, "space": False}, "label": "slalom left"},
        {"t": 32.5, "keys": {"w": True,  "a": False, "s": False, "d": True,  "space": False}, "label": "slalom right"},
        {"t": 34.0, "keys": {"w": True,  "a": True,  "s": False, "d": False, "space": False}, "label": "slalom left"},
        {"t": 35.5, "keys": {"w": True,  "a": False, "s": False, "d": False, "space": False}, "label": "straight"},
        # Phase 11: Build speed
        {"t": 37.0, "keys": {"w": True,  "a": False, "s": False, "d": False, "space": False}, "label": "full throttle"},
        # Phase 12: Handbrake turn (space + left)
        {"t": 40.0, "keys": {"w": True,  "a": True,  "s": False, "d": False, "space": True},  "label": "handbrake+left"},
        # Phase 13: Release handbrake, recovery
        {"t": 43.0, "keys": {"w": True,  "a": False, "s": False, "d": False, "space": False}, "label": "recovery"},
        # Phase 14: Respawn test (R key)
        {"t": 46.0, "keys": {"w": False, "a": False, "s": False, "d": False, "space": False}, "label": "respawn", "respawn": True},
        # Phase 15: Post-respawn acceleration
        {"t": 49.0, "keys": {"w": True,  "a": False, "s": False, "d": False, "space": False}, "label": "post-respawn throttle"},
        # Phase 16: Right turn
        {"t": 52.0, "keys": {"w": True,  "a": False, "s": False, "d": True,  "space": False}, "label": "throttle+right"},
        # Phase 17: Straight finish
        {"t": 55.0, "keys": {"w": True,  "a": False, "s": False, "d": False, "space": False}, "label": "full throttle"},
    ]
    return [s for s in seq if s["t"] < duration_s]


# ─── Metrics Extraction ────────────────────────────────────────────────────

EXTRACT_METRICS_JS = """
return (function() {
    var title = document.title || '';
    var fpsMatch = title.match(/(\\d+)fps/);
    var latMatch = title.match(/(\\d+)ms/);

    var ws = window.__gameWs;
    var debugEl = document.querySelector('[class*="debug"]') ||
                  document.querySelector('[data-debug]');
    var debugText = debugEl ? debugEl.innerText : '';

    var speedEl = document.querySelector('[class*="speed"]');
    var speedText = speedEl ? speedEl.innerText : '';

    // Extract numeric speed from speedometer (the large number in the arc gauge)
    var speedNum = null;
    var speedMatch = speedText.match(/(\\d+)/);
    if (speedMatch) speedNum = parseInt(speedMatch[1]);

    var canvas = document.querySelector('canvas');
    var canvasInfo = canvas ? {
        width: canvas.width, height: canvas.height,
        clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight
    } : null;

    var wsState = ws ? ws.readyState : -1;
    var wsStates = {0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED', '-1': 'NO_WS'};

    return {
        tab_title: title,
        fps: fpsMatch ? parseInt(fpsMatch[1]) : null,
        latency_ms: latMatch ? parseInt(latMatch[1]) : null,
        ws_state: wsStates[wsState] || 'UNKNOWN',
        speed_kmh: speedNum,
        canvas: canvasInfo,
        debug_overlay: debugText.substring(0, 500),
        speed_text: speedText.substring(0, 100),
        timestamp: Date.now(),
        url: window.location.href
    };
})();
"""

# Check WebSocket readyState only (lightweight, no DOM queries)
CHECK_WS_JS = """
return (function() {
    var ws = window.__gameWs;
    if (!ws) return 'NO_WS';
    var states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    return states[ws.readyState] || 'UNKNOWN';
})();
"""


# ─── WebSocket Wait ───────────────────────────────────────────────────────

def wait_for_websocket(driver, timeout=WS_CONNECT_TIMEOUT):
    """
    Poll window.__gameWs.readyState until it reaches OPEN.
    CARLA takes 30-60s to load the map, so we need patience here.
    Returns True if connected, False if timeout.
    """
    print(f"[test] Waiting up to {timeout}s for WebSocket to connect...")
    start = time.time()
    last_state = None
    while time.time() - start < timeout:
        try:
            state = driver.execute_script(CHECK_WS_JS)
            if state != last_state:
                print(f"[test]   WS state: {state} ({int(time.time() - start)}s)")
                last_state = state
            if state == "OPEN":
                return True
            if state == "CLOSED":
                print("[test]   WS closed — connection failed")
                return False
        except Exception as e:
            print(f"[test]   WS check error: {e}")
        time.sleep(1)
    print(f"[test] TIMEOUT: WebSocket did not connect within {timeout}s")
    return False


def wait_for_racing(driver, timeout=RACING_DETECT_TIMEOUT):
    """
    After WS connects, wait for the tab title to show FPS (racing state).
    The tab title format during racing: "18fps 340ms | Shadow Driver"
    """
    print(f"[test] Waiting up to {timeout}s for racing to begin...")
    start = time.time()
    while time.time() - start < timeout:
        try:
            title = driver.title
            if "fps" in title:
                print(f"[test]   Racing detected: {title}")
                return True
        except Exception:
            pass
        time.sleep(1)
    print(f"[test] Racing state not detected within {timeout}s (may still be working)")
    return False


# ─── Main Test ──────────────────────────────────────────────────────────────

def run_test(game_url: str, duration: int = RACE_DURATION):
    # Create output directory
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(__file__).parent.parent / "test-results" / ts
    out_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir = out_dir / "screenshots"
    screenshots_dir.mkdir()

    print(f"[test] Output: {out_dir}")
    print(f"[test] Game URL: {game_url}")
    print(f"[test] Duration: {duration}s")
    print(f"[test] Capture method: save_screenshot (full viewport)")
    print()

    # Connect to Safari Technology Preview
    options = Options()
    options.use_technology_preview = True
    driver = webdriver.Remote(command_executor=f'http://localhost:{SAFARIDRIVER_PORT}', options=options)
    driver.set_window_size(1920, 1080)

    # Dismiss Safari automation consent dialog
    time.sleep(1)
    subprocess.run(
        ['osascript', '-e', 'tell application "System Events" to keystroke return'],
        capture_output=True
    )
    time.sleep(0.5)

    metrics_log = []
    frame_idx = 0

    try:
        # ── Step 1: Navigate to game ──
        print("[test] Navigating to game...")
        driver.get(game_url)
        time.sleep(2)
        # Mark as returning player to skip first-time controls overlay
        driver.execute_script("localStorage.setItem('shadow_driver_has_played', 'true');")
        print("[test] Set localStorage: shadow_driver_has_played=true")
        # Reload so React reads the updated localStorage
        driver.get(game_url)
        time.sleep(3)

        # Take initial screenshot
        driver.save_screenshot(str(screenshots_dir / "00_initial.png"))
        print("[test] Initial screenshot saved")

        # ── Step 2: Wait for RaceSetup and click Start Race ──
        print("[test] Looking for Start Race button...")
        try:
            start_btn = WebDriverWait(driver, 15).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Start Race')]"))
            )
            driver.save_screenshot(str(screenshots_dir / "01_race_setup.png"))
            print("[test] Found Start Race button, clicking...")
            start_btn.click()
            time.sleep(1)
        except Exception as e:
            print(f"[test] Could not find Start Race button: {e}")
            try:
                driver.find_element(By.TAG_NAME, "canvas")
                print("[test] Canvas found — may already be in race")
            except Exception:
                driver.save_screenshot(str(screenshots_dir / "error_no_start_btn.png"))
                raise

        # ── Step 3: Wait for WebSocket to connect ──
        driver.save_screenshot(str(screenshots_dir / "02_connecting.png"))
        ws_connected = wait_for_websocket(driver, timeout=WS_CONNECT_TIMEOUT)

        if not ws_connected:
            driver.save_screenshot(str(screenshots_dir / "error_ws_failed.png"))
            print("[test] ERROR: WebSocket failed to connect. Aborting drive phase.")
            print("[test] Check: Is the SSH tunnel up? Is the race server running?")
            # Still save report with what we have
            raise RuntimeError("WebSocket connection failed")

        driver.save_screenshot(str(screenshots_dir / "03_ws_connected.png"))
        print("[test] WebSocket connected!")

        # ── Step 4: Wait for racing state (countdown → racing) ──
        racing = wait_for_racing(driver, timeout=RACING_DETECT_TIMEOUT)
        time.sleep(2)  # Extra buffer for countdown to finish

        driver.save_screenshot(str(screenshots_dir / "04_racing.png"))
        if racing:
            print("[test] Race is live!")
        else:
            print("[test] Proceeding anyway (may be in countdown or loading)")

        # ── Step 5: Dismiss any overlay + enable debug ──
        # Dispatch real keydown on window to dismiss FirstTimeOverlay
        # (it listens for window keydown events after 200ms delay)
        print("[test] Dismissing overlays...")
        time.sleep(0.5)
        driver.execute_script(
            "window.dispatchEvent(new KeyboardEvent('keydown', "
            "{key: 'w', code: 'KeyW', keyCode: 87, bubbles: true}));"
        )
        time.sleep(0.3)
        # Double-tap to be safe
        driver.execute_script(
            "window.dispatchEvent(new KeyboardEvent('keydown', "
            "{key: 'w', code: 'KeyW', keyCode: 87, bubbles: true}));"
        )
        time.sleep(0.5)
        driver.save_screenshot(str(screenshots_dir / "05_overlay_dismissed.png"))

        # Enable debug overlay (backtick key)
        print("[test] Enabling debug overlay...")
        driver.execute_script(
            "window.dispatchEvent(new KeyboardEvent('keydown', "
            "{key: '`', code: 'Backquote', keyCode: 192, bubbles: true}));"
        )
        time.sleep(0.5)

        # ── Step 6: Drive and capture ──
        drive_seq = make_drive_sequence(duration)
        start_time = time.time()
        next_capture_time = start_time
        next_metrics_time = start_time
        seq_idx = 0

        print(f"[test] Driving for {duration}s — screenshots every {SCREENSHOT_INTERVAL}s, metrics every {METRICS_INTERVAL}s")
        print(f"[test] Drive sequence: accel→brake→reverse+steer→left→right→slalom→handbrake→respawn")
        print()

        # Start driving: hold W
        driver.execute_script(
            "window.__e2eKeys = {w: true, a: false, s: false, d: false, space: false};"
        )
        current_phase = "accelerating"
        stuck_since = None          # timestamp when car was first detected stuck
        auto_respawn_count = 0      # count of auto-respawns triggered
        STUCK_THRESHOLD_S = 4.0     # seconds of being stuck before auto-respawn
        last_speed_kmh = None

        while time.time() - start_time < duration:
            elapsed = time.time() - start_time
            now = time.time()

            # Update driving input based on sequence
            while seq_idx < len(drive_seq) - 1 and drive_seq[seq_idx + 1]["t"] <= elapsed:
                seq_idx += 1

            step = drive_seq[seq_idx]
            keys = step["keys"]
            js_keys = json.dumps(keys).lower()
            driver.execute_script(f"window.__e2eKeys = {js_keys};")

            # Handle respawn event (dispatch R key)
            if step.get("respawn") and current_phase != "respawn":
                print(f"  [{int(elapsed):3d}s] Phase: respawn (sending R key)")
                driver.execute_script(
                    "window.dispatchEvent(new KeyboardEvent('keydown', "
                    "{key: 'r', code: 'KeyR', keyCode: 82, bubbles: true}));"
                )
                time.sleep(0.1)
                driver.execute_script(
                    "window.dispatchEvent(new KeyboardEvent('keyup', "
                    "{key: 'r', code: 'KeyR', keyCode: 82, bubbles: true}));"
                )

            # Use label from drive sequence for phase tracking
            phase = step.get("label", "unknown")

            if phase != current_phase:
                print(f"  [{int(elapsed):3d}s] Phase: {phase}")
                current_phase = phase

            # Capture full-viewport screenshot at SCREENSHOT_INTERVAL rate
            if now >= next_capture_time:
                try:
                    fname = f"frame_{frame_idx:04d}_{int(elapsed * 10):04d}.png"
                    driver.save_screenshot(str(screenshots_dir / fname))
                    frame_idx += 1
                except Exception:
                    pass  # Don't let capture failures interrupt driving
                next_capture_time = now + SCREENSHOT_INTERVAL

            # Sample metrics at METRICS_INTERVAL rate
            if now >= next_metrics_time:
                try:
                    metrics = driver.execute_script(EXTRACT_METRICS_JS)
                    metrics["elapsed_s"] = round(elapsed, 1)
                    metrics["input_keys"] = keys
                    metrics["phase"] = current_phase
                    metrics["frame_idx"] = frame_idx
                    metrics_log.append(metrics)

                    # Stuck detection: if throttle is on (W key) and speed < 3 km/h
                    # for STUCK_THRESHOLD_S seconds, auto-respawn
                    speed = metrics.get("speed_kmh")
                    last_speed_kmh = speed
                    throttle_on = keys.get("w", False) and not keys.get("s", False)
                    if throttle_on and speed is not None and speed < 3:
                        if stuck_since is None:
                            stuck_since = now
                        elif now - stuck_since > STUCK_THRESHOLD_S:
                            auto_respawn_count += 1
                            print(f"  [{int(elapsed):3d}s] AUTO-RESPAWN #{auto_respawn_count}: stuck at {speed}km/h for {STUCK_THRESHOLD_S}s")
                            driver.execute_script(
                                "window.dispatchEvent(new KeyboardEvent('keydown', "
                                "{key: 'r', code: 'KeyR', keyCode: 82, bubbles: true}));"
                            )
                            time.sleep(0.1)
                            driver.execute_script(
                                "window.dispatchEvent(new KeyboardEvent('keyup', "
                                "{key: 'r', code: 'KeyR', keyCode: 82, bubbles: true}));"
                            )
                            stuck_since = None
                            # Brief pause after respawn before resuming inputs
                            time.sleep(1.5)
                    else:
                        stuck_since = None

                    # Print condensed status every ~2 seconds
                    if len(metrics_log) % 10 == 0:
                        fps_str = f"{metrics['fps']}fps" if metrics['fps'] else "?fps"
                        lat_str = f"{metrics['latency_ms']}ms" if metrics['latency_ms'] else "?ms"
                        ws_str = metrics.get('ws_state', '?')
                        spd_str = f"{speed}km/h" if speed is not None else "?km/h"
                        print(f"  [{int(elapsed):3d}s] {fps_str} {lat_str} ws={ws_str} spd={spd_str} frames={frame_idx} phase={current_phase}")
                except Exception:
                    pass
                next_metrics_time = now + METRICS_INTERVAL

            time.sleep(0.05)  # 20Hz loop

        # ── Step 7: Stop driving ──
        driver.execute_script(
            "window.__e2eKeys = {w: false, a: false, s: false, d: false, space: false};"
        )
        time.sleep(1)

        # Final screenshot
        driver.save_screenshot(str(screenshots_dir / "final_browser.png"))

        # Clear e2e keys
        driver.execute_script("delete window.__e2eKeys;")

    except RuntimeError as e:
        print(f"[test] {e}")
    except Exception as e:
        print(f"[test] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # ── Step 8: Save report ──
        report = {
            "game_url": game_url,
            "duration_s": duration,
            "timestamp": ts,
            "capture_method": "save_screenshot",
            "total_frames": frame_idx,
            "total_metrics_samples": len(metrics_log),
            "capture_rate_hz": round(frame_idx / max(duration, 1), 1),
            "metrics_rate_hz": round(len(metrics_log) / max(duration, 1), 1),
            "metrics": metrics_log,
        }

        # Compute summary stats
        fps_values = [m["fps"] for m in metrics_log if m.get("fps") is not None]
        lat_values = [m["latency_ms"] for m in metrics_log if m.get("latency_ms") is not None]
        ws_states = [m.get("ws_state") for m in metrics_log if m.get("ws_state")]

        if fps_values:
            report["summary"] = {
                "avg_fps": round(sum(fps_values) / len(fps_values), 1),
                "min_fps": min(fps_values),
                "max_fps": max(fps_values),
                "avg_latency_ms": round(sum(lat_values) / len(lat_values), 1) if lat_values else None,
                "min_latency_ms": min(lat_values) if lat_values else None,
                "max_latency_ms": max(lat_values) if lat_values else None,
                "samples": len(fps_values),
                "ws_state_final": metrics_log[-1].get("ws_state") if metrics_log else None,
            }

        if ws_states:
            report["ws_states_seen"] = list(set(ws_states))

        report_path = out_dir / "report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)

        # Print summary
        print()
        print("=" * 60)
        print("  GAMEPLAY TEST REPORT")
        print("=" * 60)
        if "summary" in report:
            s = report["summary"]
            print(f"  FPS:     avg={s['avg_fps']}  min={s['min_fps']}  max={s['max_fps']}")
            if s.get("avg_latency_ms"):
                print(f"  Latency: avg={s['avg_latency_ms']}ms  min={s['min_latency_ms']}ms  max={s['max_latency_ms']}ms")
            print(f"  Samples: {s['samples']}")
            print(f"  WS:      {s.get('ws_state_final', '?')}")
        else:
            print("  No FPS metrics collected (game may not have connected)")
        if ws_states:
            print(f"  WS states seen: {', '.join(set(ws_states))}")
        print(f"  Screenshots: {report.get('total_frames', 0)} ({report.get('capture_rate_hz', 0)} fps)")
        print(f"  Metrics samples: {report.get('total_metrics_samples', 0)} ({report.get('metrics_rate_hz', 0)} Hz)")
        print(f"  Report: {report_path}")
        print("=" * 60)

        driver.quit()

    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Shadow Driver v3 automated gameplay test")
    parser.add_argument("--url", default=None, help="Full game URL (overrides --ws)")
    parser.add_argument("--ws", default=None, help="WebSocket URL (e.g., ws://localhost:8765)")
    parser.add_argument("--duration", type=int, default=RACE_DURATION, help="Driving duration in seconds")
    args = parser.parse_args()

    if args.url:
        url = args.url
    elif args.ws:
        url = f"http://localhost:5173/race?ws={args.ws}"
    else:
        url = DEFAULT_GAME_URL

    run_test(url, args.duration)
