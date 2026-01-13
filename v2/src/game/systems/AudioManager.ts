import Phaser from 'phaser';

/**
 * AudioManager - Procedural audio system for Shadow Driver v2
 *
 * Uses Web Audio API oscillators to generate game sounds without audio files:
 * - Engine: Variable frequency oscillator based on car speed
 * - Collision: White noise burst
 * - Countdown beep: 440 Hz tone
 * - Countdown go: 880 Hz tone (octave higher)
 * - Checkpoint: Quick ascending notes
 * - Lap complete: Short celebratory melody
 *
 * Integration:
 * ```typescript
 * // In RaceScene create()
 * this.audioManager = new AudioManager(this);
 * this.audioManager.create();
 *
 * // In update loop
 * this.audioManager.playEngine(this.player.getState().speed);
 *
 * // On collision
 * this.audioManager.playCollision();
 * ```
 */

/** Audio configuration constants */
export const AUDIO_CONSTANTS = {
  // Engine sound frequency range (Hz)
  ENGINE_MIN_FREQ: 80,
  ENGINE_MAX_FREQ: 350,
  ENGINE_VOLUME: 0.15,

  // Collision noise duration (ms)
  COLLISION_DURATION: 150,
  COLLISION_VOLUME: 0.3,

  // Countdown tones
  COUNTDOWN_BEEP_FREQ: 440,
  COUNTDOWN_GO_FREQ: 880,
  COUNTDOWN_DURATION: 200,
  COUNTDOWN_VOLUME: 0.25,

  // Checkpoint melody
  CHECKPOINT_NOTES: [523.25, 659.25, 783.99], // C5, E5, G5
  CHECKPOINT_NOTE_DURATION: 80,
  CHECKPOINT_VOLUME: 0.2,

  // Lap complete melody
  LAP_COMPLETE_NOTES: [523.25, 587.33, 659.25, 783.99, 880], // C5, D5, E5, G5, A5
  LAP_COMPLETE_NOTE_DURATION: 100,
  LAP_COMPLETE_VOLUME: 0.25,
} as const;

export class AudioManager {
  private scene: Phaser.Scene;
  private enabled: boolean = true;
  private volume: number = 1.0;

  // Web Audio context and nodes
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Engine sound state
  private engineOscillator: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private isEngineRunning: boolean = false;
  private targetEngineFreq: number = AUDIO_CONSTANTS.ENGINE_MIN_FREQ;
  private currentEngineFreq: number = AUDIO_CONSTANTS.ENGINE_MIN_FREQ;

  // Prevent sound spam
  private lastCollisionTime: number = 0;
  private collisionCooldown: number = 200; // ms

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Preload - called during BootScene preload
   * No actual files to load since we use Web Audio synthesis
   */
  preload(): void {
    // No audio files to load - using procedural audio
    // This method exists for API consistency
  }

  /**
   * Initialize Web Audio context after user interaction
   * Must be called in create() after a user gesture (click/touch)
   */
  create(): void {
    // Create audio context on first user interaction to comply with browser policies
    this.initAudioContext();

    // Listen for scene shutdown to clean up
    this.scene.events.on('shutdown', this.destroy, this);
    this.scene.events.on('destroy', this.destroy, this);
  }

