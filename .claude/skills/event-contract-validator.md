# Event Contract Validator

**Purpose:** Prevent event emitter mismatches between components by documenting and validating event contracts before implementation.

---

## When to Use This Skill

Use this skill when:
- Multiple components communicate via events (EventEmitter, CustomEvents, pub/sub)
- React components interact with game engines (Phaser, Three.js, etc.)
- Frontend communicates with backend via WebSockets or SSE
- Multiple agents are implementing interconnected code
- You're debugging "events not firing" bugs

---

## The Problem This Solves

The Shadow Driver v2 project had a critical bug:

```typescript
// BootScene.ts emitted on SCENE events
this.events.emit('bootComplete');

// GameContainer.tsx listened on GAME events
game.events.once('bootComplete', ...)
```

**Result:** Event never received. Game never started. All tests passed because they mocked the event system entirely.

---

## Event Contract Template

Before implementing any event-based communication, document the contract:

```markdown
## Event Contract: [ComponentA] ↔ [ComponentB]

### Overview
**Purpose:** [What this event communication achieves]
**Direction:** [A → B | B → A | Bidirectional]

### Events

| Event Name | Emitter | Emitter Object | Listener | Listener Object | Payload |
|------------|---------|----------------|----------|-----------------|---------|
| `eventName` | ComponentA | `this.game.events` | ComponentB | `game.events` | `{ prop: Type }` |

### Emitter Object Reference
- `this.events` - Scene-local (Phaser scene events, React component events)
- `this.game.events` - Global (Phaser game events, visible to React)
- `window` - Browser global (CustomEvent)
- `socket` - WebSocket instance

### Contract Verification
- [ ] Emitter and listener use the SAME event object
- [ ] Event name is spelled identically (case-sensitive)
- [ ] Payload structure matches between emit and handler
- [ ] Cleanup is implemented (removeEventListener, .off())
```

---

## Phaser ↔ React Event Patterns

### Pattern 1: Game Global Events (Recommended)

Use for cross-boundary communication (Phaser ↔ React):

```typescript
// Phaser Scene (Emitter)
this.game.events.emit('gameReady', { level: 1 });

// React Component (Listener)
useEffect(() => {
  const game = gameRef.current;
  const handler = (data) => setLevel(data.level);
  game.events.on('gameReady', handler);
  return () => game.events.off('gameReady', handler);
}, []);
```

### Pattern 2: Scene Events (Phaser-only)

Use for communication within Phaser:

```typescript
// Scene A
this.events.emit('playerDied');

// Same Scene A (or scenes that have reference to Scene A)
this.events.on('playerDied', this.handleDeath);
```

### Anti-Pattern: Mixed Event Objects

```typescript
// ❌ WRONG: Different event objects
// Scene emits on scene.events
this.events.emit('ready');
// React listens on game.events
game.events.on('ready', handler);  // Never receives!

// ✅ CORRECT: Same event object
this.game.events.emit('ready');
game.events.on('ready', handler);  // Works!
```

---

## Validation Checklist

Run this checklist for every event contract:

```markdown
## Event Contract Validation: [Event Name]

### 1. Emitter Side
- [ ] Event name defined as constant (not magic string)
- [ ] Correct emitter object used
- [ ] Payload structure documented
- [ ] TypeScript interface for payload exists

### 2. Listener Side
- [ ] Listening on SAME object as emitter
- [ ] Event name matches exactly
- [ ] Handler expects correct payload structure
- [ ] Cleanup implemented (.off() or removeEventListener)

### 3. Integration Test
- [ ] Added console.log to emitter: `console.log('Emitting:', eventName)`
- [ ] Added console.log to listener: `console.log('Received:', eventName)`
- [ ] Both logs appear in correct order when app runs
- [ ] Console.logs removed after verification

### 4. Edge Cases
- [ ] What if event fires before listener registered?
- [ ] What if listener registered multiple times?
- [ ] What if component unmounts before event fires?
```

---

## Event Contract Registry Template

Add this section to your TEAM_KNOWLEDGE.md:

