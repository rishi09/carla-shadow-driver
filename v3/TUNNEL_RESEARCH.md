# Tunnel Research: Replacing Cloudflare Quick Tunnels in Shadow Driver v3

**Date:** 2026-02-19
**Current setup:** `cloudflared tunnel --url http://localhost:8765` (Cloudflare quick tunnels)
**Problem:** ~40-80ms latency overhead added by Cloudflare's proxy network
**Goal:** Find a lower-latency alternative that is free, provides TLS/`wss://`, supports WebSocket, works in Docker (Ubuntu 18.04), is automatable, and requires no client-side auth.

---

## Current Setup Analysis

The current flow:
1. `cloudflared` binary is installed in the Docker image (~20MB)
2. `entrypoint.sh` runs `cloudflared tunnel --url http://localhost:8765 --protocol http2`
3. URL is extracted from logs via grep: `https://xxx.trycloudflare.com`
4. Browser connects to `wss://xxx.trycloudflare.com` (Cloudflare provides TLS)
5. Cloudflare proxies the WebSocket connection to `ws://localhost:8765` inside the container

**Why it adds latency:** Cloudflare quick tunnels route through Cloudflare's global CDN network. The WebSocket connection goes: Browser -> Cloudflare edge PoP -> Cloudflare internal network -> Cloudflare connector -> GPU server. The extra hop through Cloudflare's network adds 40-80ms round-trip. This is acceptable for web browsing but noticeable for a 30Hz game stream.

---

## Option 1: ngrok

### Overview
ngrok is the most popular tunneling solution. It provides a public HTTPS URL that proxies traffic to your local service. Closed source, freemium model.

### Free Tier Limits (as of 2025)
- **1 online agent** (1 ngrok process at a time)
- **1 static domain** (previously URLs changed on every restart; static domains were added to free tier in 2024)
- **20 connections per minute** rate limit (this is the biggest concern)
- **No bandwidth limit** on free tier (but subject to abuse policies)
- **Auth token required** -- must sign up at ngrok.com and run `ngrok config add-authtoken <TOKEN>` before first use

### WebSocket Support
Yes. ngrok fully supports WebSocket on all tiers, including free. WebSocket connections upgrade normally through the ngrok proxy.

### TLS/HTTPS
Yes. ngrok provides `https://` URLs automatically. The browser can connect via `wss://` without issues.

### Latency
ngrok routes traffic through its own relay servers (similar to Cloudflare). Expected latency overhead is **30-60ms** -- roughly comparable to Cloudflare tunnels, possibly slightly better depending on geographic proximity to ngrok's PoPs. ngrok has fewer edge locations than Cloudflare, so for some users it could be worse.

### URL Stability
Free tier now includes **1 static domain** (e.g., `your-name.ngrok-free.app`). This means the URL does NOT change on restart -- a significant improvement over Cloudflare quick tunnels where the URL changes every time.

### Docker/Linux Setup
```bash
# Install ngrok
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | tee /etc/apt/sources.list.d/ngrok.list
apt-get update && apt-get install -y ngrok

# Or simpler: download binary directly
curl -sSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
  | tar xz -C /usr/local/bin

# Auth (required, non-interactive)
ngrok config add-authtoken $NGROK_AUTHTOKEN

# Start tunnel
ngrok http 8765 --log stdout &

# Get URL from local API
curl -s http://localhost:4040/api/tunnels | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['tunnels'][0]['public_url'])"
```

### Extracting URL Programmatically
ngrok exposes a local API at `http://localhost:4040/api/tunnels` that returns JSON with the public URL. This is cleaner than grep-from-logs.

### Gotchas
- **20 connections/minute rate limit on free tier**: This is the biggest problem. If the WebSocket drops and reconnects frequently, or if multiple people try to connect, you'll hit this fast. For a single-player game with one persistent WebSocket, it should be fine -- but reconnects during development could be annoying.
- **Auth token required**: Need to store `NGROK_AUTHTOKEN` as an environment variable in Docker/Vast.ai.
- **Interstitial warning page**: ngrok free tier shows an HTML warning page on first HTTP request from a browser. For WebSocket connections this usually doesn't apply, but it can be a nuisance if you ever hit the endpoint with a regular HTTP request.
- **Latency is NOT better than Cloudflare**: ngrok still proxies through relay servers, so latency overhead is similar (~30-60ms).

