/**
 * useEngineSound.ts - Web Audio API engine sound synthesis
 * Generates realistic engine sounds using oscillators + harmonics,
 * tire screech via filtered white noise, and countdown beeps.
 */
import { useEffect, useRef, useCallback, useState } from 'react';

// Engine frequency mapping
const IDLE_FREQ = 80;   // Hz at idle RPM
const REDLINE_FREQ = 400; // Hz at redline
const IDLE_RPM = 800;
const REDLINE_RPM = 7000;

// Harmonic volume ratios relative to fundamental
const HARMONIC_2_GAIN = 0.4;
const HARMONIC_3_GAIN = 0.2;

// Filter settings
const FILTER_MIN_FREQ = 400;   // Low-pass cutoff at idle
const FILTER_MAX_FREQ = 4000;  // Low-pass cutoff at redline

// Tire screech thresholds
const SCREECH_SPEED_THRESHOLD = 60;   // km/h
const SCREECH_STEER_THRESHOLD = 0.5;  // absolute steer value

// Master volume
const MASTER_VOLUME = 0.3;

interface AudioNodes {
  ctx: AudioContext;
  masterGain: GainNode;
  // Engine oscillators
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  osc3: OscillatorNode;
  gain1: GainNode;
  gain2: GainNode;
  gain3: GainNode;
  engineGain: GainNode;
  lowPass: BiquadFilterNode;
  // Tire screech
  screechSource: AudioBufferSourceNode | null;
  screechGain: GainNode;
  screechFilter: BiquadFilterNode;
}

