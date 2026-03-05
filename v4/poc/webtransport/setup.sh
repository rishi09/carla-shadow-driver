#!/bin/bash
# WebTransport PoC setup script for Shadow Driver v3
# Generates TLS certs, installs deps, and starts the server.

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=== WebTransport PoC Setup ==="
echo ""

# --- Step 1: Generate self-signed TLS certificate ---
if [ ! -f cert.pem ] || [ ! -f key.pem ]; then
    echo "[1/3] Generating self-signed TLS certificate..."
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
        -days 14 -nodes -keyout key.pem -out cert.pem \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
        2>/dev/null
    echo "  Created cert.pem and key.pem (valid 14 days)"

    # Get certificate hash for Chrome (needed to trust self-signed certs for WebTransport)
    HASH=$(openssl x509 -in cert.pem -outform der | openssl dgst -sha256 -binary | xxd -p | tr -d '\n')
    echo ""
    echo "  Certificate SHA-256 hash:"
    echo "  $HASH"
    echo ""
    echo "  To trust this cert in Chrome, launch with:"
    echo "  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\"
    echo "    --origin-to-force-quic-on=localhost:4433 \\"
    echo "    --ignore-certificate-errors-spki-list=$(openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)"
    echo ""
else
    echo "[1/3] TLS certificate already exists (cert.pem, key.pem)"
fi

# --- Step 2: Install Python dependencies ---
echo "[2/3] Checking Python dependencies..."
if python3 -c "import aioquic" 2>/dev/null; then
    echo "  aioquic already installed"
else
    echo "  Installing aioquic..."
    pip3 install aioquic
fi

# --- Step 3: Start server ---
echo "[3/3] Starting WebTransport server on port 4433..."
echo ""
echo "================================================================"
echo "  Server: https://localhost:4433/"
echo ""
echo "  IMPORTANT: Chrome requires special flags for self-signed certs."
echo "  Option A: Enable chrome://flags/#allow-insecure-localhost"
echo "  Option B: Launch Chrome with the flags printed above"
echo ""
echo "  For the WebTransport connection specifically, Option B is required."
echo "  The --origin-to-force-quic-on flag tells Chrome to use QUIC/HTTP3"
echo "  for that origin, which WebTransport requires."
echo "================================================================"
echo ""

python3 server.py --cert cert.pem --key key.pem --port 4433
