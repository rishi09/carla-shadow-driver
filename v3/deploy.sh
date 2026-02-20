#!/bin/bash
# Deploy server changes to running GPU instance and get game URL
# Usage: ./deploy.sh <ssh_port> <gpu_ip> [ngrok_authtoken]
# Example: ./deploy.sh 50156 66.115.179.154
# Example with ngrok: ./deploy.sh 50156 66.115.179.154 2abc123def_mytoken

PORT=${1:?Usage: ./deploy.sh <ssh_port> <gpu_ip> [ngrok_authtoken]}
IP=${2:?Usage: ./deploy.sh <ssh_port> <gpu_ip> [ngrok_authtoken]}
NGROK_TOKEN="${3:-$NGROK_AUTHTOKEN}"
SSH="ssh -o StrictHostKeyChecking=no -p $PORT root@$IP"
SCP="scp -o StrictHostKeyChecking=no -P $PORT"

echo "=== Copying server files to GPU ==="
$SCP server/carla_manager.py server/race_server.py server/race_logic.py root@$IP:/opt/shadow-driver/server/

echo "=== Restarting server + tunnel ==="
$SSH bash -s -- "$NGROK_TOKEN" <<'REMOTE'
NGROK_TOKEN="$1"

# Kill old processes
pkill -9 -f python3 2>/dev/null; pkill -9 -f cloudflared 2>/dev/null; pkill -9 -f ngrok 2>/dev/null; sleep 2

# Start server
cd /opt/shadow-driver
nohup python3 -u server/race_server.py > /tmp/race.log 2>&1 &
sleep 2

TUNNEL=""

# Try ngrok first (lower latency)
if [ -n "$NGROK_TOKEN" ]; then
    echo "Starting ngrok tunnel..."
    ngrok config add-authtoken "$NGROK_TOKEN" 2>/dev/null || true
    nohup ngrok http 8765 --log=stdout --log-format=json > /tmp/ngrok.log 2>&1 &
    sleep 3

    # Get URL from ngrok's local API
    for i in $(seq 1 15); do
        TUNNEL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
            | python3 -c "import sys,json; tunnels=json.load(sys.stdin).get('tunnels',[]); print(tunnels[0]['public_url'] if tunnels else '')" 2>/dev/null) || true
        if [ -n "$TUNNEL" ]; then
            echo "ngrok tunnel ready: $TUNNEL"
            break
        fi
        sleep 1
    done

    if [ -z "$TUNNEL" ]; then
        echo "ngrok failed, falling back to Cloudflare..."
        pkill -9 -f ngrok 2>/dev/null
    fi
fi

# Fallback: Cloudflare quick tunnel
if [ -z "$TUNNEL" ]; then
    echo "Starting Cloudflare tunnel..."
    nohup cloudflared tunnel --url http://localhost:8765 > /tmp/tunnel.log 2>&1 &
    sleep 5
    TUNNEL=$(grep -o 'https://[a-z-]*\.trycloudflare\.com' /tmp/tunnel.log | head -1)
fi

echo "TUNNEL_URL=$TUNNEL"
echo ""
echo "Game link:"
echo "https://shadow-driver-v3.vercel.app/race?ws=$TUNNEL"
REMOTE

echo ""
echo "=== Done! Check server logs: $SSH 'tail -20 /tmp/race.log' ==="
