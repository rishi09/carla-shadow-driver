/**
 * Jest Setup File
 *
 * This file runs before each test file and sets up the testing environment.
 * It imports jest-dom for extended DOM matchers like toBeInTheDocument().
 */

import '@testing-library/jest-dom';
import { jest } from '@jest/globals';

// Mock window.matchMedia for components that use media queries
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock ResizeObserver for components that need it
class MockResizeObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}
window.ResizeObserver = MockResizeObserver;
