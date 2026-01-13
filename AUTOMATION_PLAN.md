# Full Automation Plan: Play/Stop GPU Buttons

## Current Status: 90% Complete

### What's Done ✅
- [x] Vast.ai API key configured in Vercel
- [x] All 4 API routes created and deployed
- [x] Browser UI with Play/Stop buttons
- [x] Status polling and display
- [x] GPU provisioning with retry logic (tries up to 5 offers)
- [x] Instance destruction working
- [x] Startup script clones repo, installs deps, downloads model

### What's Remaining ⏳
- [ ] **Add NGROK_AUTHTOKEN to Vercel** (required - ngrok now requires auth)
- [ ] Deploy final version after adding authtoken
- [ ] Test end-to-end flow

---

## Quick Resume Guide

### Step 1: Add ngrok authtoken to Vercel

1. Get free authtoken: https://dashboard.ngrok.com/get-started/your-authtoken
2. Add to Vercel: https://vercel.com/rishi09-3609s-projects/carla-shadow-driver/settings/environment-variables
   - Key: `NGROK_AUTHTOKEN`
   - Value: (your authtoken)
3. Deploy:
   ```bash
   cd vercel-deploy
   npx vercel deploy --prod --yes
   ```

### Step 2: Test

1. Go to https://carla-shadow-driver.vercel.app
2. Click "Connect Real AI (GPU)"
3. Click "▶ Start Real AI"
4. Wait 2-3 min for startup
5. Should auto-connect when ngrok URL is ready
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
│     - git clone carla-shadow-driver                          ││
│     - pip install requirements                               ││
│     - python download_model.py pilotnet                      ││
│     - ngrok config add-authtoken                             ││
│     - Start ngrok tunnel → report URL to /api/gpu/callback   ││
│     - Start shadow_mode.py --websocket                       │◀┘
│  3. Browser auto-connects via ngrok URL                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Created/Modified

| File | Status | Description |
|------|--------|-------------|
| `vercel-deploy/api/gpu/start.js` | ✅ Created | Provision GPU with retry logic |
| `vercel-deploy/api/gpu/stop.js` | ✅ Created | Destroy GPU instance |
| `vercel-deploy/api/gpu/status.js` | ✅ Created | Check instance status |
| `vercel-deploy/api/gpu/callback.js` | ✅ Created | Receive ngrok URL from GPU |
| `vercel-deploy/index.html` | ✅ Modified | Added Play/Stop buttons + auto-provision UI |
| `vercel-deploy/vercel.json` | ✅ Modified | Simplified config |

---

## Environment Variables Required

| Variable | Status | Description |
|----------|--------|-------------|
| `VASTAI_API_KEY` | ✅ Added | Vast.ai API key (Instances: Read & Write) |
| `NGROK_AUTHTOKEN` | ❌ **TODO** | ngrok authtoken (free at ngrok.com) |

---

## Tested Functionality

| Feature | Status | Notes |
|---------|--------|-------|
| GPU Search | ✅ Working | Finds 16GB+ GPUs under $1/hr |
| GPU Provisioning | ✅ Working | Retries up to 5 offers if first fails |
| GPU Destruction | ✅ Working | Destroys instance on stop |
| Status Polling | ✅ Working | Shows running state, GPU name, SSH info |
| Callback Endpoint | ✅ Working | Stores/retrieves ngrok URLs |
| OpenCV deps | ✅ Fixed | Added libgl1-mesa-glx install |
| ngrok auth | ⏳ Pending | Needs NGROK_AUTHTOKEN env var |

---

## Known Issues & Fixes Applied

### Issue 1: GPU offers expire quickly
**Fix**: Added retry logic - tries up to 5 different GPU offers

### Issue 2: OpenCV missing libGL
**Fix**: Added `apt-get install libgl1-mesa-glx libglib2.0-0` to startup script

### Issue 3: ngrok requires authentication
**Fix**: Added NGROK_AUTHTOKEN requirement + `ngrok config add-authtoken` in startup

### Issue 4: Wrong Vercel project
**Fix**: Logged into correct account (rishi09-3609) and linked project

---

## Cost Summary

- **Vast.ai GPU**: ~$0.08-0.12/hr (RTX 4070S/4080S)
- **ngrok**: Free tier (1 tunnel)
- **Vercel**: Free tier

---

## Next Steps After Adding NGROK_AUTHTOKEN

1. Deploy: `npx vercel deploy --prod --yes`
2. Test full flow in browser
3. Verify ngrok URL gets reported back
4. Verify auto-connect works
5. Consider adding:
   - Auto-destroy after 1 hour (cost protection)
   - Rate limiting on /api/gpu/start
   - Vercel KV for persistent ngrok URL storage
