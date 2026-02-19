#!/usr/bin/env python3
"""
Automated WASD control test for Shadow Driver v3.
Uses Safari WebDriver to open the game, start a race, and verify all controls work.
Reads telemetry from the page to verify server is applying steering/throttle/brake.
"""
import sys
import time
import json
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
    print("Example: /usr/bin/python3 test_controls.py 'https://shadow-driver-v3.vercel.app/race?ws=https://xxx.trycloudflare.com'")
    sys.exit(1)

print(f"=== Shadow Driver Control Test ===")
print(f"URL: {GAME_URL}")

# Connect to Safari via safaridriver on port 9515
options = Options()
driver = webdriver.Remote(command_executor='http://localhost:9515', options=options)
driver.set_window_size(1400, 900)

# Dismiss Safari automation dialog
time.sleep(1)
subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke return'], capture_output=True)
time.sleep(0.5)


def read_telemetry():
    """Read race telemetry from the page by intercepting the last race_state message."""
    try:
        result = driver.execute_script("""
            // Try to read from the window.__lastRaceState that our injector set
            if (window.__lastRaceState) {
                return JSON.stringify(window.__lastRaceState);
            }
            return null;
        """)
        if result:
            return json.loads(result)
    except Exception:
        pass
    return None


def inject_telemetry_capture():
    """Inject a WebSocket interceptor to capture race_state messages."""
    driver.execute_script("""
        // Intercept WebSocket messages to capture telemetry
        if (!window.__wsIntercepted) {
            window.__wsIntercepted = true;
            const origSend = WebSocket.prototype.send;
            const origAddEventListener = WebSocket.prototype.addEventListener;

            // Monkey-patch the WebSocket constructor to intercept onmessage
            const OrigWS = window.WebSocket;
            window.WebSocket = function(...args) {
                const ws = new OrigWS(...args);
                const origOnMessage = Object.getOwnPropertyDescriptor(OrigWS.prototype, 'onmessage');

                ws.addEventListener('message', function(event) {
                    if (typeof event.data === 'string') {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.type === 'race_state') {
                                window.__lastRaceState = data;
                            }
                        } catch(e) {}
                    }
                });
                return ws;
            };
            window.WebSocket.prototype = OrigWS.prototype;
            window.WebSocket.CONNECTING = OrigWS.CONNECTING;
            window.WebSocket.OPEN = OrigWS.OPEN;
            window.WebSocket.CLOSING = OrigWS.CLOSING;
            window.WebSocket.CLOSED = OrigWS.CLOSED;
        }
    """)


def print_telemetry(label):
    """Print current telemetry values for diagnostics."""
    telem = read_telemetry()
    if telem:
        p = telem.get('player', {})
        print(f"    [{label}] speed={p.get('speed_kmh', '?')} throttle={p.get('throttle', '?')} "
              f"steer={p.get('steer', '?')} brake={p.get('brake', '?')} "
              f"status={telem.get('race_status', '?')}")
    else:
        print(f"    [{label}] No telemetry available yet")


try:
    # 1. Open game and inject telemetry capture
    print("\n[1] Opening game...")
    driver.get(GAME_URL)
    time.sleep(2)
    inject_telemetry_capture()
    time.sleep(1)
    driver.save_screenshot('/tmp/sd_01_loaded.png')
    print("    Screenshot: /tmp/sd_01_loaded.png")

    # 2. Click Start Race button
    print("\n[2] Looking for Start Race button...")
    try:
        start_btn = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Start Race')]"))
        )
        start_btn.click()
        print("    Clicked Start Race")
    except Exception as e:
        print(f"    ERROR: Could not find Start Race button: {e}")
        driver.save_screenshot('/tmp/sd_error_nobutton.png')
        sys.exit(1)

    # 3. Wait for connection + countdown
    print("\n[3] Waiting for race to start...")
    time.sleep(12)
    driver.save_screenshot('/tmp/sd_02_racing.png')
    print("    Screenshot: /tmp/sd_02_racing.png")
    print_telemetry("pre-controls")

    # 4. Test W key (forward) - 4 seconds
    print("\n[4] Testing W key (throttle)...")
    actions = ActionChains(driver)
    actions.key_down('w').perform()
    time.sleep(2)
    print_telemetry("W 2s")
    time.sleep(2)
    print_telemetry("W 4s")
    driver.save_screenshot('/tmp/sd_03_w_pressed.png')
    # DON'T release W yet — keep it held for next test

    # 5. Test W+A (forward + turn left) - 4 seconds
    print("\n[5] Testing W+A (forward + steer left)...")
    actions = ActionChains(driver)
    actions.key_down('a').perform()  # W is already held
    time.sleep(1)
    print_telemetry("W+A 1s")
    time.sleep(1)
    print_telemetry("W+A 2s")
    time.sleep(2)
    print_telemetry("W+A 4s")
    driver.save_screenshot('/tmp/sd_04_wa_pressed.png')
    actions = ActionChains(driver)
    actions.key_up('a').perform()
    print("    Screenshot: /tmp/sd_04_wa_pressed.png")
    time.sleep(0.5)

    # 6. Test W+D (forward + turn right) - 4 seconds
    print("\n[6] Testing W+D (forward + steer right)...")
    actions = ActionChains(driver)
    actions.key_down('d').perform()  # W still held
    time.sleep(1)
    print_telemetry("W+D 1s")
    time.sleep(1)
    print_telemetry("W+D 2s")
    time.sleep(2)
    print_telemetry("W+D 4s")
    driver.save_screenshot('/tmp/sd_05_wd_pressed.png')
    actions = ActionChains(driver)
    actions.key_up('d').key_up('w').perform()
    print("    Screenshot: /tmp/sd_05_wd_pressed.png")
    time.sleep(1)

    # 7. Test S (brake/reverse) - 3 seconds
    print("\n[7] Testing S (brake/reverse)...")
    actions = ActionChains(driver)
    actions.key_down('s').perform()
    time.sleep(1)
    print_telemetry("S 1s")
    time.sleep(2)
    print_telemetry("S 3s")
    driver.save_screenshot('/tmp/sd_06_s_pressed.png')
    actions = ActionChains(driver)
    actions.key_up('s').perform()
    print("    Screenshot: /tmp/sd_06_s_pressed.png")
    time.sleep(1)

    # 8. Test R (respawn)
    print("\n[8] Testing R (respawn)...")
    actions = ActionChains(driver)
    actions.send_keys('r').perform()
    time.sleep(2)
    driver.save_screenshot('/tmp/sd_07_respawn.png')
    print_telemetry("after respawn")
    print("    Screenshot: /tmp/sd_07_respawn.png")

    # 9. Test C (camera switch)
    print("\n[9] Testing C (camera switch)...")
    actions = ActionChains(driver)
    actions.send_keys('c').perform()
    time.sleep(2)
    driver.save_screenshot('/tmp/sd_08_camera.png')
    print_telemetry("after camera")
    print("    Screenshot: /tmp/sd_08_camera.png")

    # Final
    driver.save_screenshot('/tmp/sd_09_final.png')
    print("\n=== Test complete ===")
    print("Screenshots saved to /tmp/sd_*.png")
    print("\n=== KEY RESULTS ===")
    print("Check the telemetry values above:")
    print("  - W test: throttle should be > 0, speed should increase")
    print("  - W+A test: steer should be NEGATIVE (< 0)")
    print("  - W+D test: steer should be POSITIVE (> 0)")
    print("  - S test: brake should be > 0 OR reverse active")
    print("\nAlso check server log: tail -50 /tmp/race.log")

finally:
    driver.quit()
