# Connectivity & Deployment Audit -- Shadow Driver v3

**Date:** 2026-02-20
**Auditor scope:** All transport methods, failure modes, and tunnel strategies between the Vercel frontend and the Vast.ai GPU backend.

---

## 1. Transport Methods in the Codebase

The codebase implements four distinct connectivity paths between the browser and the GPU server. Each serves a different use case.

### 1.1 Cloudflare Quick Tunnels (automatic, no-auth fallback)

**Files:**
- `v3/docker/entrypoint.sh` (lines 144--168)
- `v3/deploy.sh` (lines 76--82)

**How it works:**
The entrypoint runs `cloudflared tunnel --url http://localhost:8765 --protocol http2`. The cloudflared binary establishes a connection to Cloudflare's edge network and registers a random subdomain at `*.trycloudflare.com`. The URL is extracted from the log file via grep:
```bash
TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' $TUNNEL_LOG | head -1)
```
Cloudflare terminates TLS and proxies WebSocket traffic through its CDN to the container's port 8765.

**Latency overhead:** 40--80ms round-trip.

### 1.2 ngrok (primary tunnel, requires auth token)

**Files:**
- `v3/docker/entrypoint.sh` (lines 114--142)
- `v3/deploy.sh` (lines 52--74)
- `v3/api/gpu/start.ts` (lines 56--59, NGROK_AUTHTOKEN passthrough)

**How it works:**
When `NGROK_AUTHTOKEN` is set, ngrok is tried first. The tunnel is started with `ngrok http 8765`, and the URL is extracted from ngrok's local API at `localhost:4040/api/tunnels` via a Python one-liner. This is more reliable than log parsing. If ngrok fails, the system falls back to Cloudflare.

**Latency overhead:** 10--20ms (claimed), 30--60ms (measured in TUNNEL_RESEARCH.md).

### 1.3 SSH Port Forwarding (developer workflow)

**Not in any script -- a manual operation:**
```bash
ssh -N -L 8765:localhost:8765 -p <PORT> root@<IP>
```
This maps the GPU's WebSocket port to `localhost:8765` on the developer's machine. The browser connects to `ws://localhost:8765`, which Chrome allows even from HTTPS pages (localhost is treated as a secure context).

**Latency overhead:** ~5--15ms (SSH encryption only, no proxy relay).

### 1.4 Direct WebSocket via Query Parameter

**Files:**
- `v3/src/pages/Race.tsx` (line 39, line 1136)
- `v3/src/hooks/useGPUConnection.ts` (line 402, `connectDirect` at line 902)

**How it works:**
The URL `https://shadow-driver-v3.vercel.app/race?ws=<tunnel_url>` passes the tunnel URL as a query parameter. The `useGPUConnection` hook converts `https://` to `wss://` and `http://` to `ws://`, then opens a WebSocket. A demo mode (`?demo=true`) connects to `ws://localhost:8765` directly.

**Protocol conversion logic:**
```typescript
const wsUrl = tunnelUrl.replace('https://', 'wss://').replace('http://', 'ws://');
```

### 1.5 Auto-Provisioning Flow (untested end-to-end)

**Files:**
- `v3/api/gpu/start.ts` -- provisions a Vast.ai GPU, passes env vars including `CALLBACK_URL` and `NGROK_AUTHTOKEN`
- `v3/api/gpu/callback.ts` -- receives the tunnel URL from the GPU instance, stores in Vercel KV
- `v3/api/gpu/status.ts` -- polled by the frontend to get the tunnel URL
- `v3/src/hooks/useGPUConnection.ts` (lines 658--708) -- polls `/api/gpu/status` every 5s for up to 15 minutes

**How it works:**
1. Frontend calls `POST /api/gpu/start`
2. Vercel API provisions a Vast.ai instance with the onstart script
3. Onstart script launches `entrypoint.sh` which starts CARLA, race server, and tunnel
4. Tunnel URL is POSTed back to `/api/gpu/callback`
5. Frontend polls `/api/gpu/status` and receives the tunnel URL
6. Frontend connects via WebSocket

**Status:** The onstart script and callback chain exist in code but have NOT been tested end-to-end with the v3 Docker image.

