# Shadow Driver v2

A complete game overhaul of the CARLA Shadow Driver racing game with modern web technologies.

## Features

### Game Modes
- **Head-to-Head** - Race against AI opponents in real-time
- **Time Trial** - Beat your personal best and compete on leaderboards

### Tracks
| Track | Difficulty | Checkpoints | Description |
|-------|------------|-------------|-------------|
| Sunset Speedway | Easy | 3 | Wide oval for beginners |
| Mountain Pass | Medium | 5 | S-curves with cones |
| Nightmare Circuit | Hard | 7 | Hairpins with barriers |

### AI Personalities
| Model | Style | Behavior |
|-------|-------|----------|
| PilotNet | Smooth | NVIDIA-style end-to-end driving |
| Alpamayo | Anticipatory | Early obstacle detection |
| Aggressive | Fast | Tight corners, late braking |
| Cautious | Safe | Wide margins, early reactions |
| Drunk | Chaotic | Wobbly, unpredictable (for fun!) |

### Core Features
- Arcade-style car physics with damage system
- Collision detection with crash penalties
- Scoring system with bonuses for perfect laps
- Checkpoint validation (no route cutting!)
- Persistent leaderboards via localStorage
- Mobile touch controls with virtual joystick
- Procedural audio (engine, collisions, checkpoints)
- Glass-morphism UI design

## Tech Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Phaser 3** - Game engine
- **Tailwind CSS v4** - Styling
- **Jest** - Testing

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Project Structure

```
v2/
├── src/
│   ├── components/       # React UI components
│   │   ├── game/        # GameHUD, MobileControls, etc.
│   │   ├── layout/      # Header, Footer, Layout
│   │   ├── menu/        # MainMenu, TrackSelect
│   │   └── results/     # ResultsScreen
│   ├── game/            # Phaser game code
│   │   ├── objects/     # Car, TrackRenderer
│   │   ├── scenes/      # BootScene, RaceScene
│   │   └── systems/     # AI, Collision, Scoring, Audio
│   ├── hooks/           # Custom React hooks
│   ├── tests/           # Jest test files
│   └── types/           # TypeScript definitions
├── public/
│   └── assets/
│       └── tracks/      # Track JSON files
└── TEAM_KNOWLEDGE.md    # Architecture decisions log
```

## Architecture Highlights

- **Phaser + React Integration**: Uses refs and factory pattern for lifecycle management
- **Event-Driven Communication**: Phaser scenes emit events to React for HUD updates
- **Tailwind v4**: CSS-first configuration with `@theme` directive
- **Procedural Audio**: Web Audio API synthesis (no audio files needed)

## Deployment

The game builds to static files and can be deployed to any static host:

```bash
npm run build
# Output in dist/
```

Recommended hosts:
- Vercel (zero config)
- Netlify
- GitHub Pages

## License

MIT License
