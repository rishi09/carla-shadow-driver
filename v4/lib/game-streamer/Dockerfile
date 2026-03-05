FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install GStreamer with all plugins including NVCODEC
RUN apt-get update -qq && \
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
    curl && \
    rm -rf /var/lib/apt/lists/*

# Install FFmpeg with NVENC (fallback encoder)
RUN curl -sL https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
    | tar xJ -C /tmp && \
    cp /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg /usr/local/bin/ffmpeg && \
    rm -rf /tmp/ffmpeg-master-latest-linux64-gpl

# Install Python dependencies
RUN pip3 install --no-cache-dir \
    websockets \
    numpy \
    psutil

# Copy library and test files
WORKDIR /app
COPY game_streamer.py test_streamer.py benchmark.py viewer.html ./

# WebSocket port
EXPOSE 8765

# Default: run test streamer
CMD ["python3", "test_streamer.py", "--port", "8765"]
