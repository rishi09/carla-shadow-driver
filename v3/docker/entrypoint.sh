#!/bin/bash
# Do NOT use set -e: we want to report errors back via callback, not silently die

# Instance ID for callback reporting
INST_ID="${VAST_CONTAINERLABEL:-${INSTANCE_ID:-unknown}}"
CALLBACK_URL="${CALLBACK_URL:-https://shadow-driver-v3.vercel.app/api/gpu/callback}"
WS_PORT=8765

# Report status to callback endpoint
report_status() {
    local status="$1"
    local message="$2"
    echo "[entrypoint] Reporting status: $status - $message"
    local response
    response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$CALLBACK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"instance_id\":\"$INST_ID\",\"status\":\"$status\",\"message\":\"$message\"}" 2>&1) || true
    echo "[entrypoint] Callback response: $response"
}

echo "=== Shadow Driver v3 GPU Entrypoint ==="
echo "Date: $(date)"
echo "Instance ID: $INST_ID"
echo "Callback URL: $CALLBACK_URL"
echo "VASTAI_API_KEY: ${VASTAI_API_KEY:+set (${#VASTAI_API_KEY} chars)}"
echo "Python: $(which python3) $(python3 --version 2>&1)"
echo "Working dir: $(pwd)"

# Step 1: Start Xvfb virtual display for NvFBC capture
# NvFBC captures the GPU framebuffer directly, bypassing CPU memory copies.
# This requires an X11 display even though we're headless. Xvfb provides a
# virtual framebuffer that CARLA renders into, which NvFBC can then capture.
echo "Starting Xvfb virtual display on :99..."
Xvfb :99 -screen 0 1280x720x24 +extension GLX +render -noreset &
XVFB_PID=$!
sleep 1

# Verify Xvfb is running
if kill -0 $XVFB_PID 2>/dev/null; then
    export DISPLAY=:99
    echo "Xvfb running on :99 (PID: $XVFB_PID)"
    # Log display info if x11-utils is available
    xdpyinfo -display :99 2>/dev/null | head -5 || true
else
    echo "WARNING: Xvfb failed to start -- NvFBC capture will be unavailable"
    echo "CARLA will use headless mode (camera sensor fallback)"
fi

# Step 1b: Patch DefaultEngine.ini for visual quality
# These settings improve rendering quality at minimal GPU cost:
# - Bloom: warm lighting glow on headlights, streetlights, sun
# - Ambient Occlusion: contact shadows where objects meet surfaces
# - FXAA: anti-aliasing that works reliably on Linux camera sensors (TAA=2 is broken)
# - Supersampling: render at 125% resolution, downsample to output for sharper edges
INI="/home/carla/CarlaUE4/Config/DefaultEngine.ini"
if [ -f "$INI" ]; then
    sed -i 's/r.DefaultFeature.Bloom=False/r.DefaultFeature.Bloom=True/' "$INI"
    sed -i 's/r.DefaultFeature.AmbientOcclusion=False/r.DefaultFeature.AmbientOcclusion=True/' "$INI"
    sed -i 's/r.DefaultFeature.AntiAliasing=2/r.DefaultFeature.AntiAliasing=1/' "$INI"
    grep -q 'r.ScreenPercentage' "$INI" || \
        sed -i '/\[\/Script\/Engine.RendererSettings\]/a r.ScreenPercentage=125' "$INI"
    echo "[entrypoint] DefaultEngine.ini patched (bloom, AO, FXAA, 125% supersampling)"
else
    echo "[entrypoint] DefaultEngine.ini not found at $INI, skipping visual quality patch"
fi

# Step 2: Start CARLA
report_status "starting" "Starting CARLA simulator"

# If Xvfb is running, start CARLA with -RenderOffScreen on the virtual display.
# -RenderOffScreen uses the GPU for rendering but doesn't open a window.
# The DISPLAY env var tells UE4 which X display to use for the GL context.
# If Xvfb is NOT running, fall back to fully headless mode.
if [ -n "$DISPLAY" ]; then
    echo "Starting CARLA server (GPU rendering on virtual display $DISPLAY)..."
    DISPLAY=:99 su -s /bin/bash -c "DISPLAY=:99 /home/carla/CarlaUE4.sh -RenderOffScreen -nosound -carla-rpc-port=2000" carla &
else
    echo "Starting CARLA server (headless, no display)..."
    su -s /bin/bash -c "/home/carla/CarlaUE4.sh -RenderOffScreen -nosound -carla-rpc-port=2000" carla &
fi
CARLA_PID=$!