---

## 2. Documented Failure Modes

### 2.1 Cloudflare Quick Tunnel Failures

| Failure | Root Cause | Evidence |
|---------|-----------|----------|
| **QUIC timeout on some datacenters** | Vast.ai hosts may block UDP or have firewall rules that prevent QUIC connections to Cloudflare's edge | entrypoint.sh uses `--protocol http2` as a workaround; QUIC is listed as an untested option in TUNNEL_RESEARCH.md |
| **DNS expiry** | Quick tunnel subdomains are ephemeral; Cloudflare can reclaim the DNS entry at any time, causing `ERR_NAME_NOT_RESOLVED` | LEARNINGS.md documents tunnels dying "within minutes" |
| **Corrupt WebSocket upgrade headers** | Cloudflare's proxy occasionally injects `Connection: keep-alive` instead of `Connection: Upgrade`, causing the WebSocket handshake to fail | Referenced in CLAUDE.md: "invalid Connection header: keep-alive" |
| **40--80ms latency overhead** | Traffic routes through Cloudflare's CDN: Browser -> CF Edge PoP -> CF Internal Network -> CF Connector -> GPU | LEARNINGS.md [2026-02-19 01:00], measured at 120--220ms total RTT |

### 2.2 ngrok Failures

| Failure | Root Cause | Evidence |
|---------|-----------|----------|
| **Expired/invalid auth token** | Free ngrok tokens can expire or be revoked; the `NGROK_AUTHTOKEN` env var may not be set on the Vast.ai instance | deploy.sh line 9: `NGROK_TOKEN="${3:-$NGROK_AUTHTOKEN}"` -- falls through to empty |
| **20 connections/minute rate limit** | Free tier throttles new connections; rapid reconnects during development exhaust the limit | TUNNEL_RESEARCH.md, ngrok section |
| **HTTP interstitial page** | ngrok free tier shows a "Visit Site" warning page on first HTTP GET; does not affect WebSocket upgrade but confuses health checks | LEARNINGS.md [2026-02-19 12:00] |

### 2.3 SSH Port Forwarding Limitations

| Failure | Root Cause | Evidence |
|---------|-----------|----------|
| **No public URL** | SSH tunnel maps to `localhost:8765` on the developer's machine; the deployed Vercel frontend at `https://shadow-driver-v3.vercel.app` cannot reach it | Only works with `npm run dev` on the developer's machine |
| **Requires SSH key setup** | Developer must have `ssh-add ~/.ssh/id_ed25519` loaded and know the Vast.ai port/IP | CLAUDE.md prerequisites section |
| **Tunnel dies on SSH disconnect** | If the terminal session drops, the tunnel drops | Standard SSH behavior |

### 2.4 Auto-Shutdown Race Condition

| Failure | Root Cause | Evidence |
|---------|-----------|----------|
| **Server self-destructs before user connects** | `IDLE_TIMEOUT_SECONDS = 10 * 60` (10 minutes). The auto-shutdown timer starts immediately at boot (`race_server.py` line 2208). If CARLA takes 60--90s to start + tunnel takes 10--30s to establish + user takes time to click "Start Race", a slow setup can consume most of the 10-minute window. If there's a tunnel failure and retry, the window shrinks further. | race_server.py lines 40, 2207--2211 |
| **Countdown is not paused during setup** | The idle timer starts counting from server boot, not from "tunnel ready". Setup time (CARLA boot + tunnel) eats into the idle budget. | entrypoint.sh waits up to 120s for CARLA + up to 60s for tunnel = up to 180s consumed before user can even connect |

### 2.5 Port 8765 Already in Use

| Failure | Root Cause | Evidence |
|---------|-----------|----------|
| **Address already in use on restart** | `deploy.sh` does `pkill -9 -f race_server` but the TCP socket may linger in `TIME_WAIT` state for up to 60 seconds. The `sleep 2` is often not enough. | deploy.sh line 23; CLAUDE.md mentions killing mock WS server blocking port |
| **Mock WS server blocking the port** | A test mock server (`node test/mock_ws_server.mjs`) can hold port 8765, intercepting connections meant for the real server or SSH tunnel | CLAUDE.md "Known Issues" section |

