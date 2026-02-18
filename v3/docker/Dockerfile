FROM carlasim/carla:0.9.15

# Switch to root for installing packages
USER root

# Install system dependencies + Python 3.10 (CARLA base has Python 3.6 which is too old for PyTorch)
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
    software-properties-common curl wget && \
    add-apt-repository -y ppa:deadsnakes/ppa && \
    apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
    python3.10 python3.10-distutils python3.10-venv && \
    rm -rf /var/lib/apt/lists/*

# Make Python 3.10 the default and install pip
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 1 && \
    curl -sS https://bootstrap.pypa.io/get-pip.py | python3.10

# Install cloudflared
RUN curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# Install PyTorch with CUDA support (separate step for cache efficiency)
RUN pip3 install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cu121

# Install remaining Python dependencies from requirements.txt
COPY docker/requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Copy server code
COPY server/ /opt/shadow-driver/server/
COPY configs/ /opt/shadow-driver/configs/
COPY docker/entrypoint.sh /opt/shadow-driver/entrypoint.sh
RUN chmod +x /opt/shadow-driver/entrypoint.sh

WORKDIR /opt/shadow-driver

EXPOSE 8765

ENTRYPOINT ["/opt/shadow-driver/entrypoint.sh"]
