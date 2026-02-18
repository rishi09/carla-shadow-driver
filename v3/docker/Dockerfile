FROM carlasim/carla:0.9.15

# Switch to root for installing packages
USER root

# Install system dependencies
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
    curl wget && \
    rm -rf /var/lib/apt/lists/*

# Install Miniconda (provides Python 3.10, since CARLA base has Python 3.6 which is too old for PyTorch)
RUN curl -sL https://repo.anaconda.com/miniconda/Miniconda3-py310_24.11.1-0-Linux-x86_64.sh -o /tmp/miniconda.sh && \
    bash /tmp/miniconda.sh -b -p /opt/conda && \
    rm /tmp/miniconda.sh && \
    /opt/conda/bin/conda clean -a -y
ENV PATH="/opt/conda/bin:$PATH"

# Install cloudflared
RUN curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

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