### 2.6 Mixed Content Blocking

| Failure | Root Cause | Evidence |
|---------|-----------|----------|
| **`ws://` blocked from HTTPS page** | Browsers enforce mixed content rules: an HTTPS page cannot open a `ws://` (insecure WebSocket) connection to any non-localhost address. Only `wss://` or `ws://localhost:*` are allowed. | LEARNINGS.md [2026-02-19 01:00]: "ws://66.115.179.154:50187 from https://shadow-driver-v3.vercel.app is blocked" |
| **Direct IP connections impossible** | Even if Vast.ai exposes a port directly, the browser rejects `ws://<public_ip>:8765` from the HTTPS frontend. A TLS termination layer (tunnel, reverse proxy, or self-signed cert) is always required. | TUNNEL_RESEARCH.md: bore.pub ruled out for this reason |

---

## 3. What Works vs. What Doesn't

### Working

| Component | Status | Notes |
|-----------|--------|-------|
| SSH tunnel + local Vite dev server | **Reliable** | `ssh -L 8765:localhost:8765 -p PORT root@IP` + `npm run dev` -> `http://localhost:5173/race?demo=true`. Lowest latency (~50--80ms RTT). Zero tunnel dependency. |
| CARLA 0.9.15 on Vast.ai GPU | **Reliable** | RTX 3090+, runs as `carla` user to avoid root privilege check. Entrypoint.sh handles startup with 120s timeout. |
| Race server (WebSocket on port 8765) | **Reliable** | Python websockets library, handles binary JPEG frames + JSON telemetry at 30Hz. Health check endpoint at `/health`. |
| NVENC H.264 encoding | **Working** | Hardware encode via `h264_nvenc`, ~2--4ms per frame. WebCodecs decode in browser. Falls back to JPEG. |
| NvFBC GPU capture | **Working** | Zero-copy GPU framebuffer capture when Xvfb is running. Falls back to CARLA camera sensor. |
| Cloudflare tunnel with `--protocol http2` | **Fragile** | Works on most Vast.ai datacenters but adds 40--80ms latency. DNS can expire mid-session. |
| WebSocket URL caching in localStorage | **Working** | `useGPUConnection.ts` saves successful WS URLs for 30 minutes for sub-3s reconnect on page refresh. |

### Not Working

| Component | Status | Notes |
|-----------|--------|-------|
| Cloudflare QUIC protocol | **Untested** | `--protocol quic` flag exists in TUNNEL_RESEARCH.md recommendations but is NOT used anywhere in the code. May not work on all Vast.ai datacenters due to UDP blocking. |
| ngrok (current state) | **Broken** | Auth token appears to be expired or missing. No `NGROK_AUTHTOKEN` in current environment variables. System falls back to Cloudflare. |
| WebRTC video streaming | **Disabled** | Intentionally disabled (commit 92e56e0) because Cloudflare tunnels don't support UDP. Only works with direct IP connections. |
| Auto-provisioning flow | **Untested** | The full "Play Game" button flow has never been tested end-to-end with the v3 Docker image. |
| Vercel auto-deploy | **Broken** | Pushes to v3 branch are NOT deploying. The deployed bundle is stale. |

### Fragile

| Component | Status | Risk |
|-----------|--------|------|
| Cloudflare with `--protocol http2` | **Fragile** | Works but adds 40--80ms overhead. Tunnels die unpredictably. Corrupt WebSocket headers observed. |
| Auto-shutdown timer (10 min) | **Fragile** | Too short for development. Setup can consume 2--3 minutes, leaving 7--8 minutes before self-destruct. Page refresh during reconnect can trigger timer. |
| deploy.sh tunnel establishment | **Fragile** | Cloudflare tunnel gets only 5 seconds to establish (`sleep 5` then grep log). On slow networks this is not enough. |

---

## 4. Root Cause Analysis: Why Is This So Hard?

### 4.1 NAT and Firewall: No Direct Ports

