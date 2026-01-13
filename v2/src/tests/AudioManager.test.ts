/**
 * AudioManager Tests
 *
 * Tests for the procedural audio system.
 * Web Audio API is mocked since jsdom doesn't support it.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { AudioManager, AUDIO_CONSTANTS } from '../game/systems/AudioManager';

// Mock Phaser scene
const createMockScene = () => ({
  sound: {
    context: null,
  },
  events: {
    on: jest.fn(),
    off: jest.fn(),
  },
});

// Mock AudioContext
const createMockAudioContext = () => {
  const mockGainNode = {
    gain: {
      value: 1,
      setValueAtTime: jest.fn(),
      linearRampToValueAtTime: jest.fn(),
      exponentialRampToValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
  };

  const mockOscillator = {
    type: 'sine',
    frequency: {
      value: 440,
      setValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  };

  const mockFilter = {
    type: 'lowpass',
    frequency: { value: 0 },
    Q: { value: 0 },
    connect: jest.fn(),
  };

  const mockBufferSource = {
    buffer: null,
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  };

  const mockBuffer = {
    getChannelData: jest.fn(() => new Float32Array(1000)),
  };

  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createGain: jest.fn(() => mockGainNode),
    createOscillator: jest.fn(() => mockOscillator),
    createBiquadFilter: jest.fn(() => mockFilter),
    createBufferSource: jest.fn(() => mockBufferSource),
    createBuffer: jest.fn(() => mockBuffer),
    resume: jest.fn(() => Promise.resolve()),
    close: jest.fn(),
  };
};

// Store original AudioContext
const originalAudioContext = (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext;

describe('AudioManager', () => {
  let audioManager: AudioManager;
  let mockScene: ReturnType<typeof createMockScene>;
  let mockAudioContext: ReturnType<typeof createMockAudioContext>;

  beforeEach(() => {
    // Reset mocks
    mockScene = createMockScene();
    mockAudioContext = createMockAudioContext();

    // Mock global AudioContext
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = jest.fn(
      () => mockAudioContext
    );

    audioManager = new AudioManager(mockScene as unknown as Phaser.Scene);
  });

  afterEach(() => {
    // Restore original AudioContext
    (globalThis as unknown as { AudioContext: unknown }).AudioContext =
      originalAudioContext;
  });

  describe('constructor', () => {
    it('should create an AudioManager instance', () => {
      expect(audioManager).toBeInstanceOf(AudioManager);
    });

    it('should be enabled by default', () => {
      expect(audioManager.isEnabled()).toBe(true);
    });

    it('should have default volume of 1.0', () => {
      expect(audioManager.getVolume()).toBe(1.0);
    });
  });

  describe('preload', () => {
    it('should exist for API consistency', () => {
      expect(() => audioManager.preload()).not.toThrow();
    });
  });

  describe('create', () => {
    it('should initialize audio context', () => {
      audioManager.create();
      expect((globalThis as unknown as { AudioContext: jest.Mock }).AudioContext).toHaveBeenCalled();
    });

    it('should register scene event listeners', () => {
      audioManager.create();
      expect(mockScene.events.on).toHaveBeenCalledWith(
        'shutdown',
        expect.any(Function),
        audioManager
      );
      expect(mockScene.events.on).toHaveBeenCalledWith(
        'destroy',
        expect.any(Function),
        audioManager
      );
    });
  });

  describe('setEnabled', () => {
    beforeEach(() => {
      audioManager.create();
    });

    it('should enable audio', () => {
      audioManager.setEnabled(false);
      audioManager.setEnabled(true);
      expect(audioManager.isEnabled()).toBe(true);
    });

    it('should disable audio', () => {
      audioManager.setEnabled(false);
      expect(audioManager.isEnabled()).toBe(false);
    });

    it('should stop engine when disabled', () => {
      // Start engine first
      audioManager.playEngine(100);

      // Disable should stop engine
      audioManager.setEnabled(false);
      // Engine should be stopped (no error thrown)
      expect(audioManager.isEnabled()).toBe(false);
    });
  });

  describe('setVolume', () => {
    beforeEach(() => {
      audioManager.create();
    });

    it('should set volume to specified value', () => {
      audioManager.setVolume(0.5);
      expect(audioManager.getVolume()).toBe(0.5);
    });

    it('should clamp volume to 0 minimum', () => {
      audioManager.setVolume(-0.5);
      expect(audioManager.getVolume()).toBe(0);
    });

    it('should clamp volume to 1 maximum', () => {
      audioManager.setVolume(1.5);
      expect(audioManager.getVolume()).toBe(1);
    });
  });

  describe('toggle', () => {
    it('should toggle from enabled to disabled', () => {
      audioManager.create();
      expect(audioManager.isEnabled()).toBe(true);
      const result = audioManager.toggle();
      expect(result).toBe(false);
      expect(audioManager.isEnabled()).toBe(false);
    });

    it('should toggle from disabled to enabled', () => {
      audioManager.create();
      audioManager.setEnabled(false);
      const result = audioManager.toggle();
      expect(result).toBe(true);
      expect(audioManager.isEnabled()).toBe(true);
    });
  });

  describe('playEngine', () => {
    beforeEach(() => {
      audioManager.create();
    });

    it('should create engine oscillator', () => {
      audioManager.playEngine(100);
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should not play when disabled', () => {
      audioManager.setEnabled(false);
      mockAudioContext.createOscillator.mockClear();
      audioManager.playEngine(100);
      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });

    it('should reuse existing oscillator on subsequent calls', () => {
      audioManager.playEngine(100);
      const firstCallCount = mockAudioContext.createOscillator.mock.calls.length;
      audioManager.playEngine(150);
      expect(mockAudioContext.createOscillator.mock.calls.length).toBe(
        firstCallCount
      );
    });
  });

  describe('stopEngine', () => {
    beforeEach(() => {
      audioManager.create();
    });

    it('should stop engine without error when not running', () => {
      expect(() => audioManager.stopEngine()).not.toThrow();
    });

    it('should stop running engine', () => {
      audioManager.playEngine(100);
      expect(() => audioManager.stopEngine()).not.toThrow();
    });
  });

  describe('playCollision', () => {
    beforeEach(() => {
      audioManager.create();
    });

    it('should create noise buffer for collision sound', () => {
      audioManager.playCollision();
      expect(mockAudioContext.createBuffer).toHaveBeenCalled();
      expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
    });

    it('should not play when disabled', () => {
      audioManager.setEnabled(false);
      mockAudioContext.createBuffer.mockClear();
      audioManager.playCollision();
      expect(mockAudioContext.createBuffer).not.toHaveBeenCalled();
    });

    it('should respect cooldown between collisions', () => {
      audioManager.playCollision();
      const firstCallCount = mockAudioContext.createBuffer.mock.calls.length;

      // Immediate second call should be ignored due to cooldown
      audioManager.playCollision();
      expect(mockAudioContext.createBuffer.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('playCountdownBeep', () => {
    beforeEach(() => {
      audioManager.create();
    });

    it('should create oscillator for beep', () => {
      audioManager.playCountdownBeep();
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should not play when disabled', () => {
      audioManager.setEnabled(false);
      mockAudioContext.createOscillator.mockClear();
      audioManager.playCountdownBeep();
      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });
  });

  describe('playCountdownGo', () => {
    beforeEach(() => {
      audioManager.create();
    });

    it('should create oscillator for go sound', () => {
      audioManager.playCountdownGo();
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should not play when disabled', () => {
      audioManager.setEnabled(false);
      mockAudioContext.createOscillator.mockClear();
      audioManager.playCountdownGo();
      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });
  });

  describe('playCheckpoint', () => {
    beforeEach(() => {
      audioManager.create();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should create oscillator for checkpoint sound', () => {
      audioManager.playCheckpoint();
      // First note is scheduled with setTimeout, so we need to advance timers
      jest.advanceTimersByTime(10);
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should play multiple notes', () => {
      audioManager.playCheckpoint();
      mockAudioContext.createOscillator.mockClear();

      // Advance through all note timings
      jest.advanceTimersByTime(500);

      // Should have created additional oscillators for remaining notes
      expect(mockAudioContext.createOscillator.mock.calls.length).toBeGreaterThan(0);
    });

    it('should not play when disabled', () => {
      audioManager.setEnabled(false);
      mockAudioContext.createOscillator.mockClear();
      audioManager.playCheckpoint();
      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });
  });

  describe('playLapComplete', () => {
    beforeEach(() => {
      audioManager.create();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should create oscillator for lap complete sound', () => {
      audioManager.playLapComplete();
      // First note is scheduled with setTimeout, so we need to advance timers
      jest.advanceTimersByTime(10);
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should play multiple notes for melody', () => {
      audioManager.playLapComplete();
      mockAudioContext.createOscillator.mockClear();

      // Advance through all note timings
      jest.advanceTimersByTime(1000);

      // Should have created additional oscillators
      expect(mockAudioContext.createOscillator.mock.calls.length).toBeGreaterThan(0);
    });

    it('should not play when disabled', () => {
      audioManager.setEnabled(false);
      mockAudioContext.createOscillator.mockClear();
      audioManager.playLapComplete();
      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    beforeEach(() => {
      audioManager.create();
    });

    it('should stop engine on destroy', () => {
      audioManager.playEngine(100);
      expect(() => audioManager.destroy()).not.toThrow();
    });

    it('should remove event listeners', () => {
      audioManager.destroy();
      expect(mockScene.events.off).toHaveBeenCalledWith(
        'shutdown',
        expect.any(Function),
        audioManager
      );
      expect(mockScene.events.off).toHaveBeenCalledWith(
        'destroy',
        expect.any(Function),
        audioManager
      );
    });

    it('should handle multiple destroy calls gracefully', () => {
      audioManager.destroy();
      expect(() => audioManager.destroy()).not.toThrow();
    });
  });

  describe('AUDIO_CONSTANTS', () => {
    it('should have valid engine frequency range', () => {
      expect(AUDIO_CONSTANTS.ENGINE_MIN_FREQ).toBeLessThan(
        AUDIO_CONSTANTS.ENGINE_MAX_FREQ
      );
      expect(AUDIO_CONSTANTS.ENGINE_MIN_FREQ).toBeGreaterThan(0);
    });

    it('should have valid countdown frequencies', () => {
      expect(AUDIO_CONSTANTS.COUNTDOWN_BEEP_FREQ).toBe(440); // A4
      expect(AUDIO_CONSTANTS.COUNTDOWN_GO_FREQ).toBe(880); // A5 (octave higher)
    });

    it('should have valid checkpoint notes (C major arpeggio)', () => {
      expect(AUDIO_CONSTANTS.CHECKPOINT_NOTES.length).toBe(3);
      // Notes should be ascending
      for (let i = 1; i < AUDIO_CONSTANTS.CHECKPOINT_NOTES.length; i++) {
        expect(AUDIO_CONSTANTS.CHECKPOINT_NOTES[i]).toBeGreaterThan(
          AUDIO_CONSTANTS.CHECKPOINT_NOTES[i - 1]
        );
      }
    });

    it('should have valid lap complete notes', () => {
      expect(AUDIO_CONSTANTS.LAP_COMPLETE_NOTES.length).toBe(5);
    });

    it('should have reasonable volume levels (0-1 range)', () => {
      expect(AUDIO_CONSTANTS.ENGINE_VOLUME).toBeGreaterThan(0);
      expect(AUDIO_CONSTANTS.ENGINE_VOLUME).toBeLessThanOrEqual(1);
      expect(AUDIO_CONSTANTS.COLLISION_VOLUME).toBeGreaterThan(0);
      expect(AUDIO_CONSTANTS.COLLISION_VOLUME).toBeLessThanOrEqual(1);
      expect(AUDIO_CONSTANTS.COUNTDOWN_VOLUME).toBeGreaterThan(0);
      expect(AUDIO_CONSTANTS.COUNTDOWN_VOLUME).toBeLessThanOrEqual(1);
    });
  });
});
