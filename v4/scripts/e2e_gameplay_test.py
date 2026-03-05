#!/usr/bin/env python3
"""
e2e_gameplay_test.py - Automated gameplay testing feedback loop for Shadow Driver v3

Connects to Safari Technology Preview via safaridriver (port 4445), navigates
to the game, configures a race, simulates WASD driving for N seconds, takes
periodic screenshots, extracts performance metrics, and optionally grades
visual quality via Claude Vision API.

Usage:
    # Basic: just drive and capture screenshots
    python3 e2e_gameplay_test.py --ws ws://localhost:8765

    # Full: with AI quality scoring
    ANTHROPIC_API_KEY=sk-ant-... python3 e2e_gameplay_test.py \
        --ws ws://localhost:8765 \
        --duration 60 \
        --ai-grade \
        --output-dir ./test-results/run-001

    # Quickstart (skips race setup UI via URL param)
    python3 e2e_gameplay_test.py \
        --ws ws://localhost:8765 \
        --quickstart \
        --duration 30

Prerequisites:
    pip install selenium pillow anthropic
    Safari Technology Preview must be open with "Allow Remote Automation" enabled:
        Safari > Develop > Allow Remote Automation
    safaridriver must be started (it auto-starts on macOS Sequoia+):
        /Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver --port 4445 &

Key Design Decisions:
    1. Input method: window.__e2eKeys (JS injection) is MUCH more reliable than
       Selenium ActionChains for games. The game's 30Hz control loop reads this
       ref directly, bypassing all DOM focus + key repeat issues.
    2. Metrics: Read tab title for FPS/latency (e.g. "18fps 340ms | Shadow Driver")
       and execute_script to read window.__gameWs state for richer metrics.
    3. Screenshot timing: 500ms delay after take_screenshot() to avoid Safari
       canvas readback conflicts with WebGL compositing.
    4. Race setup: Use URL params (track=, laps=, weather=, quickstart=true) to
       skip UI entirely when possible -- much faster and more reliable than
       clicking through the setup modal.
"""

import argparse
import base64
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Imports with helpful error messages
# ---------------------------------------------------------------------------
try:
    from selenium import webdriver
    from selenium.webdriver.safari.options import Options as SafariOptions
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.keys import Keys
except ImportError:
    print("ERROR: selenium not installed. Run: pip install selenium")
    sys.exit(1)

try:
    from PIL import Image
    import io as _io
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("WARNING: Pillow not installed. Screenshots will be saved as raw PNG bytes.")
    print("         Install with: pip install pillow")

ANTHROPIC_AVAILABLE = False
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class FrameMetrics:
    """Metrics captured at a single point in time during the race."""
    timestamp: float           # time.time()
    elapsed_s: float           # seconds since race start
    fps: Optional[int]         # from tab title
    latency_ms: Optional[int]  # from tab title
    tab_title: str             # raw tab title string
    screenshot_path: str       # path to saved screenshot file
    race_status: Optional[str] # 'countdown'|'racing'|'finished'|None
    speed_kmh: Optional[float] # player speed from telemetry
    ws_state: Optional[str]    # 'connected'|'connecting'|'disconnected'

@dataclass
class TestReport:
    """Full results of a test run."""
    run_id: str
    start_time: str
    duration_s: float
    ws_url: str
    track: str
    laps: int
    weather: str
    car: str
    ai_difficulty: str
    frames: list = field(default_factory=list)
    ai_quality_scores: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    verdict: str = "pending"
    avg_fps: Optional[float] = None
    avg_latency_ms: Optional[float] = None


# ---------------------------------------------------------------------------
# Metrics extraction helpers
# ---------------------------------------------------------------------------

def parse_tab_title(title: str) -> tuple[Optional[int], Optional[int]]:
    """
    Parse FPS and latency from tab title like "18fps 340ms | Shadow Driver".
    Returns (fps, latency_ms) or (None, None) if not in racing mode.
    """
    # Pattern: "18fps 340ms | Shadow Driver"
    m = re.match(r'^(\d+)fps\s+(\d+)ms\s*\|', title)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def get_game_state_js(driver) -> dict:
    """
    Execute JS to extract rich game state from the React app's exposed globals.

    The game exposes:
      window.__gameWs        - the WebSocket instance
      window.__keysRef       - the current keysRef value (what's being sent to server)
      window.__e2eKeys       - our override key state

    Returns dict with ws_state, race_status, speed_kmh, and any other
    available telemetry.
    """
    script = """
    try {
        var result = {};

        // WebSocket connection state
        if (window.__gameWs) {
            var states = ['connecting', 'open', 'closing', 'closed'];
            result.ws_state = states[window.__gameWs.readyState] || 'unknown';
        } else {
            result.ws_state = 'no_ws';
        }

        // Current key state (what the game is actually sending to server)
        if (window.__keysRef && window.__keysRef.current) {
            result.keys = window.__keysRef.current;
        }

        // Check if e2e override is active
        result.e2e_override_active = !!window.__e2eKeys;

        // Try to read race state from React internals via a known DOM element
        // The HUD speedometer has a data attribute we can read
        var speedEl = document.querySelector('[data-testid="speedometer"]');
        if (speedEl) {
            result.speed_kmh = parseFloat(speedEl.getAttribute('data-speed') || '0');
        }

        // Try to detect race state from visible DOM elements
        // The countdown overlay has a specific class
        var countdown = document.querySelector('.countdown-overlay, [data-race-status]');
        if (countdown) {
            result.race_status = countdown.getAttribute('data-race-status') || 'countdown';
        }

        return result;
    } catch(e) {
        return { error: e.message };
    }
    """
    try:
        return driver.execute_script(script) or {}
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Key injection -- the CORRECT approach for this game
# ---------------------------------------------------------------------------