Vast.ai containers run behind NAT. There is no public IP or direct port mapping by default. Every connection must go through a tunnel or proxy. This eliminates the simplest solution (direct `wss://` connection) and forces all traffic through a middleman.

**Vast.ai "Direct" network mode** is available but costs more and has not been tested. It provides a public IP with exposed ports, which would allow direct WebSocket connections with a TLS reverse proxy (Caddy/nginx).

### 4.2 HTTPS Frontend Requires wss://

The Vercel frontend is served over HTTPS. Browsers enforce mixed content rules that block `ws://` connections from HTTPS pages (except to `localhost`). This means every tunnel solution MUST provide TLS termination (`wss://`). Solutions that only provide TCP forwarding (bore.pub, raw SSH) are unusable unless combined with a TLS layer.

### 4.3 Quick Tunnels Are Ephemeral

Both Cloudflare quick tunnels and ngrok free tunnels produce random URLs that change on every restart. This creates a multi-step URL propagation chain:

```
GPU boots -> starts tunnel -> extracts URL from logs/API -> POSTs URL to callback
-> stored in Vercel KV -> polled by frontend -> WebSocket connection opened
```

Any failure in this chain means the user cannot connect. The URL is also time-limited -- if the tunnel process dies or DNS expires, the URL becomes invalid and there is no automatic recovery.

### 4.4 Multiple Layers of Indirection

The full connection path has 5+ hops:

```
Browser -> Vercel CDN (HTTPS) -> Vercel API (polling) -> Vercel KV (tunnel URL storage)
-> Tunnel provider (Cloudflare/ngrok) -> Docker container -> race_server.py (port 8765) -> CARLA
```

Each hop adds latency and is a potential failure point. The polling step alone (`POLL_INTERVAL = 5000ms`) adds up to 5 seconds of connection delay.

### 4.5 Auto-Shutdown vs. Slow Boot Race Condition

The auto-shutdown timer starts at server boot, but the server is not "usable" until CARLA is ready (up to 120s), the tunnel is established (up to 60s), and the URL is propagated to the frontend (up to 30s). On a slow boot, 3+ minutes of the 10-minute idle window are consumed before the first client can possibly connect.

---

## 5. Decision Matrix: Which Tunnel to Use When

| Scenario | Recommended Tunnel | Why | Connection URL |
|----------|-------------------|-----|----------------|
| **Local development** | SSH port forward | Zero overhead, always works, no auth needed | `ws://localhost:8765` via `?demo=true` |
| **Testing with deployed Vercel frontend** | SSH port forward + local dev server | Vite dev server at `localhost:5173` can use `ws://localhost:8765`. Deployed Vercel cannot. | `ws://localhost:8765` via `?demo=true` |
| **Demo to someone else** | ngrok (if token valid) | Stable URL, lower latency than Cloudflare, provides TLS | `wss://<subdomain>.ngrok-free.app` via `?ws=` |
| **Demo, no ngrok token** | Cloudflare quick tunnel | No auth required, auto-fallback in deploy.sh | `wss://<random>.trycloudflare.com` via `?ws=` |
| **Production (auto-provisioned)** | ngrok (primary) + Cloudflare (fallback) | entrypoint.sh tries ngrok first, falls back to Cloudflare | URL delivered via callback -> KV -> polling |
| **Lowest possible latency** | SSH tunnel + local dev | ~50--80ms RTT vs 120--220ms through tunnels | `ws://localhost:8765` |
| **Multiple concurrent testers** | Named Cloudflare tunnel (account required) | Quick tunnels are single-use; named tunnels are more stable | Requires Cloudflare account setup |
| **Production (future)** | Vast.ai Direct mode + Caddy reverse proxy | Public IP, auto-TLS via Let's Encrypt, no tunnel overhead | `wss://<hostname>:<port>` |

---

## 6. Recommendations to Speed Up Testing

### Immediate (do today)

1. **Use SSH port forward + local dev server for all testing.**
   This is the most reliable path. Run:
   ```bash
   ssh -N -L 8765:localhost:8765 -p <PORT> root@<IP> &
   cd v3 && npm run dev
   # Open http://localhost:5173/race?demo=true
   ```
   Latency drops from ~200ms to ~70ms. No tunnel dependency.

