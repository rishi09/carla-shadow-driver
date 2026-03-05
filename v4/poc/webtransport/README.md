# WebTransport PoC for Shadow Driver v3

## Purpose
Test whether WebTransport (HTTP/3 over QUIC) can replace WebSocket (TCP) for streaming
H.264 video frames from CARLA, eliminating TCP head-of-line blocking.

## Files
- `server.py` -- Python WebTransport server using aioquic (196 lines)
- `client.html` -- Browser test client with stats dashboard (198 lines)
- `setup.sh` -- One-command setup: generates TLS cert, installs deps, starts server
- `README.md` -- This file

## Quick Start

```bash
# Option 1: One-command setup
cd v3/poc/webtransport
bash setup.sh

# Option 2: Manual
pip install aioquic
# Generate self-signed TLS cert
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -days 14 -nodes -keyout key.pem -out cert.pem \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
# Start server
python server.py --cert cert.pem --key key.pem --port 4433
```

## Chrome Self-Signed Cert Setup (REQUIRED)

WebTransport requires HTTPS, and Chrome requires valid certificates. For self-signed
certs, launch Chrome with special flags:

```bash
# Get the SPKI hash from your cert
SPKI=$(openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)

# Launch Chrome with the flag
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --origin-to-force-quic-on=localhost:4433 \
  --ignore-certificate-errors-spki-list=$SPKI \
  https://localhost:4433/
```

Then click "Connect WebTransport" in the test client.

## What It Tests
1. **Video datagrams**: Server sends 50KB fake frames at 30fps, fragmented into ~1100-byte
   QUIC datagrams. Client reassembles and measures FPS, jitter, chunk loss, assembly time.
2. **Telemetry stream**: Server sends JSON telemetry at 30Hz on a reliable unidirectional
   QUIC stream. Client measures rate and sequence gaps.
3. **WebSocket fallback**: Client can connect via WebSocket (TCP) for comparison. Measures
   same stats to show head-of-line blocking differences.

## Dependencies
- Python 3.8+
- aioquic >= 1.2.0 (`pip install aioquic`)
- OpenSSL (for cert generation)
- Chrome 97+ (for WebTransport client)
