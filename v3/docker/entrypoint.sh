#!/bin/bash
set -e

# Instance ID for callback reporting
INST_ID="${VAST_CONTAINERLABEL:-${INSTANCE_ID:-unknown}}"
CALLBACK_URL="${CALLBACK_URL:-https://shadow-driver-v3.vercel.app/api/gpu/callback}"
WS_PORT=8765

# Report status to callback endpoint
report_status() {
    local status="$1"
    local message="$2"
    curl -s -X POST "$CALLBACK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"instance_id\":\"$INST_ID\",\"status\":\"$status\",\"message\":\"$message\"}" || true
}

echo "=== Shadow Driver v3 GPU Entrypoint ==="
echo "Instance ID: $INST_ID"
echo "Callback URL: $CALLBACK_URL"

# Step 1: Start CARLA headless
report_status "starting" "Starting CARLA simulator"
echo "Starting CARLA server (headless)..."

/home/carla/CarlaUE4.sh -RenderOffScreen -nosound -carla-rpc-port=2000 &
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

# Step 2: Start the race server
report_status "starting" "Starting race server"
echo "Starting race server on port $WS_PORT..."

cd /opt/shadow-driver
python3 -u server/race_server.py &
SERVER_PID=$!

# Wait for WebSocket server to be ready
sleep 3
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "Race server failed to start"
    report_status "error" "Race server failed to start"
    exit 1
fi
echo "Race server is running (PID: $SERVER_PID)"

# Step 3: Start Cloudflare tunnel
report_status "tunneling" "Establishing secure tunnel"
echo "Starting Cloudflare tunnel..."

TUNNEL_LOG=/tmp/cloudflared.log
cloudflared tunnel --url http://localhost:$WS_PORT --protocol http2 > $TUNNEL_LOG 2>&1 &
CF_PID=$!

# Wait for tunnel URL
TUNNEL_URL=""
for i in $(seq 1 60); do
    if [ -f $TUNNEL_LOG ]; then
        TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' $TUNNEL_LOG | head -1)
    fi
    if [ -n "$TUNNEL_URL" ]; then
        echo "Tunnel ready: $TUNNEL_URL"
        break
    fi
    sleep 1
done

if [ -n "$TUNNEL_URL" ]; then
    # Report tunnel URL to callback
    curl -s -X POST "$CALLBACK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"instance_id\":\"$INST_ID\",\"tunnel_url\":\"$TUNNEL_URL\",\"status\":\"ready\",\"message\":\"Running\"}"
    echo "=== Shadow Driver v3 is LIVE ==="
    echo "Tunnel: $TUNNEL_URL"
else
    ERROR=$(grep -i 'error\|fail' $TUNNEL_LOG 2>/dev/null | tail -1 | head -c 100 | tr -d '"\\')
    report_status "error" "Tunnel failed: ${ERROR:-timeout}"
    echo "Tunnel failed to start"
    kill $CF_PID 2>/dev/null
    exit 1
fi

# Wait for server process (keep container alive)
wait $SERVER_PID