2. **Kill any mock server before connecting.**
   ```bash
   lsof -i :8765 | grep -v SSH
   ```
   If anything besides SSH is listening, kill it.

3. **Increase auto-shutdown to 30 minutes during development.**
   In `v3/server/race_server.py`, line 40:
   ```python
   IDLE_TIMEOUT_SECONDS = 30 * 60  # 30 minutes for development
   ```
   This prevents the server from self-destructing during slow tunnel setup or page refreshes. Revert to 10 minutes for production.

### Short-term (this week)

4. **Fix the deploy.sh tunnel wait time.**
   The Cloudflare tunnel gets only 5 seconds to establish (line 80: `sleep 5`). Increase to 15 seconds and add a polling loop:
   ```bash
   for i in $(seq 1 30); do
       TUNNEL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/tunnel.log | head -1)
       if [ -n "$TUNNEL" ]; then break; fi
       sleep 1
   done
   ```

5. **Regenerate the ngrok auth token.**
   Go to https://dashboard.ngrok.com/get-started/your-authtoken, generate a new token, and set it as:
   - `NGROK_AUTHTOKEN` in Vercel environment variables
   - Pass it as 3rd argument to `deploy.sh`

6. **Add port-free check before starting race_server.**
   In `deploy.sh`, before starting the server:
   ```bash
   # Wait for port to be free (TIME_WAIT state)
   for i in $(seq 1 10); do
       if ! ss -tlnp | grep -q ':8765 '; then break; fi
       echo "Waiting for port 8765 to be free..."
       sleep 1
   done
   ```

### Medium-term (this month)

7. **Test Vast.ai "Direct" network mode.**
   Rent an instance with Direct networking (public IP, exposed ports). Install Caddy for automatic TLS. This eliminates all tunnel overhead and provides a stable `wss://` endpoint. The setup would look like:
   ```bash
   caddy reverse-proxy --from https://gpu.yourdomain.com:443 --to localhost:8765
   ```

8. **Consider Tailscale mesh VPN.**
   If Direct networking is unavailable, Tailscale provides stable hostnames with ~2ms overhead via WireGuard. Requires the `tailscaled` daemon and TUN device access (may not work on all Vast.ai instances).

9. **Use named Cloudflare tunnels instead of quick tunnels.**
   With a Cloudflare account, named tunnels are more stable than quick tunnels. They have deterministic URLs and better routing. Still adds latency (40--80ms) but DNS expiry and corrupt headers are less likely.

10. **Start the idle timer AFTER tunnel is ready, not at boot.**
    Modify `race_server.py` so the auto-shutdown countdown begins only when the tunnel URL has been reported to the callback. This prevents setup time from eating into the idle budget.

---

## 7. Mistakes to Avoid

1. **Do not rely on Cloudflare quick tunnels for testing.**
   They are free and zero-auth, which makes them tempting, but they die unpredictably. Use SSH tunnels for development. Reserve quick tunnels for demos where you cannot use SSH.

2. **Do not assume ngrok tokens are still valid.**
   Before every deploy with ngrok, verify the token works:
   ```bash
   NGROK_AUTHTOKEN=<token> ngrok http 8765 --log=stdout
   ```
   If it fails with "auth error", regenerate at https://dashboard.ngrok.com.

3. **Do not restart the server without checking if port 8765 is free.**
   After `pkill -9 -f race_server`, the socket may linger in `TIME_WAIT`. Always verify:
   ```bash
   ss -tlnp | grep 8765
   ```
   Wait until it clears before starting the new server.

4. **Do not set auto-shutdown below 20 minutes during development.**
   The 10-minute default is for production cost control. During development, you will lose your server mid-debug if you do not increase it.

5. **Do not forget that Vercel HTTPS -> ws:// is blocked.**
   Every connection from the deployed frontend MUST use `wss://`. The only exception is `ws://localhost:*`, which only works when the developer is running a local dev server. Direct `ws://` to a public IP will always be blocked by the browser.

