> **ARCHIVED** — This file describes v1 of Shadow Driver. The active project is v3. See `.claude/CLAUDE.md` for current docs and `v3/docs/ROADMAP_VISUAL_QUALITY.md` for the roadmap.

---

# CARLA Shadow Driver - Resume Guide

**Last Session:** January 7, 2026
**Status:** All features working, GPU connection tested successfully

---

## What's Done

- ✅ **Live demo** at https://carla-shadow-driver.vercel.app
- ✅ **3 Game modes**: Simulator, Shadow, AI Only
- ✅ **5 AI behaviors**: PilotNet, Alpamayo, Aggressive, Cautious, Drunk
- ✅ **Weather system**: Clear, Rain, Fog, Night
- ✅ **GPU connection**: WebSocket + SSH tunnel working
- ✅ **NVIDIA Alpamayo**: Model class ready (needs 24GB+ VRAM)
- ✅ **Documentation**: All guides updated

---

## Quick Reference

### Run Demo Locally
```bash
cd ~/side-projects/carla-shadow-driver
open demo_visual_car.html
```

### Connect to Real GPU AI
See [`VASTAI_QUICK_START.md`](VASTAI_QUICK_START.md) for full guide.

**Quick version:**
1. Rent RTX 5090 on Vast.ai (PyTorch template)
2. SSH in and run:
   ```bash
   git clone https://github.com/rishi09/carla-shadow-driver.git
   cd carla-shadow-driver
   pip install -r requirements.txt
   python scripts/download_model.py pilotnet
   python src/shadow_mode.py --websocket --port 5001
   ```
3. On Mac, create SSH tunnel:
   ```bash
   ssh -L 9999:localhost:5001 -p <SSH_PORT> root@<IP>
   ```
4. Open `demo_visual_car.html`, connect to `localhost:9999`

---

## Next Task: Full Automation

Open [`AUTOMATION_PLAN.md`](AUTOMATION_PLAN.md) to implement:
- Play/Stop buttons on Vercel site
- Automatic GPU provisioning via Vast.ai API
- No more manual SSH tunnel

**To start:** Say "Let's implement the GPU automation plan"

---

## File Structure

```
carla-shadow-driver/
├── demo_visual_car.html      # Main browser demo
├── vercel-deploy/            # Deployed to Vercel
├── src/
│   ├── shadow_mode.py        # WebSocket server + CARLA mode
│   └── model_manager.py      # AI models (PilotNet, Alpamayo)
├── scripts/
│   └── download_model.py     # Download models from HuggingFace
├── README.md                 # Project overview
├── VASTAI_QUICK_START.md     # GPU setup guide
├── AUTOMATION_PLAN.md        # Next feature plan
└── RESUME_HERE.md            # This file
```

---

## Costs

| Item | Status |
|------|--------|
| Vast.ai credits | ~$4.50 remaining |
| Vercel hosting | FREE |
| GitHub | FREE |

---

## GitHub Repo

https://github.com/rishi09/carla-shadow-driver
