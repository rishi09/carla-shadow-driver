/**
 * useCrowdAmbiance.ts - Procedural crowd/ambiance noise via Web Audio API
 *
 * Generates crowd reactions from filtered white noise shaped by gain envelopes:
 * - Base murmur: constant low rumble of a crowd (bandpass-filtered noise)
 * - Cheer: rising bandpass sweep on overtake
 * - Gasp: sharp mid-frequency burst on collision
 * - Roar: sustained broadband noise on race finish
 * - Anticipation: swelling murmur when gap is close (<1s)
 *
 * No audio files needed — everything is synthesized from noise buffers.
 */
import { useEffect, useRef, useCallback } from 'react';

// Volume relative to engine/music
const CROWD_MASTER_VOLUME = 0.12;
const MURMUR_VOLUME = 0.15;       // Base crowd murmur level
const CHEER_VOLUME = 0.6;
const GASP_VOLUME = 0.5;
const ROAR_VOLUME = 0.7;

interface CrowdNodes {
  ctx: AudioContext;
  masterGain: GainNode;
  noiseBuffer: AudioBuffer;

  // Persistent base murmur
  murmurSource: AudioBufferSourceNode;
  murmurFilter: BiquadFilterNode;
  murmurGain: GainNode;
}

/** Create a white noise AudioBuffer */
function createNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export interface UseCrowdAmbianceReturn {
  /** Call on overtake event */
  cheer: () => void;
  /** Call on collision event */
  gasp: () => void;
  /** Call on race finish */
  roar: () => void;
  /** Set anticipation level (0 = calm, 1 = tense) — drives murmur intensity */
  setAnticipation: (level: number) => void;
  /** Start ambient crowd (call when race starts) */
  start: () => void;
  /** Stop ambient crowd (call when race ends or view changes) */
  stop: () => void;
  /** Sync mute state with engine sound */
  setMuted: (muted: boolean) => void;
}

export function useCrowdAmbiance(): UseCrowdAmbianceReturn {
  const nodesRef = useRef<CrowdNodes | null>(null);
  const playingRef = useRef(false);
  const mutedRef = useRef(true);

  const ensureNodes = useCallback((): CrowdNodes | null => {
    if (nodesRef.current) return nodesRef.current;

    const ctx = new AudioContext();

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);

    const noiseBuffer = createNoiseBuffer(ctx, 2);

    // --- Base crowd murmur: looping bandpass-filtered noise ---
    const murmurSource = ctx.createBufferSource();
    murmurSource.buffer = noiseBuffer;
    murmurSource.loop = true;

    // Bandpass centered around 400Hz with wide Q — sounds like distant crowd rumble
    const murmurFilter = ctx.createBiquadFilter();
    murmurFilter.type = 'bandpass';
    murmurFilter.frequency.value = 400;
    murmurFilter.Q.value = 0.8;

    const murmurGain = ctx.createGain();
    murmurGain.gain.value = MURMUR_VOLUME;

    murmurSource.connect(murmurFilter);
    murmurFilter.connect(murmurGain);
    murmurGain.connect(masterGain);
    murmurSource.start();

    const nodes: CrowdNodes = {
      ctx,
      masterGain,
      noiseBuffer,
      murmurSource,
      murmurFilter,
      murmurGain,
    };
    nodesRef.current = nodes;
    return nodes;
  }, []);

  const start = useCallback(() => {
    if (playingRef.current) return;
    playingRef.current = true;

    const nodes = ensureNodes();
    if (!nodes) return;

    if (mutedRef.current) {
      void nodes.ctx.suspend();
    } else {
      void nodes.ctx.resume();
    }

    const now = nodes.ctx.currentTime;
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(0, now);
    nodes.masterGain.gain.linearRampToValueAtTime(CROWD_MASTER_VOLUME, now + 2.0);
  }, [ensureNodes]);

  const stop = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;

    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;

    const now = nodes.ctx.currentTime;
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
    nodes.masterGain.gain.linearRampToValueAtTime(0, now + 1.0);

    setTimeout(() => {
      if (!playingRef.current && nodes.ctx.state === 'running') {
        void nodes.ctx.suspend();
      }
    }, 1100);
  }, []);

  // --- Cheer: rising bandpass sweep with volume swell on overtake ---
  const cheer = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = nodes.noiseBuffer;
    source.loop = true;

    // Bandpass that sweeps from 600Hz to 2000Hz (crowd excitement rising)
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.linearRampToValueAtTime(2000, now + 0.4);
    filter.frequency.linearRampToValueAtTime(1200, now + 1.5);
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(CHEER_VOLUME, now + 0.15);
    gain.gain.setValueAtTime(CHEER_VOLUME, now + 0.8);
    gain.gain.linearRampToValueAtTime(0, now + 2.0);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(nodes.masterGain);
    source.start(now);
    source.stop(now + 2.0);
  }, []);

  // --- Gasp: sharp mid-frequency burst on collision ---
  const gasp = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = nodes.noiseBuffer;

    // Bandpass at ~800Hz for a "crowd inhale" sound
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 2.0;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(GASP_VOLUME, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(nodes.masterGain);
    source.start(now);
    source.stop(now + 0.6);
  }, []);

  // --- Roar: sustained broadband crowd noise on finish ---
  const roar = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = nodes.noiseBuffer;
    source.loop = true;

    // Wide bandpass for full crowd roar
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 0.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(ROAR_VOLUME, now + 0.3);
    gain.gain.setValueAtTime(ROAR_VOLUME, now + 2.5);
    gain.gain.linearRampToValueAtTime(0, now + 4.0);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(nodes.masterGain);
    source.start(now);
    source.stop(now + 4.0);
  }, []);

  // --- Anticipation: swell the base murmur when gap is close ---
  const setAnticipation = useCallback((level: number) => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const clamped = Math.max(0, Math.min(1, level));
    const now = nodes.ctx.currentTime;

    // Murmur volume: MURMUR_VOLUME at calm, 3x at max anticipation
    const vol = MURMUR_VOLUME * (1 + clamped * 2);
    nodes.murmurGain.gain.setTargetAtTime(vol, now, 0.3);

    // Shift filter center up with anticipation (400Hz → 700Hz = more excited)
    const freq = 400 + clamped * 300;
    nodes.murmurFilter.frequency.setTargetAtTime(freq, now, 0.3);
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;

    if (muted) {
      void nodes.ctx.suspend();
    } else if (playingRef.current) {
      void nodes.ctx.resume();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const nodes = nodesRef.current;
      if (!nodes) return;
      try {
        nodes.murmurSource.stop();
        void nodes.ctx.close();
      } catch { /* ok */ }
      nodesRef.current = null;
    };
  }, []);

  return { cheer, gasp, roar, setAnticipation, start, stop, setMuted };
}

export default useCrowdAmbiance;
