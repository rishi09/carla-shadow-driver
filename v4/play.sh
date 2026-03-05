#!/bin/bash
# Start everything needed to play Shadow Driver locally
# Usage: ./play.sh [ssh_port ssh_host]
# If no args, auto-detects running Vast.ai instance via API
# Example: ./play.sh
# Example: ./play.sh 15738 ssh4.vast.ai

VASTAI_KEY="9ef4b7d90b2452ef3a61327d3934a79977f58fff9f8979ecad16eac58610416a"

echo "=== Shadow Driver Play Script ==="

# Auto-detect Vast.ai instance if no args provided
if [ -z "$1" ]; then
  echo "Looking up running Vast.ai instance..."
  INSTANCE_INFO=$(curl -sL -H "Authorization: Bearer $VASTAI_KEY" \
    "https://console.vast.ai/api/v0/instances/?owner=me" 2>/dev/null | \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
instances = [i for i in data.get('instances', []) if i.get('actual_status') == 'running']
if not instances:
    print('NONE')
elif len(instances) == 1:
    i = instances[0]
    print(f'{i[\"ssh_port\"]} {i[\"ssh_host\"]} {i[\"id\"]} {i[\"gpu_name\"]}')
else:
    # Pick the newest instance
    instances.sort(key=lambda x: x.get('start_date', 0), reverse=True)
    i = instances[0]
    print(f'{i[\"ssh_port\"]} {i[\"ssh_host\"]} {i[\"id\"]} {i[\"gpu_name\"]}')
    print(f'WARNING: {len(instances)} instances running, using newest (ID {i[\"id\"]})', file=sys.stderr)
" 2>&1)

  if [ "$INSTANCE_INFO" = "NONE" ]; then
    echo "ERROR: No running Vast.ai instances found."
    echo "Rent one at https://cloud.vast.ai with image rkshah09/shadow-driver-v3:latest"
    exit 1
  fi

  PORT=$(echo "$INSTANCE_INFO" | head -1 | awk '{print $1}')
  HOST=$(echo "$INSTANCE_INFO" | head -1 | awk '{print $2}')
  ID=$(echo "$INSTANCE_INFO" | head -1 | awk '{print $3}')
  GPU=$(echo "$INSTANCE_INFO" | head -1 | awk '{print $4}')
  echo "Found instance $ID ($GPU) at $HOST:$PORT"
else
  PORT="$1"
  HOST="$2"
fi

# Load SSH key if not already loaded
if ! ssh-add -l 2>/dev/null | grep -q ed25519; then
  echo "Loading SSH key..."
  ssh-add ~/.ssh/id_ed25519
fi

# Kill any existing tunnel on 8765
lsof -ti :8765 2>/dev/null | xargs kill 2>/dev/null

# Start SSH tunnel in background
echo "Starting SSH tunnel to $HOST:$PORT..."
ssh -o StrictHostKeyChecking=no -N -L 8765:localhost:8765 -p "$PORT" "root@$HOST" &
TUNNEL_PID=$!
sleep 2

if ! kill -0 $TUNNEL_PID 2>/dev/null; then
  echo "ERROR: SSH tunnel failed to start"
  exit 1
fi
echo "SSH tunnel running (PID $TUNNEL_PID)"

# Start Vite if not already running
if ! lsof -i :5173 2>/dev/null | grep -q LISTEN; then
  echo "Starting Vite dev server..."
  cd "$(dirname "$0")" && npm run dev &
  VITE_PID=$!
  sleep 3
  echo "Vite running (PID $VITE_PID)"
else
  echo "Vite already running on :5173"
fi

echo ""
echo "=== Ready to play! ==="
echo "Open: http://localhost:5173/race?ws=ws://localhost:8765"
echo ""
echo "Press Ctrl+C to stop tunnel"
wait $TUNNEL_PID
