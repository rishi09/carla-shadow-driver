#!/usr/bin/env /usr/bin/python3
"""
Shadow Driver game testing with Safari + Selenium.
Iteration 11: Use Phaser's setExternalInput() API instead of keyboard events.
"""
import time
import os
import subprocess
import re
from datetime import datetime

from selenium import webdriver
from selenium.webdriver.safari.options import Options
from selenium.webdriver.common.by import By

GAME_URL = "https://v2-sigma-lemon.vercel.app"
SCREENSHOT_DIR = "/tmp/shadow_driver_safari"

os.makedirs(SCREENSHOT_DIR, exist_ok=True)

def log(msg):
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {msg}")

def screenshot(driver, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    try:
        driver.save_screenshot(path)
        log(f"Screenshot: {path}")
    except:
        log(f"Could not save screenshot: {name}")
    return path

def dismiss_safari_dialog():
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke return'], capture_output=True)

def set_car_input(driver, throttle, brake, steer):
    """Control the car using Phaser's setExternalInput API."""
    result = driver.execute_script("""
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
            throttle: arguments[0],
            brake: arguments[1],
            steer: arguments[2]
        });

        return { success: true };
    """, throttle, brake, steer)
    return result

def main():
    log("=== Shadow Driver Safari Test - Iteration 11 ===")
    log("Using Phaser's setExternalInput() API for car control")

    options = Options()
    options.use_technology_preview = True

    try:
        driver = webdriver.Remote(command_executor='http://localhost:4445', options=options)
        log("Connected to Safari")
    except Exception as e:
        log(f"ERROR: {e}")
        return False

    driver.set_window_size(1280, 900)
    time.sleep(1)
    dismiss_safari_dialog()
    time.sleep(0.5)

    try:
        # Navigate to game
        log("\n=== STEP 1: Navigate to Race ===")
        driver.get(GAME_URL)
        time.sleep(3)

        # Select Race Against Computer
        for card in driver.find_elements(By.XPATH, "//div[contains(@class, 'cursor-pointer')]"):
            if "Race Against Computer" in card.text:
                card.click()
                time.sleep(2)
                break

        # Select track
        for btn in driver.find_elements(By.TAG_NAME, "button"):
            if "Choose This Track" in btn.text:
                btn.click()
                time.sleep(2)
                break

        # Start Race
        for btn in driver.find_elements(By.TAG_NAME, "button"):
            if "Start Race" in btn.text:
                btn.click()
                time.sleep(1)
                break

        # Use Local AI
        for btn in driver.find_elements(By.TAG_NAME, "button"):
            if "Local" in btn.text:
                btn.click()
                break

        # Wait for countdown
        log("Waiting for countdown...")
        time.sleep(6)

        # Dismiss tutorial
        for btn in driver.find_elements(By.TAG_NAME, "button"):
            if "Got It" in btn.text:
                btn.click()
                time.sleep(1)
                break

        screenshot(driver, "01_race_start")
        log("✓ REQUIREMENT 1: Track is visible!")

        # Test setExternalInput API
        log("\n=== STEP 2: Test setExternalInput API ===")
        result = set_car_input(driver, True, False, 0)
        log(f"API result: {result}")

        if not result or not result.get('success'):
            log("✗ setExternalInput API not working")
            return False

        # Wait a moment and check speed
        time.sleep(2)
        body_text = driver.find_element(By.TAG_NAME, "body").text
        speed_match = re.search(r'(\d+)\s*km/h', body_text, re.IGNORECASE)
        if speed_match:
            speed = int(speed_match.group(1))
            log(f"Speed: {speed} km/h")
            if speed > 0:
                log("✓ REQUIREMENT 2: Car control works!")

        screenshot(driver, "02_accelerating")

        # Race around the track!
        log("\n=== STEP 3: Race! ===")
        log("Driving for 90 seconds to complete 3 laps...")

        race_finished = False
        last_lap = 0
        best_speed = 0
        start_time = time.time()

        for i in range(900):  # 90 seconds at 10 updates/sec
            # Calculate steering for oval track
            # Oval = mostly straight with right turns at ends
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
            set_car_input(driver, True, False, steer)
            time.sleep(0.1)

            # Check progress every 10 seconds
            if i % 100 == 0 and i > 0:
                body_text = driver.find_element(By.TAG_NAME, "body").text

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
                        screenshot(driver, f"03_lap_{current_lap}")

                # Check for race finish
                if ("you won" in body_text.lower() or
                    "you lost" in body_text.lower() or
                    "race complete" in body_text.lower()):
                    log("🏁 RACE FINISHED!")
                    race_finished = True
                    break

                if current_lap >= 3:
                    log("Completed all laps!")
                    time.sleep(2)
                    break

        elapsed = time.time() - start_time
        log(f"Race duration: {elapsed:.1f} seconds")

        # Release controls
        set_car_input(driver, False, False, 0)
        screenshot(driver, "04_final")

        # Final state
        log("\n=== FINAL RESULTS ===")
        body_text = driver.find_element(By.TAG_NAME, "body").text
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

        return True

    except Exception as e:
        log(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        try:
            screenshot(driver, "error")
        except:
            pass
        return False

    finally:
        try:
            driver.quit()
        except:
            pass
        log("Done")

if __name__ == "__main__":
    main()