  /**
   * Initialize Web Audio context and master gain
   */
  private initAudioContext(): void {
    try {
      // Try to use the existing Phaser audio context if available
      // Only WebAudioSoundManager has a context property
      const soundManager = this.scene.sound;
      const phaserAudioContext =
        'context' in soundManager
          ? (soundManager.context as AudioContext | undefined)
          : undefined;

      if (phaserAudioContext && phaserAudioContext.state !== 'closed') {
        this.audioContext = phaserAudioContext;
      } else {
        // Create new audio context
        this.audioContext = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)();
      }

      // Create master gain for volume control
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.audioContext.destination);
    } catch (error) {
      console.warn('AudioManager: Failed to initialize Web Audio context', error);
      this.enabled = false;
    }
  }

  /**
   * Resume audio context if suspended (required for some browsers)
   */
  private async resumeContext(): Promise<boolean> {
    if (!this.audioContext) return false;

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.warn('AudioManager: Failed to resume audio context', error);
        return false;
      }
    }

    return this.audioContext.state === 'running';
  }

  /**
   * Play engine sound with frequency based on speed
   * Call this every frame during racing
   *
   * @param speed - Current car speed (0 to maxSpeed, typically 0-220)
   */
  playEngine(speed: number): void {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;

    // Calculate target frequency based on speed
    // Map speed (0-220) to frequency range
    const normalizedSpeed = Math.min(Math.abs(speed) / 220, 1);
    this.targetEngineFreq =
      AUDIO_CONSTANTS.ENGINE_MIN_FREQ +
      normalizedSpeed *
        (AUDIO_CONSTANTS.ENGINE_MAX_FREQ - AUDIO_CONSTANTS.ENGINE_MIN_FREQ);

    // Start engine if not running
    if (!this.isEngineRunning) {
      this.startEngine();
    }

    // Smoothly interpolate frequency
    this.currentEngineFreq +=
      (this.targetEngineFreq - this.currentEngineFreq) * 0.1;

    if (this.engineOscillator) {
      this.engineOscillator.frequency.setValueAtTime(
        this.currentEngineFreq,
        this.audioContext.currentTime
      );
    }
  }

  /**
   * Start the engine oscillator
   */
  private startEngine(): void {
    if (!this.audioContext || !this.masterGain || this.isEngineRunning) return;

    try {
      // Create oscillator for engine drone
      this.engineOscillator = this.audioContext.createOscillator();
      this.engineOscillator.type = 'sawtooth'; // Rich harmonics for engine sound
      this.engineOscillator.frequency.value = this.currentEngineFreq;

      // Create gain for engine volume with some modulation
      this.engineGain = this.audioContext.createGain();
      this.engineGain.gain.value = AUDIO_CONSTANTS.ENGINE_VOLUME * this.volume;

      // Add slight low-pass filter for warmth
      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      filter.Q.value = 1;

      // Connect: oscillator -> filter -> gain -> master
      this.engineOscillator.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOscillator.start();
      this.isEngineRunning = true;
    } catch (error) {
      console.warn('AudioManager: Failed to start engine sound', error);
    }
  }

  /**
   * Stop the engine sound
   */
  stopEngine(): void {
    if (this.engineOscillator) {
      try {
        this.engineOscillator.stop();
        this.engineOscillator.disconnect();
      } catch {
        // Ignore errors from already stopped oscillator
      }
      this.engineOscillator = null;
    }

    if (this.engineGain) {
      this.engineGain.disconnect();
      this.engineGain = null;
    }

    this.isEngineRunning = false;
  }

  /**
   * Play collision sound effect (white noise burst)
   */
  playCollision(): void {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;

    // Prevent sound spam
    const now = Date.now();
    if (now - this.lastCollisionTime < this.collisionCooldown) return;
    this.lastCollisionTime = now;

    this.resumeContext();

    try {
      // Create noise buffer for crash sound
      const duration = AUDIO_CONSTANTS.COLLISION_DURATION / 1000;
      const sampleRate = this.audioContext.sampleRate;
      const bufferSize = Math.floor(sampleRate * duration);
      const buffer = this.audioContext.createBuffer(1, bufferSize, sampleRate);
      const data = buffer.getChannelData(0);

      // Fill with white noise
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      // Create buffer source
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;

      // Envelope for sharp attack and decay
      const gainNode = this.audioContext.createGain();
      const currentTime = this.audioContext.currentTime;
      gainNode.gain.setValueAtTime(
        AUDIO_CONSTANTS.COLLISION_VOLUME * this.volume,
        currentTime
      );
      gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + duration);

      // Low-pass filter for thump
      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1000;

      // Connect and play
      source.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.masterGain);
      source.start();
    } catch (error) {
      console.warn('AudioManager: Failed to play collision sound', error);
    }
  }

  /**
   * Play countdown beep (440 Hz tone)
   */
  playCountdownBeep(): void {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;

    this.resumeContext();
    this.playTone(
      AUDIO_CONSTANTS.COUNTDOWN_BEEP_FREQ,
      AUDIO_CONSTANTS.COUNTDOWN_DURATION,
      AUDIO_CONSTANTS.COUNTDOWN_VOLUME
    );
  }

  /**
   * Play countdown "GO!" sound (880 Hz tone, longer)
   */
  playCountdownGo(): void {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;

    this.resumeContext();
    this.playTone(
      AUDIO_CONSTANTS.COUNTDOWN_GO_FREQ,
      AUDIO_CONSTANTS.COUNTDOWN_DURATION * 1.5,
      AUDIO_CONSTANTS.COUNTDOWN_VOLUME * 1.2
    );
  }

  /**
   * Play checkpoint sound (quick ascending arpeggio)
   */
  playCheckpoint(): void {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;

    this.resumeContext();

    const notes = AUDIO_CONSTANTS.CHECKPOINT_NOTES;
    const duration = AUDIO_CONSTANTS.CHECKPOINT_NOTE_DURATION;
    const volume = AUDIO_CONSTANTS.CHECKPOINT_VOLUME;

    notes.forEach((freq, index) => {
      setTimeout(() => {
        this.playTone(freq, duration, volume);
      }, index * (duration * 0.7));
    });
  }

  /**
   * Play lap complete sound (celebratory melody)
   */
  playLapComplete(): void {
    if (!this.enabled || !this.audioContext || !this.masterGain) return;

    this.resumeContext();

    const notes = AUDIO_CONSTANTS.LAP_COMPLETE_NOTES;
    const duration = AUDIO_CONSTANTS.LAP_COMPLETE_NOTE_DURATION;
    const volume = AUDIO_CONSTANTS.LAP_COMPLETE_VOLUME;

    notes.forEach((freq, index) => {
      setTimeout(() => {
        this.playTone(freq, duration, volume);
      }, index * (duration * 0.8));
    });
  }

  /**
   * Play a simple tone at the given frequency
   */
  private playTone(frequency: number, durationMs: number, volume: number): void {
    if (!this.audioContext || !this.masterGain) return;

    try {
      const oscillator = this.audioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const gainNode = this.audioContext.createGain();
      const currentTime = this.audioContext.currentTime;
      const duration = durationMs / 1000;

      // Envelope: quick attack, sustain, quick release
      gainNode.gain.setValueAtTime(0, currentTime);
      gainNode.gain.linearRampToValueAtTime(
        volume * this.volume,
        currentTime + 0.01
      );
      gainNode.gain.setValueAtTime(volume * this.volume, currentTime + duration * 0.7);
      gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + duration);

      oscillator.connect(gainNode);
      gainNode.connect(this.masterGain);

      oscillator.start(currentTime);
      oscillator.stop(currentTime + duration);
    } catch (error) {
      console.warn('AudioManager: Failed to play tone', error);
    }
  }

  /**
   * Enable or disable all audio
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      this.stopEngine();
    }
  }

  /**
   * Check if audio is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set master volume (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));

    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
    }

    if (this.engineGain) {
      this.engineGain.gain.value = AUDIO_CONSTANTS.ENGINE_VOLUME * this.volume;
    }
  }

  /**
   * Get current volume level
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Toggle audio on/off
   */
  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /**
   * Clean up audio resources
   */
  destroy(): void {
    this.stopEngine();

    // Don't close the audio context if it's Phaser's shared context
    const soundManager = this.scene.sound;
    const phaserContext = 'context' in soundManager ? soundManager.context : undefined;
    if (
      this.audioContext &&
      this.audioContext !== phaserContext
    ) {
      try {
        this.audioContext.close();
      } catch {
        // Ignore errors from already closed context
      }
    }

    this.audioContext = null;
    this.masterGain = null;

    // Remove event listeners
    this.scene.events.off('shutdown', this.destroy, this);
    this.scene.events.off('destroy', this.destroy, this);
  }
}
