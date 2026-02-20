FROM carlasim/carla:0.9.15

# Switch to root for installing packages
USER root

# Install system dependencies (libopus/libvpx for aiortc)
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
    curl wget pkg-config \
    libopus-dev libvpx-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Miniconda (provides Python 3.10, since CARLA base has Python 3.6 which is too old for PyTorch)
RUN curl -sL https://repo.anaconda.com/miniconda/Miniconda3-py310_24.11.1-0-Linux-x86_64.sh -o /tmp/miniconda.sh && \
    bash /tmp/miniconda.sh -b -p /opt/conda && \
    rm /tmp/miniconda.sh && \
    /opt/conda/bin/conda clean -a -y
ENV PATH="/opt/conda/bin:$PATH"

# Install av (PyAV) via conda-forge — it bundles its own FFmpeg,
# avoiding the Ubuntu 18.04 FFmpeg 3.4 incompatibility with modern PyAV
RUN conda install -y -c conda-forge av && conda clean -a -y

# Install FFmpeg with NVENC support (BtbN static build, ~80MB)
# This provides h264_nvenc hardware encoding on NVIDIA GPUs
RUN curl -sL https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
    | tar xJ -C /tmp && \
    cp /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg /usr/local/bin/ffmpeg && \
    rm -rf /tmp/ffmpeg-master-latest-linux64-gpl

# Install cloudflared (fallback tunnel)
RUN curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# Install ngrok (primary tunnel — lower latency than Cloudflare quick tunnels)
# Free tier: 1 agent, 1 domain, valid TLS certs, WebSocket support, ~10-20ms overhead
# Requires NGROK_AUTHTOKEN env var at runtime (free signup at https://ngrok.com)
RUN curl -sL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
    | tar xz -C /usr/local/bin

# Install PyTorch with CUDA support (separate step for cache efficiency)
RUN pip install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cu121

# Install remaining Python dependencies from requirements.txt
COPY docker/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Copy server code
COPY server/ /opt/shadow-driver/server/
COPY configs/ /opt/shadow-driver/configs/
COPY docker/entrypoint.sh /opt/shadow-driver/entrypoint.sh
RUN chmod +x /opt/shadow-driver/entrypoint.sh

WORKDIR /opt/shadow-driver

EXPOSE 8765

ENTRYPOINT ["/opt/shadow-driver/entrypoint.sh"]
