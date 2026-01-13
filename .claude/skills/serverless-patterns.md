# Serverless Architecture Patterns

**Purpose:** Prevent bugs caused by serverless behavior like cold starts, instance isolation, and statelessness. This skill documents patterns learned from the GPU callback persistence bug.

---

## When to Use This Skill

Use this skill when:
- Building or modifying serverless functions (Vercel, AWS Lambda, Cloudflare Workers)
- Storing state that needs to persist across function invocations
- Building multi-step async flows (e.g., start → callback → poll)
- Debugging "it works locally but not in production" issues
- Using `global` or module-level variables in serverless code

---

## The Problem This Solves

**Shadow Driver GPU Bug (January 2025):**

```javascript
// This code FAILED in production
if (!global.tunnelUrls) {
  global.tunnelUrls = {};
}

// POST /callback - GPU reports tunnel URL
global.tunnelUrls[instance_id] = tunnel_url;

// GET /status - Browser polls for tunnel URL
return global.tunnelUrls[instance_id];  // Returns undefined!
```

**Why it failed:**
1. GPU calls `/callback` → Function instance A stores URL in memory
2. Function instance A goes idle, Vercel cold-starts it
3. Browser polls `/status` → Function instance A (or new instance B) starts fresh
4. `global.tunnelUrls` is empty → Browser never gets the URL
5. User sees "Starting server..." forever

---

## Core Concepts

### 1. Cold Starts

**What:** Serverless functions are spun down after ~15-60 seconds of inactivity. The next request starts a fresh instance with no memory of previous state.

**Implications:**
- In-memory state (`global`, module variables) is lost
- Connections (DB, WebSocket) are closed
- Any setup code runs again

### 2. Instance Isolation

**What:** Multiple function instances can run simultaneously. They don't share memory.

**Implications:**
- `global.x` in instance A is invisible to instance B
- Even without cold starts, concurrent requests may hit different instances
- You cannot rely on in-memory state for cross-request communication

### 3. Statelessness

**Principle:** Treat every function invocation as if it's the first and last. Store state externally.

---

## Patterns

### Pattern 1: Use External State Store

**Problem:** Need state to persist across function invocations.

**Solution:** Use Vercel KV, Redis, or a database.

```javascript
// ✅ CORRECT: Use Vercel KV
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Store data with TTL
  await kv.set(`session:${id}`, data, { ex: 3600 });  // 1 hour TTL

  // Retrieve data
  const data = await kv.get(`session:${id}`);
}
```

```javascript
// ❌ WRONG: In-memory state
if (!global.sessions) {
  global.sessions = {};
}
global.sessions[id] = data;  // Lost on cold start!
```

### Pattern 2: Graceful Fallback

**Problem:** KV may not be configured, or may fail.

**Solution:** Fall back to in-memory, but log a warning.

```javascript
const useKV = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

async function getData(key) {
  if (useKV) {
    try {
      return await kv.get(key);
    } catch (e) {
      console.error('KV error, falling back to memory:', e);
      return global.fallback[key];
    }
  }
  console.warn('KV not configured, using in-memory (WILL LOSE DATA ON COLD START)');
  return global.fallback[key];
}
```

### Pattern 3: TTL for Ephemeral Data

**Problem:** Data should expire after a certain time.

**Solution:** Use TTL (Time To Live) when storing.

```javascript
// Expires after 1 hour
await kv.set(`gpu:${instanceId}`, data, { ex: 3600 });

// Expires after 5 minutes (short-lived callback)
await kv.set(`callback:${token}`, data, { ex: 300 });
```

### Pattern 4: Idempotent Operations

**Problem:** Function may be invoked multiple times for the same request (retries, timeouts).

**Solution:** Make operations idempotent - safe to repeat.

```javascript
// ✅ CORRECT: Idempotent - same result if called twice
await kv.set(`order:${orderId}`, { status: 'completed' });

// ❌ WRONG: Not idempotent - charges customer twice
await chargeCustomer(customerId, amount);
```

### Pattern 5: Request-Scoped State Only

**Problem:** Need to share data within a single request.

**Solution:** Pass data through function parameters, not globals.

