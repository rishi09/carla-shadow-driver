/**
 * Example test to verify Jest + React Testing Library setup works correctly.
 *
 * This file demonstrates:
 * - Component rendering with RTL
 * - User interaction testing
 * - jest-dom matchers (toBeInTheDocument, etc.)
 * - Mocking Phaser-dependent components
 */

import { render, screen, fireEvent } from '@testing-library/react';
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

    // Check for game mode buttons
    expect(screen.getByText(/head to head/i)).toBeInTheDocument();
    expect(screen.getByText(/time trial/i)).toBeInTheDocument();
  });
});

describe('Game Mode Selection', () => {
  it('navigates to game when head-to-head is selected', () => {
    render(<App />);

    // Find and click the head-to-head button
    const headToHeadButton = screen.getByText(/head to head/i);
    fireEvent.click(headToHeadButton);

    // Game container should now be visible
    expect(screen.getByTestId('game-container')).toBeInTheDocument();
  });

  it('shows back button when in game view', () => {
    render(<App />);

    // Navigate to game
    const headToHeadButton = screen.getByText(/head to head/i);
    fireEvent.click(headToHeadButton);

    // Check for back button
    expect(screen.getByText(/back to menu/i)).toBeInTheDocument();
  });

  it('can navigate back to menu from game', () => {
    render(<App />);

    // Navigate to game
    const headToHeadButton = screen.getByText(/head to head/i);
    fireEvent.click(headToHeadButton);

    // Click back button
    const backButton = screen.getByText(/back to menu/i);
    fireEvent.click(backButton);

    // Should be back on menu
    expect(screen.getByText(/head to head/i)).toBeInTheDocument();
    expect(screen.queryByTestId('game-container')).not.toBeInTheDocument();
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
