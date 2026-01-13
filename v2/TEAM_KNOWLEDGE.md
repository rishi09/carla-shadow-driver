# Shadow Driver v2 - Team Knowledge Base

## Purpose
This document captures learnings, failures, decisions, and patterns discovered during development.
All agents must READ this before starting work and APPEND learnings when done.

---

## Architecture Decisions Log

### AD-001: Phaser + React Integration
**Decision:** Use refs and factory pattern to manage Phaser lifecycle
**Rationale:** Avoids React re-render issues, makes testing easier
**Files:** `src/components/game/GameContainer.tsx`, `src/game/PhaserGame.ts`

### AD-002: Tailwind v4 Configuration
**Decision:** Use CSS-based `@theme` directive instead of JS config
**Rationale:** Tailwind v4 uses new CSS-first approach
**Files:** `src/index.css`, `postcss.config.js`

### AD-003: Jest with Phaser Mocking
**Decision:** Mock all Phaser imports in tests
**Rationale:** jsdom lacks canvas support required by Phaser
**Pattern:**
```typescript
jest.mock('phaser', () => ({
  Game: jest.fn(),
  Scene: class {},
  AUTO: 0,
}));
```

### AD-004: GameHUD Overlay Architecture
**Decision:** Use React overlay with absolute positioning over Phaser canvas
**Rationale:** Phaser canvas handles game graphics; React handles UI with familiar patterns
**Key patterns:**
- `useAnimatedNumber` hook for smooth value transitions (cubic ease-out)
- Glass-morphism styling consistent with MainMenu (`bg-dark-200/60 backdrop-blur-md`)
- Inline `<style>` for component-specific keyframe animations (flash, penaltyPulse)
- Props interface designed for easy Phaser event bridging
- Top bar for lap/time info, bottom bar for speed/checkpoints/position
**Files:** `src/components/game/GameHUD.tsx`

### AD-005: Countdown Overlay Animation Strategy
**Decision:** Use inline `<style>` tags for component-specific CSS keyframe animations
**Rationale:** Complex multi-step animations (scale + opacity transitions) are difficult to express with Tailwind utility classes. Inline styles keep animations scoped to the component and avoid global CSS bloat.
**Key patterns:**
- State machine approach: `3 -> 2 -> 1 -> 'GO' -> 'done'`
- `requestAnimationFrame` to reset animation triggers between counts
- Color-coded numbers: 3 (red), 2 (yellow), 1 (green), GO (gold/accent)
- Optional `onTick` callback for sound integration
- Explosion effect using CSS pseudo-burst lines and expanding ring
**Files:** `src/components/game/CountdownOverlay.tsx`

### AD-006: Leaderboard Persistence with localStorage
**Decision:** Use localStorage with track-specific keys for leaderboard persistence
**Rationale:** Simple, no backend required, persists across sessions
**Key patterns:**
- Key format: `shadow-driver-leaderboard-{trackId}`
- Max 10 entries per track, sorted by time ascending
- Validate data on load to handle corrupted/malformed entries
- Generate unique IDs with timestamp + random string
- Export types (`LeaderboardEntry`) for use in ResultsScreen
**Files:** `src/hooks/useLeaderboard.ts`

### AD-007: Results Screen Dual-Mode Layout
**Decision:** Single ResultsScreen component handles both head-to-head and time-trial modes
**Rationale:** Shared infrastructure (medals, formatting, buttons) with mode-specific rendering
**Key patterns:**
- `mode` prop determines layout: side-by-side cards (h2h) vs single detailed breakdown (tt)
- Medal system: Gold (< goldTime), Silver (< parTime), Bronze (completed)
- "NEW!" indicator for personal best detection via leaderboard hook
- Reusable `ResultCard` sub-component for player/AI results
- Consistent button layout with `onPlayAgain` and `onMainMenu` callbacks
**Files:** `src/components/results/ResultsScreen.tsx`

### AD-008: Track Data as JSON with Polygon Boundaries
**Decision:** Store track geometry as JSON files with explicit inner/outer boundary polygons
**Rationale:**
- JSON allows easy track creation/editing without code changes
- Explicit boundaries enable accurate collision detection
- Separating centerLine from boundaries allows independent rendering of guide lines
**Key patterns:**
- centerLine: Array of points for dashed yellow guide line
- boundaries.outer/inner: Closed polygons for collision and fill
- Checkpoints use position + width + angle for line-segment collision
- All angles in radians for Phaser compatibility
- Colors as hex strings for easy JSON serialization
**Files:** `src/types/track.ts`, `public/assets/tracks/*.json`

### AD-009: Scoring System with Penalties and Bonuses
**Decision:** Implement full scoring system with penalties, bonuses, and perfect lap detection
**Rationale:**
- Crash penalties (+3000ms) encourage clean driving
- Off-track penalties (+500ms/sec) punish cutting corners
- Checkpoint bonuses (-200ms each) reward precision
- Perfect lap bonus (-2000ms) incentivizes flawless runs
**Key patterns:**
- `startRace()` initializes first lap; `completeLap()` validates checkpoints and starts next
- Sequential checkpoint enforcement prevents route cutting
- Extended interface `ExtendedRaceResult` adds detailed lap breakdown
- Static `determineWinner()` for head-to-head mode comparison
- `TimeTrialScoring` utility class for localStorage personal best management
**Files:** `src/game/systems/ScoringSystem.ts`, `src/tests/ScoringSystem.test.ts`

