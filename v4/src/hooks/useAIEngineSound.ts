/**
 * useAIEngineSound.ts - Spatial AI car engine sound with Doppler effect
 *
 * Creates a simple sawtooth oscillator routed through a PannerNode for 3D
 * spatial audio. The browser's Web Audio PannerNode handles Doppler shift
 * natively when the panner position changes over time.
 *
 * - Base frequency mapped to AI speed (80 + speed * 0.5 Hz)
 * - Gain scales inversely with distance (silent beyond 50 m)
 * - Max gain capped at 0.08 so it stays ambient behind the player engine
 */
import { useEffect, useRef, useCallback } from 'react';

const MAX_GAIN = 0.08;
const MAX_DISTANCE = 50; // metres — silent beyond this

interface AIAudioNodes {
  ctx: AudioContext;
  osc: OscillatorNode;
  gain: GainNode;
  panner: PannerNode;
}

export interface UseAIEngineSoundReturn {
  start: () => void;
  stop: () => void;
  update: (
    aiX: number,
    aiY: number,
    aiSpeed: number,
    playerX: number,
    playerY: number,
    playerYaw: number,
  ) => void;
  setMuted: (muted: boolean) => void;
}

export function useAIEngineSound(): UseAIEngineSoundReturn {
  const nodesRef = useRef<AIAudioNodes | null>(null);
  const startedRef = useRef(false);
  const mutedRef = useRef(true); // start muted (matches player engine default)

  // Build the audio graph once, but don't start the oscillator yet.
  const ensureContext = useCallback(() => {
    if (nodesRef.current) return nodesRef.current;

    const ctx = new AudioContext();

    // --- Panner: HRTF for natural spatial cues ---
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 5;
    panner.maxDistance = MAX_DISTANCE;
    panner.rolloffFactor = 1;
    panner.coneOuterGain = 0.4;

    // --- Gain ---
    const gain = ctx.createGain();
    gain.gain.value = 0; // silent until update() is called

    // --- Oscillator: sawtooth for buzzy engine character ---
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 80; // base idle

    // Wire: osc -> panner -> gain -> destination
    osc.connect(panner);
    panner.connect(gain);
    gain.connect(ctx.destination);

    const nodes: AIAudioNodes = { ctx, osc, gain, panner };
    nodesRef.current = nodes;

    // Respect muted state
    if (mutedRef.current) {
      void ctx.suspend();
    }

    return nodes;
  }, []);

  /** Start the oscillator (idempotent). */
  const start = useCallback(() => {
    const nodes = ensureContext();
    if (startedRef.current) return;
    startedRef.current = true;
    nodes.osc.start();
    if (!mutedRef.current) {
      void nodes.ctx.resume();
    }
  }, [ensureContext]);

  /** Stop & tear down. */
  const stop = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    try {
      nodes.osc.stop();
    } catch {
      /* already stopped */
    }
    try {
      void nodes.ctx.close();
    } catch {
      /* already closed */
    }
    nodesRef.current = null;
    startedRef.current = false;
  }, []);

  /** Called every animation frame with latest telemetry. */
  const update = useCallback(
    (
      aiX: number,
      aiY: number,
      aiSpeed: number,
      playerX: number,
      playerY: number,
      playerYaw: number,
    ) => {
      const nodes = nodesRef.current;
      if (!nodes || nodes.ctx.state === 'closed') return;

      const now = nodes.ctx.currentTime;

      // --- Transform AI position into player-relative coords ---
      // CARLA uses a left-handed coordinate system (X right, Y forward).
      // We rotate the world-space delta by -playerYaw so that the listener
      // always faces "forward" along the Z axis in Web Audio space.
      const dx = aiX - playerX;
      const dy = aiY - playerY;
      const yawRad = (playerYaw * Math.PI) / 180;
      const cosY = Math.cos(yawRad);
      const sinY = Math.sin(yawRad);

      // Rotate into listener-local frame:
      //   localX = right,  localZ = forward (negative in Web Audio convention)
      const localX = dx * cosY + dy * sinY;
      const localZ = -((-dx) * sinY + dy * cosY); // negate so "in front" is -Z

      // Set panner position (Y=0, flat plane)
      nodes.panner.positionX.setValueAtTime(localX, now);
      nodes.panner.positionY.setValueAtTime(0, now);
      nodes.panner.positionZ.setValueAtTime(localZ, now);

      // --- Frequency from AI speed ---
      const freq = 80 + aiSpeed * 0.5;
      nodes.osc.frequency.setTargetAtTime(freq, now, 0.05);

      // --- Distance-based gain ---
      const dist = Math.sqrt(dx * dx + dy * dy);
      let vol: number;
      if (dist > MAX_DISTANCE) {
        vol = 0;
      } else {
        // Smooth inverse falloff
        vol = MAX_GAIN * (1 - dist / MAX_DISTANCE);
      }
      nodes.gain.gain.setTargetAtTime(vol, now, 0.05);
    },
    [],
  );

  /** Mute / unmute (synced with player engine mute toggle). */
  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;

    if (muted) {
      void nodes.ctx.suspend();
    } else {
      void nodes.ctx.resume();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const nodes = nodesRef.current;
      if (!nodes) return;
      try {
        nodes.osc.stop();
      } catch {
        /* ok */
      }
      try {
        void nodes.ctx.close();
      } catch {
        /* ok */
      }
      nodesRef.current = null;
      startedRef.current = false;
    };
  }, []);

  return { start, stop, update, setMuted };
}

export default useAIEngineSound;