### Verdict
**Not recommended.** Latency is comparable to Cloudflare (not an improvement). The 20 connections/minute rate limit and required auth token add complexity without benefit. The static domain is nice but doesn't justify the switch.

---

## Option 2: Tailscale Funnel

### Overview
Tailscale is a WireGuard-based mesh VPN. Tailscale Funnel is a feature that exposes a local service to the public internet via a stable HTTPS URL (e.g., `device-name.tailnet-name.ts.net`).

### Free Tier (Personal Plan)
- **100 devices**, 3 users
- **Funnel IS included** on the Personal (free) plan (it is listed as available on Personal, Personal Plus, Premium, and Enterprise)
- Funnel is currently in beta

### WebSocket Support
Not explicitly documented, but Funnel operates as a TLS/TCP proxy. Since WebSocket runs over HTTP/TLS, it should work. However, this is unconfirmed officially and could be a risk.

### TLS/HTTPS
Yes. Tailscale automatically provisions HTTPS certificates for Funnel URLs. The URL format is `https://<hostname>.<tailnet>.ts.net`.

### Latency
Tailscale uses WireGuard for its mesh network, which typically adds **<5ms overhead** for direct peer-to-peer connections. However, **Funnel is NOT a direct connection** -- it routes through Tailscale's DERP relay servers to expose traffic to the public internet. The relay adds latency similar to other proxy-based solutions. Expected overhead: **20-50ms** depending on relay location. Better than Cloudflare in theory, but not dramatically.

### Port Restrictions
Funnel only works on ports **443, 8443, or 10000**. Your service must listen on one of these, or you use `tailscale serve` to proxy from these ports to your actual port (e.g., proxy 443 -> localhost:8765). This adds another layer of proxying.

### Docker Setup
Tailscale in Docker is complex:
```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Start Tailscale daemon (requires TUN device or userspace networking)
tailscaled --state=/var/lib/tailscale/tailscaled.state &

# Authenticate non-interactively with auth key
tailscale up --authkey=$TS_AUTHKEY --hostname=shadow-driver

# Enable Funnel (requires ACL policy changes in Tailscale admin console)
tailscale funnel --bg 8765

# URL is deterministic: https://shadow-driver.<tailnet>.ts.net
```

### Gotchas
- **Requires Tailscale daemon running**: `tailscaled` needs to run inside the container. On Vast.ai's Docker setup, this may conflict with network namespacing.
- **Requires TUN device or userspace networking**: The container needs `/dev/net/tun` or must use `--tun=userspace-networking`. Vast.ai may not expose TUN.
- **ACL policy configuration required**: You must enable Funnel in the Tailscale admin console's ACL policy before it works. This is a one-time setup but adds friction.
- **Auth key management**: Need a Tailscale auth key (pre-authenticated, reusable) stored as an env var.
- **Funnel is beta**: May have undocumented limits or stability issues.
- **Unconfirmed WebSocket support**: The docs don't explicitly confirm WebSocket works through Funnel.

### Verdict
**Not recommended.** Too much operational complexity for marginal latency improvement. Requires TUN device access (may not work on Vast.ai), daemon management, ACL policies, and auth keys. WebSocket support is unconfirmed. The latency improvement over Cloudflare exists but is modest since Funnel still uses relay servers.

---

## Option 3: bore.pub (Open Source TCP Tunnel)

### Overview
bore is a minimal TCP tunnel written in Rust. The public server at `bore.pub` is free to use. It simply forwards TCP connections from a public port to your local port.

### Free Tier
Completely free, no account required, no auth token needed. The public `bore.pub` server is available for anyone.

### WebSocket Support
bore operates at the TCP level, so it forwards any TCP traffic including HTTP/WebSocket. However...

### TLS/HTTPS -- THE DEALBREAKER
**bore does NOT provide TLS.** It exposes a raw TCP port at `bore.pub:<random-port>`. The connection URL would be `ws://bore.pub:12345` (not `wss://`). Since the frontend is on `https://shadow-driver-v3.vercel.app`, browsers will **block mixed content** -- you cannot connect to `ws://` from an `https://` page.