### AD-010: AI Controller with Multiple Personality Models
**Decision:** Port 5 AI personality models from original demo with top-down view adaptation
**Rationale:**
- Multiple AI personalities add variety and replayability
- Difficulty levels map to different personalities (easy=cautious, medium=pilotnet, hard=aggressive)
- Original pseudo-3D models work well in top-down with proper track position/curvature calculation
**Key patterns:**
- `AI_MODELS` object exports all 5 models with name, description, compute function
- Internal `AIInputState` uses continuous values; convert to `InputState` (boolean throttle/brake) for car
- Track position calculated via point-to-segment projection with signed distance
- Curvature calculated from angle changes in upcoming centerLine segments
- Obstacle visibility uses angle-based filtering (only see ahead ~90 degrees)
- Difficulty modifiers: speed scaling (0.7-1.0) and precision (0.8-0.98)
**AI Models:**
| Model | Position Factor | Curve Factor | Obstacle Range | Target Speed |
|-------|-----------------|--------------|----------------|--------------|
| PilotNet | 0.9 | 0.7 | 50-150 | 210 (70%) |
| Alpamayo | 0.7 | 1.2 | 30-250 | 195 (65%) |
| Aggressive | 1.3 | 0.9 | 30-100 | 270 (90%) |
| Cautious | 0.5 | 0.4 | 50-300 | 150 (50%) |
| Drunk | 0.4 | 0.3 | 20-80 | Wobbly |
**Files:** `src/game/systems/AIController.ts`, `src/tests/AIController.test.ts`

---

## Failures & Lessons Learned

### F-001: [TEMPLATE]
**What happened:**
**Root cause:**
**Fix applied:**
**Lesson:**

---

## Successful Patterns

### P-001: Agent Parallelization
**Pattern:** Launch multiple agents for independent tasks
**Benefit:** 3x faster completion
**Caveat:** Need sync points to avoid conflicts

### P-002: Sub-agent Expert Consultation
**Pattern:** When stuck, spawn a subject-matter expert agent
**Benefit:** Unblocks without waiting for human
**Caveat:** Must summarize findings back to parent

### P-003: Track Selection UI Pattern
**Pattern:** Use difficulty-based color coding with consistent styling
**Implementation:**
- Create a `difficultyConfig` object mapping difficulty levels to colors/styles
- Use dynamic inline styles for glow effects (boxShadow) since Tailwind can't generate arbitrary color values at runtime
- Leverage localStorage for persisting best times with key format: `best_${trackId}_${mode}`
- Use `useMemo` for derived values like best times to avoid unnecessary recalculations
**Files:** `src/components/menu/TrackSelect.tsx`

### P-004: Smooth Number Animation Hook
**Pattern:** Custom `useAnimatedNumber` hook for fluid HUD value transitions
**Implementation:**
- Uses `requestAnimationFrame` for performant animation loop
- Cubic ease-out function for natural deceleration: `1 - Math.pow(1 - progress, 3)`
- Cleanup via `cancelAnimationFrame` on unmount/value change
- Configurable duration parameter (default 150ms)
**Benefit:** Prevents jarring value jumps in speed, timers, and other numeric displays
**Files:** `src/components/game/GameHUD.tsx`

---

## Context Management Protocol

### For Agents Working on This Project:

1. **READ THIS FILE FIRST** - Understand prior decisions and failures
2. **APPEND TO THIS FILE** when you:
   - Make an architectural decision
   - Encounter and fix a failure
   - Discover a successful pattern
3. **KEEP CHANGES SMALL** - Commit frequently to avoid context bloat
4. **SUMMARIZE WORK** - End each session with a status update

### Context Budget Guidelines:
- Each agent should aim to complete work in <50k tokens
- If work exceeds this, spawn sub-agents for sub-tasks
- Always return a summary, not the full work log

---

## Current Team Status

### Phase 1: Foundation ✅ COMPLETE
- [x] Vite + React + TypeScript scaffold
- [x] Phaser.js integration
- [x] Tailwind CSS theme
- [x] Layout/Menu components
- [x] Jest testing setup
- [x] GitHub Actions workflow

### Phase 2: Core Game ✅ COMPLETE
- [x] Car physics
- [x] Track rendering
- [x] Collision system
- [x] AI controller
- [x] Scoring system
- [x] GameHUD
- [x] TrackSelect
- [x] CountdownOverlay
- [x] ResultsScreen

### Phase 3: Content & Polish ⏳ PENDING
### Phase 4: Integration ✅ COMPLETE
- [x] App.tsx full navigation flow
- [x] State management for views
- [x] Mobile controls integration
- [x] Component props wiring
- [x] Race result handling
### Phase 5: Stretch Goals ⏳ PENDING

---

## File Ownership

