#!/usr/bin/env python3
"""
Manus-powered automated test & fix loop for Shadow Driver v3.

Usage:
    python3 scripts/manus_test_loop.py                    # Single test run
    python3 scripts/manus_test_loop.py --loop              # Continuous loop
    python3 scripts/manus_test_loop.py --probe             # Probe API to discover schema
    python3 scripts/manus_test_loop.py --compare           # Compare last 2 test runs

Environment:
    MANUS_API_KEY  - Manus API key (falls back to hardcoded default)
    GAME_URL       - Game URL (default: http://localhost:5173/race?ws=ws://localhost:8765)

Architecture:
    - Creates a Manus task with a detailed test prompt
    - Manus controls the user's local Chrome via CDP (localhost URLs work)
    - Polls for task completion, parses structured JSON report
    - Saves results to v3/test-results/manus/
    - Compares against previous runs for regression detection
    - Same Manus session ID is reused across loops for change tracking
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MANUS_API_KEY = os.environ.get(
    "MANUS_API_KEY",
    "sk-YmdCm6vwjjAxA51mfmZnh9X7515jw96G_ucNTnjmXUcFpZn3GygXAU3MZ65ee4H2flFtPHLoqEQ-ZYFmHLBedcBwpt-N",
)
MANUS_API_BASE = "https://api.manus.ai/v1"
DEFAULT_GAME_URL = "http://localhost:5173/race?ws=ws://localhost:8765"

RESULTS_DIR = Path(__file__).parent.parent / "test-results" / "manus"
BUG_TRACKER_PATH = RESULTS_DIR / "bug_tracker.json"
SESSION_STATE_PATH = RESULTS_DIR / "session_state.json"

# How long to wait for Manus to complete a test (seconds)
MANUS_TIMEOUT = 900  # 15 minutes (Manus browser tasks take 5-10 minutes)
MANUS_POLL_INTERVAL = 10  # seconds between status checks

# ---------------------------------------------------------------------------
# Manus API Client
# ---------------------------------------------------------------------------


def _headers() -> Dict[str, str]:
    return {
        "API_KEY": MANUS_API_KEY,
        "Content-Type": "application/json",
    }


def _post(endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST to Manus API. Uses urllib to avoid external dependencies."""
    import urllib.request
    import urllib.error

    url = f"{MANUS_API_BASE}/{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=_headers(), method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[MANUS] HTTP {e.code} from POST {endpoint}: {body}")
        raise
    except Exception as e:
        print(f"[MANUS] Error POST {endpoint}: {e}")
        raise


def _get(endpoint: str) -> Dict[str, Any]:
    """GET from Manus API."""
    import urllib.request
    import urllib.error

    url = f"{MANUS_API_BASE}/{endpoint}"
    req = urllib.request.Request(url, headers=_headers(), method="GET")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[MANUS] HTTP {e.code} from GET {endpoint}: {body}")
        raise
    except Exception as e:
        print(f"[MANUS] Error GET {endpoint}: {e}")
        raise


def probe_api() -> Dict[str, Any]:
    """Probe the Manus API to discover the schema.

    Sends a minimal request to see what fields are required/accepted.
    """
    print("[MANUS] Probing API schema...")

    # Try empty body first to get validation errors
    results = {}
    for payload in [
        {},
        {"prompt": "test"},
        {"prompt": "test", "model": "manus-1"},
    ]:
        try:
            resp = _post("tasks", payload)
            results["success"] = resp
            print(f"[MANUS] Success with payload keys: {list(payload.keys())}")
            print(f"[MANUS] Response: {json.dumps(resp, indent=2)}")
            break
        except Exception as e:
            results[str(list(payload.keys()))] = str(e)
            print(f"[MANUS] Payload {list(payload.keys())} -> {e}")

    return results


# ---------------------------------------------------------------------------
# Test Prompt Generation
# ---------------------------------------------------------------------------

# The previous Manus session ID, reused for continuity so Manus can track
# what changed between test runs.
_session_id: Optional[str] = None


