#!/usr/bin/env python3
"""
Browser automation test for Shadow Driver game.
Uses Safari Technology Preview via Selenium.

Prerequisites:
- safaridriver running: /Applications/Safari\ Technology\ Preview.app/Contents/MacOS/safaridriver -p 4445
"""

import time
import json
import sys
from datetime import datetime

try:
    from selenium import webdriver
    from selenium.webdriver.safari.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
except ImportError:
    print("ERROR: selenium not installed. Run: pip install selenium")
    sys.exit(1)

GAME_URL = "https://v2-sigma-lemon.vercel.app"
SCREENSHOT_DIR = "/tmp/shadow_driver_tests"

def log(msg):
    """Log with timestamp."""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def save_screenshot(driver, name):
    """Save a screenshot with the given name."""
    import os
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    path = f"{SCREENSHOT_DIR}/{name}.png"
    driver.save_screenshot(path)
    log(f"Screenshot saved: {path}")
    return path

def get_console_logs(driver):
    """Get browser console logs (may not work on Safari)."""
    try:
        logs = driver.get_log('browser')
        return logs
    except:
        return []

def test_game():
    """Main test function."""
    log("Starting browser automation test...")

    # Connect to Safari Technology Preview on port 4445
    options = Options()
    options.use_technology_preview = True

    try:
        driver = webdriver.Remote(command_executor='http://localhost:4445', options=options)
    except Exception as e:
        log(f"ERROR: Failed to connect to safaridriver: {e}")
        log("Make sure safaridriver is running on port 4445")
        return False

    driver.set_window_size(1400, 900)

    results = {
        "timestamp": datetime.now().isoformat(),
        "tests": {}
    }

    try:
        # Test 1: Load the game
        log("TEST 1: Loading game...")
        driver.get(GAME_URL)
        time.sleep(3)
        save_screenshot(driver, "01_initial_load")

        # Check if page loaded
        title = driver.title
        log(f"Page title: {title}")
        results["tests"]["page_load"] = {"passed": True, "title": title}

        # Test 2: Check for game elements
        log("TEST 2: Looking for game elements...")
        time.sleep(2)

        # Look for canvas or game container
        try:
            canvas = driver.find_element(By.TAG_NAME, "canvas")
            log(f"Found canvas: {canvas.size}")
            results["tests"]["canvas_found"] = {"passed": True, "size": canvas.size}
        except:
            log("No canvas found, looking for other game elements...")
            results["tests"]["canvas_found"] = {"passed": False}

        # Look for buttons
        buttons = driver.find_elements(By.TAG_NAME, "button")
        button_texts = [b.text for b in buttons if b.text]
        log(f"Found {len(buttons)} buttons: {button_texts[:5]}")
        results["tests"]["buttons"] = {"count": len(buttons), "texts": button_texts[:10]}

        save_screenshot(driver, "02_game_elements")

        # Test 3: Look for start/play button
        log("TEST 3: Looking for play/start button...")
        play_button = None
        for btn in buttons:
            txt = btn.text.lower()
            if 'play' in txt or 'start' in txt or 'race' in txt or 'arcade' in txt or 'mode' in txt:
                play_button = btn
                log(f"Found potential play button: '{btn.text}'")
                break

        if play_button:
            results["tests"]["play_button"] = {"found": True, "text": play_button.text}
            log(f"Clicking: {play_button.text}")
            play_button.click()
            time.sleep(2)
            save_screenshot(driver, "03_after_play_click")
        else:
            log("No play button found - maybe game auto-starts?")
            results["tests"]["play_button"] = {"found": False}

        # Test 4: Look for track/game canvas
        log("TEST 4: Looking for track/game view...")
        time.sleep(2)
        save_screenshot(driver, "04_game_view")

        # Check for any game-related text
        body_text = driver.find_element(By.TAG_NAME, "body").text
        has_speed = "speed" in body_text.lower() or "mph" in body_text.lower() or "km" in body_text.lower()
        has_time = "time" in body_text.lower() or "lap" in body_text.lower()
        log(f"Has speed indicator: {has_speed}, Has time indicator: {has_time}")
        results["tests"]["game_indicators"] = {"speed": has_speed, "time": has_time}

        # Test 5: Try keyboard controls
        log("TEST 5: Testing keyboard controls...")
        body = driver.find_element(By.TAG_NAME, "body")

        # Press arrow keys
        for key, name in [(Keys.ARROW_UP, "UP"), (Keys.ARROW_DOWN, "DOWN"),
                          (Keys.ARROW_LEFT, "LEFT"), (Keys.ARROW_RIGHT, "RIGHT")]:
            body.send_keys(key)
            time.sleep(0.2)

        time.sleep(1)
        save_screenshot(driver, "05_after_keyboard")
        log("Keyboard controls tested (check screenshots for visual feedback)")
        results["tests"]["keyboard_test"] = {"completed": True}

        # Test 6: Look for GPU/AI mode button
        log("TEST 6: Looking for GPU/AI mode option...")
        buttons = driver.find_elements(By.TAG_NAME, "button")
        gpu_button = None
        for btn in buttons:
            txt = btn.text.lower()
            if 'gpu' in txt or 'ai' in txt or 'realistic' in txt or 'shadow' in txt:
                gpu_button = btn
                log(f"Found GPU/AI button: '{btn.text}'")
                break

        if gpu_button:
            results["tests"]["gpu_button"] = {"found": True, "text": gpu_button.text}
        else:
            log("No GPU/AI button found on current screen")
            results["tests"]["gpu_button"] = {"found": False}

        # Final screenshot
        save_screenshot(driver, "06_final_state")

        # Summary
        log("\n" + "=" * 50)
        log("TEST SUMMARY")
        log("=" * 50)
        for test_name, result in results["tests"].items():
            status = "PASS" if result.get("passed", result.get("found", result.get("completed", False))) else "CHECK"
            log(f"  {test_name}: {status}")
        log("=" * 50)
        log(f"Screenshots saved to: {SCREENSHOT_DIR}")

        # Save results
        results_path = f"{SCREENSHOT_DIR}/results.json"
        with open(results_path, 'w') as f:
            json.dump(results, f, indent=2)
        log(f"Results saved to: {results_path}")

        return True

    except Exception as e:
        log(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        save_screenshot(driver, "error_state")
        return False

    finally:
        driver.quit()
        log("Browser closed")

if __name__ == "__main__":
    success = test_game()
    sys.exit(0 if success else 1)
