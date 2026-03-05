#!/bin/bash
# setup.sh -- Install GStreamer + NVENC dependencies on Ubuntu 20.04/22.04
#
# Run inside an nvidia-docker container with NVIDIA GPU access:
#   docker run --gpus all -it ubuntu:22.04 bash
#   curl -sL https://raw.githubusercontent.com/.../setup.sh | bash
#
# Or on a Vast.ai instance:
#   bash setup.sh
#
# Prerequisites:
#   - NVIDIA GPU with NVENC support (GTX 1050+, RTX series)
#   - nvidia-docker or NVIDIA Container Toolkit
#   - Ubuntu 20.04 or 22.04

set -e

echo "=== game-streamer setup ==="
echo "Installing GStreamer + NVENC dependencies..."

# Detect Ubuntu version
UBUNTU_VERSION=$(lsb_release -rs 2>/dev/null || echo "22.04")
echo "Ubuntu version: $UBUNTU_VERSION"

# Install GStreamer core + plugins
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
    python3 python3-pip python3-dev \
    gstreamer1.0-tools \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-libav \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev \
    gir1.2-gst-plugins-base-1.0 \
    gir1.2-gstreamer-1.0 \
    python3-gi \
    python3-gi-cairo \
    gir1.2-gtk-3.0

# Install GStreamer NVCODEC plugin (provides nvh264enc, cudaupload, cudaconvert)
# On Ubuntu 22.04+, this is in gstreamer1.0-plugins-bad
# On Ubuntu 20.04, may need PPA or manual build
if dpkg -l | grep -q gstreamer1.0-plugins-bad; then
    echo "gstreamer1.0-plugins-bad already installed"
else
    echo "Installing gstreamer1.0-plugins-bad..."
    apt-get install -y -qq gstreamer1.0-plugins-bad
fi

# Verify GStreamer version
GST_VERSION=$(gst-inspect-1.0 --version 2>/dev/null | head -1 || echo "unknown")
echo "GStreamer version: $GST_VERSION"

# Check for NVENC elements
echo ""
echo "--- Checking NVENC elements ---"
if gst-inspect-1.0 nvh264enc > /dev/null 2>&1; then
    echo "[OK] nvh264enc found"
else
    echo "[MISSING] nvh264enc not found"
    echo "  This usually means:"
    echo "  1. nvidia-docker / NVIDIA Container Toolkit not configured"
    echo "  2. GPU does not support NVENC"
    echo "  3. gstreamer1.0-plugins-bad not compiled with NVCODEC"
    echo ""
    echo "  Try: gst-inspect-1.0 | grep nvcodec"
    echo "  If empty, the NVCODEC plugin is not loaded."
fi

if gst-inspect-1.0 cudaupload > /dev/null 2>&1; then
    echo "[OK] cudaupload found (zero-copy GPU path available)"
else
    echo "[MISSING] cudaupload not found (will use CPU colorspace conversion)"
fi

if gst-inspect-1.0 cudaconvert > /dev/null 2>&1; then
    echo "[OK] cudaconvert found"
else
    echo "[MISSING] cudaconvert not found"
fi

if gst-inspect-1.0 h264parse > /dev/null 2>&1; then
    echo "[OK] h264parse found"
else
    echo "[MISSING] h264parse not found"
fi

# Install Python dependencies
echo ""
echo "--- Installing Python packages ---"
pip3 install --no-cache-dir \
    websockets \
    numpy \
    PyGObject

# Optional: psutil for benchmark CPU measurement
pip3 install --no-cache-dir psutil 2>/dev/null || true

# Install FFmpeg with NVENC (as fallback)
if command -v ffmpeg &> /dev/null; then
    echo ""
    echo "[OK] FFmpeg already installed"
    ffmpeg -encoders 2>/dev/null | grep -q nvenc && echo "[OK] FFmpeg has NVENC support" || echo "[WARN] FFmpeg lacks NVENC"
else
    echo ""
    echo "--- Installing FFmpeg ---"
    # BtbN static build with NVENC
    curl -sL https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
        | tar xJ -C /tmp
    cp /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg /usr/local/bin/ffmpeg
    rm -rf /tmp/ffmpeg-master-latest-linux64-gpl
    echo "[OK] FFmpeg installed with NVENC"
fi

# Verify pipeline works
echo ""
echo "--- Testing pipeline ---"
echo "Testing: videotestsrc ! video/x-raw,format=BGRA ! videoconvert ! video/x-raw,format=I420 ! x264enc ! fakesink"
timeout 5 gst-launch-1.0 \
    videotestsrc num-buffers=10 \
    ! "video/x-raw,format=BGRA,width=320,height=240,framerate=30/1" \
    ! videoconvert \
    ! "video/x-raw,format=I420" \
    ! x264enc speed-preset=ultrafast tune=zerolatency \
    ! fakesink \
    2>&1 && echo "[OK] Software pipeline works" || echo "[WARN] Software pipeline failed"

# Test NVENC pipeline (if available)
if gst-inspect-1.0 nvh264enc > /dev/null 2>&1; then
    echo ""
    echo "Testing NVENC pipeline..."
    timeout 5 gst-launch-1.0 \
        videotestsrc num-buffers=10 \
        ! "video/x-raw,format=BGRA,width=320,height=240,framerate=30/1" \
        ! videoconvert \
        ! "video/x-raw,format=NV12" \
        ! nvh264enc preset=p1 zerolatency=true \
        ! fakesink \
        2>&1 && echo "[OK] NVENC pipeline works" || echo "[WARN] NVENC pipeline failed"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Quick start:"
echo "  python3 test_streamer.py"
echo "  # Then open viewer.html in a browser"
echo ""
echo "Benchmark:"
echo "  python3 benchmark.py"
