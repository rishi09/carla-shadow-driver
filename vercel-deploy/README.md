# CARLA Shadow Driver

Interactive autonomous driving simulator with real-time AI predictions.

## Features

- **3 Game Modes**: Simulator, Shadow, AI Only
- **5 AI Behaviors**: PilotNet, Alpamayo, Aggressive, Cautious, Drunk
- **Weather Effects**: Clear, Rain, Fog, Night
- **GPU Connection**: Connect to real AI models on cloud GPU

## Controls

| Key | Action |
|-----|--------|
| W / ↑ | Accelerate |
| S / ↓ | Brake |
| A / ← | Steer left |
| D / → | Steer right |
| SPACE | Emergency brake |

## How It Works

Shadow mode is how Tesla, Waymo, and Cruise validate their AI:
1. You drive (green car)
2. AI predicts what it would do (blue car)
3. System measures divergence

## Connect Real GPU AI

Click "Connect Real AI" and follow the instructions to connect to a cloud GPU running the actual neural network.

## Tech Stack

- Pure HTML/CSS/JavaScript (no frameworks)
- Canvas API for rendering
- WebSocket for GPU connection
- NVIDIA PilotNet / Alpamayo models

---

Built to make autonomous driving concepts accessible to everyone.

[Full Project](https://github.com/rishi09/carla-shadow-driver)
