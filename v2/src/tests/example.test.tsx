/**
 * Example test to verify Jest + React Testing Library setup works correctly.
 *
 * This file demonstrates:
 * - Component rendering with RTL
 * - User interaction testing
 * - jest-dom matchers (toBeInTheDocument, etc.)
 * - Mocking Phaser-dependent components
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { jest } from '@jest/globals';

// Mock Phaser entirely - it requires canvas which jsdom doesn't support
jest.unstable_mockModule('phaser', () => ({
  default: {
    Game: jest.fn(),
    AUTO: 'auto',
    Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
    Physics: { ARCADE: 'ARCADE' },
    Scene: class MockScene {},
  },
  Game: jest.fn(),
  AUTO: 'auto',
  Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
  Physics: { ARCADE: 'ARCADE' },
  Scene: class MockScene {},
}));

// Mock the GameContainer since it depends on Phaser
jest.unstable_mockModule('../components/game/GameContainer', () => ({
  GameContainer: ({ width, height }: { width: number; height: number }) => (
    <div data-testid="game-container" style={{ width, height }}>
      Game Container Mock
    </div>
  ),
}));

// Import App after mocks are set up (ESM requires dynamic import after mocking)
const { default: App } = await import('../App');

describe('App Component', () => {
  it('renders the main menu by default', () => {
    render(<App />);

    // Check for menu elements - use getAllBy since there may be multiple headings
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.length).toBeGreaterThan(0);
  });

  it('displays the application title in header', () => {
    render(<App />);

    expect(screen.getByText('Shadow Driver')).toBeInTheDocument();
  });

  it('shows game mode options in menu', () => {
    render(<App />);

    // Check for game mode buttons (updated text from MainMenu)
    expect(screen.getByText(/race against computer/i)).toBeInTheDocument();
    expect(screen.getByText(/practice mode/i)).toBeInTheDocument();
  });
});

describe('Game Mode Selection', () => {
  it('navigates to track selection when head-to-head is selected', async () => {
    render(<App />);

    // The ModeCard has role="button" with aria-label containing the mode name
    // Find and click the mode card directly
    const modeCard = screen.getByRole('button', { name: /race against computer/i });
    await act(async () => {
      fireEvent.click(modeCard);
    });

    // Should now show track selection screen
    expect(screen.getByText(/select your track/i)).toBeInTheDocument();
  });

  it('shows back button in track selection view', async () => {
    render(<App />);

    // Click the mode card
    const modeCard = screen.getByRole('button', { name: /race against computer/i });
    await act(async () => {
      fireEvent.click(modeCard);
    });

    // Check for back button
    expect(screen.getByText(/back to mode select/i)).toBeInTheDocument();
  });

  it('can navigate back to menu from track selection', async () => {
    render(<App />);

    // Navigate to track selection
    const modeCard = screen.getByRole('button', { name: /race against computer/i });
    await act(async () => {
      fireEvent.click(modeCard);
    });

    // Click back button
    const backButton = screen.getByText(/back to mode select/i);
    await act(async () => {
      fireEvent.click(backButton);
    });

    // Should be back on menu
    expect(screen.getByText(/race against computer/i)).toBeInTheDocument();
    expect(screen.queryByText(/select your track/i)).not.toBeInTheDocument();
  });

  it('navigates to game when track is selected', async () => {
    render(<App />);

    // Navigate to track selection
    const modeCard = screen.getByRole('button', { name: /race against computer/i });
    await act(async () => {
      fireEvent.click(modeCard);
    });

    // Select a track
    const trackCard = screen.getByText(/sunset speedway/i);
    await act(async () => {
      fireEvent.click(trackCard);
    });

    // Click start race button
    const startButton = screen.getByText(/start race/i);
    await act(async () => {
      fireEvent.click(startButton);
    });

    // Game container should now be visible
    expect(screen.getByTestId('game-container')).toBeInTheDocument();
  });
});

describe('Testing Setup Verification', () => {
  it('jest-dom matchers work correctly', () => {
    render(<App />);

    const title = screen.getByText('Shadow Driver');
    expect(title).toBeInTheDocument();
    expect(title).toBeVisible();
  });

  it('can query by text content with regex', () => {
    render(<App />);

    // Using getAllByText since the title appears in multiple places
    const matches = screen.getAllByText(/shadow.*driver/i);
    expect(matches.length).toBeGreaterThan(0);
  });
});
