#!/bin/bash
#
# run_test.sh - CI runner for Shadow Driver v3 automated gameplay testing
#
# Checks prerequisites, runs the gameplay test, grades the screenshots,
# and outputs a structured pass/fail result.
#
# Usage:
#   ./run_test.sh                                     # defaults: localhost, 60s
#   ./run_test.sh --ws ws://localhost:8765 --duration 30
#   ./run_test.sh --ws ws://localhost:8765 --grade     # also run visual grader
#   ./run_test.sh --ws ws://localhost:8765 --html      # generate HTML report
#
# Exit codes:
#   0 = PASS (game ran, metrics OK, visual quality OK)
#   1 = FAIL (game failed to start, black screen, low FPS, or grader failed)
#   2 = PREREQ (missing prerequisite: safaridriver, game server, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V3_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$V3_DIR")"
PYTHON="/usr/bin/python3"

# ─── Defaults ─────────────────────────────────────────────────────────────
WS_URL="ws://localhost:8765"
GAME_URL=""
DURATION=60
RUN_GRADER=false
GENERATE_HTML=false
SAFARIDRIVER_PORT=4445
MIN_FPS=10
MIN_QUALITY=30

# ─── Parse args ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --ws)        WS_URL="$2"; shift 2 ;;
        --url)       GAME_URL="$2"; shift 2 ;;
        --duration)  DURATION="$2"; shift 2 ;;
        --grade)     RUN_GRADER=true; shift ;;
        --html)      GENERATE_HTML=true; RUN_GRADER=true; shift ;;
        --port)      SAFARIDRIVER_PORT="$2"; shift 2 ;;
        --min-fps)   MIN_FPS="$2"; shift 2 ;;
        --min-quality) MIN_QUALITY="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--ws URL] [--url URL] [--duration SECS] [--grade] [--html]"
            echo ""
            echo "Options:"
            echo "  --ws URL         WebSocket URL (default: ws://localhost:8765)"
            echo "  --url URL        Full game URL (overrides --ws)"
            echo "  --duration SECS  Drive duration in seconds (default: 60)"
            echo "  --grade          Run visual quality grader on screenshots"
            echo "  --html           Generate HTML report (implies --grade)"
            echo "  --port PORT      safaridriver port (default: 4445)"
            echo "  --min-fps N      Minimum acceptable avg FPS (default: 10)"
            echo "  --min-quality N  Minimum quality score 0-100 (default: 30)"
            echo ""
            echo "Prerequisites:"
            echo "  1. safaridriver running on port $SAFARIDRIVER_PORT"
            echo "  2. Game server reachable at the WebSocket URL"
            echo "  3. Safari Technology Preview with Remote Automation enabled"
            echo "  4. Python 3.9+ with selenium, numpy, Pillow installed"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 2
            ;;
    esac
done

# ─── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
info() { echo -e "${CYAN}[INFO]${NC} $1"; }

# ─── Prerequisite Checks ─────────────────────────────────────────────────

echo ""
echo "============================================================"
echo "  Shadow Driver v3 - Automated Test Runner"
echo "============================================================"
echo ""

PREREQS_OK=true

# 1. Python
info "Checking Python..."
if $PYTHON --version > /dev/null 2>&1; then
    pass "Python: $($PYTHON --version 2>&1)"
else
    fail "Python 3 not found at $PYTHON"
    PREREQS_OK=false
fi

# 2. Python packages
info "Checking Python packages..."
MISSING_PKGS=""
$PYTHON -c "import selenium" 2>/dev/null || MISSING_PKGS="$MISSING_PKGS selenium"
$PYTHON -c "import numpy" 2>/dev/null || MISSING_PKGS="$MISSING_PKGS numpy"
$PYTHON -c "from PIL import Image" 2>/dev/null || MISSING_PKGS="$MISSING_PKGS Pillow"

if [ -n "$MISSING_PKGS" ]; then
    fail "Missing Python packages:$MISSING_PKGS"
    echo "  Install with: pip install$MISSING_PKGS"
    PREREQS_OK=false
else
    pass "Python packages: selenium, numpy, Pillow"
fi

# Optional: opencv
if $PYTHON -c "import cv2" 2>/dev/null; then
    pass "Optional: opencv-python available (SSIM will use cv2)"
else
    warn "Optional: opencv-python not installed (SSIM will use numpy fallback)"
    echo "  Install with: pip install opencv-python"
fi

# 3. safaridriver
info "Checking safaridriver on port $SAFARIDRIVER_PORT..."
if curl -s "http://localhost:$SAFARIDRIVER_PORT/status" > /dev/null 2>&1; then
    pass "safaridriver responding on port $SAFARIDRIVER_PORT"