| Component | Owner | Status |
|-----------|-------|--------|
| App.tsx | Integration Architect | Complete |
| Car.ts | Game Engine Lead | Complete |
| TrackRenderer.ts | Game Engine Lead | Complete |
| CollisionSystem.ts | Game Engine Lead | Complete |
| AIController.ts | Game Engine Lead | Complete |
| ScoringSystem.ts | Game Engine Lead | Complete |
| AudioManager.ts | Game Audio Specialist | Complete |
| GameHUD.tsx | UI/UX Lead | Complete |
| TrackSelect.tsx | UI/UX Lead | Complete |
| MobileControls.tsx | UI/UX Lead | Complete |
| CountdownOverlay.tsx | UI/UX Lead | Complete |
| ResultsScreen.tsx | UI/UX Lead | Complete |
| useLeaderboard.ts | UI/UX Lead | Complete |
| useMobileDetect.ts | UI/UX Lead | Complete |
| Unit tests | QA Lead | Pending |
| Integration tests | QA Lead | Pending |

---

## Quick Reference

### Run Dev Server
```bash
cd v2 && npm run dev
```

### Run Tests
```bash
cd v2 && npm test
```

### Build for Production
```bash
cd v2 && npm run build
```

### Key Files
- Entry: `src/main.tsx`
- App: `src/App.tsx`
- Game: `src/game/PhaserGame.ts`
- Scenes: `src/game/scenes/`
- Objects: `src/game/objects/`
- Components: `src/components/`
- Types: `src/types/`

---

## Agent Session Logs

### Car Physics Implementation (Game Engine Specialist)
**Date:** 2025-01-12
**Task:** Implement arcade-style car physics

**Physics Constants Chosen:**
| Constant | Player | AI | Rationale |
|----------|--------|-----|-----------|
| maxSpeed | 220 | 200 | Player gets slight advantage |
| acceleration | 120 | 100 | Faster pickup for player |
| brakeForce | 200 | 200 | Same braking power |
| friction | 50 | 50 | Absolute units/sec decay |
| turnRate | 3 | 3 | Radians/sec at max speed |
| damageDuration | 1000ms | 1000ms | 1 second penalty |
| damageSpeedReduction | 0.3 | 0.3 | Keep 30% speed on hit |

