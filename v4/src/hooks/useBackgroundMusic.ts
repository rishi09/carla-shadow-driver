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

/** Tension layer nodes for final lap heartbeat bass */
interface TensionNodes {
  osc: OscillatorNode;       // 60Hz low bass oscillator
  gain: GainNode;            // Volume envelope (pulsed by LFO)
  lfo: OscillatorNode;       // 2Hz LFO for heartbeat pulsing
  lfoGain: GainNode;         // LFO depth control
}

export interface UseBackgroundMusicReturn {
  start: () => void;
  stop: () => void;
  updateIntensity: (intensity: number) => void;
  /** Trigger event-driven music changes (overtake celebration, close-gap drums, final-lap intensity) */
  triggerMusicEvent: (event: 'overtake' | 'close_gap_start' | 'close_gap_end' | 'final_lap') => void;
  /** Final-lap tension: heartbeat bass when gap < 1.0s, layer ducking on final checkpoint approach */
  setFinalLapTension: (gapSeconds: number, isFinalLap: boolean, checkpointProgress: number) => void;
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

  // Event-driven music layer refs
  const closeGapDrumRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);
  const finalLapBoostRef = useRef(false);
  const tensionRef = useRef<TensionNodes | null>(null);
  const tensionActiveRef = useRef(false);
  const layersDuckedRef = useRef(false);

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

  // --- Event-driven music layer changes ---
  const triggerMusicEvent = useCallback((event: 'overtake' | 'close_gap_start' | 'close_gap_end' | 'final_lap') => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    switch (event) {
      case 'overtake': {
        // Brief volume boost + chord shift to major (celebratory)
        // Shift pad chord from Am (A, C, E) to A major (A, C#, E) for 3 seconds
        if (nodes.padOscs.length >= 3) {
          // C3 (131Hz) -> C#3 (139Hz)
          nodes.padOscs[1].frequency.setValueAtTime(139, now);
          nodes.padOscs[1].frequency.setValueAtTime(131, now + 3.0); // revert
        }
        // Temporary master boost
        nodes.masterGain.gain.cancelScheduledValues(now);
        nodes.masterGain.gain.setValueAtTime(MASTER_VOLUME * 1.4, now);
        nodes.masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME, now + 3.0);
        break;
      }

      case 'close_gap_start': {
        // Add a driving drum layer (square wave at 2x tempo, bandpass filtered)
        if (closeGapDrumRef.current) return; // already active

        const drumOsc = ctx.createOscillator();
        drumOsc.type = 'square';
        const currentTempo = TEMPO_MIN + intensityRef.current * (TEMPO_MAX - TEMPO_MIN);
        drumOsc.frequency.value = currentTempo * 2; // double-time

        const drumFilter = ctx.createBiquadFilter();
        drumFilter.type = 'lowpass';
        drumFilter.frequency.value = 200;
        drumFilter.Q.value = 5;

        const drumGain = ctx.createGain();
        drumGain.gain.setValueAtTime(0, now);
        drumGain.gain.linearRampToValueAtTime(0.25, now + 1.0); // fade in over 1s

        drumOsc.connect(drumFilter);
        drumFilter.connect(drumGain);
        drumGain.connect(nodes.masterGain);
        drumOsc.start(now);

        closeGapDrumRef.current = { osc: drumOsc, gain: drumGain };
        break;
      }

      case 'close_gap_end': {
        // Fade out and stop the drum layer
        const drum = closeGapDrumRef.current;
        if (!drum) return;

        drum.gain.gain.linearRampToValueAtTime(0, now + 0.5);
        setTimeout(() => {
          try { drum.osc.stop(); } catch { /* ok */ }
          closeGapDrumRef.current = null;
        }, 600);
        break;
      }

      case 'final_lap': {
        if (finalLapBoostRef.current) return;
        finalLapBoostRef.current = true;

        // Permanent: raise bass, add more rhythm, increase tempo by 15%
        const newTempo = (TEMPO_MIN + intensityRef.current * (TEMPO_MAX - TEMPO_MIN)) * 1.15;
        nodes.bassLfo.frequency.setTargetAtTime(newTempo, now, 0.3);
        nodes.rhythmOsc.frequency.setTargetAtTime(newTempo, now, 0.3);

        // Boost bass by 30%
        const bassVal = nodes.bassGain.gain.value;
        nodes.bassGain.gain.setTargetAtTime(bassVal * 1.3, now, 0.5);

        // Boost rhythm by 30%
        const rhythmVal = nodes.rhythmGain.gain.value;
        nodes.rhythmGain.gain.setTargetAtTime(Math.max(rhythmVal, 0.3) * 1.3, now, 0.5);

        // Boost master slightly
        nodes.masterGain.gain.cancelScheduledValues(now);
        nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
        nodes.masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME * 1.25, now + 2.0);
        break;
      }
    }
  }, []);

  // --- Final lap tension: heartbeat bass when gap < 1.0s, layer ducking near finish ---
  const setFinalLapTension = useCallback((gapSeconds: number, isFinalLap: boolean, checkpointProgress: number) => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;
    const t = 0.1; // smoothing time constant

    const shouldActivate = isFinalLap && gapSeconds < 1.0;

    if (shouldActivate) {
      // --- Create tension oscillator if not yet active ---
      if (!tensionRef.current) {
        // 60Hz bass oscillator (mimics heartbeat sub-bass)
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 60;

        // Gain node for volume envelope (pulsed by LFO)
        const gain = ctx.createGain();
        gain.gain.value = 0; // start silent, ramp in

        // 2Hz LFO for heartbeat pulsing effect
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 2; // 2 Hz = heartbeat rhythm

        // LFO modulates the gain node's gain parameter
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0; // LFO depth starts at 0, increased with tension

        // Signal path: osc -> gain -> masterGain
        osc.connect(gain);
        gain.connect(nodes.masterGain);

        // LFO path: lfo -> lfoGain -> gain.gain (AudioParam modulation)
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);

        osc.start(now);
        lfo.start(now);

        tensionRef.current = { osc, gain, lfo, lfoGain };
        tensionActiveRef.current = true;
      }

      const tension = tensionRef.current;

      // --- Scale volume based on gap: 0 at 1.0s, max at 0.0s ---
      // tensionAmount: 0.0 (gap=1.0s) to 1.0 (gap=0.0s)
      const tensionAmount = Math.max(0, Math.min(1, 1.0 - gapSeconds));

      // Base gain for the oscillator (constant part)
      const baseGain = tensionAmount * 0.4;
      tension.gain.gain.setTargetAtTime(baseGain, now, t);

      // LFO depth increases with tension (heartbeat gets more pronounced)
      const lfoDepth = tensionAmount * 0.35;
      tension.lfoGain.gain.setTargetAtTime(lfoDepth, now, t);

      // --- Layer ducking: drop other layers on final checkpoint approach ---
      if (checkpointProgress > 0.9) {
        if (!layersDuckedRef.current) {
          layersDuckedRef.current = true;
          // Duck all other layers to 0.3x their current level
          nodes.padMasterGain.gain.setTargetAtTime(nodes.padMasterGain.gain.value * 0.3, now, 0.3);
          nodes.rhythmGain.gain.setTargetAtTime(nodes.rhythmGain.gain.value * 0.3, now, 0.3);
          nodes.hihatGain.gain.setTargetAtTime(nodes.hihatGain.gain.value * 0.3, now, 0.3);
          // Keep bass drone but reduce it
          nodes.bassGain.gain.setTargetAtTime(nodes.bassGain.gain.value * 0.3, now, 0.3);
        }
      } else {
        // Restore layers if we dropped back below 0.9 progress
        if (layersDuckedRef.current) {
          layersDuckedRef.current = false;
          // Let updateIntensity restore proper levels on next call
        }
      }
    } else {
      // --- Conditions no longer apply: clean up tension layer ---
      if (tensionRef.current) {
        const tension = tensionRef.current;
        // Fade out over 0.3s then stop
        tension.gain.gain.setTargetAtTime(0, now, 0.15);
        tension.lfoGain.gain.setTargetAtTime(0, now, 0.15);

        const capturedTension = tension;
        setTimeout(() => {
          try { capturedTension.osc.stop(); } catch { /* ok */ }
          try { capturedTension.lfo.stop(); } catch { /* ok */ }
        }, 400);

        tensionRef.current = null;
        tensionActiveRef.current = false;
      }

      // Restore ducked layers
      if (layersDuckedRef.current) {
        layersDuckedRef.current = false;
        // updateIntensity will restore proper levels on next call
      }
    }
  }, []);

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
    finalLapBoostRef.current = false;

    stopHihatLoop();

    // Stop close-gap drum if active
    if (closeGapDrumRef.current) {
      try { closeGapDrumRef.current.osc.stop(); } catch { /* ok */ }
      closeGapDrumRef.current = null;
    }

    // Stop tension layer if active
    if (tensionRef.current) {
      try { tensionRef.current.osc.stop(); } catch { /* ok */ }
      try { tensionRef.current.lfo.stop(); } catch { /* ok */ }
      tensionRef.current = null;
      tensionActiveRef.current = false;
    }
    layersDuckedRef.current = false;

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
      // Clean up tension layer
      if (tensionRef.current) {
        try { tensionRef.current.osc.stop(); } catch { /* ok */ }
        try { tensionRef.current.lfo.stop(); } catch { /* ok */ }
        tensionRef.current = null;
      }
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

  return { start, stop, updateIntensity, triggerMusicEvent, setFinalLapTension, setMuted, isMuted };
}

export default useBackgroundMusic;