```javascript
// ✅ CORRECT: Pass data through
async function handleRequest(req) {
  const user = await getUser(req.userId);
  await processOrder(user, req.order);  // Pass user explicitly
}

// ❌ WRONG: Global state within request
let currentUser;
async function handleRequest(req) {
  currentUser = await getUser(req.userId);  // Race condition with concurrent requests!
  await processOrder(req.order);  // Uses global currentUser
}
```

---

## Anti-Patterns

### Anti-Pattern 1: Trusting In-Memory State

```javascript
// ❌ This WILL break in production
const cache = {};

export function handler(req, res) {
  if (cache[key]) {
    return res.json(cache[key]);  // Empty after cold start
  }
  cache[key] = expensiveComputation();
  return res.json(cache[key]);
}
```

**Why it's bad:** Cache is empty after cold start. In local dev, the server stays running so this works. In production, it fails randomly.

### Anti-Pattern 2: WebSocket in Serverless

```javascript
// ❌ WebSockets don't work in serverless functions
const wss = new WebSocket.Server({ port: 8080 });

export function handler(req, res) {
  // This can't work - function dies after response
}
```

**Why it's bad:** Serverless functions live only for the duration of a single request. WebSockets require persistent connections.

**Instead:** Use a separate WebSocket server (e.g., on Render, Railway, or EC2) or use Vercel's Edge middleware with Streams.

### Anti-Pattern 3: Long-Running Operations

```javascript
// ❌ May timeout (Vercel has 10s limit on hobby, 60s on pro)
export async function handler(req, res) {
  const result = await verySlowOperation();  // 5 minutes
  return res.json(result);
}
```

**Instead:** Return immediately, process async, callback when done.

```javascript
// ✅ Start async, callback when done
export async function handler(req, res) {
  const jobId = await queueJob(req.body);
  return res.json({ jobId, status: 'processing' });
}

// Separate worker (not serverless) processes jobs and calls webhook
```

---

## Debugging Serverless Issues

### Symptom: "Works locally, fails in production"

**Check:**
1. Are you using `global` or module-level variables?
2. Are you relying on data from a previous request?
3. Is there a race condition with concurrent requests?

### Symptom: "Works sometimes, fails randomly"

**Check:**
1. Cold start timing - does it fail after periods of inactivity?
2. Instance isolation - are concurrent requests hitting different instances?
3. TTL expiration - did the data expire?

### Symptom: "Data disappears"

**Check:**
1. Is KV/Redis actually configured? Check env vars.
2. Is there a TTL that expired?
3. Was the key spelled correctly (typos in dynamic keys)?

---

## Vercel KV Setup

### Step 1: Create KV Store

1. Go to https://vercel.com/dashboard
2. Select your project
3. Go to **Storage** tab
4. Click **Create Database** → **KV**
5. Choose a name (e.g., `gpu-tunnel-store`)
6. Click **Create**

### Step 2: Connect to Project

1. In the KV store page, click **Connect Project**
2. Select your project
3. Choose environment (Production, Preview, Development)
4. Click **Connect**

### Step 3: Verify Environment Variables

Vercel automatically adds:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_URL` (optional)

### Step 4: Deploy

Redeploy your project for the env vars to take effect.

### Step 5: Verify

```bash
curl https://your-app.vercel.app/api/your-endpoint
# Response should include: "using_kv": true
```

---

## Quick Reference: When to Use What

| State Type | Storage | Example |
|------------|---------|---------|
| Session data | Vercel KV (TTL 1hr) | User auth tokens |
| Cache | Vercel KV (TTL varies) | API responses |
| Permanent data | Database (Postgres, Mongo) | User profiles |
| Request-scoped | Function parameters | Current request data |
| Never store in serverless | - | WebSocket connections |

---

## Integration with Other Skills

| Skill | Integration |
|-------|-------------|
| `deployment-contract-validator.md` | Add serverless state check to pre-deploy |
| `failure-mode-checklist.md` | Include "cold start" as failure mode |
| `e2e-browser-testing.md` | Test multi-request flows that span cold starts |

---

## Lesson Learned

**The GPU callback bug taught us:**

> In serverless, assume your function has amnesia. Every invocation starts with a blank slate. If you need to remember something, write it down externally.

This skill exists because we shipped code that worked locally but failed in production due to cold starts. The fix took 30 minutes. The debugging took 2+ hours. Reading this skill takes 5 minutes.
