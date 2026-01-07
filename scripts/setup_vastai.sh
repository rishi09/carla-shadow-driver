#!/bin/bash
# Vast.ai instance setup script
# Run this ONCE after SSH-ing into your new Vast.ai instance

set -e

echo "=== CARLA Shadow Driver - Vast.ai Setup ==="
echo ""

# Update system
echo "[1/4] Updating system packages..."
apt-get update -qq

# Install NVIDIA container toolkit if not present
if ! command -v nvidia-container-cli &> /dev/null; then
    echo "[2/4] Installing NVIDIA Container Toolkit..."
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | apt-key add -
    curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | tee /etc/apt/sources.list.d/nvidia-docker.list
    apt-get update -qq
    apt-get install -y nvidia-container-toolkit
else
    echo "[2/4] NVIDIA Container Toolkit already installed"
fi

# Pull CARLA Docker image
echo "[3/4] Pulling CARLA Docker image (this may take a while)..."
docker pull carlasim/carla:0.9.16

# Create start script
echo "[4/4] Creating CARLA start script..."
cat > /root/start_carla.sh << 'EOF'
#!/bin/bash
# Start CARLA server in headless mode

docker run --gpus all --net=host --rm -d \
    --name carla-server \
    carlasim/carla:0.9.16 \
    bash CarlaUE4.sh -RenderOffScreen -nosound -quality-level=Low

echo "CARLA server starting..."
echo "Wait ~30 seconds for initialization"
echo ""
echo "To check status: docker logs carla-server"
echo "To stop: docker stop carla-server"
EOF
chmod +x /root/start_carla.sh

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Next steps:"
echo "  1. Start CARLA:  ./start_carla.sh"
echo "  2. On your Mac, create SSH tunnel:"
echo "     ssh -L 2000:localhost:2000 -L 2001:localhost:2001 root@<THIS_IP> -p <PORT>"
echo "  3. Run: python src/test_connection.py"
echo ""