class GameKeyController:
    """
    Controls the game by injecting into window.__e2eKeys.

    This is the BEST approach for Shadow Driver v3 because:
    1. The game's 30Hz control interval reads window.__e2eKeys directly (Race.tsx:826-830)
    2. No DOM focus issues -- works regardless of which element has keyboard focus
    3. Precise: state is read every 33ms at fixed intervals, matching game tick rate
    4. Simultaneous keys trivially supported (just set multiple bool fields)
    5. No ActionChains timing jitter, no key-repeat interference
    6. Safari-compatible: just a JS object write, no browser-specific keyboard API needed

    Usage:
        ctrl = GameKeyController(driver)
        ctrl.throttle()           # hold W
        time.sleep(3)
        ctrl.steer_left()         # also hold A (simultaneous W+A)
        time.sleep(1)
        ctrl.straight()           # release A (back to just W)
        ctrl.stop()               # release all
    """

    def __init__(self, driver):
        self.driver = driver
        self._state = {"w": False, "a": False, "s": False, "d": False, "space": False}

    def _apply(self):
        """Write current state to window.__e2eKeys."""
        self.driver.execute_script(
            "window.__e2eKeys = arguments[0];", self._state.copy()
        )

    def set(self, w=False, a=False, s=False, d=False, space=False):
        """Set exact key state."""
        self._state = {"w": w, "a": a, "s": s, "d": d, "space": space}
        self._apply()

    def stop(self):
        """Release all keys."""
        self.set()

    def throttle(self):
        """Hold W (forward throttle)."""
        self._state["w"] = True
        self._state["s"] = False
        self._apply()

    def brake(self):
        """Hold S (brake/reverse)."""
        self._state["s"] = True
        self._state["w"] = False
        self._apply()

    def steer_left(self):
        """Hold A (left steer, keeps current throttle/brake)."""
        self._state["a"] = True
        self._state["d"] = False
        self._apply()

    def steer_right(self):
        """Hold D (right steer, keeps current throttle/brake)."""
        self._state["d"] = True
        self._state["a"] = False
        self._apply()

    def straight(self):
        """Release steering (keeps current throttle/brake)."""
        self._state["a"] = False
        self._state["d"] = False
        self._apply()

    def handbrake(self):
        """Hold Space (handbrake)."""
        self._state["space"] = True
        self._apply()

    def release_handbrake(self):
        """Release Space."""
        self._state["space"] = False
        self._apply()

    def forward_left(self):
        """W+A simultaneously."""
        self.set(w=True, a=True)

    def forward_right(self):
        """W+D simultaneously."""
        self.set(w=True, d=True)

    def respawn(self):
        """
        Trigger respawn (R key). This can't use __e2eKeys since R is handled
        separately. Dispatch a real keyboard event instead.
        """
        self.driver.execute_script("""
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'r', code: 'KeyR', keyCode: 82,
                bubbles: true, cancelable: true
            }));
        """)

    def toggle_debug(self):
        """Toggle debug overlay (backtick key)."""
        self.driver.execute_script("""
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: '`', code: 'Backquote', keyCode: 192,
                bubbles: true, cancelable: true
            }));
        """)

    def clear(self):
        """Remove the e2e override so real keyboard input takes over again."""
        self.driver.execute_script("delete window.__e2eKeys;")


# ---------------------------------------------------------------------------
# Alternative: ActionChains key injection (fallback, less reliable)
# ---------------------------------------------------------------------------