else
    # Try to start it
    warn "safaridriver not responding. Attempting to start..."
    STP_DRIVER="/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver"
    REGULAR_DRIVER="/usr/bin/safaridriver"

    if [ -x "$STP_DRIVER" ]; then
        "$STP_DRIVER" --port "$SAFARIDRIVER_PORT" &
        DRIVER_PID=$!
        sleep 2
        if curl -s "http://localhost:$SAFARIDRIVER_PORT/status" > /dev/null 2>&1; then
            pass "safaridriver started (PID $DRIVER_PID) on port $SAFARIDRIVER_PORT"
        else
            fail "safaridriver failed to start. Run manually:"
            echo "  $STP_DRIVER --port $SAFARIDRIVER_PORT &"
            PREREQS_OK=false
        fi
    elif [ -x "$REGULAR_DRIVER" ]; then
        "$REGULAR_DRIVER" --port "$SAFARIDRIVER_PORT" &
        DRIVER_PID=$!
        sleep 2
        if curl -s "http://localhost:$SAFARIDRIVER_PORT/status" > /dev/null 2>&1; then
            pass "safaridriver started (PID $DRIVER_PID) on port $SAFARIDRIVER_PORT"
        else
            fail "safaridriver failed to start"
            PREREQS_OK=false
        fi
    else
        fail "No safaridriver found"
        PREREQS_OK=false
    fi
fi

# 4. Game server reachable (WebSocket check)
info "Checking game server at $WS_URL..."
# Extract host:port from ws:// URL
WS_HOST=$(echo "$WS_URL" | sed 's|ws://||' | sed 's|wss://||' | cut -d'/' -f1 | cut -d':' -f1)
WS_PORT=$(echo "$WS_URL" | sed 's|ws://||' | sed 's|wss://||' | cut -d'/' -f1 | cut -d':' -f2)
WS_PORT=${WS_PORT:-8765}

if nc -z "$WS_HOST" "$WS_PORT" 2>/dev/null; then
    pass "Game server reachable at $WS_HOST:$WS_PORT"
else
    warn "Game server not reachable at $WS_HOST:$WS_PORT"
    echo "  The test will still try to connect (server may start during setup)"
fi

# 5. Vite dev server (if using localhost game URL)
if [ -z "$GAME_URL" ]; then
    info "Checking Vite dev server on :5173..."
    if nc -z localhost 5173 2>/dev/null; then
        pass "Vite dev server running on :5173"
    else
        warn "Vite dev server not running on :5173"
        echo "  Start with: cd $V3_DIR && npx vite --host &"
    fi
fi

echo ""

if [ "$PREREQS_OK" = false ]; then
    fail "Prerequisites not met. Fix the issues above and retry."
    exit 2
fi

# ─── Run Gameplay Test ────────────────────────────────────────────────────

info "Starting gameplay test (${DURATION}s)..."
echo ""

GAMEPLAY_TEST="$SCRIPT_DIR/gameplay_test.py"
GAMEPLAY_ARGS=""

if [ -n "$GAME_URL" ]; then
    GAMEPLAY_ARGS="--url $GAME_URL"
else
    GAMEPLAY_ARGS="--ws $WS_URL"
fi
GAMEPLAY_ARGS="$GAMEPLAY_ARGS --duration $DURATION"

# Run the test and capture exit code
set +e
$PYTHON "$GAMEPLAY_TEST" $GAMEPLAY_ARGS
GAMEPLAY_EXIT=$?
set -e

echo ""

if [ $GAMEPLAY_EXIT -ne 0 ]; then
    fail "Gameplay test exited with code $GAMEPLAY_EXIT"
fi

# ─── Find the latest test results ────────────────────────────────────────

RESULTS_BASE="$V3_DIR/test-results"
LATEST_DIR=$(ls -td "$RESULTS_BASE"/20* 2>/dev/null | head -1)

if [ -z "$LATEST_DIR" ]; then
    fail "No test results directory found in $RESULTS_BASE"
    exit 1
fi

info "Test results: $LATEST_DIR"
SCREENSHOTS_DIR="$LATEST_DIR/screenshots"
REPORT_JSON="$LATEST_DIR/report.json"

# ─── Parse Gameplay Report ────────────────────────────────────────────────

OVERALL_PASS=true