def _load_session_id() -> Optional[str]:
    """Load the persistent Manus session ID for continuity across loops."""
    global _session_id
    if SESSION_STATE_PATH.exists():
        state = json.loads(SESSION_STATE_PATH.read_text())
        _session_id = state.get("manus_session_id")
    return _session_id


def _save_session_id(sid: str):
    """Persist the Manus session ID for the next loop iteration."""
    global _session_id
    _session_id = sid
    state = {}
    if SESSION_STATE_PATH.exists():
        state = json.loads(SESSION_STATE_PATH.read_text())
    state["manus_session_id"] = sid
    state["last_updated"] = datetime.now().isoformat()
    SESSION_STATE_PATH.write_text(json.dumps(state, indent=2))


def ensure_project() -> Optional[str]:
    """Create or load a Manus project for grouping test tasks.

    Using a project allows Manus to track context across test iterations,
    so it can see what changed between runs.
    """
    state = {}
    if SESSION_STATE_PATH.exists():
        state = json.loads(SESSION_STATE_PATH.read_text())

    project_id = state.get("manus_project_id")
    if project_id:
        return project_id

    try:
        resp = _post("projects", {
            "name": "Shadow Driver v3 QA",
            "instructions": (
                "You are testing a cloud-streamed racing game. "
                "Always capture video/screenshots at high frequency. "
                "Return structured JSON reports with detailed event logs."
            ),
        })
        project_id = resp.get("id") or resp.get("project_id")
        if project_id:
            state["manus_project_id"] = project_id
            state["last_updated"] = datetime.now().isoformat()
            RESULTS_DIR.mkdir(parents=True, exist_ok=True)
            SESSION_STATE_PATH.write_text(json.dumps(state, indent=2))
            print(f"[MANUS] Created project: {project_id}")
            return project_id
    except Exception as e:
        print(f"[MANUS] Could not create project (non-fatal): {e}")

    return None


def _get_previous_bugs() -> List[str]:
    """Get bug titles from the most recent test run for regression checking."""
    runs = sorted(RESULTS_DIR.glob("2*.json"))
    if not runs:
        return []
    try:
        data = json.loads(runs[-1].read_text())
        return [b.get("title", "") for b in data.get("bugs", [])]
    except Exception:
        return []


def _get_previous_working() -> List[str]:
    """Get working features from the most recent test run."""
    runs = sorted(RESULTS_DIR.glob("2*.json"))
    if not runs:
        return []
    try:
        data = json.loads(runs[-1].read_text())
        return data.get("working", [])
    except Exception:
        return []