class ActionChainsKeyController:
    """
    Fallback key controller using Selenium ActionChains.

    LIMITATIONS compared to GameKeyController:
    - Requires the target element to have focus (use driver.find_element(...).click() first)
    - Key repeat: browsers only fire keydown once then repeat after ~500ms delay,
      so holding 'W' via key_down() works but the interval timing isn't the game's 33ms
    - Safari: ActionChains are generally reliable for single key presses but can
      drop events when the browser tab is in background or compositor is busy
    - Simultaneous keys: key_down(W) then key_down(A) works in ActionChains,
      both events are sent in the same chain perform() call

    When to use this:
    - As fallback when window.__e2eKeys isn't available (e.g., testing a different game)
    - When you need to test actual browser keyboard event handling (not just game logic)
    """

    def __init__(self, driver, target_element=None):
        self.driver = driver
        self.target = target_element
        self._held_keys = set()

    def _get_target(self):
        """Return the element to dispatch keys to, or None for the active element."""
        return self.target

    def key_down(self, key: str):
        """
        Hold a key down. key should be a Keys.* constant or a single character.

        Example:
            ctrl.key_down('w')       # hold W
            ctrl.key_down(Keys.SPACE)  # hold space
        """
        ac = ActionChains(self.driver)
        if self.target:
            ac.key_down(key, self.target)
        else:
            ac.key_down(key)
        ac.perform()
        self._held_keys.add(key)

    def key_up(self, key: str):
        """Release a held key."""
        ac = ActionChains(self.driver)
        if self.target:
            ac.key_up(key, self.target)
        else:
            ac.key_up(key)
        ac.perform()
        self._held_keys.discard(key)

    def release_all(self):
        """Release all currently held keys."""
        for key in list(self._held_keys):
            self.key_up(key)

    def tap(self, key: str, duration_ms: int = 50):
        """
        Simulate a key tap: press down, wait, release.
        duration_ms: how long to hold before release (default 50ms)
        """
        self.key_down(key)
        time.sleep(duration_ms / 1000)
        self.key_up(key)


# ---------------------------------------------------------------------------
# Screenshot capture
# ---------------------------------------------------------------------------

def take_screenshot(driver, output_path: str) -> bool:
    """
    Capture a screenshot and save to output_path.

    Safari note: driver.get_screenshot_as_png() captures the full browser
    viewport including the WebGL canvas. Canvas content IS captured (unlike
    some headless Chrome configurations). However, there is a known race
    condition where capturing immediately after a WebGL frame can yield a
    black canvas. The 200ms sleep before capture mitigates this.

    Returns True on success, False on error.
    """
    try:
        # Brief sleep to let the WebGL frame settle into the composited viewport
        time.sleep(0.2)

        png_bytes = driver.get_screenshot_as_png()

        if PIL_AVAILABLE:
            img = Image.open(_io.BytesIO(png_bytes))
            img.save(output_path)
        else:
            with open(output_path, 'wb') as f:
                f.write(png_bytes)

        return True
    except Exception as e:
        print(f"  [screenshot] Error saving to {output_path}: {e}")
        return False


def screenshot_is_black(screenshot_path: str, threshold: float = 0.01) -> bool:
    """
    Heuristic: returns True if the screenshot is predominantly black (likely a
    black screen bug -- NVENC not producing frames, WebGL not rendering, etc.).

    threshold: fraction of non-black pixels required to be considered "live"
    """
    if not PIL_AVAILABLE:
        return False
    try:
        img = Image.open(screenshot_path).convert('L')  # grayscale
        pixels = list(img.getdata())
        non_black = sum(1 for p in pixels if p > 10)
        return (non_black / len(pixels)) < threshold
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Race setup via URL params (recommended approach)
# ---------------------------------------------------------------------------

def build_game_url(base_url: str, ws_url: str, track: str = "Town05",
                   laps: int = 2, weather: str = "clear",
                   car: str = "vehicle.tesla.model3",
                   ai_model: str = "carla_pilotnet",
                   quickstart: bool = False) -> str:
    """
    Build the game URL with all race settings encoded as query parameters.

    Using URL params is FAR better than clicking through the UI because:
    1. No timing issues with React state updates
    2. Works even if UI layout changes
    3. The quickstart=true param skips the setup screen entirely and
       auto-starts the race after 1 second (Race.tsx:isQuickstart logic)
    """
    params = [
        f"ws={ws_url}",
        f"track={track}",
        f"laps={laps}",
        f"weather={weather}",
        f"playerCar={car}",
        f"model={ai_model}",
    ]
    if quickstart:
        params.append("quickstart=true")

    return f"{base_url}?{'&'.join(params)}"


# ---------------------------------------------------------------------------
# Race setup via UI clicking (fallback when you need to test the UI itself)
# ---------------------------------------------------------------------------

def click_through_race_setup(driver, wait: WebDriverWait, track: str = "Town05",
                              weather: str = "clear", laps: int = 2):
    """
    Click through the Race Setup modal to configure and start a race.

    This approach tests the actual UI but is fragile -- prefer URL params
    (build_game_url with quickstart=True) for automated testing.

    The setup modal has:
    - Track selector buttons (each has text matching TRACKS[].name)
    - Weather buttons (each has text matching WEATHER_OPTIONS[].label)
    - Lap count buttons (1, 2, 3, 5)
    - "Start Race" button at the bottom
    """
    print("  Clicking through race setup UI...")

    try:
        # Wait for setup modal to be visible
        # The RaceSetup component renders as a fixed overlay with "Race Setup" heading
        wait.until(EC.presence_of_element_located((By.XPATH, "//*[contains(text(), 'Race Setup')]")))
        time.sleep(0.5)

        # Select track -- find the track button by its label text
        try:
            track_btn = driver.find_element(By.XPATH, f"//*[contains(text(), '{track}')]")
            track_btn.click()
            time.sleep(0.3)
            print(f"    Selected track: {track}")
        except Exception as e:
            print(f"    WARNING: Could not find track button for '{track}': {e}")

        # Select weather
        try:
            weather_label = weather.capitalize()
            weather_btn = driver.find_element(By.XPATH, f"//*[normalize-space(text())='{weather_label}']")
            weather_btn.click()
            time.sleep(0.3)
            print(f"    Selected weather: {weather}")
        except Exception as e:
            print(f"    WARNING: Could not find weather button '{weather}': {e}")

        # Select laps
        try:
            # Lap buttons are simple numbers
            laps_btn = driver.find_element(By.XPATH, f"//button[normalize-space(text())='{laps}']")
            laps_btn.click()
            time.sleep(0.3)
            print(f"    Selected laps: {laps}")
        except Exception as e:
            print(f"    WARNING: Could not find laps button '{laps}': {e}")

        # Click Start Race
        try:
            start_btn = driver.find_element(By.XPATH, "//button[contains(text(), 'Start Race')]")
            start_btn.click()
            print("    Clicked Start Race")
        except Exception as e:
            print(f"    ERROR: Could not find Start Race button: {e}")
            raise

    except Exception as e:
        print(f"  ERROR in click_through_race_setup: {e}")
        raise


