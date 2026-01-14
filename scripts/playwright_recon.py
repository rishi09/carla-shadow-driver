#!/usr/bin/env python3
"""
Reconnaissance script to inspect Shadow Driver game state.
Uses Firefox with Playwright.
"""
from playwright.sync_api import sync_playwright
import os

GAME_URL = "https://v2-sigma-lemon.vercel.app"
SCREENSHOT_DIR = "/tmp/shadow_driver_playwright"

os.makedirs(SCREENSHOT_DIR, exist_ok=True)

def main():
    print(f"Testing game at: {GAME_URL}")

    with sync_playwright() as p:
        browser = p.webkit.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()

        # Capture console logs
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        print("\n=== Step 1: Load game ===")
        page.goto(GAME_URL)
        page.wait_for_load_state("networkidle")
        page.screenshot(path=f"{SCREENSHOT_DIR}/01_initial.png")
        print(f"Screenshot saved: {SCREENSHOT_DIR}/01_initial.png")

        # Find all buttons
        buttons = page.locator("button").all()
        print(f"\nFound {len(buttons)} buttons:")
        for i, btn in enumerate(buttons[:10]):
            try:
                text = btn.text_content()
                if text and text.strip():
                    print(f"  {i}: '{text.strip()}'")
            except:
                pass

        # Check for canvas (game rendering)
        canvas = page.locator("canvas").all()
        print(f"\nFound {len(canvas)} canvas elements")

        # Look for game menu
        print("\n=== Step 2: Navigate to game ===")

        # Try clicking "Arcade Mode" button
        arcade_btn = page.locator("button:has-text('Arcade Mode')")
        if arcade_btn.count() > 0:
            print("Found 'Arcade Mode' button, clicking...")
            arcade_btn.click()
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{SCREENSHOT_DIR}/02_after_arcade.png")
            print(f"Screenshot saved: {SCREENSHOT_DIR}/02_after_arcade.png")

        # Look for track selection
        easy_btn = page.locator("button:has-text('Sunset Speedway'), button:has-text('Easy')")
        if easy_btn.count() > 0:
            print("Found easy track button, clicking...")
            easy_btn.first.click()
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{SCREENSHOT_DIR}/03_after_track.png")
            print(f"Screenshot saved: {SCREENSHOT_DIR}/03_after_track.png")

        # Look for Start Race button
        start_btn = page.locator("button:has-text('Start Race'), button:has-text('Race')")
        if start_btn.count() > 0:
            print("Found 'Start Race' button, clicking...")
            start_btn.first.click()
            page.wait_for_timeout(2000)
            page.screenshot(path=f"{SCREENSHOT_DIR}/04_race_start.png")
            print(f"Screenshot saved: {SCREENSHOT_DIR}/04_race_start.png")

        # Check for game canvas
        print("\n=== Step 3: Check game state ===")
        canvas = page.locator("canvas").all()
        print(f"Canvas elements: {len(canvas)}")

        # Get page text to look for game indicators
        body_text = page.locator("body").text_content()
        has_speed = "speed" in body_text.lower() or "mph" in body_text.lower()
        has_lap = "lap" in body_text.lower()
        has_time = "time" in body_text.lower()
        print(f"Speed indicator: {has_speed}")
        print(f"Lap indicator: {has_lap}")
        print(f"Time indicator: {has_time}")

        # Try keyboard controls
        print("\n=== Step 4: Test keyboard controls ===")
        page.keyboard.press("ArrowUp")
        page.wait_for_timeout(500)
        page.keyboard.press("ArrowUp")
        page.wait_for_timeout(500)
        page.screenshot(path=f"{SCREENSHOT_DIR}/05_after_keys.png")
        print(f"Screenshot saved: {SCREENSHOT_DIR}/05_after_keys.png")

        # Final state
        page.screenshot(path=f"{SCREENSHOT_DIR}/06_final.png", full_page=True)
        print(f"Screenshot saved: {SCREENSHOT_DIR}/06_final.png")

        # Print console logs
        print("\n=== Console Logs ===")
        for log in console_logs[-20:]:
            print(log)

        context.close()
        browser.close()
        print(f"\n=== Done! Screenshots in {SCREENSHOT_DIR} ===")

if __name__ == "__main__":
    main()
