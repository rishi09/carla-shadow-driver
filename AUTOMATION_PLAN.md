> **ARCHIVED** — This file describes v1 of Shadow Driver. The active project is v3. See `.claude/CLAUDE.md` for current docs and `v3/docs/ROADMAP_VISUAL_QUALITY.md` for the roadmap.

---

# Full Automation Plan: Play/Stop GPU Buttons

## Current Status: 95% Complete

### What's Done ✅
- [x] Vast.ai API key configured in Vercel
- [x] All 4 API routes created and deployed
- [x] Browser UI with Play/Stop buttons
- [x] Status polling and display
- [x] GPU provisioning with retry logic (tries up to 5 offers)
- [x] Instance destruction working
- [x] Startup script clones repo, installs deps, downloads model
- [x] **Switched from ngrok to Cloudflare Tunnel** (no auth required, enterprise-friendly)

### What's Remaining ⏳
- [ ] Deploy final version
- [ ] Test end-to-end flow

---

## Quick Resume Guide

### Step 1: Deploy
```bash
cd vercel-deploy
npx vercel deploy --prod --yes
```

### Step 2: Test

1. Go to https://carla-shadow-driver.vercel.app
2. Click "Connect Real AI (GPU)"
3. Click "▶ Start Real AI"
4. Wait 2-3 min for startup
5. Should auto-connect when Cloudflare tunnel URL is ready
6. Click "Stop GPU" when done

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BROWSER (Vercel)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ Play Button │  │ Stop Button │  │ Status      │  │ WebSocket       │ │
│  │ (start GPU) │  │ (destroy)   │  │ (polling)   │  │ (to GPU)        │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
└─────────┼────────────────┼────────────────┼──────────────────┼──────────┘
          │                │                │                  │
          ▼                ▼                ▼                  │
┌─────────────────────────────────────────────────────────────┐│
│                    VERCEL API ROUTES                         ││
│  /api/gpu/start    /api/gpu/stop    /api/gpu/status          ││
│  /api/gpu/callback                                           ││
└─────────────────────────────────────────────────────────────┘│
          │                │                │                  │
          ▼                ▼                ▼                  │
┌─────────────────────────────────────────────────────────────┐│
│                      VAST.AI API                             ││
│  PUT /asks/:id (create)   DELETE /instances/:id (destroy)    ││
│  GET /instances (list all)                                   ││
└─────────────────────────────────────────────────────────────┘│
          │                                                    │
          ▼                                                    │
┌─────────────────────────────────────────────────────────────┐│
│                    GPU INSTANCE                              ││
│  1. Boot with PyTorch template                               ││
│  2. Run startup script (onstart):                            ││
│     - apt-get install libgl1-mesa-glx (for OpenCV)          ││
│     - curl cloudflared binary                                ││
│     - git clone carla-shadow-driver                          ││
│     - pip install requirements                               ││
│     - python download_model.py pilotnet                      ││
│     - Start WebSocket server in background                   ││
│     - Start Cloudflare Tunnel → report URL to callback       │◀┘
│  3. Browser auto-connects via wss://xxx.trycloudflare.com    │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Created/Modified

| File | Status | Description |
|------|--------|-------------|
| `vercel-deploy/api/gpu/start.js` | ✅ Created | Provision GPU with retry logic, cloudflared startup |
| `vercel-deploy/api/gpu/stop.js` | ✅ Created | Destroy GPU instance |
| `vercel-deploy/api/gpu/status.js` | ✅ Created | Check instance status + tunnel URL |
| `vercel-deploy/api/gpu/callback.js` | ✅ Created | Receive tunnel URL from GPU |
| `vercel-deploy/index.html` | ✅ Modified | Added Play/Stop buttons + auto-provision UI |
| `vercel-deploy/vercel.json` | ✅ Modified | Simplified config |

---

## Environment Variables Required

| Variable | Status | Description |
|----------|--------|-------------|
| `VASTAI_API_KEY` | ✅ Added | Vast.ai API key (Instances: Read & Write) |

**Note:** No additional auth tokens needed! Cloudflare Quick Tunnels require no account.

---

## Tested Functionality

| Feature | Status | Notes |
|---------|--------|-------|
| GPU Search | ✅ Working | Finds 16GB+ GPUs under $1/hr |
| GPU Provisioning | ✅ Working | Retries up to 5 offers if first fails |
| GPU Destruction | ✅ Working | Destroys instance on stop |
| Status Polling | ✅ Working | Shows running state, GPU name, SSH info |
| Callback Endpoint | ✅ Working | Stores/retrieves tunnel URLs |
| OpenCV deps | ✅ Fixed | Added libgl1-mesa-glx install |
| Tunnel (Cloudflare) | ⏳ Pending test | No auth required, enterprise-friendly |

---

## Known Issues & Fixes Applied

### Issue 1: GPU offers expire quickly
**Fix**: Added retry logic - tries up to 5 different GPU offers

### Issue 2: OpenCV missing libGL
**Fix**: Added `apt-get install libgl1-mesa-glx libglib2.0-0` to startup script

### Issue 3: ngrok requires authentication & blocked by IT
**Fix**: Switched to Cloudflare Tunnel (cloudflared) - no account or auth required!

### Issue 4: Wrong Vercel project
**Fix**: Logged into correct account (rishi09-3609) and linked project

### Issue 5: NumPy 2.x incompatibility with PyTorch
**Fix**: Added `pip install 'numpy<2'` before requirements.txt installation

### Issue 6: Instance ID mismatch in callbacks
**Fix**: Pass INSTANCE_ID as env var to container, enhanced callback to track status

---

## Debugging

### Check all callback entries (no SSH needed)
```bash
curl -s "https://carla-shadow-driver.vercel.app/api/gpu/callback" | jq .
```

### Check specific instance status
```bash
curl -s "https://carla-shadow-driver.vercel.app/api/gpu/status?instance_id=YOUR_ID" | jq .
```

### SSH into instance (if needed)
```bash
ssh -p PORT root@ssh5.vast.ai
cat /var/log/onstart.log
```

---

## Cost Summary

- **Vast.ai GPU**: ~$0.08-0.12/hr (RTX 4070S/4080S)
- **Cloudflare Tunnel**: Free (Quick Tunnels)
- **Vercel**: Free tier

---

## Why Cloudflare Tunnel Instead of ngrok

| Feature | ngrok | Cloudflare Tunnel |
|---------|-------|-------------------|
| Auth required | Yes (since 2023) | No (Quick Tunnels) |
| IT/Admin approval | Often blocked | Usually allowed |
| WebSocket support | Yes | Yes |
| HTTPS/WSS | Yes | Yes |
| Speed | Fast | Fast |
| Cost | Free tier | Free |

---

## Next Steps

1. Deploy: `npx vercel deploy --prod --yes`
2. Test full flow in browser
3. Verify Cloudflare tunnel URL gets reported back
4. Verify auto-connect works
5. Consider adding:
   - Auto-destroy after 1 hour (cost protection)
   - Rate limiting on /api/gpu/start
   - Vercel KV for persistent tunnel URL storage
