# CARLA Shadow Driver

A self-driving car learning project using CARLA simulator and NVIDIA's PilotNet model.

**Goal:** Understand how autonomous driving works through shadow mode - where an AI watches and suggests, but doesn't control.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        YOUR MAC (Local)                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  CARLA Client   │  │   PilotNet      │  │  Shadow Mode UI     │  │
│  │  (sensors.py)   │──│   (model.py)    │──│  (visualizer.py)    │  │
│  └────────┬────────┘  └─────────────────┘  └─────────────────────┘  │
│           │                                                          │
└───────────┼──────────────────────────────────────────────────────────┘
            │ TCP/IP (port 2000)
            │
┌───────────┼──────────────────────────────────────────────────────────┐
│           ▼              VAST.AI CLOUD (Remote GPU)                  │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    CARLA Server (Docker)                         │ │
│  │   • Physics simulation    • Weather/lighting                     │ │
│  │   • Vehicle dynamics      • Sensor rendering                     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Phase 1: Set up Vast.ai + CARLA Server

1. **Create Vast.ai account:** https://cloud.vast.ai/
2. **Add credits:** Start with $5-10 (that's 20-40 hours of usage)
3. **Rent a GPU instance:**
   - Search for: T4 or RTX 3080+
   - Min 16GB GPU VRAM, 32GB RAM
   - Select Ubuntu with Docker
   - Use the template in `scripts/vastai-template.json`
4. **SSH into your instance and run CARLA:**
   ```bash
   # On the Vast.ai instance
   docker run --gpus all --net=host -d \
     carlasim/carla:0.9.16 \
     bash CarlaUE4.sh -RenderOffScreen -nosound
   ```

### Phase 2: Connect from your Mac

1. **Set up SSH tunnel:**
   ```bash
   # Replace with your Vast.ai instance IP
   ssh -L 2000:localhost:2000 -L 2001:localhost:2001 root@<VAST_IP> -p <PORT>
   ```

2. **Install local dependencies:**
   ```bash
   cd carla-shadow-driver
   pip install -r requirements.txt
   ```

3. **Test connection:**
   ```bash
   python src/test_connection.py
   ```

### Phase 3: Drive manually and see AI suggestions

```bash
python src/shadow_mode.py
```

## Project Structure

```
carla-shadow-driver/
├── README.md
├── requirements.txt
├── configs/
│   └── default.yaml          # Configuration settings
├── scripts/
│   ├── setup_vastai.sh       # Vast.ai setup script
│   └── vastai-template.json  # Vast.ai instance template
├── src/
│   ├── carla_client.py       # CARLA connection and control
│   ├── sensors.py            # Camera and telemetry capture
│   ├── recorder.py           # Data recording to disk
│   ├── model.py              # PilotNet inference
│   ├── visualizer.py         # Shadow mode overlay UI
│   ├── shadow_mode.py        # Main application
│   └── test_connection.py    # Connection tester
├── models/
│   └── pilotnet.pt           # Trained model weights
└── data/
    └── recordings/           # Saved driving sessions
```

## Phases

- [x] Phase 0: Environment research
- [ ] Phase 1: CARLA running on cloud
- [ ] Phase 2: Camera streaming working
- [ ] Phase 3: Data recording pipeline
- [ ] Phase 4: PilotNet inference (offline)
- [ ] Phase 5: Shadow mode (live AI suggestions)
- [ ] Phase 6: Optional limited AI control

## Cost Estimate

| Activity | Time | Cost (Vast.ai T4) |
|----------|------|-------------------|
| Initial setup & testing | 2 hours | ~$0.50 |
| Manual driving + recording | 4 hours | ~$1.00 |
| Shadow mode experiments | 10 hours | ~$2.50 |
| **Total for full project** | ~16 hours | **~$4.00** |

## Resources

- [CARLA Documentation](https://carla.readthedocs.io/)
- [CARLA Python API](https://carla.readthedocs.io/en/latest/python_api/)
- [NVIDIA PilotNet Paper](https://arxiv.org/abs/1704.07911)
- [Vast.ai Docs](https://docs.vast.ai/)
