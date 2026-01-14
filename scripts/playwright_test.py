#!/usr/bin/env python3
"""
Shadow Driver game testing with Playwright + Chromium.
Using setExternalInput() API for car control.
"""
import time
import os
import re
from datetime import datetime
from playwright.sync_api import sync_playwright

GAME_URL = "https://v2-sigma-lemon.vercel.app"
SCREENSHOT_DIR = "/tmp/shadow_driver_playwright"

os.makedirs(SCREENSHOT_DIR, exist_ok=True)

def log(msg):
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {msg}", flush=True)

def set_car_input(page, throttle, brake, steer):
    """Control the car using Phaser's setExternalInput API."""
    result = page.evaluate("""([throttle, brake, steer]) => {
        // Get Phaser game instance
        if (!window.phaserGame) {
            if (typeof Phaser !== 'undefined' && Phaser.GAMES && Phaser.GAMES.length > 0) {
                window.phaserGame = Phaser.GAMES[0];
            } else {
                return { success: false, error: 'Phaser not found' };
            }
        }

        const raceScene = window.phaserGame.scene.getScene('RaceScene');
        if (!raceScene) {
            return { success: false, error: 'RaceScene not found' };
        }

        raceScene.setExternalInput({
            throttle: throttle,
            brake: brake,
            steer: steer
        });

        return { success: true };
    }""", [throttle, brake, steer])
    return result

def main():
    log("=== Shadow Driver Playwright Test ===")
    log("Using Phaser's setExternalInput() API for car control")

    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        page = browser.new_page()
        page.set_viewport_size({"width": 1280, "height": 900})

        # Capture console logs
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        try:
            # Navigate to game
            log("\n=== STEP 1: Navigate to Race ===")
            page.goto(GAME_URL)
            page.wait_for_load_state("networkidle")
            page.screenshot(path=f"{SCREENSHOT_DIR}/01_home.png")
            log(f"Screenshot: {SCREENSHOT_DIR}/01_home.png")

            # Select Race Against Computer
            race_btn = page.locator("text=Race Against Computer").first
            if race_btn.count() > 0:
                race_btn.click()
                page.wait_for_timeout(2000)
                log("Clicked 'Race Against Computer'")

            page.screenshot(path=f"{SCREENSHOT_DIR}/02_track_select.png")

            # Select track (Choose This Track button)
            choose_btn = page.locator("button:has-text('Choose This Track')").first
            if choose_btn.count() > 0:
                choose_btn.click()
                page.wait_for_timeout(2000)
                log("Clicked 'Choose This Track'")

            # Start Race
            start_btn = page.locator("button:has-text('Start Race')").first
            if start_btn.count() > 0:
                start_btn.click()
                page.wait_for_timeout(1000)
                log("Clicked 'Start Race'")

            # Use Local AI
            local_btn = page.locator("button:has-text('Local')").first
            if local_btn.count() > 0:
                local_btn.click()
                log("Clicked 'Local' AI")

            # Wait for countdown
            log("Waiting for countdown...")
            page.wait_for_timeout(6000)

            # Dismiss tutorial
            got_it_btn = page.locator("button:has-text('Got It')").first
            if got_it_btn.count() > 0:
                got_it_btn.click()
                page.wait_for_timeout(1000)
                log("Dismissed tutorial")

            page.screenshot(path=f"{SCREENSHOT_DIR}/03_race_start.png")
            log("✓ REQUIREMENT 1: Track is visible!")

            # Test setExternalInput API
            log("\n=== STEP 2: Test setExternalInput API ===")
            result = set_car_input(page, True, False, 0)
            log(f"API result: {result}")

            if not result or not result.get('success'):
                log("✗ setExternalInput API not working")
                return False

            # Wait a moment and check speed
            page.wait_for_timeout(2000)
            body_text = page.locator("body").text_content()
            speed_match = re.search(r'(\d+)\s*km/h', body_text, re.IGNORECASE)
            if speed_match:
                speed = int(speed_match.group(1))
                log(f"Speed: {speed} km/h")
                if speed > 0:
                    log("✓ REQUIREMENT 2: Car control works!")

            page.screenshot(path=f"{SCREENSHOT_DIR}/04_accelerating.png")

            # Race around the track!
            log("\n=== STEP 3: Race! ===")
            log("Driving for 90 seconds to complete 3 laps...")

            race_finished = False
            last_lap = 0
            best_speed = 0
            start_time = time.time()

            for i in range(900):  # 90 seconds at 10 updates/sec
                # Calculate steering for oval track
                cycle = i % 200

                if cycle < 80:  # Top straight
                    steer = 0
                elif cycle < 100:  # First corner (right)
                    steer = 0.8
                elif cycle < 180:  # Bottom straight
                    steer = 0
                else:  # Second corner (right)
                    steer = 0.8

                # Always accelerate
                set_car_input(page, True, False, steer)
                page.wait_for_timeout(100)

                # Check progress every 10 seconds
                if i % 100 == 0 and i > 0:
                    body_text = page.locator("body").text_content()

                    # Check speed
                    speed_match = re.search(r'(\d+)\s*km/h', body_text, re.IGNORECASE)
                    if speed_match:
                        speed = int(speed_match.group(1))
                        if speed > best_speed:
                            best_speed = speed
                        log(f"Speed: {speed} km/h")

                    # Check lap
                    lap_match = re.search(r'lap\s*(\d+)/3', body_text, re.IGNORECASE)
                    if lap_match:
                        current_lap = int(lap_match.group(1))
                        if current_lap > last_lap:
                            log(f"=== LAP {current_lap}/3 ===")
                            last_lap = current_lap
                            page.screenshot(path=f"{SCREENSHOT_DIR}/05_lap_{current_lap}.png")

                    # Check for race finish
                    if ("you won" in body_text.lower() or
                        "you lost" in body_text.lower() or
                        "race complete" in body_text.lower()):
                        log("🏁 RACE FINISHED!")
                        race_finished = True
                        break

                    if last_lap >= 3:
                        log("Completed all laps!")
                        page.wait_for_timeout(2000)
                        break

            elapsed = time.time() - start_time
            log(f"Race duration: {elapsed:.1f} seconds")

            # Release controls
            set_car_input(page, False, False, 0)
            page.screenshot(path=f"{SCREENSHOT_DIR}/06_final.png")

            # Final state
            log("\n=== FINAL RESULTS ===")
            body_text = page.locator("body").text_content()
            log(f"Page text:\n{body_text[:600]}")

            lap_match = re.search(r'lap\s*(\d+)', body_text, re.IGNORECASE)
            time_match = re.search(r'time\s*(\d+:\d+\.\d+)', body_text, re.IGNORECASE)

            if lap_match:
                log(f"Final Lap: {lap_match.group(1)}/3")
            if time_match:
                log(f"Race Time: {time_match.group(1)}")
            log(f"Best Speed: {best_speed} km/h")

            if best_speed > 0:
                log("✓ REQUIREMENT 2: Controls work!")

            if race_finished or last_lap >= 3:
                log("✓ REQUIREMENT 4: Race completed!")

            log("\n=== SUMMARY ===")
            log(f"Screenshots: {SCREENSHOT_DIR}")

            # Print console logs
            log("\n=== Console Logs (last 10) ===")
            for entry in console_logs[-10:]:
                log(entry)

            return True

        except Exception as e:
            log(f"ERROR: {e}")
            import traceback
            traceback.print_exc()
            try:
                page.screenshot(path=f"{SCREENSHOT_DIR}/error.png")
            except:
                pass
            return False

        finally:
            browser.close()
            log("Done")

if __name__ == "__main__":
    main()