**Key Implementation Details:**
1. Steering is proportional to speed (can't turn when stopped, threshold: 10 units)
2. Reverse steering when going backwards for natural feel
3. Damage includes visual feedback (alpha flash) and camera shake
4. Uses Rectangle placeholder for sprite (ready for real sprite swap)
5. Compatible with other agents' work (getPosition, getGameObject, setAngle, destroy)

**Files Created/Modified:**
- `src/game/objects/Car.ts` - Full car class with arcade physics
- `src/game/objects/index.ts` - Export index
- `src/types/game.ts` - Added InputState, CarState interfaces

**Integration Notes:**
- Import: `import { Car } from '../objects'`
- Call `car.update(inputState, delta)` in scene update loop
- Call `car.onCollision('obstacle' | 'boundary' | 'wall' | 'car')` when collision detected
- Use `car.getState()` to get current position/speed for HUD updates
- Use `car.reset(x, y, angle)` to reset for new race

### Track Rendering & Data Implementation (Game Engine Specialist)
**Date:** 2025-01-12
**Task:** Create track rendering system and define 3 tracks

**Track Data Structure:**
- `TrackData` interface with centerLine, boundaries (inner/outer), checkpoints, finishLine, obstacles
- `Vector2` type for all point coordinates
- `Checkpoint` with position, width, and angle (radians)
- `ObstacleData` for cones and barriers with optional rotation
- Timing: `parTime` and `goldTime` in milliseconds

**Track Designs:**
| Track | Difficulty | Width | Checkpoints | Obstacles | Par Time | Gold Time |
|-------|------------|-------|-------------|-----------|----------|-----------|
| Sunset Speedway | Easy | 120px | 3 | 0 | 45s | 38s |
| Mountain Pass | Medium | 100px | 5 | 8 cones | 55s | 45s |
| Nightmare Circuit | Hard | 80px | 7 | 12 cones + 4 barriers | 70s | 55s |

**TrackRenderer Features:**
1. Background fill (customizable per track)
2. Track surface via filled polygon (outer boundary, cutout inner)
3. Boundary lines (white by default, red for hard track)
4. Dashed center line (yellow, 70% opacity)
5. Checkered finish line (2x8 alternating squares)
6. Checkpoint indicators (subtle blue lines)
7. Obstacle rendering: orange cones (triangle with stripe), red/white striped barriers

**Rendering Order (bottom to top):**
1. Background -> 2. Track surface -> 3. Boundaries -> 4. Center line -> 5. Checkpoints -> 6. Finish line -> 7. Obstacles

**Files Created/Modified:**
- `src/types/track.ts` - Complete track type definitions
- `src/game/objects/TrackRenderer.ts` - Full rendering implementation
- `public/assets/tracks/easy.json` - Sunset Speedway (oval)
- `public/assets/tracks/medium.json` - Mountain Pass (S-curves)
- `public/assets/tracks/hard.json` - Nightmare Circuit (complex with hairpins)

**Integration Notes:**
- Load track JSON: `fetch('/assets/tracks/easy.json').then(r => r.json())`
- Create renderer: `new TrackRenderer(scene, trackData)`
- Call `renderer.render()` in scene create
- Get boundaries for collision: `renderer.getInnerBoundary()`, `renderer.getOuterBoundary()`
- Get checkpoints: `renderer.getCheckpoints()`
- Clean up: `renderer.destroy()`

**Design Decisions:**
- Canvas size assumed 900x600 (from PhaserGame.ts defaults)
- All tracks are closed loops (centerLine ends at start)
- Angles in radians for consistency with Phaser
- Colors can be overridden per track via JSON (backgroundColor, trackColor, borderColor)

### Scoring System Implementation (Game Engine Specialist)
**Date:** 2026-01-12
**Task:** Create scoring system with penalties, bonuses, and winner determination

**Scoring Constants:**
| Component | Value | Description |
|-----------|-------|-------------|
| Crash Penalty | +3000ms | Per boundary/obstacle collision |
| Off-Track | +500ms/sec | While outside track boundaries |
| Checkpoint Bonus | -200ms | Per checkpoint hit in sequence |
| Perfect Lap | -2000ms | No crashes + all checkpoints |

**Key Implementation Details:**
1. `ScoringSystem` class tracks single racer (create one per racer)
2. Checkpoints must be hit in sequential order (enforced via Set + expected index)
3. `completeLap()` returns false if not all checkpoints hit
4. Final time = raw + penalties - checkpoint bonuses - perfect bonus (clamped to 0)
5. Backward compatible with existing `RaceResult` interface from `types/game.ts`
6. Extended `ExtendedRaceResult` adds `lapDetails`, `totalPenalties`, `totalBonuses`, `perfectLaps`
7. `TimeTrialScoring` utility for localStorage personal best management

**Winner Determination (head-to-head):**
1. More laps completed wins
2. If tied, lower total time wins
3. On exact tie, player wins (home advantage)

**Files Created/Modified:**
- `src/game/systems/ScoringSystem.ts` - Full implementation with TimeTrialScoring
- `src/tests/ScoringSystem.test.ts` - 50 comprehensive tests

**Integration Notes:**
```typescript
// Create scoring system
const scoring = new ScoringSystem(totalCheckpoints, totalLaps);
scoring.startRace(gameTime);

// During race
scoring.hitCheckpoint(id);  // Returns true if valid
scoring.addCrashPenalty();  // On collision
scoring.addOffTrackTime(deltaMs);  // Each frame while off-track

// On lap complete
if (scoring.completeLap(gameTime)) {
  // Valid lap, started next or race finished
}

// Get results
const result = scoring.getRaceResult();  // Basic RaceResult
const extended = scoring.getExtendedRaceResult();  // With lap details

// Head-to-head winner
const winner = ScoringSystem.determineWinner(playerResult, aiResult);

// Time trial personal best
TimeTrialScoring.savePersonalBest(trackId, result);
const pb = TimeTrialScoring.getPersonalBest(trackId);
```

**Edge Cases Handled:**
- Negative time inputs throw errors
- Final time clamped to 0 (can't go negative from bonuses)
- Duplicate checkpoints rejected
- Out-of-order checkpoints rejected
- Empty race returns sensible defaults

### Collision System Implementation (Game Engine Specialist)
**Date:** 2026-01-12
**Task:** Create robust collision detection for track boundaries and obstacles

**Algorithms Implemented:**

1. **Ray Casting (Point-in-Polygon)**
   - Used for boundary detection (is car on track?)
   - Cast horizontal ray from point, count edge crossings
   - Odd crossings = inside, even = outside
   - Works correctly for concave polygons

2. **Circle-Rectangle Collision**
   - Used for obstacle collision (cones, barriers)
   - Find closest point on rectangle to circle center
   - Compare distance to circle radius
   - Also calculates collision normal for physics response

3. **Circle-Circle Collision**
   - Used for car-to-car collision
   - Simple distance < sum of radii check
   - Normal vector points from car1 to car2

**Performance Optimizations:**
| Optimization | Implementation | Benefit |
|--------------|----------------|---------|
| Spatial filtering | Only check obstacles within 100px radius | Reduces O(n) to O(nearby) |
| Cached segments | Pre-compute boundary line segments | Faster distance calculations |
| Early-out checks | Check boundary before obstacles | Most collisions are boundary |

**Collision Constants:**
| Constant | Value | Rationale |
|----------|-------|-----------|
| CAR_COLLISION_RADIUS | 25px | Matches visual car size |
| OBSTACLE_PROXIMITY_RADIUS | 100px | 4x car radius for safety margin |
| DEFAULT_OBSTACLE_WIDTH | 20px | Standard cone/barrier size |
| DEFAULT_OBSTACLE_HEIGHT | 20px | Standard cone/barrier size |

**API Design:**
```typescript
// Main collision check - returns type and collision normal
checkCollision(car: Car): CollisionResult

// Boundary check only
isOnTrack(position: Vector2): boolean

// Car-to-car collision
checkCarCollision(car1: Car, car2: Car): CollisionResult

// Checkpoint/finish line detection
checkCheckpointCrossing(car: Car, checkpointId: number): boolean
checkFinishLineCrossing(car: Car): boolean

// Debug visualization
setDebugEnabled(enabled: boolean): void
drawDebug(): void
```

**Files Created/Modified:**
- `src/game/systems/CollisionSystem.ts` - Full implementation (549 lines)
- `src/tests/CollisionSystem.test.ts` - 36 comprehensive tests

**Test Coverage:**
- Boundary detection (inside track, outside outer, inside inner)
- Obstacle collision detection with normals
- Car-to-car collision
- Checkpoint and finish line crossing
- Edge cases (corners, L-shaped tracks, empty boundaries, triangles)
- Performance test (1000 collision checks in <100ms)

**Integration Notes:**
- Import: `import { CollisionSystem } from '../systems/CollisionSystem'`
- Create: `new CollisionSystem(scene, trackData)`
- Call `checkCollision(car)` in update loop
- Use `result.type` to determine collision response
- Use `result.normal` for bounce/push physics
- Use `setDebugEnabled(true)` to visualize boundaries

### AI Controller Implementation (Game Engine Specialist)
**Date:** 2026-01-12
**Task:** Port AI models from demo_visual_car.html and adapt for top-down view

**Models Ported:**
| Model | Personality | Use Case |
|-------|-------------|----------|
| PilotNet | Smooth, centered | Default medium difficulty |
| Alpamayo | Anticipatory, smooth curves | Early obstacle detection |
| Aggressive | Tight corners, late reactions | Hard difficulty |
| Cautious | Wide margins, early reactions | Easy difficulty |
| Drunk | Wobbly, unpredictable | Fun/challenge mode |

**Top-Down Adaptation:**
1. **Track Position** - Calculated via perpendicular signed distance from centerLine
   - Uses point-to-segment projection algorithm
   - Finds closest segment, projects car position onto it
   - Cross product determines left/right side
   - Normalized to -1 (left edge) to +1 (right edge)

2. **Curvature** - Average angle change in upcoming segments
   - Samples next 5 centerLine segments
   - Calculates angle of each segment pair
   - Returns normalized curvature (-1 to +1)

3. **Obstacle Detection** - Angle-based filtering
   - Only considers obstacles within 90-degree forward arc
   - Distance calculated in world units
   - Lane assignment based on relative angle

**Difficulty Mapping:**
| Difficulty | Model | Speed Mod | Precision |
|------------|-------|-----------|-----------|
| Easy | Cautious | 0.70 | 0.80 |
| Medium | PilotNet | 0.85 | 0.90 |
| Hard | Aggressive | 1.00 | 0.98 |

**Key Design Decisions:**
1. Internal AI uses continuous 0-1 throttle/brake, converted to boolean for InputState
2. Each model has distinct reaction distances for obstacles
3. Drunk model uses sine wave combinations for unpredictable wobble
4. Precision modifier randomly reduces steering accuracy on lower difficulties

**Files Created/Modified:**
- `src/game/systems/AIController.ts` - Full implementation (651 lines)
- `src/tests/AIController.test.ts` - 78 comprehensive tests

**Test Coverage:**
- All 5 models tested for valid output ranges
- Position correction direction verified
- Obstacle avoidance behavior validated
- Model-specific characteristics verified (wobble, reaction distance, speed preference)
- Edge cases: extreme speeds, positions, many obstacles

**Integration Notes:**
```typescript
// Create AI controller
const aiController = new AIController(car, trackData, 'medium');

// Set model directly (overrides difficulty)
aiController.setModel('drunk');

// In game loop
const input = aiController.compute();
aiCar.update(input, delta);

// Get model info for UI
const modelInfo = aiController.getModelInfo();
console.log(modelInfo.name, modelInfo.description);
```


### RaceScene Implementation (Technical Architect)
**Date:** 2026-01-12
**Task:** Create main RaceScene integrating all game systems

**Architecture:**
RaceScene is the central orchestrator that coordinates all game systems:
1. **Track Loading**: Loads track JSON via Phaser preload, falls back to default track for testing
2. **Object Creation**: Instantiates Car, TrackRenderer, and systems in correct order
3. **Game Loop**: Reads input -> updates cars -> checks collisions -> updates scoring -> emits state
4. **Event Communication**: Emits events to React for HUD updates, countdown, race completion

**State Machine:**
```
loading -> countdown -> racing -> finished
    ^                      |
    |______(restart)_______|
```

**Key Implementation Decisions:**
| Decision | Rationale |
|----------|-----------|
| Type-only imports | Required by verbatimModuleSyntax in tsconfig |
| Default track fallback | Allows testing without JSON files |
| Checkpoint sequence enforcement | Prevents route cutting |
| Finish line debounce (500ms) | Prevents double-counting crossings |
| Penalty flash timer (300ms) | Visual feedback for collisions |

**Event System:**
| Event | Payload | When |
|-------|---------|------|
| sceneReady | trackName, gameMode, laps | Scene created |
| countdownUpdate | "3"/"2"/"1"/"GO!" | Each countdown step |
| raceStart | - | Race begins |
| gameState | RaceHUDState | Every frame |
| checkpointHit | player, checkpointId | Checkpoint crossed |
| lapComplete | player, lap | Lap finished |
| raceComplete | playerResult, aiResult, winner | Race finished |

**Files Created/Modified:**
- `src/game/scenes/RaceScene.ts` - Main game scene (600+ lines)
- `src/game/scenes/BootScene.ts` - Updated to transition to RaceScene
- `src/game/PhaserGame.ts` - Added RaceScene to scene list
- `src/types/game.ts` - Added RaceHUDState, RaceResult, RaceSceneData interfaces

**Integration Notes:**
```typescript
// Start race from React
game.events.emit('startRace', { trackId: 'easy', mode: 'time-trial' });

// Listen for HUD updates in React
raceScene.events.on('gameState', (state: RaceHUDState) => {
  setSpeed(state.speed);
  setLap(state.lapNumber);
  // etc.
});

// Mobile input from React
raceScene.setExternalInput({ throttle: true, brake: false, steer: 0.5 });
```

**Coordination with Other Agents:**
- Depends on: Car.ts, TrackRenderer.ts, CollisionSystem.ts, ScoringSystem.ts, AIController.ts
- All dependencies were implemented by other agents in parallel
- Fixed type import issues (verbatimModuleSyntax requires `import type`)
- Collision type mismatch fixed by adding 'none' check before calling onCollision

**Lessons Learned:**
1. Use `import type` for all type-only imports when verbatimModuleSyntax is enabled
2. Create default/fallback data for testing when external files may not exist
3. State machine approach simplifies race flow management
4. Debouncing is essential for line-crossing detection

### Mobile Touch Controls Implementation (Mobile UX Specialist)
**Date:** 2026-01-12
**Task:** Create touch controls for mobile devices

**Component Architecture:**
| Component | Purpose |
|-----------|---------|
| MobileControls | Main wrapper, manages input state, visibility |
| VirtualJoystick | Circular touch joystick for steering + throttle |
| BrakeButton | Dedicated brake button for quick access |

**Control Mapping:**
| Input | Action | Threshold |
|-------|--------|-----------|
| Joystick X | Steer | -1 to 1 (with 0.15 deadzone) |
| Joystick Y up | Throttle | Y < -0.3 |
| Joystick Y down | Brake | Y > 0.5 |
| Brake button | Brake (override) | On press |

**Technical Implementation:**
1. **Touch tracking**: Uses `touch.identifier` to track specific finger through multi-touch scenarios
2. **Joystick math**: Projects touch position onto circular constraint, normalizes to -1 to 1
3. **Deadzone**: 15% deadzone prevents accidental input near center
4. **Input deduplication**: Only emits to callback when input actually changes
5. **Safe area**: Uses `env(safe-area-inset-bottom)` for notched devices
6. **Visual feedback**: Active state with color changes and glow effects

**Mobile Detection Hooks:**
| Hook | Purpose |
|------|---------|
| `useMobileDetect(breakpoint)` | Touch capability + screen width check |
| `useTouchCapable()` | Simple touch capability check |

**Files Created:**
- `src/components/game/MobileControls.tsx` - Touch controls component (320 lines)
- `src/hooks/useMobileDetect.ts` - Device detection hooks (60 lines)
- `src/hooks/index.ts` - Updated exports

**Integration Notes:**
```typescript
import { MobileControls } from './components/game/MobileControls';
import { useMobileDetect } from './hooks';

function GameContainer() {
  const isMobile = useMobileDetect();

  const handleMobileInput = (input: InputState) => {
    raceScene.setExternalInput(input);
  };

  return (
    <div className="relative">
      <canvas /> {/* Phaser canvas */}
      <MobileControls
        visible={isMobile && gameState === 'racing'}
        onInput={handleMobileInput}
      />
    </div>
  );
}
```

**Design Decisions:**
1. **Separate brake button**: Joystick Y-down provides brake, but dedicated button gives quicker access for emergency stops
2. **Glass-morphism styling**: Matches existing GameHUD aesthetic with `backdrop-blur` and semi-transparent backgrounds
3. **44px minimum touch targets**: Follows iOS/Android accessibility guidelines
4. **Direction indicators**: Visual arrows show throttle/brake zones in joystick
5. **Landscape orientation**: Controls positioned at bottom edges for thumb access

### Audio Manager Implementation (Game Audio Specialist)
**Date:** 2026-01-12
**Task:** Create procedural audio system for game sounds

**Audio Approach: Web Audio API Synthesis**
Chose procedural audio generation over placeholder files because:
1. No audio files needed - works immediately
2. Engine sound can dynamically follow car speed
3. Smaller build size
4. Consistent audio experience

**Sound Effects:**
| Sound | Generation Method | Frequency/Notes | Duration |
|-------|-------------------|-----------------|----------|
| Engine | Sawtooth oscillator + lowpass filter | 80-350 Hz (speed-based) | Continuous |
| Collision | White noise burst + lowpass filter | Random samples | 150ms |
| Countdown beep | Sine oscillator | 440 Hz (A4) | 200ms |
| Countdown go | Sine oscillator | 880 Hz (A5) | 300ms |
| Checkpoint | Ascending arpeggio | C5-E5-G5 | 3x80ms |
| Lap complete | Ascending melody | C5-D5-E5-G5-A5 | 5x100ms |

**Audio Constants:**
| Constant | Value | Purpose |
|----------|-------|---------|
| ENGINE_MIN_FREQ | 80 Hz | Idle engine frequency |
| ENGINE_MAX_FREQ | 350 Hz | Max speed engine frequency |
| ENGINE_VOLUME | 0.15 | Engine base volume |
| COLLISION_VOLUME | 0.3 | Collision impact volume |
| COUNTDOWN_VOLUME | 0.25 | UI sound volume |

**Key Implementation Details:**
1. **AudioContext sharing**: Reuses Phaser's WebAudioSoundManager context if available
2. **Browser autoplay**: Handles suspended context state from browser policies
3. **Collision cooldown**: 200ms debounce prevents sound spam
4. **Engine interpolation**: Smooth frequency transitions (10% lerp per frame)
5. **Volume clamping**: Master volume clamped to 0-1 range
6. **Cleanup**: Properly disconnects nodes and closes context on destroy

**Files Created:**
- `src/game/systems/AudioManager.ts` - Full audio system (460 lines)
- `src/tests/AudioManager.test.ts` - 40 comprehensive tests

**Test Coverage:**
- Constructor and initialization
- Enable/disable toggle
- Volume control with clamping
- Engine sound start/stop/update
- Collision sound with cooldown
- Countdown beep and go sounds
- Checkpoint and lap complete melodies
- Destroy and cleanup
- Audio constants validation

**Integration Notes:**
```typescript
// In RaceScene constructor
private audioManager!: AudioManager;

// In create()
this.audioManager = new AudioManager(this);
this.audioManager.create();

// In update loop (racing state)
this.audioManager.playEngine(this.player.getState().speed);

// On collision
this.audioManager.playCollision();

// During countdown
this.audioManager.playCountdownBeep();  // For 3, 2, 1
this.audioManager.playCountdownGo();     // For GO!

// On checkpoint/lap
this.audioManager.playCheckpoint();
this.audioManager.playLapComplete();

// Settings integration
audioManager.setEnabled(userSettings.soundEnabled);
audioManager.setVolume(userSettings.soundVolume);

// Cleanup in shutdown()
this.audioManager.destroy();
```

**Design Decisions:**
1. **Procedural over samples**: No external audio files needed, instant loading
2. **Sawtooth for engine**: Rich harmonics simulate engine sound
3. **White noise for collision**: Simulates impact better than tones
4. **Musical notes for feedback**: C major arpeggio is universally pleasing
5. **Separate master gain**: Easy global volume control

### App.tsx Full Integration (Integration Architect)
**Date:** 2026-01-12
**Task:** Wire all components together in App.tsx for complete user flow

**User Flow Implemented:**
```
MainMenu -> TrackSelect -> GameContainer -> ResultsScreen -> (Play Again OR Main Menu)
```

**State Architecture:**
```typescript
type View = 'menu' | 'track-select' | 'game' | 'results';

interface AppState {
  currentView: View;
  selectedMode: GameMode | null;
  selectedTrack: string | null;
  raceResult: RaceResult | null;
  aiResult: RaceResult | null;
  winner: 'player' | 'ai' | null;
}
```

**Key Implementation Details:**
1. **State machine navigation**: Single `currentView` state controls which component renders
2. **Callback handlers with useCallback**: Prevents unnecessary re-renders of child components
3. **Track ID mapping**: TrackSelect uses display IDs ('sunset-speedway'), GameContainer uses file IDs ('easy')
4. **Track timing lookup**: Centralized `TRACK_TIMINGS` object for par/gold times in ResultsScreen
5. **Layout visibility**: Header/footer hidden during game view for more screen space
6. **Difficulty auto-mapping**: Track difficulty determines AI difficulty setting

**Component Props Wiring:**
| Component | Props Passed | Event Handler |
|-----------|--------------|---------------|
| MainMenu | onSelectMode | handleModeSelect -> track-select |
| TrackSelect | mode, onSelectTrack, onBack | handleTrackSelect -> game |
| GameContainer | trackId, mode, difficulty, isMobile, onRaceComplete | handleRaceComplete -> results |
| ResultsScreen | mode, trackId, playerResult, aiResult, parTime, goldTime, onPlayAgain, onMainMenu | handlePlayAgain -> game, handleMainMenu -> menu |

**Mobile Integration:**
- `useMobileDetect()` hook provides isMobile boolean
- Passed to GameContainer which handles MobileControls internally
- Controls hidden in non-game views automatically

**Files Modified:**
- `src/App.tsx` - Full integration (285 lines)

**Integration Notes:**
```typescript
// Track ID mapping (TrackSelect IDs -> JSON file IDs)
const trackMap = {
  'sunset-speedway': 'easy',
  'mountain-pass': 'medium',
  'nightmare-circuit': 'hard',
};

// Track timings for medal calculation
const TRACK_TIMINGS = {
  'sunset-speedway': { parTime: 55000, goldTime: 42000 },
  'mountain-pass': { parTime: 70000, goldTime: 55000 },
  'nightmare-circuit': { parTime: 90000, goldTime: 72000 },
};
```

**Lessons Learned:**
1. Keep state flat - avoid nested objects for simpler updates
2. Use initialState object for easy reset to main menu
3. Track IDs should be consistent between components (consider centralizing)
4. GameContainer already integrates MobileControls, no need to duplicate in App
5. Layout `showHeader/showFooter` props enable immersive game view

### CARLA Emulator / Realistic Mode Research (Innovation Lead)
**Date:** 2026-01-12
**Task:** Research CARLA simulator integration for "Realistic Mode" with improved graphics

**Research Findings:**

#### 1. CARLA M1 Mac Compatibility
**Verdict: NOT RECOMMENDED**

CARLA officially supports only:
- Windows 10/11
- Ubuntu 20.04/22.04
- Requires NVIDIA GPU with 8GB+ VRAM (RTX 2070 or better)
- Uses ~20GB disk space

CARLA has **no official Mac or ARM support**. Running via Docker with Rosetta 2 is problematic because:
- CARLA requires GPU acceleration (OpenGL/Vulkan) which doesn't work well through Docker on M1
- Emulation performance would be extremely poor
- The Docker image `carlasim/carla:0.9.14` is x86_64 only

**Sources:**
- [CARLA Quick Start](https://carla.readthedocs.io/en/latest/start_quickstart/)
- [Docker ARM64 Issues](https://github.com/docker/for-mac/issues/7137)

#### 2. Lightweight CARLA Visual Options

| Option | Feasibility | Notes |
|--------|-------------|-------|
| Full CARLA Docker | NOT VIABLE | No GPU passthrough on M1 Mac |
| CARLA + VNC | NOT VIABLE | Same GPU issues |
| Carlaviz Web Viewer | LIMITED | Shows 3D wireframe view only, not full graphics |
| Pre-recorded Footage | POSSIBLE | Would need access to Windows/Linux machine with GPU |

**Carlaviz Plugin:**
- Provides web-based visualization at http://127.0.0.1:8080/
- Shows actors, sensors, LIDAR data in simplified 3D view
- NOT suitable for game-quality visuals (debug/visualization tool only)

#### 3. RECOMMENDED APPROACH: React Three Fiber

**Best Option: Browser-native 3D with React Three Fiber**

| Criteria | React Three Fiber | CARLA Docker | Pre-recorded Video |
|----------|-------------------|--------------|-------------------|
| M1 Mac Compatible | YES | NO | YES |
| Interactive | YES | YES | NO |
| Setup Complexity | LOW | HIGH | MEDIUM |
| Visual Quality | GOOD | EXCELLENT | EXCELLENT |
| Development Time | 15-20 hours | N/A | 8-10 hours |
| File Size Impact | ~500KB | N/A | ~100MB/track |

**Tech Stack for Realistic Mode:**
```bash
npm install three @react-three/fiber @react-three/drei @react-three/cannon
npm install -D @types/three
```

**Existing Reference Projects:**
- [react-threejs-car-racing](https://github.com/sctlcd/react-threejs-car-racing) - Live demo at react-threejs-car-racing.vercel.app
- [super-car-racing-three](https://github.com/hamidrezaghanbari/super-car-racing-three) - Live demo at supercar-racing.vercel.app

**Free 3D Assets:**
- Cars: [Low Poly Racing Cars on Sketchfab](https://sketchfab.com/3d-models/low-poly-racing-cars-polyscript-084ba9104ae74586b349e94db894c0fa)
- Textures: [ambientCG.com](https://ambientcg.com/) for PBR road/asphalt
- HDRI Skyboxes: [Poly Haven](https://polyhaven.com/)

#### 4. Implementation Plan

**Phase 1: Basic 3D Scene (2-3 hours)**
- Install React Three Fiber dependencies
- Create Canvas with perspective camera
- Add ground plane and placeholder car
- Add chase camera following car

**Phase 2: Car Model & Physics (3-4 hours)**
- Load GLTF car model
- Add wheel rotation animation
- Implement raycast vehicle physics
- Add steering animation

**Phase 3: Track Environment (4-5 hours)**
- Generate road from existing centerLine data
- Add PBR materials (asphalt texture, normals)
- Add guardrails/barriers from boundary data
- Add environment decorations

**Phase 4: Effects & Polish (3-4 hours)**
- Post-processing (bloom, motion blur)
- Particle effects (tire smoke)
- Skid marks/tire trails
- Camera shake on collision

**Phase 5: Integration (2-3 hours)**
- Bridge with existing InputState
- Reuse GameHUD overlay
- Sync with ScoringSystem
- Add 2D/3D toggle in settings

**Files Created:**
- `src/components/game/RealisticMode.tsx` - Placeholder component with detailed implementation plan

**Decision:**
Proceed with React Three Fiber approach. This provides:
1. Full browser compatibility (no server/Docker needed)
2. Works on M1 Mac development machine
3. Interactive 3D with physics
4. Reuses existing track data and game systems
5. Reasonable development time (15-20 hours)

**Alternative (Fallback):**
If 3D development takes too long, pre-recorded video mode could work:
- Record CARLA gameplay on a Windows/Linux machine
- Sync video playback with game progress
- Less interactive but achieves "impressive graphics" goal

