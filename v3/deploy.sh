#!/bin/bash
# Deploy server changes to running GPU instance and get game URL
# Usage: ./deploy.sh <ssh_port> <gpu_ip>
# Example: ./deploy.sh 50156 66.115.179.154

PORT=${1:?Usage: ./deploy.sh <ssh_port> <gpu_ip>}
IP=${2:?Usage: ./deploy.sh <ssh_port> <gpu_ip>}
SSH="ssh -o StrictHostKeyChecking=no -p $PORT root@$IP"
SCP="scp -o StrictHostKeyChecking=no -P $PORT"

echo "=== Copying server files to GPU ==="
$SCP server/carla_manager.py server/race_server.py server/race_logic.py root@$IP:/opt/shadow-driver/server/

echo "=== Restarting server + tunnel ==="
$SSH bash -s <<'REMOTE'
# Kill old processes
pkill -9 -f python3 2>/dev/null; pkill -9 -f cloudflared 2>/dev/null; sleep 2

# Start server
cd /opt/shadow-driver
nohup python3 -u server/race_server.py > /tmp/race.log 2>&1 &
sleep 2

# Start tunnel and capture URL
nohup cloudflared tunnel --url http://localhost:8765 > /tmp/tunnel.log 2>&1 &
sleep 5

# Extract and print tunnel URL
TUNNEL=$(grep -o 'https://[a-z-]*\.trycloudflare\.com' /tmp/tunnel.log | head -1)
echo "TUNNEL_URL=$TUNNEL"
echo ""
echo "Game link:"
echo "https://shadow-driver-v3.vercel.app/race?ws=$TUNNEL"
REMOTE

echo ""
echo "=== Done! Check server logs: $SSH 'tail -20 /tmp/race.log' ==="