You would need to terminate TLS yourself (e.g., run nginx with a self-signed cert inside the container), but self-signed certs won't work in browsers without manual trust configuration.

### Latency
bore is a simple TCP forwarder with minimal processing. Expected overhead: **5-15ms** -- significantly less than Cloudflare or ngrok. But the lack of TLS makes this moot.

### Verdict
**Not usable.** No TLS support means browsers will block the connection due to mixed content. Would require a separate TLS termination solution, which defeats the simplicity.

---

## Option 4: localhost.run (SSH Tunnel)

### Overview
localhost.run is a free SSH-based tunneling service. You create a tunnel with a single SSH command -- no client software to install.

### Setup
```bash
ssh -R 80:localhost:8765 nokey@localhost.run
```
This outputs a URL like `https://abc123.lhr.life` that proxies to your local port.

### Free Tier
- Free, no account required for basic use
- **Random URL** that changes on every restart
- Custom domains require paid plan
- Bandwidth/connection limits are undocumented but exist

### TLS/HTTPS
Yes. localhost.run provides HTTPS URLs automatically.

### WebSocket Support
Yes. WebSocket connections are supported through the SSH tunnel.

### Latency
SSH tunnel overhead is minimal on the encryption side (~1-3ms for SSH), but the connection still routes through localhost.run's servers. Expected overhead: **20-40ms** -- comparable to Cloudflare.

### Docker Setup
```bash
# Generate SSH key (non-interactive)
ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N "" -q

# Start tunnel (need to parse URL from output)
ssh -o StrictHostKeyChecking=no -R 80:localhost:8765 nokey@localhost.run 2>&1 &

# Extract URL from output
TUNNEL_URL=$(timeout 10 ssh -o StrictHostKeyChecking=no \
  -R 80:localhost:8765 nokey@localhost.run 2>&1 | grep -oE 'https://[^ ]+')
```

### Gotchas
- **Unreliable**: localhost.run has historically had downtime and reliability issues
- **No API for URL extraction**: Must parse stdout, similar to cloudflared
- **Connection timeouts**: SSH tunnels can drop and need to be monitored/restarted
- **URL changes every restart**: No stable URL on free tier
- **Unknown rate limits**: Could be throttled without warning

### Verdict
**Not recommended.** Latency is comparable to Cloudflare. Reliability is worse. No significant advantage over the current setup.

---

## Option 5: serveo.net (SSH Tunnel)

### Overview
serveo.net was a free SSH tunnel service similar to localhost.run. Usage: `ssh -R 80:localhost:8765 serveo.net`.

### Current Status
**serveo.net appears to be down or unreliable as of 2025.** The service has had extended outages in the past and is not actively maintained. Not a viable option.

### Verdict
**Not usable.** Service is unreliable/defunct.

---

## Option 6: Pinggy (SSH Tunnel)

### Overview
Pinggy is a newer SSH-based tunneling service with multi-region support.

### Free Tier
- Free, no account required
- **60-minute tunnel timeout** -- tunnel dies after 60 minutes and must be restarted
- Random subdomain (changes on restart)
- Unlimited data transfer on free tier

### TLS/HTTPS
Yes. Provides HTTPS URLs.

### WebSocket Support
Not explicitly confirmed in documentation, but SSH-based HTTP proxies generally support WebSocket.

### Latency
Multi-region servers (USA, Europe, Asia) mean the tunnel endpoint can be geographically close to the player. Expected overhead: **15-35ms** -- potentially better than Cloudflare depending on player location.

### Setup
```bash
ssh -p 443 -R0:localhost:8765 a.pinggy.io 2>&1 &
# Parse URL from output
```

### Gotchas
- **60-minute timeout on free tier**: This is a dealbreaker for a game session. The tunnel drops after 60 minutes and the player would need to reload with a new URL.
- **No programmatic URL extraction API**

### Verdict
**Not usable for gaming.** The 60-minute timeout makes it impractical.

---

## Option 7: zrok (OpenZiti-based)

### Overview
zrok is an open-source sharing platform built on OpenZiti. It provides public HTTPS URLs for local services. Hosted version available at myzrok.io with a free tier.

### Free Tier
- Generous free tier on hosted myzrok.io
- Account required