# ---------------------------------------------------------------------------
# Wait for race to start
# ---------------------------------------------------------------------------

def wait_for_racing(driver, timeout: float = 60.0) -> bool:
    """
    Wait until the game enters the 'racing' state (countdown finishes).

    Detection method: tab title changes to "Xfps Yms | Shadow Driver" format,
    which only happens during active racing (Race.tsx:129).

    Returns True when racing starts, False on timeout.
    """
    print(f"  Waiting up to {timeout:.0f}s for race to start...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        title = driver.title
        fps, lat = parse_tab_title(title)
        if fps is not None:
            print(f"    Racing detected! {fps}fps {lat}ms")
            return True
        time.sleep(1.0)
    print("  WARNING: Timed out waiting for racing state")
    return False


def wait_for_countdown(driver, timeout: float = 90.0) -> bool:
    """
    Wait until the countdown appears (CARLA map has loaded and race is starting).
    Countdown phase: tab title is just "Shadow Driver" but the canvas shows video.
    """
    print(f"  Waiting up to {timeout:.0f}s for CARLA to load...")
    deadline = time.time() + timeout

    # Wait for the page to have a WebSocket connection (ws_state == 'open')
    while time.time() < deadline:
        state = get_game_state_js(driver)
        ws = state.get("ws_state", "unknown")
        if ws == "open":
            print("    WebSocket connected!")
            return True
        if ws in ("closed", "no_ws"):
            time.sleep(2.0)
        else:
            time.sleep(1.0)

    print("  WARNING: Timed out waiting for WebSocket connection")
    return False


# ---------------------------------------------------------------------------
# Driving sequences
# ---------------------------------------------------------------------------

def drive_simple_loop(ctrl: GameKeyController, duration_s: float,
                      screenshot_callback=None, screenshot_interval_s: float = 2.0):
    """
    Simple driving strategy: hold W (throttle) continuously, with gentle
    periodic steering corrections to stay on track in Town05's grid layout.

    This is the most reliable approach for automated testing because:
    - Town05 has long straight sections, so W alone keeps the car moving
    - Periodic A/D steers simulate real driving without needing AI or vision
    - Even if the car crashes or gets stuck, the loop continues capturing data

    For more sophisticated strategies, see drive_adaptive_loop() below.
    """
    start = time.time()
    screenshot_count = 0
    last_screenshot = 0.0
    steer_phase = 0  # cycle through steering patterns

    print(f"  Starting simple drive loop ({duration_s:.0f}s)...")
    ctrl.throttle()

    while True:
        now = time.time()
        elapsed = now - start
        if elapsed >= duration_s:
            break

        # Periodic steering: cycle every 8 seconds
        # (W, W+D, W, W+A) to simulate left/right turns
        phase_duration = 8.0
        phase_elapsed = elapsed % (phase_duration * 4)
        if phase_elapsed < phase_duration:
            ctrl.set(w=True)                    # straight
        elif phase_elapsed < phase_duration * 2:
            ctrl.set(w=True, d=True)            # gentle right
        elif phase_elapsed < phase_duration * 3:
            ctrl.set(w=True)                    # straight
        else:
            ctrl.set(w=True, a=True)            # gentle left

        # Periodic screenshot
        if now - last_screenshot >= screenshot_interval_s:
            last_screenshot = now
            if screenshot_callback:
                screenshot_callback(elapsed)

        time.sleep(0.1)

    ctrl.stop()
    print(f"  Drive loop complete. {screenshot_count} screenshots taken.")


def drive_slalom(ctrl: GameKeyController, duration_s: float,
                 period_s: float = 3.0):
    """
    Slalom driving: W+A, W, W+D, W pattern to test steering response and physics.
    Good for detecting grip/fishtail issues.
    """
    print(f"  Slalom drive ({duration_s:.0f}s, period={period_s:.1f}s)")
    ctrl.throttle()
    start = time.time()

    moves = [
        {"w": True, "a": True,  "s": False, "d": False, "space": False},
        {"w": True, "a": False, "s": False, "d": False, "space": False},
        {"w": True, "a": False, "s": False, "d": True,  "space": False},
        {"w": True, "a": False, "s": False, "d": False, "space": False},
    ]
    move_idx = 0

    while time.time() - start < duration_s:
        keys = moves[move_idx % len(moves)]
        ctrl.set(**keys)
        time.sleep(period_s)
        move_idx += 1

    ctrl.stop()


# ---------------------------------------------------------------------------
# AI quality grading via Claude Vision
# ---------------------------------------------------------------------------

GRADING_RUBRIC = """
You are evaluating screenshots from a browser-based racing game called Shadow Driver.
The game streams video from CARLA simulator to the browser via WebSocket.

Please evaluate each screenshot on these criteria (score 1-10 each):

1. VIDEO_QUALITY: Is the video stream clear? (No artifacts, compression blocks, blur, pixelation)
2. FPS_SMOOTHNESS: Based on visible motion blur or frame consistency, does the game appear to run smoothly?
3. UI_READABILITY: Are the HUD elements (speedometer, minimap, lap timer, gap timer) clearly visible?
4. BLACK_SCREEN: Is the canvas showing actual game content? (Score 10 = normal video, 1 = black screen)
5. GAME_STATE: Does the screenshot show expected racing content (car on track, environment)?

Also flag any specific issues you notice:
- Black screen (video feed not working)
- UI elements missing or overlapping
- Video artifacts (blocking, green screen, corruption)
- Car stuck or off-track

Return your response as JSON:
{
  "scores": {
    "video_quality": <1-10>,
    "fps_smoothness": <1-10>,
    "ui_readability": <1-10>,
    "black_screen": <1-10>,
    "game_state": <1-10>
  },
  "overall": <1-10>,
  "issues": ["issue1", "issue2"],
  "summary": "one sentence summary"
}
"""

def grade_screenshot_with_claude(screenshot_path: str,
                                  api_key: str,
                                  frame_metrics: Optional[FrameMetrics] = None) -> dict:
    """
    Send a screenshot to Claude claude-sonnet-4-6 for quality assessment.

    Returns the parsed quality scores dict, or empty dict on error.

    Cost note: each 1920x1080 screenshot is ~2500 tokens ~ $0.0075 at Sonnet pricing.
    For a 60-second test at 2s intervals = 30 screenshots = ~$0.22.
    Consider using claude-haiku for cheaper bulk grading.
    """
    if not ANTHROPIC_AVAILABLE:
        print("  WARNING: anthropic not installed. Skipping AI grading.")
        print("           Install with: pip install anthropic")
        return {}

    try:
        client = anthropic.Anthropic(api_key=api_key)

        # Encode screenshot to base64
        with open(screenshot_path, 'rb') as f:
            img_bytes = f.read()

        # Optionally resize to reduce token cost
        if PIL_AVAILABLE:
            img = Image.open(_io.BytesIO(img_bytes))
            # Target max 1568px on long edge (Claude's optimal size)
            max_dim = 1568
            if max(img.width, img.height) > max_dim:
                ratio = max_dim / max(img.width, img.height)
                new_size = (int(img.width * ratio), int(img.height * ratio))
                img = img.resize(new_size, Image.LANCZOS)
                buf = _io.BytesIO()
                img.save(buf, format='JPEG', quality=85)
                img_bytes = buf.getvalue()

        img_b64 = base64.standard_b64encode(img_bytes).decode('utf-8')

        # Build context from metrics
        context = ""
        if frame_metrics:
            context = f"\nContext: t={frame_metrics.elapsed_s:.1f}s, "
            if frame_metrics.fps is not None:
                context += f"fps={frame_metrics.fps}, lat={frame_metrics.latency_ms}ms, "
            context += f"tab_title='{frame_metrics.tab_title}'"

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": img_b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": GRADING_RUBRIC + context,
                        }
                    ],
                }
            ],
        )

        # Parse JSON from response
        text = response.content[0].text
        # Extract JSON block if wrapped in markdown
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            return json.loads(json_match.group())
        return {"raw_response": text}

    except Exception as e:
        print(f"  ERROR grading screenshot: {e}")
        return {"error": str(e)}