```markdown
## Event Contract Registry

### [System Name] Events

| Event | From | To | Object | Payload | Notes |
|-------|------|----|---------|---------| -----|
| `init` | App | Engine | `game.events` | none | Triggers setup |
| `ready` | Engine | App | `game.events` | `{ version: string }` | Safe to interact |
| `error` | Engine | App | `game.events` | `{ code: number, msg: string }` | Handle errors |

### Event Object Legend
- `game.events` - Phaser Game global EventEmitter
- `scene.events` - Phaser Scene local EventEmitter
- `window` - Browser CustomEvent
- `socket` - WebSocket/Socket.io instance
```

---

## Debugging Event Issues

### Step 1: Verify Emitter

```typescript
// Add temporary logging
console.log('About to emit:', eventName);
console.log('Emitter object:', this.game?.events ? 'game.events' : 'scene.events');
this.game.events.emit(eventName, payload);
console.log('Emitted:', eventName);
```

### Step 2: Verify Listener

```typescript
// Add temporary logging
console.log('Registering listener for:', eventName);
console.log('Listener object:', game?.events ? 'game.events' : 'unknown');
game.events.on(eventName, (data) => {
  console.log('Received:', eventName, data);
  // ... handler logic
});
```

### Step 3: Check Registration Order

```typescript
// Events fired before registration are lost!
// If you see "Emitted" but not "Received", check timing

// ❌ WRONG: Event fires before listener
game.events.emit('ready');  // Fires immediately
game.events.on('ready', handler);  // Too late!

// ✅ CORRECT: Listen first
game.events.on('ready', handler);  // Registered
game.events.emit('ready');  // Now it works
```

### Step 4: Check for Typos

```typescript
// Case-sensitive!
game.events.emit('gameReady');  // camelCase
game.events.on('GameReady', handler);  // PascalCase - WON'T MATCH

// Use constants
const EVENTS = {
  GAME_READY: 'gameReady',
} as const;

game.events.emit(EVENTS.GAME_READY);
game.events.on(EVENTS.GAME_READY, handler);
```

---

## TypeScript Event Typing

Create type-safe event contracts:

```typescript
// events.ts
export interface GameEvents {
  bootComplete: void;
  startRace: { trackId: string; mode: 'time-trial' | 'head-to-head' };
  gameState: RaceHUDState;
  raceComplete: { playerResult: RaceResult; aiResult?: RaceResult };
}

// Type-safe emit wrapper
function emitGameEvent<K extends keyof GameEvents>(
  game: Phaser.Game,
  event: K,
  payload: GameEvents[K]
) {
  game.events.emit(event, payload);
}

// Type-safe listener wrapper
function onGameEvent<K extends keyof GameEvents>(
  game: Phaser.Game,
  event: K,
  handler: (payload: GameEvents[K]) => void
) {
  game.events.on(event, handler);
  return () => game.events.off(event, handler);
}

// Usage
emitGameEvent(game, 'startRace', { trackId: 'easy', mode: 'time-trial' });
onGameEvent(game, 'gameState', (state) => setHudState(state));
```

---

## Quick Reference: Common Event Systems

### Phaser 3
```typescript
// Global (React ↔ Phaser)
this.game.events.emit('event', data);
game.events.on('event', handler);
game.events.off('event', handler);

// Scene-local (Phaser only)
this.events.emit('event', data);
this.events.on('event', handler);
```

### React (Custom Events)
```typescript
// Emit
window.dispatchEvent(new CustomEvent('event', { detail: data }));

// Listen
useEffect(() => {
  const handler = (e: CustomEvent) => console.log(e.detail);
  window.addEventListener('event', handler);
  return () => window.removeEventListener('event', handler);
}, []);
```

### Node.js EventEmitter
```typescript
import { EventEmitter } from 'events';
const emitter = new EventEmitter();
emitter.emit('event', data);
emitter.on('event', handler);
emitter.off('event', handler);
```

---

## Best Practices

1. **Document contracts BEFORE implementing** - Both sides agree on the API
2. **Use constants for event names** - Prevents typos
3. **Add TypeScript interfaces for payloads** - Catch mismatches at compile time
4. **Always implement cleanup** - Memory leaks are silent bugs
5. **Log during development** - Remove before production
6. **Test the contract explicitly** - Don't rely on mocks
7. **Keep event registry updated** - New events = new registry entry
