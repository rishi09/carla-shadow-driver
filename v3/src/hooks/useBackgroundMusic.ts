/**
 * useBackgroundMusic.ts - Procedural ambient/racing music via Web Audio API
 *
 * Layers:
 *  - Bass drone: sine wave at ~55Hz (A1) with rhythmic pulsing
 *  - Chord pad: 3 oscillators forming Am chord (A2=110, C3=131, E3=165) with LFO tremolo
 *  - Rhythm pulse: square wave at tempo freq through low-pass for kick-drum effect
 *  - Hi-hat: filtered noise bursts at 8th-note intervals (high intensity only)
 *
 * Intensity (0..1) controls which layers are active and their volumes/tempo.
 */
import { useEffect, useRef, useCallback, useState } from 'react';

// --- Constants ---
const BASS_FREQ = 55;           // A1
const CHORD_FREQS = [110, 131, 165]; // A2, C3, E3 (Am)
const LFO_RATE = 0.25;          // Hz - slow tremolo
const MASTER_VOLUME = 0.18;     // Keep background music quieter than engine

// Tempo range (beats per second)
const TEMPO_MIN = 1.6;  // ~96 bpm at low intensity
const TEMPO_MAX = 2.4;  // ~144 bpm at high intensity

const FADE_IN_SECONDS = 2.0;
const FADE_OUT_SECONDS = 1.0;

// Hi-hat noise burst duration
const HIHAT_DURATION = 0.03; // seconds

interface MusicNodes {
  ctx: AudioContext;
  masterGain: GainNode;

  // Bass drone
  bassOsc: OscillatorNode;
  bassGain: GainNode;
  bassLfo: OscillatorNode;
  bassLfoGain: GainNode;

  // Chord pad (3 oscillators)
  padOscs: OscillatorNode[];
  padGains: GainNode[];
  padMasterGain: GainNode;
  padLfo: OscillatorNode;
  padLfoGain: GainNode;

  // Rhythm pulse
  rhythmOsc: OscillatorNode;
  rhythmGain: GainNode;
  rhythmFilter: BiquadFilterNode;

  // Hi-hat
  hihatGain: GainNode;
  hihatFilter: BiquadFilterNode;
  noiseBuffer: AudioBuffer;
}

/** Create a white noise AudioBuffer for hi-hat */
function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate; // 1 second
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export interface UseBackgroundMusicReturn {
  start: () => void;
  stop: () => void;
  updateIntensity: (intensity: number) => void;
  setMuted: (muted: boolean) => void;
  isMuted: boolean;
}