# Wait for CARLA to be ready (poll port 2000)
echo "Waiting for CARLA to be ready..."
for i in $(seq 1 120); do
    if python3 -c "import socket; s=socket.socket(); s.settimeout(1); s.connect(('localhost',2000)); s.close()" 2>/dev/null; then
        echo "CARLA is ready (took ${i}s)"
        break
    fi
    if [ $i -eq 120 ]; then
        echo "CARLA failed to start after 120s"
        report_status "error" "CARLA failed to start"
        exit 1
    fi
    sleep 1
done

# Step 3: Start the race server
report_status "starting" "Starting race server"
echo "Starting race server on port $WS_PORT..."

cd /opt/shadow-driver

# Verify Python can import required modules
echo "Checking Python imports..."
python3 -c "import carla; print(f'CARLA Python API: {carla.__file__}')" 2>&1 || {
    echo "ERROR: Cannot import carla Python module"
    report_status "error" "Cannot import carla Python module"
    # Don't exit - try to continue, it might work via egg path
}

python3 -u server/race_server.py &
SERVER_PID=$!

# Wait for WebSocket server to be ready
sleep 3
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "Race server failed to start"
    report_status "error" "Race server failed to start - check Python deps"
    # Show the last few lines of any Python traceback
    echo "=== Recent logs ==="
    tail -50 /var/log/shadow-driver.log 2>/dev/null || true
    exit 1
fi
echo "Race server is running (PID: $SERVER_PID)"

# Step 4: Start tunnel (ngrok preferred for lower latency, Cloudflare as fallback)
report_status "tunneling" "Establishing secure tunnel"

TUNNEL_URL=""

# --- Option A: ngrok (lower latency, ~10-20ms overhead vs Cloudflare's ~40-80ms) ---
# Requires NGROK_AUTHTOKEN env var. Get a free token at https://dashboard.ngrok.com/signup
if [ -n "$NGROK_AUTHTOKEN" ]; then
    echo "Starting ngrok tunnel (auth token present)..."
    ngrok config add-authtoken "$NGROK_AUTHTOKEN" 2>/dev/null || true

    NGROK_LOG=/tmp/ngrok.log
    ngrok http $WS_PORT --log=stdout --log-format=json > $NGROK_LOG 2>&1 &
    NGROK_PID=$!

    # Wait for ngrok to expose the public URL (via its local API on port 4040)
    for i in $(seq 1 30); do
        sleep 1
        # ngrok exposes a local API at localhost:4040 with tunnel info
        TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
            | python3 -c "import sys,json; tunnels=json.load(sys.stdin).get('tunnels',[]); print(tunnels[0]['public_url'] if tunnels else '')" 2>/dev/null) || true
        if [ -n "$TUNNEL_URL" ]; then
            echo "ngrok tunnel ready: $TUNNEL_URL (took ${i}s)"
            break
        fi
    done

    if [ -z "$TUNNEL_URL" ]; then
        echo "ngrok failed to start, check log:"
        tail -20 $NGROK_LOG 2>/dev/null
        kill $NGROK_PID 2>/dev/null
        echo "Falling back to Cloudflare tunnel..."
    fi
fi

# --- Option B: Cloudflare quick tunnel (fallback, higher latency ~40-80ms overhead) ---
if [ -z "$TUNNEL_URL" ]; then
    echo "Starting Cloudflare tunnel..."
    TUNNEL_LOG=/tmp/cloudflared.log
    cloudflared tunnel --url http://localhost:$WS_PORT --protocol http2 > $TUNNEL_LOG 2>&1 &
    CF_PID=$!

    for i in $(seq 1 60); do
        if [ -f $TUNNEL_LOG ]; then
            TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' $TUNNEL_LOG | head -1)
        fi
        if [ -n "$TUNNEL_URL" ]; then
            echo "Cloudflare tunnel ready: $TUNNEL_URL (took ${i}s)"
            break
        fi
        sleep 1
    done

    if [ -z "$TUNNEL_URL" ]; then
        ERROR=$(grep -i 'error\|fail' $TUNNEL_LOG 2>/dev/null | tail -1 | head -c 100 | tr -d '"\\')
        report_status "error" "Tunnel failed: ${ERROR:-timeout}"
        echo "Tunnel failed to start"
        kill $CF_PID 2>/dev/null
        exit 1
    fi
fi

# Report tunnel URL
if [ -n "$TUNNEL_URL" ]; then
    echo "Reporting tunnel URL to callback..."
    curl -v -X POST "$CALLBACK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"instance_id\":\"$INST_ID\",\"tunnel_url\":\"$TUNNEL_URL\",\"status\":\"ready\",\"message\":\"Running\"}" 2>&1
    echo ""
    echo "=== Shadow Driver v3 is LIVE ==="
    echo "Tunnel: $TUNNEL_URL"
    echo "Instance: $INST_ID"
fi

# Wait for server process (keep container alive)
wait $SERVER_PID