function rpmToFrequency(rpm: number): number {
  const t = Math.max(0, Math.min(1, (rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
  return IDLE_FREQ + t * (REDLINE_FREQ - IDLE_FREQ);
}

function rpmToFilterFreq(rpm: number): number {
  const t = Math.max(0, Math.min(1, (rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
  return FILTER_MIN_FREQ + t * (FILTER_MAX_FREQ - FILTER_MIN_FREQ);
}

/** Create a looping white noise buffer */
function createWhiteNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * 2; // 2 seconds of noise
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export interface UseEngineSoundReturn {
  update: (rpm: number, throttle: number, speed: number, steer: number) => void;
  playCountdownBeeps: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: boolean;
}

export function useEngineSound(): UseEngineSoundReturn {
  const [isMuted, setIsMuted] = useState(true); // Start muted (browser autoplay policy)
  const nodesRef = useRef<AudioNodes | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);
  const screechActiveRef = useRef(false);
  const mutedRef = useRef(true);
  const initializedRef = useRef(false);

  // Initialize audio context and nodes
  const initAudio = useCallback(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const ctx = new AudioContext();
    const masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_VOLUME;
    masterGain.connect(ctx.destination);

    // Low-pass filter for engine
    const lowPass = ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = FILTER_MIN_FREQ;
    lowPass.Q.value = 1.5;
    lowPass.connect(masterGain);

    // Engine gain (controlled by throttle)
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.1; // Start quiet
    engineGain.connect(lowPass);

    // Fundamental oscillator
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = IDLE_FREQ;
    const gain1 = ctx.createGain();
    gain1.gain.value = 1.0;
    osc1.connect(gain1);
    gain1.connect(engineGain);

    // 2nd harmonic
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = IDLE_FREQ * 2;
    const gain2 = ctx.createGain();
    gain2.gain.value = HARMONIC_2_GAIN;
    osc2.connect(gain2);
    gain2.connect(engineGain);

    // 3rd harmonic
    const osc3 = ctx.createOscillator();
    osc3.type = 'square';
    osc3.frequency.value = IDLE_FREQ * 3;
    const gain3 = ctx.createGain();
    gain3.gain.value = HARMONIC_3_GAIN;
    osc3.connect(gain3);
    gain3.connect(engineGain);

    // Start oscillators
    osc1.start();
    osc2.start();
    osc3.start();

    // Tire screech setup: bandpass filter -> gain -> master
    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 3000;
    screechFilter.Q.value = 5;
    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    screechFilter.connect(screechGain);
    screechGain.connect(masterGain);

    // Create white noise buffer
    noiseBufferRef.current = createWhiteNoiseBuffer(ctx);

    nodesRef.current = {
      ctx,
      masterGain,
      osc1, osc2, osc3,
      gain1, gain2, gain3,
      engineGain,
      lowPass,
      screechSource: null,
      screechGain,
      screechFilter,
    };

    // Respect muted state
    if (mutedRef.current) {
      void ctx.suspend();
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    initAudio();
  }, [initAudio]);

  // Start screech noise source
  const startScreech = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || !noiseBufferRef.current) return;

    // If already active, just ramp up gain
    if (screechActiveRef.current && nodes.screechSource) return;

    const source = nodes.ctx.createBufferSource();
    source.buffer = noiseBufferRef.current;
    source.loop = true;
    source.connect(nodes.screechFilter);
    source.start();
    nodes.screechSource = source;
    screechActiveRef.current = true;
  }, []);

  const stopScreech = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || !screechActiveRef.current) return;

    // Fade out
    nodes.screechGain.gain.setTargetAtTime(0, nodes.ctx.currentTime, 0.05);
    const source = nodes.screechSource;
    if (source) {
      setTimeout(() => {
        try { source.stop(); } catch { /* already stopped */ }
      }, 200);
    }
    nodes.screechSource = null;
    screechActiveRef.current = false;
  }, []);

  // Update engine parameters (called every frame)
  const update = useCallback((rpm: number, throttle: number, speed: number, steer: number) => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;

    const now = nodes.ctx.currentTime;
    const freq = rpmToFrequency(rpm);

    // Update oscillator frequencies with smooth ramp
    nodes.osc1.frequency.setTargetAtTime(freq, now, 0.03);
    nodes.osc2.frequency.setTargetAtTime(freq * 2, now, 0.03);
    nodes.osc3.frequency.setTargetAtTime(freq * 3, now, 0.03);

    // Update engine volume based on throttle (idle still makes some sound)
    const engineVol = 0.08 + throttle * 0.92;
    nodes.engineGain.gain.setTargetAtTime(engineVol, now, 0.05);

    // Update low-pass filter based on RPM
    const filterFreq = rpmToFilterFreq(rpm);
    nodes.lowPass.frequency.setTargetAtTime(filterFreq, now, 0.05);

    // Tire screech: speed > 60 && |steer| > 0.5
    const shouldScreech = speed > SCREECH_SPEED_THRESHOLD && Math.abs(steer) > SCREECH_STEER_THRESHOLD;
    if (shouldScreech) {
      if (!screechActiveRef.current) {
        startScreech();
      }
      // Volume proportional to how hard the turn is
      const screechVol = Math.min(1, (Math.abs(steer) - SCREECH_STEER_THRESHOLD) * 2) * 0.5;
      nodes.screechGain.gain.setTargetAtTime(screechVol, now, 0.02);
    } else {
      if (screechActiveRef.current) {
        stopScreech();
      }
    }
  }, [startScreech, stopScreech]);

  // Play countdown beeps: 3 short high beeps + 1 long lower beep for GO
  const playCountdownBeeps = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;

    // If context is suspended (muted), resume it temporarily for beeps
    // Actually, if muted, we skip beeps
    if (nodes.ctx.state === 'suspended') return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    // Helper to play a beep
    const playBeep = (startTime: number, duration: number, frequency: number, volume: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
      gain.gain.setValueAtTime(volume, startTime + duration - 0.02);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);
      osc.connect(gain);
      gain.connect(nodes.masterGain);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    // 3 short high beeps (880Hz, 0.2s each, 1 second apart)
    playBeep(now + 0.0, 0.2, 880, 0.6);
    playBeep(now + 1.0, 0.2, 880, 0.6);
    playBeep(now + 2.0, 0.2, 880, 0.6);

    // 1 long lower beep for GO (440Hz, 0.6s)
    playBeep(now + 3.0, 0.6, 440, 0.8);
  }, []);

  // Mute/unmute toggle
  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    setIsMuted(muted);
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
        nodes.osc1.stop();
        nodes.osc2.stop();
        nodes.osc3.stop();
        if (nodes.screechSource) {
          try { nodes.screechSource.stop(); } catch { /* ok */ }
        }
        void nodes.ctx.close();
      } catch {
        // Context may already be closed
      }
      nodesRef.current = null;
      initializedRef.current = false;
    };
  }, []);

  return { update, playCountdownBeeps, setMuted, isMuted };
}

export default useEngineSound;