export function useBackgroundMusic(): UseBackgroundMusicReturn {
  const [isMuted, setIsMuted] = useState(true); // Start muted (browser autoplay policy)
  const nodesRef = useRef<MusicNodes | null>(null);
  const mutedRef = useRef(true);
  const playingRef = useRef(false);
  const intensityRef = useRef(0);
  const hihatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Build the audio graph (lazy, called once)
  const ensureNodes = useCallback((): MusicNodes | null => {
    if (nodesRef.current) return nodesRef.current;

    const ctx = new AudioContext();

    // --- Master gain ---
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0; // Start silent; fade in on start()
    masterGain.connect(ctx.destination);

    // --- Bass drone ---
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.5;
    bassGain.connect(masterGain);

    // Bass LFO for rhythmic pulsing
    const bassLfo = ctx.createOscillator();
    bassLfo.type = 'sine';
    bassLfo.frequency.value = TEMPO_MIN; // pulsing at tempo
    const bassLfoGain = ctx.createGain();
    bassLfoGain.gain.value = 0.3; // pulse depth
    bassLfo.connect(bassLfoGain);
    bassLfoGain.connect(bassGain.gain);

    const bassOsc = ctx.createOscillator();
    bassOsc.type = 'sine';
    bassOsc.frequency.value = BASS_FREQ;
    bassOsc.connect(bassGain);

    // --- Chord pad ---
    const padMasterGain = ctx.createGain();
    padMasterGain.gain.value = 0; // controlled by intensity
    padMasterGain.connect(masterGain);

    // Pad LFO (tremolo)
    const padLfo = ctx.createOscillator();
    padLfo.type = 'sine';
    padLfo.frequency.value = LFO_RATE;
    const padLfoGain = ctx.createGain();
    padLfoGain.gain.value = 0.15; // tremolo depth
    padLfo.connect(padLfoGain);
    padLfoGain.connect(padMasterGain.gain);

    const padOscs: OscillatorNode[] = [];
    const padGains: GainNode[] = [];
    for (const freq of CHORD_FREQS) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      osc.connect(g);
      g.connect(padMasterGain);
      padOscs.push(osc);
      padGains.push(g);
    }

    // --- Rhythm pulse ---
    const rhythmFilter = ctx.createBiquadFilter();
    rhythmFilter.type = 'lowpass';
    rhythmFilter.frequency.value = 150;
    rhythmFilter.Q.value = 8;

    const rhythmGain = ctx.createGain();
    rhythmGain.gain.value = 0; // controlled by intensity
    rhythmFilter.connect(rhythmGain);
    rhythmGain.connect(masterGain);

    const rhythmOsc = ctx.createOscillator();
    rhythmOsc.type = 'square';
    rhythmOsc.frequency.value = TEMPO_MIN;
    rhythmOsc.connect(rhythmFilter);

    // --- Hi-hat ---
    const hihatFilter = ctx.createBiquadFilter();
    hihatFilter.type = 'highpass';
    hihatFilter.frequency.value = 8000;
    hihatFilter.Q.value = 1;

    const hihatGain = ctx.createGain();
    hihatGain.gain.value = 0;
    hihatFilter.connect(hihatGain);
    hihatGain.connect(masterGain);

    const noiseBuffer = createNoiseBuffer(ctx);

    // Start all oscillators
    bassOsc.start();
    bassLfo.start();
    padLfo.start();
    for (const osc of padOscs) osc.start();
    rhythmOsc.start();

    const nodes: MusicNodes = {
      ctx,
      masterGain,
      bassOsc,
      bassGain,
      bassLfo,
      bassLfoGain,
      padOscs,
      padGains,
      padMasterGain,
      padLfo,
      padLfoGain,
      rhythmOsc,
      rhythmGain,
      rhythmFilter,
      hihatGain,
      hihatFilter,
      noiseBuffer,
    };
    nodesRef.current = nodes;
    return nodes;
  }, []);

  // Schedule a single hi-hat noise burst
  const triggerHihat = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const source = nodes.ctx.createBufferSource();
    source.buffer = nodes.noiseBuffer;
    source.connect(nodes.hihatFilter);

    const now = nodes.ctx.currentTime;
    source.start(now);
    source.stop(now + HIHAT_DURATION);
  }, []);

  const stopHihatLoop = useCallback(() => {
    if (hihatIntervalRef.current) {
      clearInterval(hihatIntervalRef.current);
      hihatIntervalRef.current = null;
    }
  }, []);

  // Update intensity (called each frame from the game loop)
  const updateIntensity = useCallback((intensity: number) => {
    const clamped = Math.max(0, Math.min(1, intensity));
    intensityRef.current = clamped;

    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const now = nodes.ctx.currentTime;
    const t = 0.1; // smoothing time constant

    // Bass drone: always present, volume 0.3..0.6
    const bassVol = 0.3 + clamped * 0.3;
    nodes.bassGain.gain.setTargetAtTime(bassVol, now, t);

    // Chord pad: quiet at low, louder at high -> 0.05..0.35
    const padVol = 0.05 + clamped * 0.3;
    nodes.padMasterGain.gain.setTargetAtTime(padVol, now, t);

    // Rhythm pulse: silent below 0.3, ramps up to 0.4
    const rhythmVol = clamped < 0.3 ? 0 : ((clamped - 0.3) / 0.7) * 0.4;
    nodes.rhythmGain.gain.setTargetAtTime(rhythmVol, now, t);

    // Tempo: scales with intensity
    const tempo = TEMPO_MIN + clamped * (TEMPO_MAX - TEMPO_MIN);
    nodes.bassLfo.frequency.setTargetAtTime(tempo, now, t);
    nodes.rhythmOsc.frequency.setTargetAtTime(tempo, now, t);

    // Hi-hat: only above 0.5 intensity
    if (clamped > 0.5) {
      const hihatVol = ((clamped - 0.5) / 0.5) * 0.25;
      nodes.hihatGain.gain.setTargetAtTime(hihatVol, now, t);

      // Restart hi-hat loop with updated interval
      stopHihatLoop();
      const intervalMs = (1 / (tempo * 2)) * 1000;
      hihatIntervalRef.current = setInterval(triggerHihat, intervalMs);
    } else {
      nodes.hihatGain.gain.setTargetAtTime(0, now, t);
      stopHihatLoop();
    }
  }, [stopHihatLoop, triggerHihat]);

  // Start music playback (fade in over 2 seconds)
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

    // Fade in master gain
    const now = nodes.ctx.currentTime;
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
    nodes.masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME, now + FADE_IN_SECONDS);
  }, [ensureNodes]);

  // Stop music (fade out over 1 second, then suspend)
  const stop = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;

    stopHihatLoop();

    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;

    const now = nodes.ctx.currentTime;
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
    nodes.masterGain.gain.linearRampToValueAtTime(0, now + FADE_OUT_SECONDS);

    // Suspend context after fade out completes
    setTimeout(() => {
      if (!playingRef.current && nodes.ctx.state === 'running') {
        void nodes.ctx.suspend();
      }
    }, FADE_OUT_SECONDS * 1000 + 100);
  }, [stopHihatLoop]);

  // Mute / unmute
  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    setIsMuted(muted);
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
      stopHihatLoop();
      const nodes = nodesRef.current;
      if (!nodes) return;
      try {
        nodes.bassOsc.stop();
        nodes.bassLfo.stop();
        nodes.padLfo.stop();
        for (const osc of nodes.padOscs) osc.stop();
        nodes.rhythmOsc.stop();
        void nodes.ctx.close();
      } catch {
        // Context may already be closed
      }
      nodesRef.current = null;
    };
  }, [stopHihatLoop]);

  return { start, stop, updateIntensity, setMuted, isMuted };
}

export default useBackgroundMusic;