6. **Do not open multiple browser tabs to the same GPU.**
   The server tracks connected clients for auto-shutdown. Multiple tabs create multiple WebSocket connections. If one tab disconnects uncleanly, it can trigger the idle timer even though another tab is still active. Close extra tabs.

7. **Do not use `--protocol quic` without testing first.**
   Some Vast.ai datacenters block UDP traffic, which QUIC requires. The `--protocol http2` flag is the safer default. Only switch to QUIC after verifying UDP connectivity on the specific datacenter.

---

## 8. Latency Budget Summary

The full latency stack from keypress to screen update:

| Component | SSH Tunnel | Cloudflare Tunnel | Notes |
|-----------|-----------|-------------------|-------|
| Server steering ramp | ~40ms | ~40ms | Fixed, was 130ms |
| NvFBC GPU capture | <1ms | <1ms | Hardware framebuffer capture |
| NVENC H.264 encode | ~2--4ms | ~2--4ms | Hardware encoder, zero-latency preset |
| Network transit (tunnel) | ~30--60ms | ~80--140ms | **The dominant factor** |
| Browser H.264 decode | ~1--3ms | ~1--3ms | WebCodecs hardware decode |
| rAF sync wait | 0--16ms | 0--16ms | requestAnimationFrame jitter |
| **Total** | **~75--125ms** | **~125--205ms** | SSH is 50--80ms faster |

**Key insight:** Network transit through the tunnel is the single largest latency contributor. All encoding, physics, and rendering optimizations combined are smaller than the tunnel overhead difference between SSH and Cloudflare. Optimizing the transport layer provides more return than any other investment.

---

## 9. Connection Flow Diagram

```
Developer Workflow (SSH tunnel):
  Terminal:  ssh -L 8765:localhost:8765 -p PORT root@IP
  Browser:   http://localhost:5173/race?demo=true
  Path:      Browser -> ws://localhost:8765 -> SSH tunnel -> GPU:8765 -> race_server

Direct WS URL (tunnel already established):
  Browser:   https://shadow-driver-v3.vercel.app/race?ws=https://xxx.trycloudflare.com
  Path:      Browser -> wss://xxx.trycloudflare.com -> Cloudflare edge -> GPU:8765 -> race_server

Auto-Provisioned (untested):
  Browser:   POST /api/gpu/start -> poll /api/gpu/status -> receive tunnel_url
  Path:      Browser -> wss://<tunnel_url> -> ngrok/Cloudflare -> GPU:8765 -> race_server
  Callback:  GPU -> POST /api/gpu/callback -> Vercel KV -> polled by frontend
```

---

## 10. File Reference

| File | Purpose | Key Lines |
|------|---------|-----------|
| `v3/docker/entrypoint.sh` | Container entrypoint: starts CARLA, race server, tunnel | L114--168 (tunnel setup) |
| `v3/server/race_server.py` | WebSocket server, auto-shutdown manager | L40 (idle timeout), L385 (handle_client), L2201 (serve) |
| `v3/src/hooks/useGPUConnection.ts` | Client-side WebSocket + provisioning state machine | L395 (connectWebSocket), L402 (URL conversion), L658 (polling) |
| `v3/src/pages/Race.tsx` | Race page, reads `?ws=` and `?demo=` params | L34 (DEMO_WS_URL), L39 (directWsUrl), L1136 (connectDirect) |
| `v3/api/gpu/start.ts` | Vast.ai provisioning, onstart script | L32--85 (ONSTART_SCRIPT), L159 (env passthrough) |
| `v3/api/gpu/callback.ts` | Receives tunnel URL from GPU, stores in KV | L87 (tunnel_url storage) |
| `v3/api/gpu/status.ts` | Polled by frontend for tunnel URL | L78 (tunnel_url retrieval) |
| `v3/deploy.sh` | Manual deploy: copy files, restart server, start tunnel | L19--88 (remote script) |
| `v3/TUNNEL_RESEARCH.md` | Detailed comparison of 7 tunnel solutions | Full file |
| `v3/LEARNINGS.md` | Historical failure documentation | L283--293 (Cloudflare latency, mixed content) |
| `v3/TODO.md` | Transport roadmap and latency budget | L1--26 (latency stack, transport TODO) |