### TLS/HTTPS
Yes. Public shares get HTTPS URLs automatically.

### WebSocket Support
Not explicitly documented. OpenZiti is a TCP/UDP overlay, so WebSocket should work in theory.

### Latency
OpenZiti is a zero-trust network overlay. Traffic routes through OpenZiti routers. Expected overhead: **20-50ms** -- comparable to other proxy solutions.

### Setup Complexity
Requires installing the zrok CLI, creating an account, enabling an environment, then sharing. More steps than Cloudflare quick tunnels.

### Verdict
**Not recommended.** More complex than Cloudflare with no clear latency improvement. WebSocket support is unconfirmed.

---

## Comparison Summary

| Solution | Free | TLS | WebSocket | Latency Overhead | Stable URL | No Auth Required | Docker-Friendly | Verdict |
|----------|------|-----|-----------|-----------------|------------|-----------------|-----------------|---------|
| **Cloudflare (current)** | Yes | Yes | Yes | 40-80ms | No (changes) | Yes | Easy | Baseline |
| **ngrok** | Yes | Yes | Yes | 30-60ms | Yes (1 static) | No (token) | Easy | Marginal improvement |
| **Tailscale Funnel** | Yes | Yes | Unconfirmed | 20-50ms | Yes | No (auth key) | Hard (needs TUN) | Too complex |
| **bore.pub** | Yes | **No** | Yes (TCP) | 5-15ms | No | Yes | Easy | No TLS = unusable |
| **localhost.run** | Yes | Yes | Yes | 20-40ms | No | Yes | Easy | Unreliable |
| **serveo.net** | Yes | Yes | Yes | N/A | No | Yes | Easy | Service is down |
| **Pinggy** | Yes | Yes | Likely | 15-35ms | No | Yes | Easy | 60-min timeout |
| **zrok** | Yes | Yes | Unconfirmed | 20-50ms | Yes | No (account) | Medium | More complex |

---

## Recommendation: Stay with Cloudflare Quick Tunnels (for now)

### Why?

After researching all alternatives, **none of them offer a meaningful latency improvement while meeting all requirements.**

The fundamental issue is that all proxy-based tunnel solutions (ngrok, Tailscale Funnel, localhost.run, Pinggy, zrok) add latency because they route traffic through relay servers. The overhead varies from 15-80ms depending on the solution and geography, but no solution eliminates the relay hop.

The only way to achieve near-zero tunnel overhead is:
1. **Direct connection** (bore.pub approach) -- but this lacks TLS, so browsers block it
2. **Self-hosted reverse proxy with a real domain** -- requires owning a domain, running a relay server, managing TLS certs

### If Latency Reduction Is Critical: Self-Hosted Approach

The only realistic way to significantly reduce tunnel latency is to **skip the tunnel entirely** and expose the WebSocket port directly with TLS:

#### Option A: Direct Port Exposure + Caddy (Recommended Future Path)
Instead of tunneling, run a lightweight reverse proxy (Caddy) inside the Docker container that auto-provisions Let's Encrypt TLS certificates:

```bash
# In Dockerfile: install Caddy
RUN curl -sSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy \
    && chmod +x /usr/local/bin/caddy

# In entrypoint.sh:
# Vast.ai exposes ports directly. Get the public IP.
PUBLIC_IP=$(curl -s ifconfig.me)

# Run Caddy as a reverse proxy with automatic HTTPS
# (Requires a domain pointing to this IP, or use Caddy's on-demand TLS)
caddy reverse-proxy --from https://$HOSTNAME.yourdomain.com --to localhost:8765 &
```

**Problem:** This requires a domain name and DNS setup. Vast.ai instances have dynamic IPs, so you'd need dynamic DNS.

#### Option B: Vast.ai Direct Port + Self-Signed TLS
Vast.ai instances can expose ports directly. You could run the WebSocket server with TLS using a self-signed cert, but browsers reject self-signed certs for `wss://`.

#### Option C: Cloudflare Tunnel with `--protocol quic`
The current setup uses `--protocol http2`. Switching to QUIC might reduce latency slightly:
```bash
cloudflared tunnel --url http://localhost:8765 --protocol quic
```
QUIC has lower connection establishment overhead and better multiplexing. This is the **lowest-effort change** that might yield a small improvement (5-15ms reduction).

