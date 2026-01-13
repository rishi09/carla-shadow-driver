# Shadow Driver Game Development Patterns

**Purpose:** Codified learnings from the v2 game overhaul project. Use these patterns for future game development, complex UI projects, or multi-agent development efforts.

---

## When to Use This Skill

Use these patterns when:
- Building React + Phaser.js games
- Developing accessible game UIs (the "70-year-old father test")
- Managing multi-agent development teams
- Integrating game engines with React state

---

## Pattern 1: Phaser + React Integration

**Problem:** Phaser.js manages its own game loop and state, which conflicts with React's declarative rendering model.

**Solution:** Use refs and event-driven communication.

```tsx
// GameContainer.tsx pattern
const gameRef = useRef<Phaser.Game | null>(null);
const raceSceneRef = useRef<RaceScene | null>(null);

useEffect(() => {
  const game = createPhaserGame(containerRef.current, width, height);
  gameRef.current = game;

  // Listen for Phaser events
  game.events.on('gameState', (state) => {
    setHudState(state); // Update React state
  });

  // Cleanup is critical
  return () => {
    destroyPhaserGame(gameRef.current);
  };
}, []);
```

**Key Lessons:**
1. Never store Phaser objects in React state - use refs
2. Create factory functions that return game instances
3. Use Phaser's event system to communicate state changes
4. Always clean up intervals/timeouts in useEffect return

---

## Pattern 2: Accessibility-First Game UI

**Problem:** Games often have poor accessibility, alienating users with different abilities or technical backgrounds.

**Solution:** Design for the "70-year-old immigrant father" persona.

### Language Guidelines:
- "Race Against Computer" not "Head-to-Head Mode"
- "Practice Mode" not "Time Trial"
- "BEGINNER" not "EASY"
- "Choose a Track" not "Select Track"
- "Click the button above" not "Press Enter or click to continue"

### Visual Guidelines:
- Minimum 16px font size for body text
- High contrast: text-white/70 minimum on dark backgrounds
- Large touch targets: 100px minimum for mobile controls
- Clear visual hierarchy with spacing

### Component Patterns:
```tsx
// Always include ARIA attributes
<div
  role="button"
  aria-label={`Select ${title} mode. ${description}`}
  aria-pressed={isSelected}
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }}
>

// Progress indicators need proper labeling
<div
  role="progressbar"
  aria-label={`Checkpoints: ${hitCount} of ${total}`}
  aria-valuenow={hitCount}
  aria-valuemin={0}
  aria-valuemax={total}
>
```

---

## Pattern 3: localStorage Robustness

**Problem:** localStorage fails silently in private browsing or when quota exceeded.

**Solution:** Always wrap in try/catch and validate:

```typescript
const getBestTime = (trackId: string, mode: string): number | null => {
  try {
    const key = `best_${trackId}_${mode}`;
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return isNaN(parsed) ? null : parsed;
  } catch {
    // localStorage unavailable in private browsing
    return null;
  }
};
```

---

## Pattern 4: Preventing React Double-Execution Bugs

**Problem:** React Strict Mode and Fast Refresh can cause effects to run twice, creating duplicate entries.

**Solution:** Use refs to track if side effects have already executed:

```tsx
const entryAddedRef = useRef(false);

useEffect(() => {
  if (entryAddedRef.current) return;
  entryAddedRef.current = true;

  addEntry({ /* ... */ });
}, [addEntry, data]);
```

---

## Pattern 5: Proper Timer Cleanup

**Problem:** Memory leaks from orphaned intervals/timeouts when components unmount.

**Solution:** Track all timers and clean up:

```tsx
useEffect(() => {
  let checkInterval: ReturnType<typeof setInterval> | null = null;
  let safetyTimeout: ReturnType<typeof setTimeout> | null = null;

  checkInterval = setInterval(() => { /* ... */ }, 100);
  safetyTimeout = setTimeout(() => {
    if (checkInterval) clearInterval(checkInterval);
  }, 5000);

  return () => {
    if (checkInterval) clearInterval(checkInterval);
    if (safetyTimeout) clearTimeout(safetyTimeout);
  };
}, []);
```

---

## Pattern 6: Multi-Agent Team Management

**Problem:** Multiple agents working on the same codebase can conflict or duplicate work.

**Solution:** Clear role separation and shared knowledge base.

### Team Structure:
| Role | Responsibility | Deliverables |
|------|----------------|--------------|
| Game Engine Lead | Physics, collision, tracks, AI | src/game/** |
| UI/UX Lead | Components, styling, accessibility | src/components/** |
| QA Lead | Testing, integration, bug fixes | src/tests/** |
| Innovation Lead | Research, stretch goals | Documentation |
| Release Lead | Git, deployment, documentation | README, commits |

### Shared Knowledge Pattern:
Maintain a `TEAM_KNOWLEDGE.md` file with:
1. Session logs with date, task, findings
2. Key decisions and rationale
3. Patterns discovered
4. Lessons learned

Example entry:
```markdown
### Session: [Team Name] (Date)
**Task:** What was being done
**Findings:** What was discovered
**Decision:** What was decided and why
**Files Changed:** List of modified files
```

---

## Pattern 7: Tailwind CSS v4 Configuration

**Problem:** Tailwind v4 changed from JS config to CSS-first configuration.

**Solution:** Use `@theme` directive in CSS:

```css
/* index.css */
@import "tailwindcss";

@theme {
  --color-dark-500: #0a0a0f;
  --color-human: #4CAF50;
  --color-ai: #2196F3;
  --font-family-sans: 'Inter', system-ui, sans-serif;
}
```

---

## Pattern 8: Empty Array Edge Cases

**Problem:** Functions like `Math.min(...[])` return `Infinity`, causing bugs.

**Solution:** Always check array length before operations:

```typescript
const bestLapIndex = result.lapTimes.length > 0
  ? result.lapTimes.indexOf(Math.min(...result.lapTimes))
  : -1;
```

---

## Anti-Patterns to Avoid

1. **Don't** store Phaser objects in React state
2. **Don't** use `substr()` - use `substring()` (deprecated API)
3. **Don't** assume localStorage is available
4. **Don't** use inline event handlers in game loops
5. **Don't** forget to clean up intervals/timeouts
6. **Don't** use technical jargon in user-facing text

---

## Quick Reference: File Structure

```
v2/
├── src/
│   ├── components/       # React UI (JSX only, no game logic)
│   ├── game/            # Phaser code (no React imports)
│   │   ├── objects/     # Game entities (Car, etc.)
│   │   ├── scenes/      # Phaser scenes
│   │   └── systems/     # Reusable systems (AI, Collision, Scoring)
│   ├── hooks/           # Custom hooks (useLeaderboard, etc.)
│   └── types/           # Shared TypeScript interfaces
└── TEAM_KNOWLEDGE.md    # Organizational memory
```