def grade_before_after(before_path: str, after_path: str, api_key: str,
                        change_description: str = "a code change") -> dict:
    """
    Compare two screenshots (before/after a code change) and ask Claude
    to assess visual regression.

    Use this in the feedback loop:
        scores = grade_before_after(
            before_path="results/baseline/screenshot_030.png",
            after_path="results/run-002/screenshot_030.png",
            change_description="Increased rear tire friction from 3.2 to 3.8"
        )
    """
    if not ANTHROPIC_AVAILABLE:
        return {"error": "anthropic not installed"}

    try:
        client = anthropic.Anthropic(api_key=api_key)

        def load_b64(path):
            with open(path, 'rb') as f:
                data = f.read()
            return base64.standard_b64encode(data).decode('utf-8')

        b64_before = load_b64(before_path)
        b64_after = load_b64(after_path)

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Image 1 (BEFORE the change):"},
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/png", "data": b64_before}
                        },
                        {"type": "text", "text": "Image 2 (AFTER the change):"},
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/png", "data": b64_after}
                        },
                        {
                            "type": "text",
                            "text": f"""Compare these two screenshots from the Shadow Driver racing game.
The change made was: {change_description}

Assess:
1. Is video quality better or worse after the change? (scale: -5 to +5)
2. Are there any new visual artifacts or regressions?
3. Are there improvements in rendering quality?
4. Overall verdict: IMPROVED / REGRESSED / NO_CHANGE

Return as JSON:
{{
  "quality_delta": <-5 to +5>,
  "verdict": "IMPROVED|REGRESSED|NO_CHANGE",
  "improvements": ["..."],
  "regressions": ["..."],
  "summary": "one sentence"
}}"""
                        }
                    ],
                }
            ],
        )

        text = response.content[0].text
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            return json.loads(json_match.group())
        return {"raw_response": text}

    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Main test runner