### Pragmatic Recommendation

1. **Immediate (low effort):** Try `--protocol quic` with the existing Cloudflare tunnel setup. May shave 5-15ms.

2. **Short term:** Stay with Cloudflare quick tunnels. They are free, reliable, zero-auth, easy to automate, and well-tested. The 40-80ms overhead is noticeable but playable for a racing game.

3. **Medium term (if latency becomes a real issue):** Consider ngrok with a static domain. The main advantage is URL stability (no need to extract a new URL on restart), and the local API at `localhost:4040` is cleaner than grep-from-logs. But latency will be similar.

4. **Long term (maximum performance):** Set up a custom domain with Cloudflare DNS, use Cloudflare Tunnel (named tunnel, not quick tunnel) with the `--protocol quic` flag. Named tunnels can be configured to use the nearest Cloudflare PoP and have slightly better routing than quick tunnels. Or, investigate whether Vast.ai supports direct port exposure with a managed TLS certificate.

---

## Quick Win: Try QUIC Protocol

The simplest change to try right now -- modify `entrypoint.sh` line 85:

**Before:**
```bash
cloudflared tunnel --url http://localhost:8765 --protocol http2 > $TUNNEL_LOG 2>&1 &
```

**After:**
```bash
cloudflared tunnel --url http://localhost:8765 --protocol quic > $TUNNEL_LOG 2>&1 &
```

And in `deploy.sh` line 25:
```bash
nohup cloudflared tunnel --url http://localhost:8765 --protocol quic > /tmp/tunnel.log 2>&1 &
```

QUIC uses UDP instead of TCP, reducing connection setup overhead and potentially improving WebSocket performance. If QUIC isn't supported by the cloudflared version in the Docker image, it will fall back to HTTP/2 automatically.

---

## If We Did Switch to ngrok (Setup Reference)

For reference, here's what the ngrok setup would look like if we decided to switch:

### Dockerfile Changes
```dockerfile
# Replace cloudflared installation with ngrok
RUN curl -sSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
    | tar xz -C /usr/local/bin
```

### entrypoint.sh Changes (Step 3)
```bash
# Step 3: Start ngrok tunnel
report_status "tunneling" "Establishing secure tunnel"
echo "Starting ngrok tunnel..."

# Auth (NGROK_AUTHTOKEN must be set as env var on Vast.ai)
ngrok config add-authtoken "$NGROK_AUTHTOKEN"

# Start ngrok (use static domain if configured)
if [ -n "$NGROK_DOMAIN" ]; then
    ngrok http 8765 --domain="$NGROK_DOMAIN" --log=stdout --log-format=json > /tmp/ngrok.log 2>&1 &
else
    ngrok http 8765 --log=stdout --log-format=json > /tmp/ngrok.log 2>&1 &
fi
NGROK_PID=$!

# Wait for ngrok to be ready, then get URL from local API
TUNNEL_URL=""
for i in $(seq 1 30); do
    TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'])" 2>/dev/null)
    if [ -n "$TUNNEL_URL" ]; then
        echo "Tunnel ready: $TUNNEL_URL"
        break
    fi
    sleep 1
done
```

### Environment Variables Needed
```
NGROK_AUTHTOKEN  - ngrok auth token (from ngrok.com dashboard)
NGROK_DOMAIN     - (optional) static domain like "my-game.ngrok-free.app"
```

### Advantages Over Cloudflare
- Stable URL (doesn't change on restart) if using static domain
- Clean API for URL extraction (`localhost:4040/api/tunnels`)
- No interstitial page for WebSocket connections

### Disadvantages
- Requires auth token (another secret to manage)
- 20 connections/minute rate limit
- Similar latency to Cloudflare
- ngrok free tier may show interstitial on HTTP requests

---

## Final Answer

**Stick with Cloudflare quick tunnels.** Try the `--protocol quic` flag for a potential 5-15ms improvement. None of the alternatives offer enough latency reduction to justify the migration effort and added complexity. The real latency bottleneck is likely not the tunnel itself but the geographic distance between the player and the Vast.ai GPU -- which no tunnel solution can fix.
