# Shadow Driver - Project Instructions

## Project Overview

Shadow Driver is a 2D racing game with GPU-powered "realistic mode" that streams from CARLA simulator. The frontend is deployed on Vercel, with a separate API project for GPU provisioning.

**Key URLs:**
- Game: https://v2-sigma-lemon.vercel.app
- API: https://carla-shadow-driver.vercel.app

---

## MANDATORY: Pre-Deploy Checklist

**Before declaring ANY work complete, you MUST run through this checklist.**

This exists because multiple bugs shipped that could have been caught with basic verification:
1. API URL bug: Frontend called relative URL, resolved to wrong domain
2. Cold start bug: GPU callback data lost on Vercel function restart

### Quick Verification (5 minutes)

```markdown
## Pre-Deploy Verification

### 1. API Smoke Test (MANDATORY)
For each API endpoint the frontend calls:
- [ ] curl the endpoint from the DEPLOYED domain
- [ ] Verify response is JSON (starts with { or [), not HTML
- [ ] If HTML returned, the URL is WRONG

### 2. Serverless State Check
- [ ] Is any state stored in-memory (global, module vars)?
- [ ] If yes, will it survive cold starts? (Use KV/Redis instead)
- [ ] Check: Does response include "using_kv: true"?

### 3. Async Flow Check
For multi-step operations (start → callback → poll):
- [ ] Test each step with curl independently
- [ ] Wait 2 min between steps to simulate cold start
- [ ] Verify data persists across the delay

### 4. Failure Mode Questions
- [ ] What if the network fails?
- [ ] What if the server restarts?
- [ ] What if data is missing?
- [ ] What if URLs are wrong?

### 5. User Flow Test
- [ ] Click through the main user flow in browser
- [ ] Check browser console for errors
- [ ] Check Network tab for failed requests
```

---

## Skills Reference

Use these skills during development:

| Skill | Use When |
|-------|----------|
| `failure-mode-checklist.md` | Before any deployment - ask "what if?" |
| `serverless-patterns.md` | Working with Vercel functions, state storage |
| `deployment-contract-validator.md` | Cross-project API integration |
| `e2e-browser-testing.md` | Testing complete user flows |
| `multi-agent-orchestration.md` | Managing parallel agent work |
| `retrospective-agent.md` | After bugs are discovered |

---

## Architecture

### Deployment Topology

```
v2-sigma-lemon.vercel.app (Frontend)
    │
    │ API calls (MUST use absolute URLs)
    ▼
carla-shadow-driver.vercel.app (API)
    │
    ├─ /api/gpu/start  → Provisions GPU on Vast.ai
    ├─ /api/gpu/status → Checks GPU status + tunnel URL
    ├─ /api/gpu/callback → Receives tunnel URL from GPU
    └─ /api/gpu/stop   → Destroys GPU instance
    │
    ▼
Vercel KV (Required for callback data persistence)
    │
    ▼
Vast.ai GPU → Cloudflare Tunnel → WebSocket to browser
```

### Environment Variables (carla-shadow-driver project)

```
VASTAI_API_KEY     - Vast.ai API key for GPU provisioning
KV_REST_API_URL    - Vercel KV endpoint (auto-set when KV connected)
KV_REST_API_TOKEN  - Vercel KV auth token (auto-set when KV connected)
```

---

## Known Issues & Fixes

### Issue: "Starting server..." spins forever
**Cause:** Vercel KV not configured, callback data lost on cold start
**Fix:** Set up Vercel KV for the carla-shadow-driver project

### Issue: "Unexpected token '<'" JSON parse error
**Cause:** API URL resolving to wrong domain, returning HTML 404
**Fix:** Use absolute URLs in useGPUConnection.ts

---

## Testing Commands

```bash
# Check if API returns JSON (not HTML)
curl -s https://carla-shadow-driver.vercel.app/api/gpu/callback | head -1
# Good: {"entries":0,"data":{},...}
# Bad: <!DOCTYPE html> or The page...

# Check if KV is enabled
curl -s https://carla-shadow-driver.vercel.app/api/gpu/callback | grep using_kv
# Should show: "using_kv":true

# Test callback persistence (simulates GPU callback)
curl -X POST https://carla-shadow-driver.vercel.app/api/gpu/callback \
  -H "Content-Type: application/json" \
  -d '{"instance_id":"test123","status":"testing"}'

# Wait 2 min, then verify data persisted
sleep 120
curl "https://carla-shadow-driver.vercel.app/api/gpu/callback?instance_id=test123"
# Should show the test data if KV is working
```

---

## Commit Guidelines

- Run pre-deploy checklist before pushing
- Include "Tested:" section in commit messages for API changes
- Reference skills used in complex changes

---

## When Things Go Wrong

1. **Use retrospective-agent.md** - Document what happened
2. **Update relevant skills** - Prevent recurrence
3. **Update this CLAUDE.md** - Add to Known Issues
4. **Create new skill if needed** - Capture the learning