# ---------------------------------------------------------------------------

class ShadowDriverE2ETest:
    """
    Full end-to-end test runner for Shadow Driver v3.

    Lifecycle:
        test = ShadowDriverE2ETest(args)
        test.setup()      # Connect to Safari, navigate to game
        test.run()        # Execute driving sequence + capture metrics
        test.report()     # Print and save results
        test.teardown()   # Close browser
    """

    def __init__(self, args):
        self.args = args
        self.driver = None
        self.wait = None
        self.ctrl = None
        self.output_dir = Path(args.output_dir)
        self.frames: list[FrameMetrics] = []
        self.errors: list[str] = []
        self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.report_data = None

    def setup(self):
        """Connect to safaridriver and navigate to the game."""
        print("\n=== Shadow Driver E2E Test ===")
        print(f"Run ID: {self.run_id}")
        print(f"Output: {self.output_dir}")
        print()

        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Connect to Safari Technology Preview via safaridriver
        # safaridriver must be running on port 4445
        print("Connecting to safaridriver on port 4445...")
        print("(Make sure Safari Technology Preview is open with Remote Automation enabled)")
        print("  Safari TP > Develop > Allow Remote Automation")
        print()

        safari_options = SafariOptions()

        # Connect to existing safaridriver session
        # safaridriver auto-starts on macOS Ventura+, but you may need to run:
        #   /Applications/Safari\ Technology\ Preview.app/Contents/MacOS/safaridriver --port 4445 &
        self.driver = webdriver.Safari(
            options=safari_options,
            service=webdriver.safari.service.Service(
                executable_path="/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver",
                port=4445
            )
        )

        self.driver.maximize_window()
        self.wait = WebDriverWait(self.driver, 30)

        # Build game URL with all settings encoded
        game_url = build_game_url(
            base_url=self.args.base_url,
            ws_url=self.args.ws,
            track=self.args.track,
            laps=self.args.laps,
            weather=self.args.weather,
            car=self.args.car,
            ai_model=self.args.ai_model,
            quickstart=self.args.quickstart,
        )

        print(f"Navigating to: {game_url}")
        self.driver.get(game_url)
        time.sleep(2)  # Let React hydrate

        # Set up key controller
        self.ctrl = GameKeyController(self.driver)

        print("Setup complete.")

    def run(self):
        """Execute the full test: wait for race, drive, capture metrics."""
        args = self.args

        # Handle non-quickstart mode: wait for and click through setup UI
        if not args.quickstart:
            print("\nWaiting for Race Setup UI...")
            try:
                # In non-quickstart mode, the URL params pre-select settings
                # but the user must click "Start Race". We click it automatically.
                time.sleep(3)  # Wait for setup modal
                start_btn = self.driver.find_element(
                    By.XPATH, "//button[contains(text(), 'Start Race')]"
                )
                start_btn.click()
                print("Clicked Start Race button")
            except Exception as e:
                print(f"Could not auto-click Start Race: {e}")
                print("You may need to manually click Start Race in the browser.")

        # Wait for WebSocket to connect (CARLA loading)
        connected = wait_for_countdown(self.driver, timeout=90)
        if not connected:
            self.errors.append("WebSocket did not connect within 90s")
            return

        # Toggle debug overlay on to capture richer metrics in screenshots
        print("\nToggling debug overlay...")
        self.ctrl.toggle_debug()
        time.sleep(0.5)

        # Take pre-race screenshot
        pre_race_path = str(self.output_dir / "pre_race.png")
        take_screenshot(self.driver, pre_race_path)
        print(f"Pre-race screenshot: {pre_race_path}")

        # Wait for countdown to finish and racing to begin
        racing = wait_for_racing(self.driver, timeout=60)
        if not racing:
            print("WARNING: Race did not start -- capturing what we have")

        print(f"\nStarting {args.duration}s drive sequence...")

        race_start_time = time.time()
        last_screenshot_time = 0.0
        screenshot_index = 0

        # --- Main drive loop ---
        # Phase 1 (0-10s): full throttle straight to get up to speed
        # Phase 2 (10-end): alternating W, W+D, W, W+A every 8s
        self.ctrl.throttle()

        while True:
            now = time.time()
            elapsed = now - race_start_time

            if elapsed >= args.duration:
                break

            # Periodic steering (skip first 10s to let car accelerate)
            if elapsed > 10:
                phase = elapsed % 32.0
                if phase < 8:
                    self.ctrl.set(w=True)
                elif phase < 16:
                    self.ctrl.set(w=True, d=True)
                elif phase < 24:
                    self.ctrl.set(w=True)
                else:
                    self.ctrl.set(w=True, a=True)

            # Screenshot at configured interval
            if now - last_screenshot_time >= args.screenshot_interval:
                last_screenshot_time = now
                screenshot_index += 1

                screenshot_path = str(self.output_dir / f"screenshot_{screenshot_index:03d}.png")
                success = take_screenshot(self.driver, screenshot_path)

                if success:
                    # Read current metrics
                    title = self.driver.title
                    fps, lat = parse_tab_title(title)
                    js_state = get_game_state_js(self.driver)

                    is_black = screenshot_is_black(screenshot_path)
                    if is_black:
                        print(f"  [{elapsed:.1f}s] WARNING: Black screen detected!")
                        self.errors.append(f"Black screen at t={elapsed:.1f}s")

                    frame = FrameMetrics(
                        timestamp=now,
                        elapsed_s=elapsed,
                        fps=fps,
                        latency_ms=lat,
                        tab_title=title,
                        screenshot_path=screenshot_path,
                        race_status=js_state.get("race_status"),
                        speed_kmh=js_state.get("speed_kmh"),
                        ws_state=js_state.get("ws_state"),
                    )
                    self.frames.append(frame)

                    status_str = f"  [{elapsed:.1f}s] "
                    if fps is not None:
                        status_str += f"{fps}fps {lat}ms "
                    if js_state.get("ws_state"):
                        status_str += f"ws={js_state['ws_state']} "
                    status_str += f"-> {Path(screenshot_path).name}"
                    if is_black:
                        status_str += " [BLACK SCREEN]"
                    print(status_str)

            time.sleep(0.05)  # 20Hz polling -- fast enough without burning CPU

        # Stop all keys
        self.ctrl.stop()
        self.ctrl.clear()

        print(f"\nDrive complete. {screenshot_index} screenshots captured.")

        # Post-race screenshot (results screen)
        time.sleep(3)  # Wait for results to appear
        results_path = str(self.output_dir / "post_race.png")
        take_screenshot(self.driver, results_path)
        print(f"Post-race screenshot: {results_path}")

        # AI grading (optional)
        if args.ai_grade:
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                print("\nWARNING: ANTHROPIC_API_KEY not set. Skipping AI grading.")
            else:
                print(f"\nGrading {len(self.frames)} screenshots with Claude...")
                for i, frame in enumerate(self.frames):
                    print(f"  Grading {Path(frame.screenshot_path).name}...")
                    scores = grade_screenshot_with_claude(
                        frame.screenshot_path,
                        api_key=api_key,
                        frame_metrics=frame
                    )
                    if scores:
                        frame_data = {
                            "screenshot": frame.screenshot_path,
                            "elapsed_s": frame.elapsed_s,
                            "fps": frame.fps,
                            "latency_ms": frame.latency_ms,
                            "scores": scores,
                        }
                        # Add to report
                        if not hasattr(self, 'ai_scores'):
                            self.ai_scores = []
                        self.ai_scores.append(frame_data)

                        overall = scores.get("overall", "?")
                        issues = scores.get("issues", [])
                        print(f"    Overall: {overall}/10", end="")
                        if issues:
                            print(f" | Issues: {', '.join(issues)}", end="")
                        print()

    def report(self):
        """Compute aggregate stats and save the full JSON report."""
        fps_values = [f.fps for f in self.frames if f.fps is not None]
        lat_values = [f.latency_ms for f in self.frames if f.latency_ms is not None]

        avg_fps = sum(fps_values) / len(fps_values) if fps_values else None
        avg_lat = sum(lat_values) / len(lat_values) if lat_values else None

        # Determine verdict
        verdict = "UNKNOWN"
        if len(self.frames) == 0:
            verdict = "NO_DATA"
        elif len(self.errors) > 0 and any("black" in e.lower() for e in self.errors):
            verdict = "BLACK_SCREEN"
        elif avg_fps and avg_fps >= 25 and avg_lat and avg_lat < 150:
            verdict = "EXCELLENT"
        elif avg_fps and avg_fps >= 15:
            verdict = "PLAYABLE"
        elif avg_fps and avg_fps >= 5:
            verdict = "DEGRADED"
        else:
            verdict = "UNPLAYABLE"

        print("\n=== Test Report ===")
        print(f"Run ID: {self.run_id}")
        print(f"Duration: {self.args.duration}s")
        print(f"Screenshots: {len(self.frames)}")
        print(f"Avg FPS: {avg_fps:.1f}" if avg_fps else "Avg FPS: N/A")
        print(f"Avg Latency: {avg_lat:.0f}ms" if avg_lat else "Avg Latency: N/A")
        print(f"Errors: {len(self.errors)}")
        for e in self.errors:
            print(f"  - {e}")
        print(f"Verdict: {verdict}")

        # AI scores summary
        if hasattr(self, 'ai_scores') and self.ai_scores:
            all_overall = [s["scores"].get("overall", 0) for s in self.ai_scores if isinstance(s["scores"].get("overall"), (int, float))]
            if all_overall:
                avg_ai_score = sum(all_overall) / len(all_overall)
                print(f"AI Quality Score: {avg_ai_score:.1f}/10 avg")

        # Save full report to JSON
        report = {
            "run_id": self.run_id,
            "start_time": datetime.now().isoformat(),
            "args": vars(self.args),
            "verdict": verdict,
            "avg_fps": avg_fps,
            "avg_latency_ms": avg_lat,
            "frames": [
                {
                    "elapsed_s": f.elapsed_s,
                    "fps": f.fps,
                    "latency_ms": f.latency_ms,
                    "tab_title": f.tab_title,
                    "screenshot": f.screenshot_path,
                    "race_status": f.race_status,
                    "speed_kmh": f.speed_kmh,
                    "ws_state": f.ws_state,
                }
                for f in self.frames
            ],
            "errors": self.errors,
            "ai_scores": getattr(self, 'ai_scores', []),
        }

        report_path = self.output_dir / "report.json"
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        print(f"\nFull report saved: {report_path}")
        print(f"Screenshots directory: {self.output_dir}/")

        self.report_data = report
        return report

    def teardown(self):
        """Clean up: release keys, close browser."""
        if self.ctrl:
            try:
                self.ctrl.stop()
                self.ctrl.clear()
            except Exception:
                pass
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
        print("Browser closed.")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Shadow Driver v3 - Automated E2E gameplay test",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic drive test (no AI grading)
  python3 e2e_gameplay_test.py --ws ws://localhost:8765

  # Full test with AI quality scoring
  ANTHROPIC_API_KEY=sk-ant-... python3 e2e_gameplay_test.py \\
    --ws ws://localhost:8765 --ai-grade --duration 60

  # Quickstart (skip race setup UI)
  python3 e2e_gameplay_test.py --ws ws://localhost:8765 --quickstart

  # Custom track + car
  python3 e2e_gameplay_test.py \\
    --ws ws://localhost:8765 \\
    --track Town03 --laps 1 --car vehicle.ford.mustang

