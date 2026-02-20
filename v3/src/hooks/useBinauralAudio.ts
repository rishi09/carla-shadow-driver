/**
 * useBinauralAudio.ts - 3D spatial audio for AI car positioning
 *
 * Uses Web Audio API's StereoPannerNode to pan the AI car's engine
 * sound based on relative position. Also uses gain to simulate
 * distance (louder when closer, quieter when far).
 *
 * Audio chain: OscillatorNode -> GainNode -> StereoPannerNode -> destination
 *
 * Pan is derived from the sine of the relative angle between the player's
 * heading and the direction to the AI car. Distance attenuates volume via
 * an inverse-linear model. A subtle Doppler effect shifts pitch when the
 * AI is approaching or receding.
 *
 * Wild Idea #38 from TODO.md
 */
import { useEffect, useRef, useCallback, useState } from 'react';

// --- Engine sound constants ---

/** Base engine frequency at idle (Hz) */
const BASE_FREQ = 80;
/** Maximum engine frequency (Hz) */
const MAX_FREQ = 300;
/** Frequency increase per km/h of AI speed */
const FREQ_PER_KMH = 0.5;

// --- Spatial constants ---

/** World units beyond which gain floors at MIN_GAIN */
const MAX_AUDIBLE_DISTANCE = 200;
/** Minimum gain so the AI is never fully inaudible */
const MIN_GAIN = 0.05;
/** Gain multiplier when AI is behind the player (muffled) */
const BEHIND_GAIN_PENALTY = 0.3;

// --- Doppler constants ---

/** Pitch multiplier when AI is approaching */
const DOPPLER_APPROACHING = 1.05;
/** Pitch multiplier when AI is receding */
const DOPPLER_RECEDING = 0.95;
/** Distance-change deadband: below this magnitude, no Doppler shift is applied */
const DOPPLER_DEADBAND = 0.5;

// --- Smoothing & volume ---

/** Time constant for setTargetAtTime transitions (seconds) */
const SMOOTH_TIME_CONSTANT = 0.1;
/** Master volume for the binaural AI engine layer */
const MASTER_VOLUME = 0.25;

// --- Types ---

interface BinauralNodes {
  ctx: AudioContext;
  oscillator: OscillatorNode;
  gainNode: GainNode;
  pannerNode: StereoPannerNode;
}

interface UseBinauralAudioOptions {
  /** Whether binaural audio is enabled */
  enabled: boolean;
  /** AI car world position */
  aiPosition: { x: number; y: number } | null;
  /** Player car world position */
  playerPosition: { x: number; y: number } | null;
  /** Player car heading in degrees (0 = north, 90 = east) */
  playerHeading: number;
  /** AI car speed in km/h, used for engine pitch */
  aiSpeed: number;
}

interface UseBinauralAudioReturn {
  /** Whether the binaural audio system is currently producing sound */
  isActive: boolean;
  /** Current pan value: -1 (full left) to +1 (full right) */
  panValue: number;
  /** Current distance-based gain: 0 to 1 */
  distanceGain: number;
  /** Tear down audio nodes (also called automatically on unmount) */
  cleanup: () => void;
}

// --- Helpers ---

/** Convert degrees to radians */
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Clamp a value between min and max */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// --- Hook ---