def build_test_prompt(game_url: str, iteration: int = 1) -> str:
    """Build a comprehensive test prompt for Manus.

    The prompt is designed for machine-parseable output with video capture
    at high FPS and detailed event descriptions. Since Manus controls
    local Chrome via CDP, latency is near-zero for input commands —
    we can test many scenarios including rapid inputs.
    """
    prev_bugs = _get_previous_bugs()
    prev_working = _get_previous_working()

    regression_check = ""
    if prev_working:
        items = "\n".join(f"  - {w}" for w in prev_working[:10])
        regression_check = f"""
REGRESSION CHECK — These features were working in the previous test.
Verify each one still works and flag any that broke:
{items}
"""

    prev_bugs_note = ""
    if prev_bugs:
        items = "\n".join(f"  - {b}" for b in prev_bugs[:10])
        prev_bugs_note = f"""
KNOWN BUGS from previous test — check if these are now fixed:
{items}
"""

    return f"""You are an automated QA tester for a cloud-streamed racing game called Shadow Driver.
This is test iteration #{iteration} of a continuous testing loop.

## Setup

1. Open {game_url} in the browser
2. Wait for the page to fully load (you should see a race setup screen)
3. CRITICAL VIDEO REQUIREMENTS:
   - Start Chrome screen recording BEFORE clicking Start Race
   - Record for the FULL duration of the test (minimum 20 seconds, up to 60 seconds)
   - If Chrome recording is unavailable, take screenshots every 0.5 seconds throughout
   - Save the recording and note the file path in your report
   - Target: capture at browser's native refresh rate (30-60 FPS)
   - We need continuous visual evidence to track graphics changes over time

## Phase 1: Race Start (0-15 seconds)
1. Click "Start Race" with default settings (or click through any setup UI)
2. Wait for the 3-2-1 countdown
3. Screenshot the countdown sequence — note if numbers are visible
4. Note the tab title after countdown (shows FPS and latency)
5. Describe EXACTLY what you see: background, HUD elements, car position

## Phase 2: Forward Driving (15-45 seconds)
1. Press and HOLD the W key for 15 seconds
2. Every 3 seconds, note:
   - Current speed shown on speedometer (bottom-left HUD)
   - FPS shown in tab title
   - Any visual artifacts (macroblocking, freezing, black frames)
   - Whether the car is visibly moving (road/buildings changing)
3. While holding W, briefly tap A (left) then D (right) to test steering
4. Note steering responsiveness: does the car visibly turn?
5. Screenshot at peak speed

## Phase 3: Braking & Reverse (45-75 seconds)
1. Release W. Press S to brake. Note how quickly the car stops.
2. Once stopped (speedometer shows 0 or near 0):
   a. Release S completely
   b. Wait 1 second
   c. Press S again — does the car go into reverse?
   d. Note: speedometer should show R or -1 gear
   e. While in reverse, test A/D steering — does it feel correct?
3. Press W to exit reverse and drive forward again
4. Screenshot the speedometer during reverse

## Phase 4: Respawn Test (75-90 seconds)
1. Press R to respawn
2. IMMEDIATELY note:
   - Does FPS drop? (check tab title before and after)
   - How long until the car appears at a new position?
   - Is there a visual glitch/flash?
3. After respawn, hold W for 5 seconds — does the car accelerate normally?

## Phase 5: Extended Driving + Edge Cases (90-180 seconds)
1. Hold W and drive for 60 seconds
2. Intentionally drive OFF-ROAD (steer away from the road surface)
   - Does the car get a gentle nudge back toward the road?
   - Or does it just keep going off-road?
3. Drive INTO a wall or barrier at speed
   - Does the car auto-respawn after being stuck?
   - Or does it stay stuck?
4. Try rapid key sequences: W+A, W+D, S quickly after W
5. Look for the AI opponent car — is there a second car visible anywhere?
6. Check the gap timer (shows time difference to AI) — what does it read?
7. Note any off-road incidents, visual artifacts, or crashes
8. Take screenshots at interesting moments

## Phase 6: HUD Verification (continuous throughout)
Throughout all phases, verify these HUD elements:
- [ ] Speedometer: arc with needle, number (km/h), gear indicator
- [ ] Input bars: THR (green), BRK (red), STR (blue) — bottom of screen
- [ ] Gap timer: shows time difference to AI (+XX.Xs or -XX.Xs)
- [ ] Minimap: top-down view with car position dot
- [ ] Lap counter: if visible
- [ ] FPS/latency: in tab title

## Phase 7: Graphics Quality Monitoring (continuous throughout)
Watch for these visual quality issues and note EXACT timestamps:
- Screen going dark then brightening back (brightness oscillation)
- Color shifts (scene turning blue/green/orange unexpectedly)
- Macroblocking (pixelated blocks during camera movement or turns)
- Frame freezes (video stops but HUD keeps updating)
- Black frames or flashes between normal frames
- Vignette or darkening at screen edges that appears/disappears
- Any shader effects appearing (blur, distortion, color grading changes)
- Track surface changing appearance over time
Rate each on severity (none/mild/moderate/severe) in the JSON output.

## Phase 8: Performance Summary
1. Note the final tab title (FPS and latency)
2. Count approximate number of visual glitches/freezes during the test
3. Rate overall smoothness 1-10

{regression_check}
{prev_bugs_note}

## Output Format

CRITICAL: Return your complete analysis as a JSON object. Include ALL fields.
Wrap the JSON in ```json ... ``` code fences so it's easy to parse.

```json
{{
  "test_date": "YYYY-MM-DD",
  "test_iteration": {iteration},
  "duration_seconds": <int>,
  "overall_score": <1-10>,
  "fps": {{"avg": <int>, "min": <int>, "max": <int>}},
  "latency_ms": {{"avg": <int>, "min": <int>, "max": <int>}},
  "phases": {{
    "race_start": {{
      "countdown_visible": <true/false>,
      "countdown_description": "<what you saw>",
      "initial_fps": <int>,
      "time_to_first_frame_seconds": <float>
    }},
    "forward_driving": {{
      "max_speed_kmh": <int>,
      "steering_responsive": <true/false>,
      "visual_quality": "<description>",
      "artifacts": ["<description of each artifact>"]
    }},
    "braking_reverse": {{
      "brake_works": <true/false>,
      "reverse_works": <true/false>,
      "reverse_gear_display": "<what gear indicator shows>",
      "reverse_steering_correct": <true/false>,
      "exit_reverse_works": <true/false>
    }},
    "respawn": {{
      "respawn_works": <true/false>,
      "fps_drop_on_respawn": <true/false>,
      "fps_before": <int>,
      "fps_after": <int>,
      "recovery_seconds": <float>
    }},
    "extended_driving": {{
      "off_road_nudge_works": <true/false>,
      "wall_stuck_recovery": <true/false>,
      "ai_car_visible": <true/false>,
      "gap_timer_value": "<string shown>",
      "crashes_or_disconnects": <int>
    }}
  }},
  "hud": {{
    "speedometer_visible": <true/false>,
    "input_bars_visible": <true/false>,
    "gap_timer_visible": <true/false>,
    "minimap_visible": <true/false>,
    "lap_counter_visible": <true/false>
  }},
  "graphics_quality": {{
    "brightness_oscillation": "none|mild|moderate|severe",
    "color_shifts": "none|mild|moderate|severe",
    "macroblocking": "none|mild|moderate|severe",
    "frame_freezes": <int count>,
    "black_frames": <int count>,
    "unexpected_effects": ["<description of any shader/visual effects appearing>"],
    "overall_visual_rating": <1-10>,
    "timeline": [
      {{"timestamp_s": <float>, "observation": "<graphics change observed>"}}
    ]
  }},
  "bugs": [
    {{
      "id": <int>,
      "severity": "critical|high|medium|low",
      "category": "controls|video|physics|ui|performance",
      "title": "<short description>",
      "description": "<detailed description with timestamp>",
      "timestamp_seconds": <float>,
      "screenshot_description": "<what the screenshot shows>",
      "regression": <true/false>
    }}
  ],
  "working": ["<feature that works correctly>"],
  "regressions": ["<feature that was working before but is now broken>"],
  "event_log": [
    {{
      "timestamp_seconds": <float>,
      "action": "<what was done>",
      "observation": "<what happened>"
    }}
  ]
}}
```

IMPORTANT NOTES:
- Take screenshots FREQUENTLY — at least every 5 seconds during active testing
- The "event_log" should have at least 20 entries documenting what you did and saw
- Every bug MUST have a detailed description with the exact timestamp
- If you can record video, save it and note the path
- Be brutally honest — if something doesn't work, say so clearly
"""


