# Shadow Driver v3 -- Connectivity & Tunnel Technical Audit

**Date:** 2026-02-20
**Scope:** Complete analysis of every connectivity path between the Vercel frontend and the Vast.ai GPU backend, including root causes of failures, architectural problems, and prioritized fixes.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Inventory: All Connectivity Methods](#2-inventory-all-connectivity-methods)
3. [What Works vs. What Does Not](#3-what-works-vs-what-does-not)
4. [Root Cause Analysis of Every Failure](#4-root-cause-analysis-of-every-failure)
5. [Architectural Problems](#5-architectural-problems)
6. [Recommendations (Ordered by Impact)](#6-recommendations-ordered-by-impact)
7. [Mistakes to Avoid](#7-mistakes-to-avoid)
8. [Appendix: File Reference with Line Numbers](#8-appendix-file-reference-with-line-numbers)

---

## 1. Executive Summary

The project has tried five different connectivity approaches (Cloudflare quick tunnels, ngrok, SSH port forwarding, direct IP, local dev server) and none of them work reliably in production. The root problem is not any individual tunnel -- it is that the architecture has **four independent failure points that compound**: tunnel establishment, URL propagation, auto-shutdown timing, and port contention. Even when the tunnel works, the auto-shutdown timer may kill the server before the user connects. Even when the server survives, a zombie process may hold port 8765. Even when the port is free, the tunnel URL may expire before the frontend receives it.

**The single highest-impact fix** is changing the auto-shutdown timer to start AFTER the first client connects (or after the tunnel URL is reported), not at server boot. This one change eliminates the most common failure mode (server self-destructing during setup) and costs zero additional infrastructure.

**The second highest-impact fix** is making `deploy.sh` robust: add SO_REUSEADDR to the Python server, add a port-free wait loop, and increase the Cloudflare tunnel wait from 5 seconds to 30 seconds with a polling loop.

---

## 2. Inventory: All Connectivity Methods

### 2.1 Cloudflare Quick Tunnels

**Files:**
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/docker/entrypoint.sh` lines 144-168
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/deploy.sh` lines 76-82

**Mechanism:** The `cloudflared` binary (installed in Dockerfile line 33-34) connects to Cloudflare's edge network and registers a random `*.trycloudflare.com` subdomain. The URL is extracted via log grep:

```bash
# entrypoint.sh line 148
cloudflared tunnel --url http://localhost:$WS_PORT --protocol http2 > $TUNNEL_LOG 2>&1 &

# entrypoint.sh line 153
TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' $TUNNEL_LOG | head -1)
```

**Protocol:** HTTP/2 is hardcoded via `--protocol http2`. This is deliberate -- QUIC (UDP) is blocked on some Vast.ai datacenters.

**Latency overhead:** 40-80ms round-trip (measured in LEARNINGS.md at 120-220ms total RTT vs 50-80ms via SSH).

### 2.2 ngrok

**Files:**
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/docker/entrypoint.sh` lines 114-142
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/deploy.sh` lines 52-74
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/api/gpu/start.ts` lines 159-163 (env passthrough)
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/docker/Dockerfile` lines 39-40 (ngrok install)

**Mechanism:** When `NGROK_AUTHTOKEN` is set, ngrok is tried before Cloudflare. URL is extracted from ngrok's local REST API at `localhost:4040/api/tunnels` (more reliable than log parsing). Falls back to Cloudflare if ngrok fails.

```bash
# entrypoint.sh line 121
ngrok http $WS_PORT --log=stdout --log-format=json > $NGROK_LOG 2>&1 &

# entrypoint.sh line 128-129
TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
    | python3 -c "import sys,json; tunnels=json.load(sys.stdin).get('tunnels',[]); print(tunnels[0]['public_url'] if tunnels else '')" 2>/dev/null)
```

**Latency overhead:** 30-60ms (TUNNEL_RESEARCH.md).

### 2.3 SSH Port Forwarding

**Files:** Not codified in any script. Manual operation documented in CLAUDE.md.

```bash
ssh -N -L 8765:localhost:8765 -p <PORT> root@<IP>
```

Maps the GPU's port 8765 to `localhost:8765` on the developer's machine. Combined with `npm run dev` (Vite on localhost:5173), the browser connects to `ws://localhost:8765` which browsers allow even from HTTPS origins (localhost is a secure context).

**Latency overhead:** ~5-15ms (SSH encryption only, no proxy relay).

### 2.4 Direct IP Access

**Files:**
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/api/gpu/start.ts` line 158 (`ports: '8765/tcp'`)
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/hooks/useGPUConnection.ts` line 401

**Mechanism:** The Vast.ai provisioning requests port 8765/tcp to be exposed. In theory, the browser could connect directly to `ws://<vast_ip>:8765`.

**Status:** Does NOT work. Vast.ai uses NAT -- even with `ports: '8765/tcp'`, the port is not directly accessible from the internet. Additionally, the HTTPS frontend blocks `ws://` connections to non-localhost addresses (mixed content policy). See LEARNINGS.md line 290.

### 2.5 Direct WebSocket via Query Parameter (`?ws=`)

**Files:**
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/pages/Race.tsx` line 39, 1136
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/hooks/useGPUConnection.ts` line 401, 901-904

**Mechanism:** The URL `https://shadow-driver-v3.vercel.app/race?ws=<tunnel_url>` passes a tunnel URL as a query parameter. The hook converts `https://` to `wss://`:

```typescript
// useGPUConnection.ts line 401
const wsUrl = tunnelUrl.replace('https://', 'wss://').replace('http://', 'ws://');
```

A demo mode (`?demo=true`) connects to `ws://localhost:8765`:

```typescript
// Race.tsx line 34
const DEMO_WS_URL = 'ws://localhost:8765';
```

**Status:** Works when the tunnel URL is valid. This is the primary testing path.

### 2.6 Auto-Provisioning Flow

**Files:**
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/api/gpu/start.ts` -- provisions Vast.ai instance
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/api/gpu/callback.ts` -- receives tunnel URL
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/api/gpu/status.ts` -- polled by frontend
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/hooks/useGPUConnection.ts` lines 658-708 (polling)

**Mechanism:** Frontend calls `POST /api/gpu/start` -> Vercel API provisions Vast.ai -> onstart script launches entrypoint -> tunnel URL POSTed to `/api/gpu/callback` -> stored in Vercel KV -> frontend polls `/api/gpu/status` every 5s (up to 15 min) -> receives tunnel URL -> opens WebSocket.

**Status:** Never tested end-to-end with v3 Docker image. Documented as "untested" in CLAUDE.md.

### 2.7 WebSocket URL Caching (localStorage)

**Files:**
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/hooks/useGPUConnection.ts` lines 27-64

**Mechanism:** On successful WebSocket connection, the tunnel URL is saved to localStorage with a 30-minute TTL (`WS_URL_MAX_AGE_MS`). On page load, `getLastWsUrl()` is called and the URL is used as `directWsUrl` in Race.tsx line 39. This enables sub-3s reconnect on page refresh.

```typescript
// useGPUConnection.ts line 30
const WS_URL_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
```

**Status:** Works for page refreshes. Breaks if the tunnel dies mid-session (stale URL saved, next visit fails). `clearLastWsUrl()` is called on fatal errors (line 617, 640).

---

## 3. What Works vs. What Does Not

### Reliable

| Component | Evidence |
|-----------|----------|
| SSH tunnel + local Vite dev server | Lowest latency (~50-80ms RTT). Zero tunnel dependency. Always works when SSH is reachable. |
| WebSocket server (websockets library on port 8765) | Handles binary JPEG + JSON telemetry at 30Hz. Health check at `/health`. No observed WebSocket-layer failures. |
| CARLA 0.9.15 on Vast.ai | RTX 3090+, root privilege fix (`su carla`), 120s startup timeout in entrypoint.sh. |
| `?ws=` query parameter connection | Simple, stateless, works with any valid `wss://` URL. |
| JPEG-over-WebSocket streaming | ~18 FPS, reliable through any HTTP proxy/tunnel. |
| WebSocket URL caching | Enables fast reconnect on page refresh. Properly invalidated on errors. |

### Broken

| Component | Failure Mode |
|-----------|-------------|
| ngrok auth token | Token is expired or missing. `NGROK_AUTHTOKEN` not set in environment. System falls to Cloudflare. |
| Direct IP access | Vast.ai NAT prevents direct port access. Mixed content policy blocks `ws://` from HTTPS frontend. |
| Auto-provisioning flow | Never tested end-to-end. Depends on Vercel KV, callback chain, and tunnel -- any link can fail silently. |
| Vercel auto-deploy | Pushes to v3 branch not deploying. Stale bundle on production. |
| WebRTC video | Intentionally disabled (commit 92e56e0). Cloudflare tunnels block UDP required for WebRTC. |

### Fragile (Works Sometimes)

| Component | Risk |
|-----------|------|
| Cloudflare quick tunnels | 40-80ms overhead. DNS can expire mid-session. Corrupt `Connection: keep-alive` headers observed. `--protocol http2` is a workaround for QUIC failures but still unreliable. |
| Auto-shutdown timer | 10 minutes from boot. CARLA boot (up to 120s) + tunnel setup (up to 60s) + user action time eats into the window. Server may self-destruct before first connection. |
| `deploy.sh` tunnel setup | Cloudflare tunnel gets only `sleep 5` (line 80) before URL extraction. Too short on slow networks. |
| Port 8765 reuse after restart | `pkill -9` + `sleep 2` leaves socket in TIME_WAIT. Server restart fails with "address already in use". |

---

## 4. Root Cause Analysis of Every Failure

### 4.1 Cloudflare QUIC Timeout

**Error:** `failed to dial to edge with quic: timeout: no recent network activity`

**Root cause:** Some Vast.ai datacenters have firewall rules that block UDP traffic. QUIC (the default cloudflared protocol) requires UDP. When UDP is blocked, the QUIC handshake times out.

**Where in code:** The codebase already works around this. `entrypoint.sh` line 148 uses `--protocol http2`, which forces TCP-only mode. `deploy.sh` line 79 does NOT use `--protocol http2` (just `cloudflared tunnel --url http://localhost:8765`), which means deploy.sh is more likely to hit this failure than the Docker entrypoint.

**Fix:** Add `--protocol http2` to `deploy.sh` line 79.

### 4.2 Cloudflare HTTP/2 TLS Timeout

**Error:** `TLS handshake with edge error: read tcp... i/o timeout`

**Root cause:** Network connectivity issues between the Vast.ai instance and Cloudflare's edge PoP. This can be caused by: (a) temporary network congestion on the datacenter's uplink, (b) Cloudflare edge PoP overload, or (c) DNS resolution failure for Cloudflare's edge addresses.

**Where in code:** The entrypoint (line 162-168) reports this as a fatal error and exits. There is no retry logic for tunnel establishment.

**Fix:** Add a retry loop. Try up to 3 times with 10-second delays before giving up. Also consider adding `--retries 5` flag to cloudflared (if supported by the version installed).

### 4.3 ngrok Auth Token Invalid (ERR_NGROK_107)

**Error:** `ERR_NGROK_107` -- auth token is invalid or expired.

**Root cause:** The `NGROK_AUTHTOKEN` environment variable is either not set, empty, or contains an expired token. The token is passed from Vercel env -> Vast.ai instance env -> entrypoint.sh. Any break in this chain results in ngrok failing. ngrok free tier tokens do not expire automatically, but they can be revoked from the dashboard.

**Where in code:**
- `start.ts` line 163: `...(NGROK_AUTHTOKEN ? { NGROK_AUTHTOKEN } : {})` -- conditionally passes the token only if it exists in Vercel env.
- `entrypoint.sh` line 116: `if [ -n "$NGROK_AUTHTOKEN" ]` -- skips ngrok entirely if token is missing.
- `deploy.sh` line 9: `NGROK_TOKEN="${3:-$NGROK_AUTHTOKEN}"` -- takes token from 3rd CLI argument or shell env.

**Fix:** Regenerate the ngrok token at https://dashboard.ngrok.com/get-started/your-authtoken. Set it as `NGROK_AUTHTOKEN` in both Vercel environment variables and local shell environment. Claim a free static domain (`*.ngrok-free.app`) to avoid URL changes on restart.

### 4.4 Auto-Shutdown Killing Server Before User Connects

**Error:** Server exits with `[auto-shutdown] Exiting process...` before any WebSocket connection is established.

**Root cause:** The auto-shutdown timer starts **immediately when the race server process starts** (line 2207-2211 of `race_server.py`), not when the server becomes reachable by users. The timeline:

```
T=0      Server process starts, 10-minute countdown begins
T=0-120s CARLA boots (entrypoint.sh waits up to 120s)
T=120s   Race server starts (entrypoint.sh line 94)
T=123s   entrypoint.sh waits 3s (line 98), checks server is alive
T=123-183s  Tunnel establishment (up to 60s for Cloudflare)
T=183s   Tunnel URL extracted, reported to callback
T=183s+  User sees the URL, clicks play, browser connects
```

But wait -- the race server's own internal timer started at T=120s (when `race_server.py` launched), and the 10-minute window began counting from there. By the time the tunnel is ready (T=183s), only ~7 minutes remain. If the user takes a few minutes to configure and start a race, the server may self-destruct mid-session.

**Critical detail:** The timer runs **inside `race_server.py`** (line 2209), not in the entrypoint. So the countdown starts when the Python process launches, not when CARLA finishes booting. This means:

- Best case: CARLA boots in 30s + tunnel in 10s = 40s consumed, 9m20s remaining.
- Worst case: CARLA boots in 90s + tunnel in 30s = 120s consumed, 8m remaining.
- With tunnel failure + retry: Could consume 3+ minutes, leaving <7 minutes.

**Additional problem:** The auto-shutdown also fires `sys.exit(0)` (line 180), which kills the Python process. Since the entrypoint does `wait $SERVER_PID` (line 184), this causes the container to exit entirely, destroying the Vast.ai instance.

**Fix:** Two options:
1. **Delay timer start:** Start the countdown only after the first `client_connected` call, not at boot. The first disconnect would then start the idle timer.
2. **Separate boot timer:** Use a longer initial timeout (e.g., 30 minutes) for the first-ever connection, then switch to 10 minutes after the first disconnect.

### 4.5 Port 8765 "Address Already in Use"

**Error:** `OSError: [Errno 98] Address already in use`

**Root cause:** `deploy.sh` line 23 runs `pkill -9 -f race_server` followed by `sleep 2`. The `-9` (SIGKILL) does not allow the Python process to cleanly close its listening socket. The kernel keeps the TCP socket in `TIME_WAIT` state for up to 60 seconds (the standard TCP TIME_WAIT duration). The `sleep 2` is insufficient.

The `websockets.serve()` call in `race_server.py` line 2201 does not set `SO_REUSEADDR` on the listening socket.

**Secondary cause:** The mock WebSocket server (`node test/mock_ws_server.mjs`) may hold port 8765 on the developer's local machine, intercepting SSH-tunneled connections.

**Fix:**
1. Set `SO_REUSEADDR` in the race server. The `websockets.serve()` function accepts `reuse_port=True` in newer versions, or pass a pre-configured socket.
2. In `deploy.sh`, add a port-free wait loop after killing the old process.
3. Use `pkill -15` (SIGTERM) instead of `pkill -9` to allow graceful shutdown. The server has SIGTERM handlers (line 2220-2221).

### 4.6 Vast.ai NAT Preventing Direct Port Access

**Root cause:** Vast.ai containers run behind NAT by default. The `ports: '8765/tcp'` parameter in `start.ts` line 158 requests port exposure, but Vast.ai maps this to a random high port (e.g., 50187) on the host. The container's port 8765 is NOT directly accessible from the internet on port 8765.

Even if port mapping worked, the HTTPS frontend cannot connect to `ws://<public_ip>:<port>` due to mixed content policy. Only `wss://` is allowed from HTTPS origins (except `ws://localhost`).

**Fix:** This is a fundamental constraint. Tunnels are required as long as the frontend is on HTTPS and Vast.ai uses NAT. The only alternative is Vast.ai "Direct" network mode (public IP with direct port access) combined with TLS termination (Caddy or nginx with auto-TLS).

### 4.7 Vercel Deploy Failures

**Root causes (multiple):**
1. **Root directory misconfiguration:** Vercel may be building from the repository root instead of `v3/`. The `vercel.json` and `package.json` are in `v3/`, but Vercel's default is the repo root.
2. **TypeScript errors:** Vercel builds fail on TS type errors that the local dev server ignores (Vite's dev mode does not type-check).
3. **Rate limiting:** Vercel free tier limits deployments. Rapid pushes during development can hit this.

**Where in code:** The deploy workflow is at `.github/workflows/deploy-frontend.yml` (mentioned in CLAUDE.md but not present in current v3 directory -- only exists at the repo root level).

**Fix:** Three options documented in CLAUDE.md: (a) GitHub Actions with `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` secrets, (b) Vercel dashboard Root Directory = `v3/` and Production Branch = `v3`, (c) CLI deploy with `npx vercel --prod`.

### 4.8 Cloudflare Tunnel Corrupt WebSocket Headers

**Error:** `invalid Connection header: keep-alive`

**Root cause:** Cloudflare's HTTP/2 proxy sometimes rewrites the `Connection: Upgrade` header to `Connection: keep-alive` during the WebSocket upgrade handshake. This causes the server-side websockets library to reject the connection. This is a known issue with Cloudflare's quick tunnel proxy and happens intermittently, likely during edge PoP handoffs or when HTTP/2 multiplexing interferes with the upgrade.

**Where in code:** Not handled anywhere. The websockets library raises a `websockets.exceptions.InvalidUpgrade` error, the connection fails, and the client retries up to 3 times (useGPUConnection.ts lines 629-636).

**Fix:** No application-level fix possible -- this is a Cloudflare proxy bug. Mitigation: use ngrok (which does not have this issue) or use named Cloudflare tunnels (more stable than quick tunnels).

---

## 5. Architectural Problems

### 5.1 The Timer-Tunnel-Callback Triple Race Condition

The most damaging architectural problem is that three independent asynchronous processes must all succeed within a tight time window, with no coordination between them:

```
Process A: Auto-shutdown timer (10 min from boot)
Process B: Tunnel establishment (up to 60s, may fail and need retry)
Process C: URL propagation (callback -> KV -> poll by frontend, up to 30s)
```

These processes are completely decoupled:
- The timer does not know if the tunnel is established
- The tunnel does not know if the timer is still running
- The frontend does not know if the server is about to shut down

**Result:** The system is fragile by construction. Any slowdown in Process B or C eats into Process A's budget, potentially causing the server to self-destruct just as the user is about to connect.

**Fix:** Couple Process A to Process B. The timer should not start until the tunnel is established (or until the first client connects). This is a 3-line code change in `race_server.py`.

### 5.2 Tunnel URL Propagation Is a Rube Goldberg Machine

For the auto-provisioning flow, the tunnel URL takes this path:

```
GPU container -> extract from logs/API -> POST to Vercel callback -> store in Vercel KV
-> polled by frontend every 5s -> URL received -> WebSocket connection opened
```

Every step can fail silently:
1. Log extraction might fail if the tunnel logs are slow to write
2. The callback POST might fail if the Vercel function is cold-starting
3. The KV store might have a write delay
4. The polling might miss the update if it falls between poll intervals
5. The WebSocket connection might fail if the tunnel URL is not yet routable

**The fundamental issue:** The URL is ephemeral (changes on every restart), so it must be propagated through this chain every time. A stable URL (ngrok static domain, named Cloudflare tunnel, or direct IP with DNS) would eliminate this entire chain.

### 5.3 No Health Monitoring of the Tunnel

Once the tunnel is established, nothing monitors whether it is still alive. If the tunnel process dies (Cloudflare quick tunnels are known to die after hours), the URL becomes invalid, but:
- The server does not know the tunnel died (it only listens on localhost:8765)
- The frontend gets `WebSocket connection failed` errors and retries 3 times, then gives up
- The localStorage-cached URL becomes stale but is not cleared until the retry fails
- There is no mechanism to re-establish the tunnel automatically

**Fix:** Add a tunnel health check loop in the entrypoint that pings the tunnel URL every 60 seconds. If it fails, restart the tunnel process and report the new URL to the callback.

### 5.4 Two Different Tunnel Strategies in Two Different Files

`entrypoint.sh` and `deploy.sh` both implement tunnel establishment, but with different logic:

| Aspect | entrypoint.sh | deploy.sh |
|--------|--------------|-----------|
| Cloudflare protocol | `--protocol http2` (line 148) | Not specified (line 79) |
| Cloudflare wait time | Up to 60s polling loop (lines 151-160) | `sleep 5` then one grep (line 80-81) |
| ngrok wait time | Up to 30s polling loop (lines 125-134) | Up to 15s polling loop (lines 60-68) |
| Error reporting | Reports to callback URL (lines 162-168) | Prints to stdout only |
| Tunnel restart on failure | Exits container (line 168) | Falls back to Cloudflare (line 72) |

This duplication means fixes must be applied in two places, and behavior differs between initial boot and manual deploy.

**Fix:** Extract tunnel logic into a shared script (e.g., `start_tunnel.sh`) that both entrypoint.sh and deploy.sh source.

### 5.5 No Graceful Server Restart

When `deploy.sh` restarts the server:
1. `pkill -9 -f race_server` -- SIGKILL, no cleanup
2. `pkill -9 -f cloudflared` -- kills existing tunnel
3. `pkill -9 -f ngrok` -- kills existing tunnel
4. `sleep 2` -- hope the port is free
5. Start new server
6. Start new tunnel

This is a "stop the world" approach. The user's active WebSocket connection is killed, the tunnel URL changes, and the user must get the new URL manually.

**Fix:** Use SIGTERM instead of SIGKILL. The race server handles SIGTERM (lines 2220-2221) and can close connections gracefully. For server code updates without tunnel changes, consider a hot-reload mechanism: send the server a SIGHUP to reload Python modules without restarting the process.

---

## 6. Recommendations (Ordered by Impact)

### Priority 1: Fix the Auto-Shutdown Timer (30 minutes of work, eliminates the most common failure)

**Problem:** Server self-destructs before users can connect.

**Change in `/Users/rkshah20/side-projects/carla-shadow-driver/v3/server/race_server.py`:**

Replace the immediate timer start at lines 2207-2211:

```python
# CURRENT (broken): Timer starts at boot, counts down during setup
server.shutdown_manager._idle_task = asyncio.create_task(
    server.shutdown_manager._idle_countdown()
)
```

With a deferred timer that only starts after the first connection-then-disconnection cycle:

```python
# FIXED: No timer at boot. Timer starts only after first client disconnects.
# The AutoShutdownManager.client_disconnected() method already creates the
# idle task when connected_clients drops to 0. So we just need to NOT start
# it here. For safety, add a long initial timeout (30 min) as a fallback
# in case no client ever connects.
INITIAL_TIMEOUT_SECONDS = 30 * 60  # 30 minutes before first connection
server.shutdown_manager._idle_task = asyncio.create_task(
    server.shutdown_manager._idle_countdown_initial()
)
```

And add a new method to `AutoShutdownManager`:

```python
async def _idle_countdown_initial(self):
    """Long initial timeout (30 min) for first-ever connection.
    Replaced by the normal 10-minute timer once a client connects."""
    try:
        await asyncio.sleep(30 * 60)
        if len(self.connected_clients) == 0:
            await self._destroy_instance()
    except asyncio.CancelledError:
        pass  # Cancelled when first client connects
```

This gives the full provisioning + tunnel + user interaction flow 30 minutes to complete, while preserving the 10-minute idle timer for subsequent disconnects.

**Alternative (simpler):** Just increase `IDLE_TIMEOUT_SECONDS` on line 40 from `10 * 60` to `30 * 60`. Less precise but eliminates the race condition with zero additional code.

### Priority 2: Make deploy.sh Robust (1 hour of work, eliminates port contention and tunnel failures)

Three changes to `/Users/rkshah20/side-projects/carla-shadow-driver/v3/deploy.sh`:

**a) Add `--protocol http2` to Cloudflare tunnel (line 79):**
```bash
# BEFORE:
nohup cloudflared tunnel --url http://localhost:8765 > /tmp/tunnel.log 2>&1 &

# AFTER:
nohup cloudflared tunnel --url http://localhost:8765 --protocol http2 > /tmp/tunnel.log 2>&1 &
```

**b) Replace `sleep 5` with a polling loop (lines 80-81):**
```bash
# BEFORE:
sleep 5
TUNNEL=$(grep -o 'https://[a-z-]*\.trycloudflare\.com' /tmp/tunnel.log | head -1)

# AFTER:
for i in $(seq 1 30); do
    TUNNEL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/tunnel.log | head -1)
    if [ -n "$TUNNEL" ]; then break; fi
    sleep 1
done
```

**c) Add port-free wait after killing old server (after line 23):**
```bash
# After pkill, wait for port to be free
for i in $(seq 1 15); do
    if ! ss -tlnp 2>/dev/null | grep -q ':8765 '; then break; fi
    echo "Waiting for port 8765 to be free ($i/15)..."
    sleep 1
done
```

**d) Use SIGTERM instead of SIGKILL (line 23):**
```bash
# BEFORE:
pkill -9 -f race_server 2>/dev/null

# AFTER:
pkill -15 -f race_server 2>/dev/null; sleep 1; pkill -9 -f race_server 2>/dev/null
```

### Priority 3: Add SO_REUSEADDR to the Race Server (5 minutes, eliminates "address in use" errors)

**Change in `/Users/rkshah20/side-projects/carla-shadow-driver/v3/server/race_server.py`:**

At line 2201, the `websockets.serve()` call does not set socket options. Add `reuse_port`:

```python
# BEFORE:
async with websockets.serve(
    server.handle_client, "0.0.0.0", port,
    process_request=process_request,
):

# AFTER:
import socket
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("0.0.0.0", port))
sock.listen()
sock.setblocking(False)

async with websockets.serve(
    server.handle_client, sock=sock,
    process_request=process_request,
):
```

Or, more simply, if the `websockets` library version supports it (14.1 does):
```python
async with websockets.serve(
    server.handle_client, "0.0.0.0", port,
    process_request=process_request,
    reuse_port=True,
):
```

### Priority 4: Regenerate ngrok Token and Claim Static Domain (15 minutes, makes tunnels more reliable)

1. Go to https://dashboard.ngrok.com/get-started/your-authtoken
2. Generate a new auth token
3. Go to https://dashboard.ngrok.com/domains and claim a free static domain (e.g., `shadow-driver.ngrok-free.app`)
4. Set `NGROK_AUTHTOKEN` in:
   - Vercel environment variables (for auto-provisioning)
   - Local shell profile (`export NGROK_AUTHTOKEN=...` in `~/.zshrc`)
5. Update `entrypoint.sh` and `deploy.sh` to use the static domain:
   ```bash
   ngrok http 8765 --domain=shadow-driver.ngrok-free.app --log=stdout
   ```

The static domain means the URL does not change on restart. This eliminates the URL propagation problem entirely for manual deployments -- the user can bookmark a single `?ws=https://shadow-driver.ngrok-free.app` URL.

### Priority 5: Add Tunnel Health Monitoring (2 hours, prevents silent tunnel death)

Add a background health check to `entrypoint.sh` that periodically verifies the tunnel is alive:

```bash
# After tunnel is established and reported:
(
    while true; do
        sleep 60
        # Check if tunnel process is alive
        if ! kill -0 $CF_PID 2>/dev/null && ! kill -0 $NGROK_PID 2>/dev/null; then
            echo "[health] Tunnel process died, restarting..."
            # Restart tunnel logic here
            break
        fi
        # Check if tunnel URL is reachable
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$TUNNEL_URL/health" 2>/dev/null)
        if [ "$HTTP_CODE" != "200" ]; then
            echo "[health] Tunnel URL unreachable (HTTP $HTTP_CODE), restarting..."
            # Restart tunnel logic here
            break
        fi
    done
) &
```

### Priority 6: Unify Tunnel Logic into a Shared Script (1 hour, reduces duplication)

Create `/Users/rkshah20/side-projects/carla-shadow-driver/v3/scripts/start_tunnel.sh`:

```bash
#!/bin/bash
# Usage: source start_tunnel.sh
# Sets: TUNNEL_URL, TUNNEL_PID
# Requires: WS_PORT, NGROK_TOKEN (optional)

start_tunnel() {
    local ws_port="${1:-8765}"
    local ngrok_token="${2:-$NGROK_AUTHTOKEN}"
    TUNNEL_URL=""
    TUNNEL_PID=""

    # Try ngrok first
    if [ -n "$ngrok_token" ]; then
        ngrok config add-authtoken "$ngrok_token" 2>/dev/null
        nohup ngrok http "$ws_port" --log=stdout --log-format=json > /tmp/ngrok.log 2>&1 &
        TUNNEL_PID=$!
        for i in $(seq 1 30); do
            TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
                | python3 -c "import sys,json; t=json.load(sys.stdin).get('tunnels',[]); print(t[0]['public_url'] if t else '')" 2>/dev/null) || true
            [ -n "$TUNNEL_URL" ] && return 0
            sleep 1
        done
        kill $TUNNEL_PID 2>/dev/null
    fi

    # Fallback: Cloudflare
    nohup cloudflared tunnel --url "http://localhost:$ws_port" --protocol http2 > /tmp/cloudflared.log 2>&1 &
    TUNNEL_PID=$!
    for i in $(seq 1 60); do
        TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /tmp/cloudflared.log | head -1)
        [ -n "$TUNNEL_URL" ] && return 0
        sleep 1
    done

    return 1
}
```

Then both `entrypoint.sh` and `deploy.sh` can `source scripts/start_tunnel.sh && start_tunnel 8765 "$NGROK_TOKEN"`.

### Priority 7: Fix Vercel Deployment (30 minutes, unblocks frontend iteration)

The quickest path (from CLAUDE.md):

```bash
cd v3 && npx vercel login && npx vercel --prod
```

For persistent fix, configure Vercel dashboard:
1. Go to Project Settings -> General
2. Set Root Directory to `v3/`
3. Set Production Branch to `v3`

Or set up the GitHub Actions workflow with the required secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).

### Priority 8 (Medium-Term): Vast.ai Direct Mode + Caddy (eliminates tunnels entirely)

The ideal production architecture eliminates tunnels completely:

1. Rent a Vast.ai instance with **Direct** networking (provides a public IP)
2. Install Caddy in the Docker image:
   ```dockerfile
   RUN curl -sL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy && \
       chmod +x /usr/local/bin/caddy
   ```
3. Point a DNS record to the public IP (e.g., `gpu.shadowdriver.com`)
4. Run Caddy as a reverse proxy with auto-TLS:
   ```bash
   caddy reverse-proxy --from gpu.shadowdriver.com --to localhost:8765
   ```
5. Browser connects to `wss://gpu.shadowdriver.com` -- stable, low-latency, no tunnel

**Tradeoff:** Direct networking instances are slightly more expensive on Vast.ai and less available. Caddy requires a domain name and DNS setup. But this eliminates all tunnel-related failures.

---

## 7. Mistakes to Avoid

### 7.1 Do Not Treat Tunnels as Reliable Infrastructure

Every tunnel (Cloudflare, ngrok, bore, Tailscale Funnel) is a best-effort relay service. Quick tunnels are explicitly ephemeral -- Cloudflare reserves the right to reclaim DNS entries at any time. Building production flows on top of quick tunnels is building on sand.

**Pattern to avoid:** Assuming the tunnel URL will remain valid for the duration of a gaming session. The frontend should have a reconnection mechanism that either re-provisions the tunnel or falls back to a different URL.

### 7.2 Do Not Kill Processes with SIGKILL (-9) Unless Necessary

`deploy.sh` line 23 uses `pkill -9` which prevents graceful socket cleanup, leaving ports in TIME_WAIT. Always try SIGTERM first, wait 2 seconds, then SIGKILL as a fallback:

```bash
pkill -15 -f race_server 2>/dev/null; sleep 2; pkill -9 -f race_server 2>/dev/null
```

### 7.3 Do Not Start Timers That Compete with Setup

The auto-shutdown timer (10 min) starting at boot while the setup takes 2-3 minutes is a design antipattern. Any timer that controls resource lifecycle must start AFTER the resource is fully available, not during initialization.

### 7.4 Do Not Use `sleep N` When Waiting for Asynchronous Events

`deploy.sh` uses `sleep 5` to wait for the Cloudflare tunnel, `sleep 2` to wait for port cleanup. These are hardcoded guesses. Always use polling loops with timeouts:

```bash
# Bad: hoping 5 seconds is enough
sleep 5
TUNNEL=$(grep ...)

# Good: poll until ready or timeout
for i in $(seq 1 30); do
    TUNNEL=$(grep ...)
    [ -n "$TUNNEL" ] && break
    sleep 1
done
```

### 7.5 Do Not Duplicate Tunnel Logic in Multiple Files

The tunnel setup is implemented separately in `entrypoint.sh` and `deploy.sh` with different parameters (e.g., `--protocol http2` present in one but not the other). This guarantees they will diverge. Extract shared logic into a single script.

### 7.6 Do Not Forget Mixed Content Rules

Every connectivity approach must provide TLS (`wss://`). Direct `ws://` connections from the HTTPS frontend are blocked except to `localhost`. This is not a bug to fix -- it is a browser security requirement. Test with `wss://` from the start.

### 7.7 Do Not Open Multiple Browser Tabs to the Same Server

The auto-shutdown manager (line 43-180 of race_server.py) tracks `connected_clients` as a set of WebSocket protocol objects. Multiple tabs create multiple connections. If one tab's connection drops uncleanly, `client_disconnected` fires and may start the idle timer even though other tabs are still connected. The timer IS cancelled when another `client_connected` fires, but there is a race window.

### 7.8 Do Not Test Connectivity Changes Through the Full Provisioning Pipeline

When debugging tunnel issues, do not use the "Play Game" auto-provisioning flow. It adds 5+ minutes of Vast.ai boot time before you can even see if your tunnel fix works. Instead:

1. SSH into an already-running Vast.ai instance
2. Manually start/restart the tunnel
3. Test with `?ws=<url>` directly

### 7.9 Do Not Rely on Log Parsing for URL Extraction

`entrypoint.sh` extracts the Cloudflare tunnel URL by grepping the log file. This is fragile -- the log format can change between cloudflared versions, the URL line may not be flushed to disk when the grep runs, or the log file may contain multiple URLs from restarts. ngrok's local API (`localhost:4040/api/tunnels`) is more reliable and should be the preferred extraction method for any tunnel that offers a programmatic API.

---

## 8. Appendix: File Reference with Line Numbers

| File | Lines | Purpose |
|------|-------|---------|
| `v3/docker/entrypoint.sh` | 114-142 | ngrok tunnel setup with 30s polling loop |
| `v3/docker/entrypoint.sh` | 144-168 | Cloudflare tunnel setup with 60s polling loop, `--protocol http2` |
| `v3/docker/entrypoint.sh` | 172-181 | Tunnel URL reporting to callback |
| `v3/docker/entrypoint.sh` | 184 | `wait $SERVER_PID` -- container stays alive while server runs |
| `v3/docker/Dockerfile` | 33-34 | cloudflared binary installation |
| `v3/docker/Dockerfile` | 39-40 | ngrok binary installation |
| `v3/docker/Dockerfile` | 65 | `EXPOSE 8765` |
| `v3/server/race_server.py` | 40 | `IDLE_TIMEOUT_SECONDS = 10 * 60` |
| `v3/server/race_server.py` | 43-180 | `AutoShutdownManager` class -- tracks clients, idle countdown, instance destruction |
| `v3/server/race_server.py` | 71-81 | `client_connected` -- cancels idle timer |
| `v3/server/race_server.py` | 83-91 | `client_disconnected` -- starts idle timer if no clients |
| `v3/server/race_server.py` | 93-103 | `_idle_countdown` -- sleeps in 60s intervals, logs remaining time |
| `v3/server/race_server.py` | 112-180 | `_destroy_instance` -- sends shutdown warning, calls Vast.ai API, exits process |
| `v3/server/race_server.py` | 385-560 | `handle_client` -- WebSocket message loop, registers/unregisters from shutdown manager |
| `v3/server/race_server.py` | 875-969 | `_reset_race` -- cancels race loop but preserves CARLA actors for reconnect |
| `v3/server/race_server.py` | 2157-2227 | `main()` -- starts WebSocket server, health check endpoint, initial idle timer |
| `v3/server/race_server.py` | 2201-2204 | `websockets.serve()` -- listens on 0.0.0.0:8765, no SO_REUSEADDR |
| `v3/server/race_server.py` | 2207-2211 | **Auto-shutdown timer starts immediately at boot** |
| `v3/server/race_server.py` | 2220-2221 | SIGTERM/SIGINT handlers for graceful shutdown |
| `v3/src/hooks/useGPUConnection.ts` | 27-64 | WebSocket URL caching in localStorage (30-min TTL) |
| `v3/src/hooks/useGPUConnection.ts` | 394-654 | `connectWebSocket` -- URL conversion, WebSocket setup, retry logic |
| `v3/src/hooks/useGPUConnection.ts` | 401 | `tunnelUrl.replace('https://', 'wss://')` -- protocol conversion |
| `v3/src/hooks/useGPUConnection.ts` | 627-643 | WebSocket close handler with 3 retries on code 1006 |
| `v3/src/hooks/useGPUConnection.ts` | 658-708 | `pollGPUStatus` -- polls `/api/gpu/status` every 5s |
| `v3/src/hooks/useGPUConnection.ts` | 901-904 | `connectDirect` -- skips provisioning, connects directly to WS URL |
| `v3/src/pages/Race.tsx` | 34 | `DEMO_WS_URL = 'ws://localhost:8765'` |
| `v3/src/pages/Race.tsx` | 39 | `directWsUrl = params.get('ws') \|\| getLastWsUrl()` |
| `v3/src/pages/Race.tsx` | 1133-1136 | Demo/direct mode connects via `gpu.connectDirect(wsUrl)` |
| `v3/api/gpu/start.ts` | 32-85 | `ONSTART_SCRIPT` -- patches entrypoint, launches it in background |
| `v3/api/gpu/start.ts` | 158 | `ports: '8765/tcp'` -- requests port exposure on Vast.ai |
| `v3/api/gpu/start.ts` | 159-163 | Environment variable passthrough (`CALLBACK_URL`, `NGROK_AUTHTOKEN`) |
| `v3/api/gpu/callback.ts` | 86-91 | Stores tunnel URL in Vercel KV with 1-hour TTL |
| `v3/api/gpu/status.ts` | 70-73 | Retrieves tunnel URL from KV (tries multiple key formats) |
| `v3/deploy.sh` | 23 | `pkill -9 -f race_server` -- SIGKILL, no graceful cleanup |
| `v3/deploy.sh` | 52-74 | ngrok tunnel with 15s polling loop |
| `v3/deploy.sh` | 76-82 | Cloudflare tunnel with `sleep 5` (too short) |
| `v3/deploy.sh` | 79 | Cloudflare tunnel **missing `--protocol http2`** |
| `v3/TUNNEL_RESEARCH.md` | Full file | Comparison of 7 tunnel solutions |
| `v3/LEARNINGS.md` | 283-293 | Cloudflare latency measurements, mixed content blocking |
