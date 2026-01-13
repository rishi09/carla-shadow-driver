# Testing Strategy for Shadow Driver v2

This document outlines our testing philosophy, tools, and practices for the Shadow Driver v2 game.

## Testing Philosophy

### What We Test

1. **Game Systems (High Priority)**
   - Collision detection logic
   - Scoring calculations
   - AI behavior and decision-making
   - Game state management
   - Input handling logic

2. **React Components (Medium Priority)**
   - UI components render correctly
   - User interactions work as expected
   - State changes reflect in the UI
   - Component props are handled correctly

3. **Utility Functions**
   - Pure functions and helpers
   - Data transformations
   - Configuration parsing

### What We Don't Test

1. **Phaser Internals**
   - Phaser is already well-tested
   - We mock Phaser in our tests
   - Focus on our game logic, not the engine

2. **CSS/Styling**
   - Visual regression testing is handled separately
   - We use identity-obj-proxy to mock CSS modules

3. **Third-party Libraries**
   - Trust that dependencies are tested
   - Focus on our integration with them

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Files

- Test files should be named `*.test.ts` or `*.test.tsx`
- Tests are located alongside the code they test or in `src/tests/`
- Setup file: `src/tests/setup.ts`

## Coverage Expectations

- **Target: 70%+ coverage** on game systems and business logic
- Focus on meaningful coverage, not just hitting lines
- Critical game systems (collision, scoring, AI) should aim for 90%+

### Coverage Thresholds

We track coverage for:
- Statements
- Branches
- Functions
- Lines

## Test Structure

### Naming Conventions

```typescript
describe('ComponentName', () => {
  describe('methodName', () => {
    it('should do something when condition', () => {
      // test
    });
  });
});
```

### Example Test

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('handles click events', () => {
    const onClick = jest.fn();
    render(<MyComponent onClick={onClick} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

## Mocking Phaser

Since Phaser requires canvas (which jsdom doesn't support), we mock Phaser in tests:

```typescript
import { jest } from '@jest/globals';

// Mock Phaser before importing components that use it
jest.unstable_mockModule('phaser', () => ({
  default: {
    Game: jest.fn(),
    AUTO: 'auto',
    Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
    Physics: { ARCADE: 'ARCADE' },
    Scene: class MockScene {},
  },
  // ... named exports
}));

// Dynamic import after mocking (required for ESM)
const { GameComponent } = await import('../GameComponent');
```

## E2E Testing Plan (Future)

We plan to add Playwright for end-to-end testing:

### Scope
- Full game flow testing
- Cross-browser compatibility
- Performance benchmarks

### Planned Test Scenarios
1. **Game Start Flow**
   - Load game
   - Start new game
   - Verify initial state

2. **Gameplay**
   - Player controls work
   - Collisions are detected
   - Score updates correctly
   - Game over conditions trigger

3. **UI Interactions**
   - Pause/resume functionality
   - Settings changes persist
   - High score display

### Implementation Timeline
- Phase 1: Core gameplay tests
- Phase 2: UI integration tests
- Phase 3: Performance testing

## Continuous Integration

Tests run automatically on:
- Push to `v2-game-overhaul` branch
- Pull requests to `main` or `v2-game-overhaul`

See `.github/workflows/test.yml` for CI configuration.

## Best Practices

1. **Write tests first** for complex logic (TDD when appropriate)
2. **Keep tests focused** - one assertion per test when possible
3. **Use descriptive names** - tests are documentation
4. **Don't test implementation** - test behavior and outcomes
5. **Mock at the boundary** - keep mocks minimal
6. **Clean up after tests** - use `afterEach` for cleanup

## Tools Reference

- **Jest**: Test runner and assertion library
- **React Testing Library**: Component testing utilities
- **jest-dom**: Extended DOM matchers
- **identity-obj-proxy**: CSS module mocking
- **ts-jest**: TypeScript support for Jest