export function useBinauralAudio(options: UseBinauralAudioOptions): UseBinauralAudioReturn {
  const { enabled, aiPosition, playerPosition, playerHeading, aiSpeed } = options;

  const nodesRef = useRef<BinauralNodes | null>(null);
  const initializedRef = useRef(false);
  const prevDistRef = useRef<number | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [panValue, setPanValue] = useState(0);
  const [distanceGain, setDistanceGain] = useState(0);

  // --- Create AudioContext and audio chain lazily on first enable ---
  const initAudio = useCallback(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const ctx = new AudioContext();

    // StereoPannerNode: pans left/right based on relative AI position
    const pannerNode = ctx.createStereoPanner();
    pannerNode.pan.value = 0;
    pannerNode.connect(ctx.destination);

    // GainNode: distance-based volume attenuation
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(pannerNode);

    // OscillatorNode: sawtooth wave for AI engine growl
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = BASE_FREQ;
    oscillator.connect(gainNode);
    oscillator.start();

    nodesRef.current = { ctx, oscillator, gainNode, pannerNode };
  }, []);

  // --- Mute when document becomes hidden, resume when visible ---
  useEffect(() => {
    const handleVisibilityChange = () => {
      const nodes = nodesRef.current;
      if (!nodes) return;

      if (document.hidden) {
        void nodes.ctx.suspend();
      } else if (enabled) {
        void nodes.ctx.resume();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);

  // --- Initialize or suspend based on enabled flag ---
  useEffect(() => {
    if (enabled) {
      initAudio();
      const nodes = nodesRef.current;
      if (nodes && nodes.ctx.state === 'suspended') {
        void nodes.ctx.resume();
      }
      setIsActive(true);
    } else {
      const nodes = nodesRef.current;
      if (nodes && nodes.ctx.state === 'running') {
        void nodes.ctx.suspend();
      }
      setIsActive(false);
    }
  }, [enabled, initAudio]);

  // --- Update spatial audio parameters when positions/speed change ---
  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;
    if (!enabled || !aiPosition || !playerPosition) return;

    const now = nodes.ctx.currentTime;

    // --- Distance ---
    const dx = aiPosition.x - playerPosition.x;
    const dy = aiPosition.y - playerPosition.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // --- Relative angle ---
    // atan2(dx, dy) gives angle from player to AI in world space
    //   0 = north (+Y), positive = east (+X)
    // Subtract player heading to get the angle relative to where the player is facing
    const worldAngleRad = Math.atan2(dx, dy);
    const headingRad = degToRad(playerHeading);
    const relativeAngleRad = worldAngleRad - headingRad;

    // --- Pan: sin(relativeAngle) maps to stereo field ---
    //   0 rad (ahead)   -> pan 0
    //   pi/2 (right)    -> pan +1
    //   -pi/2 (left)    -> pan -1
    //   pi (behind)     -> pan ~0
    const pan = clamp(Math.sin(relativeAngleRad), -1, 1);

    // --- Distance-based gain ---
    let gain = clamp(1.0 - dist / MAX_AUDIBLE_DISTANCE, MIN_GAIN, 1.0);

    // When the AI is behind the player, reduce gain (muffled effect)
    const cosAngle = Math.cos(relativeAngleRad);
    if (cosAngle < 0) {
      gain *= (1.0 - BEHIND_GAIN_PENALTY);
    }

    // Scale by master volume
    gain *= MASTER_VOLUME;

    // --- Engine frequency ---
    let freq = BASE_FREQ + aiSpeed * FREQ_PER_KMH;
    freq = clamp(freq, BASE_FREQ, MAX_FREQ);

    // --- Subtle Doppler effect ---
    // Compare current distance with previous frame to detect approach/recede
    if (prevDistRef.current !== null) {
      const distDelta = dist - prevDistRef.current;
      if (distDelta < -DOPPLER_DEADBAND) {
        // AI is approaching (distance decreasing) -> slight pitch increase
        freq *= DOPPLER_APPROACHING;
      } else if (distDelta > DOPPLER_DEADBAND) {
        // AI is receding (distance increasing) -> slight pitch decrease
        freq *= DOPPLER_RECEDING;
      }
    }
    prevDistRef.current = dist;

    // --- Apply all parameters smoothly via setTargetAtTime ---
    nodes.pannerNode.pan.setTargetAtTime(pan, now, SMOOTH_TIME_CONSTANT);
    nodes.gainNode.gain.setTargetAtTime(gain, now, SMOOTH_TIME_CONSTANT);
    nodes.oscillator.frequency.setTargetAtTime(freq, now, SMOOTH_TIME_CONSTANT);

    // --- Update exposed state for consumers ---
    setPanValue(pan);
    setDistanceGain(gain);
  }, [enabled, aiPosition, playerPosition, playerHeading, aiSpeed]);

  // --- Cleanup: tear down AudioContext and nodes ---
  const cleanup = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes) return;

    try {
      nodes.oscillator.stop();
      void nodes.ctx.close();
    } catch {
      // Context may already be closed
    }

    nodesRef.current = null;
    initializedRef.current = false;
    prevDistRef.current = null;
    setIsActive(false);
    setPanValue(0);
    setDistanceGain(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { isActive, panValue, distanceGain, cleanup };
}

export default useBinauralAudio;
