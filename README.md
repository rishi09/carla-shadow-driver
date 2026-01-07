# CARLA Shadow Driver

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://carla-shadow-driver.vercel.app)
[![GitHub](https://img.shields.io/github/stars/rishi09/carla-shadow-driver?style=social)](https://github.com/rishi09/carla-shadow-driver)

**An interactive autonomous driving simulator with shadow mode** - compare your driving to AI in real-time.

## Live Demo

**[Try it now](https://carla-shadow-driver.vercel.app)** - No installation required!

## Features

### Game Modes
- **Simulator Only** - Pure driving, no AI
- **Shadow Mode** - Drive while AI suggests (industry standard for AV validation)
- **AI Only** - Watch different AI models drive autonomously

### AI Models
- **PilotNet (NVIDIA)** - End-to-end CNN, smooth steering
- **Alpamayo Style** - VLA model with trajectory planning
- **Aggressive Driver** - Tight corners, late braking
- **Cautious Driver** - Wide margins, early reactions
- **Drunk Driver** - Unpredictable, wobbly (for fun!)

### Weather & Environment
- Clear, Rain, Fog, Night conditions
- Dynamic obstacles (other cars)
- Curved roads with realistic physics

## How It Works

Shadow mode is how real autonomous vehicle companies (Tesla, Waymo, Cruise) validate their AI:

1. **You drive** (green car)
2. **AI watches and predicts** what it would do (blue ghost car)
3. **System compares** - When do you and AI disagree?

This divergence data is invaluable for finding edge cases and improving AI models.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  User Input     │  │   AI Models     │  │  Canvas Renderer    │  │
│  │  (keyboard)     │──│   (JavaScript)  │──│  (60 FPS)           │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              ▼ Optional: Real AI Mode
┌─────────────────────────────────────────────────────────────────────┐
│                        VAST.AI Cloud (GPU)                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  CARLA Simulator  +  NVIDIA Alpamayo-R1-10B (10B params)        ││
│  │  Real 3D graphics    Real neural network inference              ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

## Run Locally

```bash
# Clone the repo
git clone https://github.com/rishi09/carla-shadow-driver.git
cd carla-shadow-driver

# Start local server
python3 -m http.server 8080

# Open http://localhost:8080/demo_visual_car.html
```

## Real AI Mode (Optional)

To run the actual NVIDIA Alpamayo model (10B parameters):

1. **Rent GPU on Vast.ai** (~$0.40/hr for RTX 4090 with 24GB VRAM)
2. **Install CARLA and model**
3. **Connect via WebSocket**

See `VASTAI_SETUP.md` for detailed instructions.

## Project Structure

```
carla-shadow-driver/
├── demo_visual_car.html      # Main interactive demo
├── vercel-deploy/            # Deployment files
├── src/
│   ├── shadow_mode.py        # CARLA integration
│   ├── model_manager.py      # AI model registry
│   └── ...
├── models/                   # Pre-trained weights
└── configs/                  # Configuration
```

## Technologies

- **Frontend**: Pure HTML/CSS/JavaScript, Canvas API
- **AI Models**: NVIDIA PilotNet, Alpamayo-R1-10B
- **Simulator**: CARLA 0.9.16
- **Deployment**: Vercel
- **GPU Cloud**: Vast.ai

## Cost Estimates

| Activity | Cost |
|----------|------|
| Browser demo | FREE |
| Vast.ai (PilotNet) | ~$0.10/hr |
| Vast.ai (Alpamayo) | ~$0.40/hr |

## Learning Resources

- [NVIDIA PilotNet Paper](https://arxiv.org/abs/1604.07316)
- [NVIDIA Alpamayo](https://huggingface.co/nvidia/Alpamayo-R1-10B)
- [CARLA Documentation](https://carla.readthedocs.io/)
- [Shadow Mode Explained](https://www.tesla.com/autopilot)

## License

MIT License - feel free to use, modify, and share!

---

Built with care to make autonomous driving concepts accessible to everyone.