Prerequisites:
  1. SSH tunnel running: ssh -N -L 8765:localhost:8765 -p PORT root@IP
  2. Vite dev server: cd v3 && npx vite --host (or use --base-url https://shadow-driver-v3.vercel.app)
  3. Safari TP: open Safari Technology Preview
  4. Remote Automation: Safari TP > Develop > Allow Remote Automation
  5. safaridriver: /Applications/Safari\\ Technology\\ Preview.app/Contents/MacOS/safaridriver --port 4445 &
        """
    )

    parser.add_argument(
        "--ws",
        default="ws://localhost:8765",
        help="WebSocket URL (default: ws://localhost:8765)"
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:5173/race",
        help="Game URL base (default: http://localhost:5173/race)"
    )
    parser.add_argument(
        "--track",
        default="Town05",
        choices=["Town01", "Town02", "Town03", "Town04", "Town05", "Town07", "Town10HD"],
        help="Track to race on (default: Town05)"
    )
    parser.add_argument(
        "--laps",
        type=int,
        default=2,
        help="Number of laps (default: 2)"
    )
    parser.add_argument(
        "--weather",
        default="clear",
        choices=["clear", "cloudy", "rain", "storm", "sunset", "night"],
        help="Weather condition (default: clear)"
    )
    parser.add_argument(
        "--car",
        default="vehicle.tesla.model3",
        help="Player car blueprint ID (default: vehicle.tesla.model3)"
    )
    parser.add_argument(
        "--ai-model",
        default="carla_pilotnet",
        choices=["carla_pilotnet", "pilotnet", "alpamayo"],
        help="AI opponent model / difficulty (default: carla_pilotnet = Easy)"
    )
    parser.add_argument(
        "--quickstart",
        action="store_true",
        help="Skip race setup UI (auto-start after 1s)"
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=60.0,
        help="How long to drive in seconds (default: 60)"
    )
    parser.add_argument(
        "--screenshot-interval",
        type=float,
        default=2.0,
        help="Seconds between screenshots (default: 2.0)"
    )
    parser.add_argument(
        "--ai-grade",
        action="store_true",
        help="Grade screenshots with Claude Vision (requires ANTHROPIC_API_KEY)"
    )
    parser.add_argument(
        "--output-dir",
        default=f"./test-results/{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        help="Directory to save screenshots and report"
    )

    return parser.parse_args()


def main():
    args = parse_args()

    print("Shadow Driver v3 - Automated E2E Gameplay Test")
    print("=" * 50)

    test = ShadowDriverE2ETest(args)
    try:
        test.setup()
        test.run()
        report = test.report()
        verdict = report.get("verdict", "UNKNOWN")
        sys.exit(0 if verdict in ("EXCELLENT", "PLAYABLE") else 1)
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        test.report()
    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        test.errors.append(str(e))
        test.report()
        sys.exit(1)
    finally:
        test.teardown()


if __name__ == "__main__":
    main()
