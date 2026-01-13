/**
 * Integration Tests for Shadow Driver v2
 *
 * These tests validate the complete game flow works end-to-end.
 *
 * Test Categories:
 * 1. Main Menu Integration - Menu loads and mode selection works
 * 2. Track Selection Integration - Track selection flow works
 * 3. Game Flow Integration - Game starts, runs, and completes
 * 4. Results Screen Integration - Results display correctly
 * 5. Navigation Integration - Full navigation flow works
 *
 * Note: These tests mock Phaser since jsdom doesn't support canvas.
 * For full E2E testing with real Phaser, use Playwright (documented below).
 *
 * PLAYWRIGHT SETUP (for future E2E testing):
 * ```bash
 * npm install -D @playwright/test
 * npx playwright install
 * ```
 *
 * PLAYWRIGHT TEST EXAMPLE:
 * ```typescript
 * import { test, expect } from '@playwright/test';
 *
 * test('full game flow', async ({ page }) => {
 *   await page.goto('http://localhost:5173');
 *   await expect(page.locator('h1')).toContainText('Shadow');
 *
 *   // Select Head to Head mode
 *   await page.click('text=Head to Head');
 *   await expect(page.locator('text=SELECT YOUR TRACK')).toBeVisible();
 *
 *   // Select Sunset Speedway track
 *   await page.click('text=Sunset Speedway');
 *   await page.click('text=Start Race');
 *
 *   // Wait for countdown to complete (3 seconds + GO)
 *   await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });
 *
 *   // Game should be running - verify HUD elements
 *   await expect(page.locator('text=Lap')).toBeVisible({ timeout: 5000 });
 * });
 * ```
 *
 * CROSS-BROWSER TESTING CHECKLIST:
 * - Chrome (primary target)
 *   - [ ] Main menu loads correctly
 *   - [ ] Animations render smoothly
 *   - [ ] Game canvas displays properly
 *   - [ ] Touch events work (DevTools mobile simulation)
 *
 * - Safari
 *   - [ ] Backdrop-blur effects render
 *   - [ ] CSS gradients display correctly
 *   - [ ] Audio plays after user interaction
 *   - [ ] No console errors
 *
 * - Firefox
 *   - [ ] Canvas rendering works
 *   - [ ] Keyboard input responsive
 *   - [ ] LocalStorage persists leaderboard
 *
 * MOBILE TESTING CHECKLIST:
 * - Touch Controls
 *   - [ ] Virtual joystick renders on mobile devices
 *   - [ ] Joystick responds to touch input
 *   - [ ] Brake button works
 *   - [ ] Controls positioned in safe area
 *
 * - Orientation
 *   - [ ] Landscape mode displays correctly
 *   - [ ] Portrait mode shows rotation prompt (if implemented)
 *   - [ ] Game canvas scales appropriately
 *
 * - Performance
 *   - [ ] 30+ FPS on mid-range mobile devices
 *   - [ ] No major stuttering during gameplay
 *   - [ ] Memory usage stays reasonable
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock Phaser before any imports that use it
jest.unstable_mockModule('phaser', () => ({
  default: {
    Game: jest.fn().mockImplementation(() => ({
      events: {
        on: jest.fn(),
        off: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      },
      scene: {
        getScene: jest.fn().mockReturnValue(null),
      },
      destroy: jest.fn(),
    })),
    AUTO: 'auto',
    Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
    Physics: { ARCADE: 'ARCADE' },
    Scene: class MockScene {
      events = {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
      };
    },
  },
  Game: jest.fn(),
  AUTO: 'auto',
  Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
  Physics: { ARCADE: 'ARCADE' },
  Scene: class MockScene {},
}));

// Mock GameContainer to avoid Phaser initialization
jest.unstable_mockModule('../components/game/GameContainer', () => ({
  GameContainer: ({
    width,
    height,
    trackId,
    mode,
    onRaceComplete,
  }: {
    width: number;
    height: number;
    trackId: string;
    mode: string;
    onRaceComplete?: (result: unknown) => void;
  }) => (
    <div data-testid="game-container" style={{ width, height }}>
      <div data-testid="track-id">{trackId}</div>
      <div data-testid="game-mode">{mode}</div>
      <button
        data-testid="simulate-race-complete"
        onClick={() =>
          onRaceComplete?.({
            playerResult: {
              totalTime: 45000,
              lapTimes: [15000, 15000, 15000],
              crashes: 0,
              crashPenalty: 0,
              perfectLaps: 3,
              perfectBonus: 6000,
              playerName: 'Player',
            },
            winner: 'player',
          })
        }
      >
        Simulate Race Complete
      </button>
    </div>
  ),
}));

// Import App after mocks
const { default: App } = await import('../App');

describe('Integration Tests: Main Menu', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders main menu on initial load', () => {
    render(<App />);

    // Check for title elements
    expect(screen.getByText(/shadow/i)).toBeInTheDocument();
    expect(screen.getByText(/driver/i)).toBeInTheDocument();
  });

  it('displays game mode options', () => {
    render(<App />);

    expect(screen.getByText(/head to head/i)).toBeInTheDocument();
    expect(screen.getByText(/time trial/i)).toBeInTheDocument();
  });

  it('shows mode descriptions', () => {
    render(<App />);

    expect(screen.getByText(/race against the ai/i)).toBeInTheDocument();
    expect(screen.getByText(/set your best lap time/i)).toBeInTheDocument();
  });

  it('displays feature lists for each mode', () => {
    render(<App />);

    expect(screen.getByText(/real-time competition/i)).toBeInTheDocument();
    expect(screen.getByText(/personal best tracking/i)).toBeInTheDocument();
  });
});

describe('Integration Tests: Mode Selection', () => {
  afterEach(() => {
    cleanup();
  });

  it('head-to-head mode navigates to track selection', () => {
    render(<App />);

    fireEvent.click(screen.getByText(/head to head/i));

    expect(screen.getByText(/select your track/i)).toBeInTheDocument();
    expect(screen.getByText(/mode:/i)).toBeInTheDocument();
  });

  it('time-trial mode navigates to track selection', () => {
    render(<App />);

    fireEvent.click(screen.getByText(/time trial/i));

    expect(screen.getByText(/select your track/i)).toBeInTheDocument();
  });

  it('shows correct mode label in track selection', () => {
    render(<App />);

    fireEvent.click(screen.getByText(/head to head/i));

    // Look for mode badge in track selection
    const modeBadge = screen.getByText(/head to head/i);
    expect(modeBadge).toBeInTheDocument();
  });
});

describe('Integration Tests: Track Selection', () => {
  afterEach(() => {
    cleanup();
  });

  it('displays all three tracks', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/head to head/i));

    expect(screen.getByText(/sunset speedway/i)).toBeInTheDocument();
    expect(screen.getByText(/mountain pass/i)).toBeInTheDocument();
    expect(screen.getByText(/nightmare circuit/i)).toBeInTheDocument();
  });

  it('shows difficulty badges for each track', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/head to head/i));

    expect(screen.getByText('EASY')).toBeInTheDocument();
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('HARD')).toBeInTheDocument();
  });

  it('shows par and gold times for tracks', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/head to head/i));

    // Check for time labels
    const parTimeLabels = screen.getAllByText(/par time/i);
    const goldTimeLabels = screen.getAllByText(/gold time/i);

    expect(parTimeLabels.length).toBe(3);
    expect(goldTimeLabels.length).toBe(3);
  });

  it('shows Start Race button only after track selection', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/head to head/i));

    // Start button should not be visible before selection
    expect(screen.queryByText(/start race/i)).not.toBeInTheDocument();

    // Select a track
    fireEvent.click(screen.getByText(/sunset speedway/i));

    // Now Start Race should appear
    expect(screen.getByText(/start race/i)).toBeInTheDocument();
  });

  it('navigates back to main menu', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/head to head/i));

    // Click back button
    fireEvent.click(screen.getByText(/back to mode select/i));

    // Should be back on main menu
    expect(screen.queryByText(/select your track/i)).not.toBeInTheDocument();
    expect(screen.getByText(/head to head/i)).toBeInTheDocument();
  });
});

describe('Integration Tests: Game Start', () => {
  afterEach(() => {
    cleanup();
  });

  it('starts game with selected track and mode', () => {
    render(<App />);

    // Navigate to game
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));

    // Game container should be visible
    expect(screen.getByTestId('game-container')).toBeInTheDocument();

    // Check track ID is passed correctly (easy is the file ID for sunset-speedway)
    expect(screen.getByTestId('track-id').textContent).toBe('easy');

    // Check mode is passed correctly
    expect(screen.getByTestId('game-mode').textContent).toBe('head-to-head');
  });

  it('starts time trial mode correctly', () => {
    render(<App />);

    // Navigate to time trial
    fireEvent.click(screen.getByText(/time trial/i));
    fireEvent.click(screen.getByText(/mountain pass/i));
    fireEvent.click(screen.getByText(/start race/i));

    // Check mode is time-trial
    expect(screen.getByTestId('game-mode').textContent).toBe('time-trial');

    // Check track ID is medium
    expect(screen.getByTestId('track-id').textContent).toBe('medium');
  });

  it('shows exit race button during game', () => {
    render(<App />);

    // Navigate to game
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));

    // Exit button should be visible
    expect(screen.getByText(/exit race/i)).toBeInTheDocument();
  });

  it('shows game mode indicator during game', () => {
    render(<App />);

    // Navigate to game
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));

    // Mode indicator should show
    expect(screen.getByText(/mode:/i)).toBeInTheDocument();
    expect(screen.getByText(/track:/i)).toBeInTheDocument();
  });

  it('can exit race back to main menu', () => {
    render(<App />);

    // Navigate to game
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));

    // Exit race
    fireEvent.click(screen.getByText(/exit race/i));

    // Should be back at main menu
    expect(screen.queryByTestId('game-container')).not.toBeInTheDocument();
    expect(screen.getByText(/head to head/i)).toBeInTheDocument();
  });
});

describe('Integration Tests: Results Screen', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows results screen after race completes', () => {
    render(<App />);

    // Navigate to game and simulate race completion
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));

    // Simulate race completion
    fireEvent.click(screen.getByTestId('simulate-race-complete'));

    // Results screen should appear
    expect(screen.getByText(/race complete|winner/i)).toBeInTheDocument();
  });

  it('shows race again and main menu buttons', () => {
    render(<App />);

    // Navigate to game and complete race
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));
    fireEvent.click(screen.getByTestId('simulate-race-complete'));

    // Action buttons should be visible
    expect(screen.getByText(/race again/i)).toBeInTheDocument();
    expect(screen.getByText(/main menu/i)).toBeInTheDocument();
  });

  it('play again returns to same track', () => {
    render(<App />);

    // Navigate to game and complete race
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));
    fireEvent.click(screen.getByTestId('simulate-race-complete'));

    // Click race again
    fireEvent.click(screen.getByText(/race again/i));

    // Should be back in game with same track
    expect(screen.getByTestId('game-container')).toBeInTheDocument();
    expect(screen.getByTestId('track-id').textContent).toBe('easy');
  });

  it('main menu button returns to main menu', () => {
    render(<App />);

    // Navigate to game and complete race
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));
    fireEvent.click(screen.getByTestId('simulate-race-complete'));

    // Click main menu
    fireEvent.click(screen.getByText(/main menu/i));

    // Should be at main menu
    expect(screen.queryByTestId('game-container')).not.toBeInTheDocument();
    expect(screen.getByText(/head to head/i)).toBeInTheDocument();
  });
});

describe('Integration Tests: Full Navigation Flow', () => {
  afterEach(() => {
    cleanup();
  });

  it('complete head-to-head flow: menu -> track -> game -> results -> menu', () => {
    render(<App />);

    // 1. Main Menu
    expect(screen.getByText(/head to head/i)).toBeInTheDocument();

    // 2. Select mode
    fireEvent.click(screen.getByText(/head to head/i));
    expect(screen.getByText(/select your track/i)).toBeInTheDocument();

    // 3. Select track
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));
    expect(screen.getByTestId('game-container')).toBeInTheDocument();

    // 4. Complete race
    fireEvent.click(screen.getByTestId('simulate-race-complete'));
    expect(screen.getByText(/race again/i)).toBeInTheDocument();

    // 5. Return to menu
    fireEvent.click(screen.getByText(/main menu/i));
    expect(screen.getByText(/head to head/i)).toBeInTheDocument();
  });

  it('complete time-trial flow: menu -> track -> game -> results -> play again -> results -> menu', () => {
    render(<App />);

    // Select time trial
    fireEvent.click(screen.getByText(/time trial/i));
    fireEvent.click(screen.getByText(/nightmare circuit/i));
    fireEvent.click(screen.getByText(/start race/i));

    // First race
    fireEvent.click(screen.getByTestId('simulate-race-complete'));
    expect(screen.getByText(/race again/i)).toBeInTheDocument();

    // Play again
    fireEvent.click(screen.getByText(/race again/i));
    expect(screen.getByTestId('game-container')).toBeInTheDocument();
    expect(screen.getByTestId('track-id').textContent).toBe('hard');

    // Second race
    fireEvent.click(screen.getByTestId('simulate-race-complete'));

    // Return to menu
    fireEvent.click(screen.getByText(/main menu/i));
    expect(screen.getByText(/time trial/i)).toBeInTheDocument();
  });

  it('switching modes mid-session works correctly', () => {
    render(<App />);

    // Start with head-to-head
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/back to mode select/i));

    // Switch to time trial
    fireEvent.click(screen.getByText(/time trial/i));
    fireEvent.click(screen.getByText(/mountain pass/i));
    fireEvent.click(screen.getByText(/start race/i));

    // Verify time-trial mode
    expect(screen.getByTestId('game-mode').textContent).toBe('time-trial');
  });
});

describe('Integration Tests: Layout Behavior', () => {
  afterEach(() => {
    cleanup();
  });

  it('header is visible on main menu', () => {
    render(<App />);

    expect(screen.getByText('Shadow Driver')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('header is visible on track selection', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/head to head/i));

    expect(screen.getByText('Shadow Driver')).toBeInTheDocument();
  });

  it('header is hidden during game', () => {
    render(<App />);
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));

    // The header should not be in the document during game
    // The title in header shouldn't be visible (the game indicator is different)
    const banners = screen.queryAllByRole('banner');
    // During game, layout should hide header so banner count should be 0
    expect(banners.length).toBe(0);
  });
});

describe('Integration Tests: Track Configuration', () => {
  afterEach(() => {
    cleanup();
  });

  it('each track has correct file ID mapping', () => {
    render(<App />);

    // Test sunset-speedway -> easy
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/sunset speedway/i));
    fireEvent.click(screen.getByText(/start race/i));
    expect(screen.getByTestId('track-id').textContent).toBe('easy');

    // Go back and test mountain-pass -> medium
    fireEvent.click(screen.getByText(/exit race/i));
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/mountain pass/i));
    fireEvent.click(screen.getByText(/start race/i));
    expect(screen.getByTestId('track-id').textContent).toBe('medium');

    // Go back and test nightmare-circuit -> hard
    fireEvent.click(screen.getByText(/exit race/i));
    fireEvent.click(screen.getByText(/head to head/i));
    fireEvent.click(screen.getByText(/nightmare circuit/i));
    fireEvent.click(screen.getByText(/start race/i));
    expect(screen.getByTestId('track-id').textContent).toBe('hard');
  });
});

/**
 * MANUAL TESTING CHECKLIST
 *
 * These scenarios should be tested manually since they require real browser behavior:
 *
 * 1. Countdown Overlay Animation
 *    - [ ] Numbers 3, 2, 1 animate with scale effect
 *    - [ ] Colors change (red -> yellow -> green)
 *    - [ ] "GO!" shows with explosion effect
 *    - [ ] Overlay disappears after countdown
 *
 * 2. Game HUD During Race
 *    - [ ] Speed updates smoothly
 *    - [ ] Lap counter increments
 *    - [ ] Timer counts up
 *    - [ ] Checkpoint dots fill in
 *    - [ ] Position indicator shows (head-to-head)
 *    - [ ] Penalty flash appears on collision
 *
 * 3. Audio Feedback
 *    - [ ] Countdown beeps play
 *    - [ ] Engine sound varies with speed
 *    - [ ] Collision sounds play
 *    - [ ] Checkpoint sounds play
 *    - [ ] Lap complete sound plays
 *
 * 4. Car Physics
 *    - [ ] Car accelerates with throttle
 *    - [ ] Car brakes correctly
 *    - [ ] Steering is speed-proportional
 *    - [ ] Collision detection works
 *    - [ ] Damage slowdown applies
 *
 * 5. AI Behavior
 *    - [ ] AI follows track
 *    - [ ] AI avoids obstacles
 *    - [ ] Difficulty affects AI performance
 *
 * 6. Leaderboard Persistence
 *    - [ ] Times are saved to localStorage
 *    - [ ] Personal best is tracked
 *    - [ ] NEW! indicator shows for records
 */