if [ -f "$REPORT_JSON" ]; then
    # Extract summary values using Python (more reliable than jq on macOS)
    SUMMARY=$($PYTHON -c "
import json, sys
with open('$REPORT_JSON') as f:
    r = json.load(f)
s = r.get('summary', {})
print(f\"avg_fps={s.get('avg_fps', 'N/A')}\")
print(f\"min_fps={s.get('min_fps', 'N/A')}\")
print(f\"avg_latency={s.get('avg_latency_ms', 'N/A')}\")
print(f\"ws_state={s.get('ws_state_final', 'N/A')}\")
print(f\"canvas_frames={r.get('total_canvas_frames', 0)}\")
print(f\"capture_rate={r.get('capture_rate_hz', 0)}\")
" 2>/dev/null || echo "parse_error=true")

    eval "$SUMMARY"

    echo ""
    echo "------------------------------------------------------------"
    echo "  Gameplay Metrics"
    echo "------------------------------------------------------------"
    echo "  Avg FPS:        $avg_fps"
    echo "  Min FPS:        $min_fps"
    echo "  Avg Latency:    ${avg_latency}ms"
    echo "  WS State:       $ws_state"
    echo "  Canvas Frames:  $canvas_frames ($capture_rate fps capture)"
    echo "------------------------------------------------------------"
    echo ""

    # Check FPS threshold
    if [ "$avg_fps" != "N/A" ]; then
        FPS_INT=$(echo "$avg_fps" | cut -d'.' -f1)
        if [ "$FPS_INT" -lt "$MIN_FPS" ]; then
            fail "Avg FPS ($avg_fps) below threshold ($MIN_FPS)"
            OVERALL_PASS=false
        else
            pass "Avg FPS ($avg_fps) above threshold ($MIN_FPS)"
        fi
    else
        warn "No FPS data collected"
    fi

    # Check WS connection
    if [ "$ws_state" = "OPEN" ]; then
        pass "WebSocket connected"
    else
        warn "WebSocket state: $ws_state (expected OPEN)"
    fi

    # Check canvas frames captured
    if [ "$canvas_frames" -gt 0 ]; then
        pass "Canvas frames captured: $canvas_frames"
    else
        warn "No canvas frames captured (toDataURL may have returned blank)"
    fi
else
    warn "No report.json found"
fi

# ─── Run Visual Grader ───────────────────────────────────────────────────

GRADER_VERDICT="SKIP"

if [ "$RUN_GRADER" = true ] && [ -d "$SCREENSHOTS_DIR" ]; then
    info "Running visual quality grader..."
    echo ""

    GRADER="$SCRIPT_DIR/grader.py"
    GRADER_JSON="$LATEST_DIR/grader_report.json"
    GRADER_ARGS="$SCREENSHOTS_DIR --save-json $GRADER_JSON"

    if [ "$GENERATE_HTML" = true ]; then
        GRADER_HTML="$LATEST_DIR/quality_report.html"
        GRADER_ARGS="$GRADER_ARGS --html $GRADER_HTML"
    fi

    set +e
    $PYTHON "$GRADER" $GRADER_ARGS
    GRADER_EXIT=$?
    set -e

    if [ -f "$GRADER_JSON" ]; then
        GRADER_VERDICT=$($PYTHON -c "
import json
with open('$GRADER_JSON') as f:
    r = json.load(f)
print(r.get('verdict', 'UNKNOWN'))
" 2>/dev/null || echo "UNKNOWN")

        QUALITY_SCORE=$($PYTHON -c "
import json
with open('$GRADER_JSON') as f:
    r = json.load(f)
print(r.get('avg_quality_score', 0))
" 2>/dev/null || echo "0")

        BLACK_FRAMES=$($PYTHON -c "
import json
with open('$GRADER_JSON') as f:
    r = json.load(f)
print(r.get('black_frames', 0))
" 2>/dev/null || echo "0")

        echo ""
        echo "------------------------------------------------------------"
        echo "  Visual Quality"
        echo "------------------------------------------------------------"
        echo "  Quality Score:  $QUALITY_SCORE / 100"
        echo "  Black Frames:   $BLACK_FRAMES"
        echo "  Grader Verdict: $GRADER_VERDICT"
        echo "------------------------------------------------------------"
        echo ""

        if [ "$GRADER_VERDICT" = "FAIL" ]; then
            fail "Visual quality check failed"
            OVERALL_PASS=false
        elif [ "$GRADER_VERDICT" = "DEGRADED" ]; then
            warn "Visual quality degraded"
        else
            pass "Visual quality check passed"
        fi
    fi

    if [ "$GENERATE_HTML" = true ] && [ -f "$GRADER_HTML" ]; then
        info "HTML report: $GRADER_HTML"
    fi
fi

# ─── Final Verdict ────────────────────────────────────────────────────────

echo ""
echo "============================================================"
if [ "$OVERALL_PASS" = true ]; then
    pass "ALL CHECKS PASSED"
    echo ""
    echo "  Results: $LATEST_DIR"
    [ -f "$GRADER_HTML" ] && echo "  HTML:    $GRADER_HTML"
    echo "============================================================"
    exit 0
else
    fail "ONE OR MORE CHECKS FAILED"
    echo ""
    echo "  Results: $LATEST_DIR"
    [ -f "$GRADER_HTML" ] && echo "  HTML:    $GRADER_HTML"
    echo "============================================================"
    exit 1
fi
