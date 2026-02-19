#!/usr/bin/env python3
"""
Automated browser test for Shadow Driver v3.
Uses Safari WebDriver with a single ActionChains instance to avoid
multi-key issues with separate chains.
"""
import sys
import time
import subprocess
from selenium import webdriver
from selenium.webdriver.safari.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

GAME_URL = sys.argv[1] if len(sys.argv) > 1 else None
if not GAME_URL:
    print("Usage: /usr/bin/python3 test_controls.py <game_url>")
    sys.exit(1)

print(f"=== Shadow Driver Browser Test ===")
print(f"URL: {GAME_URL}")

options = Options()
driver = webdriver.Remote(command_executor='http://localhost:9515', options=options)
driver.set_window_size(1400, 900)

time.sleep(1)
subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke return'], capture_output=True)
time.sleep(0.5)

try:
    # 1. Open game
    print("\n[1] Opening game...")
    driver.get(GAME_URL)
    time.sleep(3)
    driver.save_screenshot('/tmp/sd_01_loaded.png')

    # 2. Click Start Race
    print("\n[2] Clicking Start Race...")
    try:
        start_btn = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Start Race')]"))
        )
        start_btn.click()
        print("    Clicked Start Race")
    except Exception as e:
        print(f"    ERROR: {e}")
        driver.save_screenshot('/tmp/sd_error.png')
        sys.exit(1)

    # 3. Wait for countdown + race start
    print("\n[3] Waiting for race start...")
    time.sleep(14)
    driver.save_screenshot('/tmp/sd_02_started.png')
    print("    Screenshot: /tmp/sd_02_started.png")

    # 4. Test all controls using a SINGLE continuous ActionChain
    # (Creating separate ActionChains for multi-key doesn't work in Safari)
    print("\n[4] Testing W (5s)...")
    actions = ActionChains(driver)
    actions.key_down('w').pause(5).perform()
    driver.save_screenshot('/tmp/sd_03_w.png')
    print("    Screenshot: /tmp/sd_03_w.png")

    print("\n[5] Testing W+A (4s)...")
    actions = ActionChains(driver)
    actions.key_down('w').key_down('a').pause(4).key_up('a').perform()
    driver.save_screenshot('/tmp/sd_04_wa.png')
    print("    Screenshot: /tmp/sd_04_wa.png")

    print("\n[6] Testing W+D (4s)...")
    actions = ActionChains(driver)
    actions.key_down('w').key_down('d').pause(4).key_up('d').key_up('w').perform()
    driver.save_screenshot('/tmp/sd_05_wd.png')
    print("    Screenshot: /tmp/sd_05_wd.png")

    print("\n[7] Testing S (3s)...")
    actions = ActionChains(driver)
    actions.key_down('s').pause(3).key_up('s').perform()
    driver.save_screenshot('/tmp/sd_06_s.png')
    print("    Screenshot: /tmp/sd_06_s.png")

    print("\n[8] Testing R (respawn)...")
    actions = ActionChains(driver)
    actions.send_keys('r').perform()
    time.sleep(2)
    driver.save_screenshot('/tmp/sd_07_r.png')
    print("    Screenshot: /tmp/sd_07_r.png")

    print("\n[9] After respawn W+A (4s)...")
    actions = ActionChains(driver)
    actions.key_down('w').key_down('a').pause(4).key_up('a').key_up('w').perform()
    driver.save_screenshot('/tmp/sd_08_wa_respawn.png')
    print("    Screenshot: /tmp/sd_08_wa_respawn.png")

    print("\n[10] Testing C (camera)...")
    actions = ActionChains(driver)
    actions.send_keys('c').perform()
    time.sleep(2)
    driver.save_screenshot('/tmp/sd_09_camera.png')
    print("    Screenshot: /tmp/sd_09_camera.png")

    print("\n=== Browser test complete ===")
    print("Screenshots at /tmp/sd_*.png")

finally:
    driver.quit()