# ---------------------------------------------------------------------------
# Task Management
# ---------------------------------------------------------------------------


def create_test_task(game_url: str, iteration: int = 1) -> str:
    """Create a Manus test task and return the task ID."""
    prompt = build_test_prompt(game_url, iteration)

    payload: Dict[str, Any] = {"prompt": prompt}

    # If we have a project_id, use it for grouping tasks across loops
    state = {}
    if SESSION_STATE_PATH.exists():
        state = json.loads(SESSION_STATE_PATH.read_text())
    project_id = state.get("manus_project_id")
    if project_id:
        payload["project_id"] = project_id
        print(f"[MANUS] Using project {project_id} for change tracking")

    print(f"[MANUS] Creating test task (iteration #{iteration})...")
    print(f"[MANUS] Prompt length: {len(prompt)} chars")

    resp = _post("tasks", payload)
    # Manus returns task_id in creation response, id in GET response
    task_id = resp.get("task_id") or resp.get("id") or "unknown"
    task_url = resp.get("task_url", "")

    print(f"[MANUS] Task created: {task_id}")
    if task_url:
        print(f"[MANUS] View at: {task_url}")

    return str(task_id)


def poll_task(task_id: str) -> Dict[str, Any]:
    """Poll a Manus task until completion or timeout.

    Manus status values observed: "pending", "completed".
    Browser-based tasks may also use "running" or "in_progress".
    We also check if the output array has a final assistant message,
    since some tasks populate output before updating status.
    """
    start = time.time()
    last_status = ""
    last_output_len = 0

    while time.time() - start < MANUS_TIMEOUT:
        resp = _get(f"tasks/{task_id}")
        status = resp.get("status", "unknown")
        output = resp.get("output", [])
        output_len = len(output) if isinstance(output, list) else 0

        if status != last_status or output_len != last_output_len:
            elapsed = int(time.time() - start)
            print(f"[MANUS] Task {task_id}: status={status} "
                  f"messages={output_len} ({elapsed}s elapsed)")
            last_status = status
            last_output_len = output_len

        if status in ("completed", "done", "finished", "success"):
            return resp
        elif status in ("failed", "error", "cancelled"):
            print(f"[MANUS] Task failed: {resp}")
            return resp

        time.sleep(MANUS_POLL_INTERVAL)

    print(f"[MANUS] Task timed out after {MANUS_TIMEOUT}s")
    return {"status": "timeout", "task_id": task_id}


# ---------------------------------------------------------------------------
# Report Parsing
# ---------------------------------------------------------------------------


def parse_report(task_response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Extract structured JSON report from Manus task output.

    Manus returns output as an array of messages. Each message has:
    - role: "user" or "assistant"
    - content: [{"type": "output_text", "text": "..."}]

    We look for the last assistant message containing our JSON report.
    """
    output = task_response.get("output", [])

    if isinstance(output, dict):
        return output

    if isinstance(output, list):
        # Walk messages in reverse to find the last assistant message with JSON
        for item in reversed(output):
            if not isinstance(item, dict):
                continue
            if item.get("role") != "assistant":
                continue

            # Extract text from content array
            content = item.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "output_text":
                        text = block.get("text", "")
                        parsed = _extract_json(text)
                        if parsed:
                            return parsed
            elif isinstance(content, str):
                parsed = _extract_json(content)
                if parsed:
                    return parsed

    # Fallback: try the whole response as text
    return _extract_json(json.dumps(task_response))


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Extract JSON from text, handling markdown code fences."""
    import re

    # Try to find JSON in code fences
    json_match = re.search(r"```json\s*\n(.*?)\n\s*```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # Try to find any JSON object in the text
    json_match = re.search(r"\{[\s\S]*\"overall_score\"[\s\S]*\}", text)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass

    # Try the whole text as JSON
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        pass

    return None


# ---------------------------------------------------------------------------
# Regression Tracking
# ---------------------------------------------------------------------------


def load_bug_tracker() -> Dict[str, Any]:
    """Load or initialize the cumulative bug tracker."""
    if BUG_TRACKER_PATH.exists():
        return json.loads(BUG_TRACKER_PATH.read_text())
    return {"bugs": {}, "test_history": []}


def update_bug_tracker(report: Dict[str, Any]) -> Dict[str, Any]:
    """Update bug tracker with new test results. Returns regression analysis."""
    tracker = load_bug_tracker()
    today = report.get("test_date", datetime.now().strftime("%Y-%m-%d"))

    # Get bugs and working features from this run
    current_bugs = {b["title"]: b for b in report.get("bugs", [])}
    current_working = set(report.get("working", []))

    regressions = []
    fixes = []
    persistent = []

    for bug_id, bug_data in tracker["bugs"].items():
        if bug_data["status"] == "fixed" and bug_id in current_bugs:
            # Was fixed, now broken again
            bug_data["status"] = "regressed"
            bug_data["last_seen"] = today
            bug_data["fix_attempts"] = bug_data.get("fix_attempts", 0) + 1
            regressions.append(bug_id)
        elif bug_data["status"] in ("persistent", "regressed") and bug_id not in current_bugs:
            # Was broken, now working
            bug_data["status"] = "fixed"
            bug_data["fixed_date"] = today
            fixes.append(bug_id)
        elif bug_id in current_bugs:
            bug_data["last_seen"] = today
            persistent.append(bug_id)

    # Add new bugs
    for title, bug in current_bugs.items():
        if title not in tracker["bugs"]:
            tracker["bugs"][title] = {
                "first_seen": today,
                "last_seen": today,
                "status": "persistent",
                "severity": bug.get("severity", "medium"),
                "category": bug.get("category", "unknown"),
                "fix_attempts": 0,
            }

    # Add test history entry
    tracker["test_history"].append({
        "date": today,
        "timestamp": datetime.now().isoformat(),
        "score": report.get("overall_score", 0),
        "bug_count": len(current_bugs),
        "working_count": len(current_working),
        "fps_avg": report.get("fps", {}).get("avg"),
        "iteration": report.get("test_iteration", 0),
    })

    # Save
    BUG_TRACKER_PATH.write_text(json.dumps(tracker, indent=2))

    return {
        "regressions": regressions,
        "fixes": fixes,
        "persistent": persistent,
        "new": [t for t in current_bugs if t not in tracker["bugs"] or
                tracker["bugs"][t]["first_seen"] == today],
    }


def compare_runs() -> Optional[Dict[str, Any]]:
    """Compare the last two test runs for changes."""
    runs = sorted(RESULTS_DIR.glob("2*.json"))
    if len(runs) < 2:
        print("[COMPARE] Need at least 2 test runs to compare")
        return None

    prev = json.loads(runs[-2].read_text())
    curr = json.loads(runs[-1].read_text())

    prev_bugs = {b["title"] for b in prev.get("bugs", [])}
    curr_bugs = {b["title"] for b in curr.get("bugs", [])}
    prev_working = set(prev.get("working", []))
    curr_working = set(curr.get("working", []))

    result = {
        "previous_run": runs[-2].name,
        "current_run": runs[-1].name,
        "score_change": (curr.get("overall_score", 0) - prev.get("overall_score", 0)),
        "new_bugs": list(curr_bugs - prev_bugs),
        "fixed_bugs": list(prev_bugs - curr_bugs),
        "persistent_bugs": list(curr_bugs & prev_bugs),
        "new_working": list(curr_working - prev_working),
        "regressions": list(prev_working - curr_working),
        "fps_change": {
            "avg": (curr.get("fps", {}).get("avg", 0) - prev.get("fps", {}).get("avg", 0)),
        },
    }

    print(f"\n{'='*60}")
    print(f"COMPARISON: {runs[-2].name} → {runs[-1].name}")
    print(f"{'='*60}")
    print(f"Score: {prev.get('overall_score', '?')} → {curr.get('overall_score', '?')} "
          f"({'+'if result['score_change']>=0 else ''}{result['score_change']})")
    print(f"FPS avg: {prev.get('fps',{}).get('avg','?')} → {curr.get('fps',{}).get('avg','?')}")

    if result["fixed_bugs"]:
        print(f"\nFIXED ({len(result['fixed_bugs'])}):")
        for b in result["fixed_bugs"]:
            print(f"  + {b}")

    if result["new_bugs"]:
        print(f"\nNEW BUGS ({len(result['new_bugs'])}):")
        for b in result["new_bugs"]:
            print(f"  ! {b}")

    if result["regressions"]:
        print(f"\nREGRESSIONS ({len(result['regressions'])}):")
        for b in result["regressions"]:
            print(f"  X {b}")

    if result["persistent_bugs"]:
        print(f"\nPERSISTENT ({len(result['persistent_bugs'])}):")
        for b in result["persistent_bugs"]:
            print(f"  ~ {b}")

    print(f"{'='*60}\n")
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def run_test(game_url: str, iteration: int = 1) -> Optional[Dict[str, Any]]:
    """Run a single Manus test cycle. Returns the parsed report or None."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    # Ensure we have a project for grouping tasks
    ensure_project()

    # Create task
    try:
        task_id = create_test_task(game_url, iteration)
    except Exception as e:
        print(f"[ERROR] Failed to create Manus task: {e}")
        return None

    # Poll for completion
    print(f"[MANUS] Polling task {task_id} (timeout: {MANUS_TIMEOUT}s)...")
    result = poll_task(task_id)

    if result.get("status") in ("timeout", "failed", "error", "cancelled"):
        print(f"[ERROR] Test failed: {result.get('status')}")
        # Save raw response for debugging
        fail_path = RESULTS_DIR / f"failed_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        fail_path.write_text(json.dumps(result, indent=2, default=str))
        return None

    # Parse report
    report = parse_report(result)
    if not report:
        print("[ERROR] Could not parse structured report from Manus output")
        # Save raw for debugging
        raw_path = RESULTS_DIR / f"raw_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        raw_path.write_text(json.dumps(result, indent=2, default=str))
        print(f"[INFO] Raw response saved to {raw_path}")
        return None

    # Save report
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = RESULTS_DIR / f"{timestamp}.json"
    report_path.write_text(json.dumps(report, indent=2))
    print(f"[SAVED] Report → {report_path}")

    # Update bug tracker
    analysis = update_bug_tracker(report)

    # Print summary
    print(f"\n{'='*60}")
    print(f"TEST RESULT — Iteration #{iteration}")
    print(f"{'='*60}")
    print(f"Overall score: {report.get('overall_score', '?')}/10")
    print(f"FPS: avg={report.get('fps',{}).get('avg','?')} "
          f"min={report.get('fps',{}).get('min','?')} "
          f"max={report.get('fps',{}).get('max','?')}")
    print(f"Latency: avg={report.get('latency_ms',{}).get('avg','?')}ms")
    print(f"Bugs: {len(report.get('bugs', []))} total")
    print(f"Working: {len(report.get('working', []))} features")

    if analysis.get("fixes"):
        print(f"\nFIXES VERIFIED: {analysis['fixes']}")
    if analysis.get("regressions"):
        print(f"\nREGRESSIONS: {analysis['regressions']}")
    if analysis.get("new"):
        print(f"\nNEW BUGS: {analysis['new']}")

    print(f"{'='*60}\n")
    return report


def run_loop(game_url: str, max_iterations: int = 10, pause_seconds: int = 30):
    """Run continuous test loop. After each test, pauses to allow fixes."""
    print(f"[LOOP] Starting Manus test loop (max {max_iterations} iterations)")
    print(f"[LOOP] Game URL: {game_url}")
    print(f"[LOOP] Pause between iterations: {pause_seconds}s")

    for i in range(1, max_iterations + 1):
        print(f"\n{'#'*60}")
        print(f"# ITERATION {i}/{max_iterations}")
        print(f"{'#'*60}\n")

        report = run_test(game_url, iteration=i)

        if report and report.get("overall_score", 0) >= 8:
            print(f"[LOOP] Score {report['overall_score']}/10 — target reached!")
            break

        if i < max_iterations:
            print(f"[LOOP] Pausing {pause_seconds}s before next iteration...")
            print(f"[LOOP] (Fix bugs now, or deploy changes before next test)")
            time.sleep(pause_seconds)

    # Final comparison
    compare_runs()


def main():
    parser = argparse.ArgumentParser(description="Manus-powered automated test loop")
    parser.add_argument("--loop", action="store_true", help="Run continuous test loop")
    parser.add_argument("--probe", action="store_true", help="Probe Manus API schema")
    parser.add_argument("--compare", action="store_true", help="Compare last 2 runs")
    parser.add_argument("--url", default=DEFAULT_GAME_URL, help="Game URL")
    parser.add_argument("--max-iterations", type=int, default=10)
    parser.add_argument("--pause", type=int, default=30, help="Seconds between loops")
    args = parser.parse_args()

    if args.probe:
        result = probe_api()
        print(json.dumps(result, indent=2, default=str))
    elif args.compare:
        compare_runs()
    elif args.loop:
        run_loop(args.url, args.max_iterations, args.pause)
    else:
        run_test(args.url)


if __name__ == "__main__":
    main()
