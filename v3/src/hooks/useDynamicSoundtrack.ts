/**
 * useDynamicSoundtrack.ts - BPM-synced stem-based dynamic soundtrack
 *
 * Replaces the old oscillator-based background music with a proper 4-stem
 * reactive soundtrack system. All stems are synthesized procedurally using
 * the Web Audio API (no external audio files).
 *
 * Stems:
 *  - Drums: Procedural drum machine (kick, snare, hi-hat) at 140 BPM
 *  - Bass: Deep sine riff in E minor with waveshaper distortion
 *  - Pad: Layered detuned sawtooth chords (Em) with lowpass filter sweep
 *  - Lead: Square wave melodic synth with vibrato + delay
 *
 * Intensity levels crossfade stems on bar boundaries (every 4 beats):
 *  - cruise:  drums 0.3, bass 0.5, pad 0.7, lead 0.0
 *  - chase:   drums 0.6, bass 0.7, pad 0.5, lead 0.3
 *  - intense: drums 0.9, bass 0.9, pad 0.3, lead 0.7
 *  - climax:  all 1.0, tempo 160 BPM
 */
import { useEffect, useRef, useCallback, useState } from 'react';

// --- Musical Constants ---
// E minor scale: E F# G A B C D
// Frequencies (Hz): E2=82.41, F#2=92.50, G2=98.00, A2=110, B2=123.47, C3=130.81, D3=146.83, E3=164.81
const E2 = 82.41;
const B2 = 123.47;
const E3 = 164.81;
const G3 = 196.00;
const B3 = 246.94;
const D4 = 293.66;
const E4 = 329.63;
const G4 = 392.00;
const A4 = 440.00;
const B4 = 493.88;
const D5 = 587.33;
const E5 = 659.26;

// Tempo
const BASE_BPM = 140;
const CLIMAX_BPM = 160;
const MASTER_VOLUME = 0.20;

// Crossfade time (seconds) - smooth volume transitions
const CROSSFADE_TIME = 0.3;

export type IntensityLevel = 'cruise' | 'chase' | 'intense' | 'climax';

// Per-stem target volumes for each intensity level
const INTENSITY_PRESETS: Record<IntensityLevel, { drums: number; bass: number; pad: number; lead: number }> = {
  cruise:  { drums: 0.3, bass: 0.5, pad: 0.7, lead: 0.0 },
  chase:   { drums: 0.6, bass: 0.7, pad: 0.5, lead: 0.3 },
  intense: { drums: 0.9, bass: 0.9, pad: 0.3, lead: 0.7 },
  climax:  { drums: 1.0, bass: 1.0, pad: 1.0, lead: 1.0 },
};

// --- Bass riff pattern (in beats, 4 bars = 16 beats) ---
// Root -> 5th -> octave -> 5th, each note 4 beats
const BASS_PATTERN: Array<{ freq: number; beats: number }> = [
  { freq: E2, beats: 4 },        // Root (E2)
  { freq: B2, beats: 4 },        // 5th (B2)
  { freq: E3, beats: 4 },        // Octave (E3)
  { freq: B2, beats: 4 },        // 5th (B2)
];

// --- Lead melody patterns (in beats, repeating phrases) ---
// Two 8-bar (32 beat) phrases that alternate
const LEAD_PHRASE_A: Array<{ freq: number; beats: number; rest?: boolean }> = [
  { freq: E4, beats: 1 },
  { freq: G4, beats: 1 },
  { freq: A4, beats: 1 },
  { freq: B4, beats: 1 },
  { freq: D5, beats: 2 },
  { freq: B4, beats: 1 },
  { freq: A4, beats: 1 },
  { freq: G4, beats: 2 },
  { freq: E4, beats: 1 },
  { freq: 0, beats: 1, rest: true },
  { freq: A4, beats: 1 },
  { freq: G4, beats: 1 },
  { freq: E4, beats: 2 },
  { freq: D4, beats: 1 },
  { freq: E4, beats: 1 },
  // total = 16 beats (4 bars)
  { freq: B4, beats: 2 },
  { freq: A4, beats: 1 },
  { freq: G4, beats: 1 },
  { freq: E4, beats: 1 },
  { freq: G4, beats: 1 },
  { freq: A4, beats: 2 },
  { freq: B4, beats: 1 },
  { freq: D5, beats: 1 },
  { freq: E5, beats: 2 },
  { freq: D5, beats: 1 },
  { freq: B4, beats: 1 },
  { freq: A4, beats: 1 },
  { freq: G4, beats: 1 },
  // total = 16 beats (4 more bars)
];

const LEAD_PHRASE_B: Array<{ freq: number; beats: number; rest?: boolean }> = [
  { freq: B4, beats: 1 },
  { freq: A4, beats: 1 },
  { freq: G4, beats: 1 },
  { freq: E4, beats: 1 },
  { freq: D4, beats: 2 },
  { freq: E4, beats: 2 },
  { freq: G4, beats: 1 },
  { freq: A4, beats: 1 },
  { freq: B4, beats: 1 },
  { freq: 0, beats: 1, rest: true },
  { freq: E5, beats: 2 },
  { freq: D5, beats: 1 },
  { freq: B4, beats: 1 },
  // total = 16 beats
  { freq: A4, beats: 2 },
  { freq: G4, beats: 1 },
  { freq: A4, beats: 1 },
  { freq: B4, beats: 2 },
  { freq: G4, beats: 1 },
  { freq: E4, beats: 1 },
  { freq: D4, beats: 1 },
  { freq: E4, beats: 1 },
  { freq: G4, beats: 2 },
  { freq: A4, beats: 1 },
  { freq: B4, beats: 1 },
  { freq: E5, beats: 1 },
  { freq: D5, beats: 1 },
  // total = 16 beats
];

// --- Pad chord voicings (E minor) ---
// Em: E3, G3, B3 (with detuning for richness)
const PAD_CHORD_FREQS = [E3, G3, B3];

// ============================================================================
// Audio graph interfaces
// ============================================================================

interface SoundtrackNodes {
  ctx: AudioContext;
  masterGain: GainNode;

  // Drum stem nodes
  drumGain: GainNode;
  noiseBuffer: AudioBuffer;

  // Bass stem nodes
  bassOsc: OscillatorNode;
  bassGain: GainNode;
  bassDistortion: WaveShaperNode;

  // Pad stem nodes
  padOscs: OscillatorNode[];  // 3 notes x 3 detuned = 9 oscillators
  padFilter: BiquadFilterNode;
  padGain: GainNode;
  padLfo: OscillatorNode;
  padLfoGain: GainNode;

  // Lead stem nodes
  leadOsc: OscillatorNode;
  leadVibratoLfo: OscillatorNode;
  leadVibratoGain: GainNode;
  leadGain: GainNode;
  leadDelay: DelayNode;
  leadDelayGain: GainNode;
}

// ============================================================================
// Utility functions
// ============================================================================

/** Create a white noise AudioBuffer */
function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2; // 2 seconds
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** Create a waveshaper distortion curve */
function makeDistortionCurve(amount: number): Float32Array {
  const samples = 256;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

/** Convert BPM to seconds per beat */
function beatDuration(bpm: number): number {
  return 60.0 / bpm;
}

/** Seconds per bar (4 beats) */
function barDuration(bpm: number): number {
  return beatDuration(bpm) * 4;
}

// ============================================================================
// Hook
// ============================================================================

export interface UseDynamicSoundtrackReturn {
  start: () => void;
  stop: () => void;
  setIntensity: (level: IntensityLevel) => void;
  setMasterVolume: (vol: number) => void;
  setMuted: (muted: boolean) => void;
  isPlaying: boolean;
  isMuted: boolean;
}

export function useDynamicSoundtrack(): UseDynamicSoundtrackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  const nodesRef = useRef<SoundtrackNodes | null>(null);
  const playingRef = useRef(false);
  const mutedRef = useRef(true);

  // Current BPM (mutable for climax tempo change)
  const bpmRef = useRef(BASE_BPM);

  // Current intensity level (for bar-boundary transitions)
  const currentIntensityRef = useRef<IntensityLevel>('cruise');
  const pendingIntensityRef = useRef<IntensityLevel | null>(null);

  // Scheduling refs
  const drumTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bassTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const padSweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pattern position tracking
  const bassPatternIdxRef = useRef(0);
  const leadPhraseRef = useRef(0); // 0 = phrase A, 1 = phrase B
  const leadNoteIdxRef = useRef(0);
  const leadBeatsPlayedRef = useRef(0); // count total beats to switch phrases

  // Master volume multiplier (user-adjustable)
  const masterVolRef = useRef(MASTER_VOLUME);

  // ========================================================================
  // Build audio graph
  // ========================================================================
  const buildGraph = useCallback((): SoundtrackNodes => {
    const ctx = new AudioContext();

    // --- Master gain ---
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0; // Start silent, fade in on start()
    masterGain.connect(ctx.destination);

    // --- Noise buffer (shared) ---
    const noiseBuffer = createNoiseBuffer(ctx);

    // ====================================================================
    // DRUM STEM
    // ====================================================================
    const drumGain = ctx.createGain();
    drumGain.gain.value = 0.3; // Initial cruise level
    drumGain.connect(masterGain);

    // ====================================================================
    // BASS STEM
    // ====================================================================
    const bassDistortion = ctx.createWaveShaper();
    bassDistortion.curve = makeDistortionCurve(8) as unknown as Float32Array<ArrayBuffer>;
    bassDistortion.oversample = '4x';

    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.5;

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = 300;
    bassFilter.Q.value = 2;

    const bassOsc = ctx.createOscillator();
    bassOsc.type = 'sine';
    bassOsc.frequency.value = E2;

    bassOsc.connect(bassDistortion);
    bassDistortion.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(masterGain);

    // ====================================================================
    // PAD STEM
    // ====================================================================
    const padGain = ctx.createGain();
    padGain.gain.value = 0.7;

    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 800;
    padFilter.Q.value = 1.5;
    padFilter.connect(padGain);
    padGain.connect(masterGain);

    // LFO for gentle filter sweep
    const padLfo = ctx.createOscillator();
    padLfo.type = 'sine';
    padLfo.frequency.value = 0.08; // Very slow sweep (~12 second cycle)
    const padLfoGain = ctx.createGain();
    padLfoGain.gain.value = 400; // Sweep range: 800 +/- 400 Hz
    padLfo.connect(padLfoGain);
    padLfoGain.connect(padFilter.frequency);

    // 3 chord notes, each with 3 detuned sawtooth oscillators
    const padOscs: OscillatorNode[] = [];
    const DETUNE_CENTS = [-8, 0, 8]; // Slight detuning for richness

    for (const baseFreq of PAD_CHORD_FREQS) {
      for (const detune of DETUNE_CENTS) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = baseFreq;
        osc.detune.value = detune;
        const oscGain = ctx.createGain();
        oscGain.gain.value = 0.06; // Each voice quiet, 9 voices total
        osc.connect(oscGain);
        oscGain.connect(padFilter);
        padOscs.push(osc);
      }
    }

    // ====================================================================
    // LEAD STEM
    // ====================================================================
    const leadGain = ctx.createGain();
    leadGain.gain.value = 0.0; // Start silent (cruise = no lead)

    // Delay effect for lead (slapback echo)
    const leadDelay = ctx.createDelay(1.0);
    leadDelay.delayTime.value = beatDuration(BASE_BPM) * 0.75; // Dotted-eighth delay
    const leadDelayGain = ctx.createGain();
    leadDelayGain.gain.value = 0.3; // Feedback amount
    const leadDelayFilter = ctx.createBiquadFilter();
    leadDelayFilter.type = 'lowpass';
    leadDelayFilter.frequency.value = 2000;

    const leadOsc = ctx.createOscillator();
    leadOsc.type = 'square';
    leadOsc.frequency.value = E4;

    // Vibrato LFO
    const leadVibratoLfo = ctx.createOscillator();
    leadVibratoLfo.type = 'sine';
    leadVibratoLfo.frequency.value = 5; // 5Hz vibrato
    const leadVibratoGain = ctx.createGain();
    leadVibratoGain.gain.value = 3; // +/- 3Hz frequency modulation (subtle)
    leadVibratoLfo.connect(leadVibratoGain);
    leadVibratoGain.connect(leadOsc.frequency);

    // Lead signal path: osc -> leadGain -> masterGain
    // + delay: osc -> delay -> delayFilter -> delayGain -> masterGain
    //                          delayGain -> delay (feedback)
    leadOsc.connect(leadGain);
    leadGain.connect(masterGain);

    leadOsc.connect(leadDelay);
    leadDelay.connect(leadDelayFilter);
    leadDelayFilter.connect(leadDelayGain);
    leadDelayGain.connect(masterGain);
    leadDelayGain.connect(leadDelay); // Feedback loop

    // ====================================================================
    // Start all continuous oscillators
    // ====================================================================
    bassOsc.start();
    padLfo.start();
    for (const osc of padOscs) osc.start();
    leadOsc.start();
    leadVibratoLfo.start();

    const nodes: SoundtrackNodes = {
      ctx,
      masterGain,
      drumGain,
      noiseBuffer,
      bassOsc,
      bassGain,
      bassDistortion,
      padOscs,
      padFilter,
      padGain,
      padLfo,
      padLfoGain,
      leadOsc,
      leadVibratoLfo,
      leadVibratoGain,
      leadGain,
      leadDelay,
      leadDelayGain,
    };

    return nodes;
  }, []);

  // ========================================================================
  // Drum scheduling - schedule one bar of drum hits
  // ========================================================================
  const scheduleDrumBar = useCallback((startTime: number) => {
    const nodes = nodesRef.current;
    if (!nodes || !playingRef.current) return;

    const ctx = nodes.ctx;
    const beat = beatDuration(bpmRef.current);

    // Pattern per bar:
    // Beat 1: kick
    // Beat 1+: hi-hat (eighth notes through the bar)
    // Beat 2: snare
    // Beat 3: kick
    // Beat 4: snare

    for (let eighth = 0; eighth < 8; eighth++) {
      const t = startTime + eighth * (beat / 2);
      if (t < ctx.currentTime) continue;

      const beatNum = Math.floor(eighth / 2); // 0-3
      const isDownbeat = eighth % 2 === 0;

      // --- Kick drum on beats 1 and 3 ---
      if (isDownbeat && (beatNum === 0 || beatNum === 2)) {
        // Kick: sine wave pitch drop 150Hz -> 50Hz + noise burst
        const kickOsc = ctx.createOscillator();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(150, t);
        kickOsc.frequency.exponentialRampToValueAtTime(50, t + 0.08);

        const kickGain = ctx.createGain();
        kickGain.gain.setValueAtTime(0.9, t);
        kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

        kickOsc.connect(kickGain);
        kickGain.connect(nodes.drumGain);
        kickOsc.start(t);
        kickOsc.stop(t + 0.25);

        // Kick click (short noise burst for transient)
        const clickSource = ctx.createBufferSource();
        clickSource.buffer = nodes.noiseBuffer;
        const clickFilter = ctx.createBiquadFilter();
        clickFilter.type = 'bandpass';
        clickFilter.frequency.value = 3000;
        clickFilter.Q.value = 2;
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.3, t);
        clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
        clickSource.connect(clickFilter);
        clickFilter.connect(clickGain);
        clickGain.connect(nodes.drumGain);
        clickSource.start(t);
        clickSource.stop(t + 0.02);
      }

      // --- Snare on beats 2 and 4 ---
      if (isDownbeat && (beatNum === 1 || beatNum === 3)) {
        // Snare body: noise burst through bandpass
        const snareSource = ctx.createBufferSource();
        snareSource.buffer = nodes.noiseBuffer;
        const snareBp = ctx.createBiquadFilter();
        snareBp.type = 'bandpass';
        snareBp.frequency.value = 1000;
        snareBp.Q.value = 1.2;
        const snareGain = ctx.createGain();
        snareGain.gain.setValueAtTime(0.7, t);
        snareGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        snareSource.connect(snareBp);
        snareBp.connect(snareGain);
        snareGain.connect(nodes.drumGain);
        snareSource.start(t);
        snareSource.stop(t + 0.15);

        // Snare tone: short triangle burst at 180Hz
        const snareTone = ctx.createOscillator();
        snareTone.type = 'triangle';
        snareTone.frequency.value = 180;
        const snareToneGain = ctx.createGain();
        snareToneGain.gain.setValueAtTime(0.3, t);
        snareToneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        snareTone.connect(snareToneGain);
        snareToneGain.connect(nodes.drumGain);
        snareTone.start(t);
        snareTone.stop(t + 0.08);
      }

      // --- Hi-hat on every eighth note ---
      {
        const hhSource = ctx.createBufferSource();
        hhSource.buffer = nodes.noiseBuffer;
        const hhFilter = ctx.createBiquadFilter();
        hhFilter.type = 'highpass';
        hhFilter.frequency.value = 8000;
        hhFilter.Q.value = 1;
        const hhGain = ctx.createGain();
        // Accent on downbeats, softer on upbeats
        const hhVol = isDownbeat ? 0.25 : 0.12;
        hhGain.gain.setValueAtTime(hhVol, t);
        hhGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

        hhSource.connect(hhFilter);
        hhFilter.connect(hhGain);
        hhGain.connect(nodes.drumGain);
        hhSource.start(t);
        hhSource.stop(t + 0.05);
      }
    }

    // Schedule next bar
    const barLen = barDuration(bpmRef.current);
    const nextBarTime = startTime + barLen;
    const delayMs = Math.max(0, (nextBarTime - ctx.currentTime - 0.05) * 1000);
    drumTimerRef.current = setTimeout(() => {
      scheduleDrumBar(nextBarTime);
    }, delayMs);
  }, []);

  // ========================================================================
  // Bass scheduling - schedule one pattern note
  // ========================================================================
  const scheduleBassNote = useCallback((startTime: number) => {
    const nodes = nodesRef.current;
    if (!nodes || !playingRef.current) return;

    const ctx = nodes.ctx;
    const beat = beatDuration(bpmRef.current);
    const pattern = BASS_PATTERN;
    const idx = bassPatternIdxRef.current % pattern.length;
    const note = pattern[idx];

    // Glide to new note
    nodes.bassOsc.frequency.setTargetAtTime(note.freq, startTime, 0.05);

    // Schedule next note
    const noteDuration = note.beats * beat;
    const nextTime = startTime + noteDuration;
    const delayMs = Math.max(0, (nextTime - ctx.currentTime - 0.05) * 1000);

    bassPatternIdxRef.current = idx + 1;
    bassTimerRef.current = setTimeout(() => {
      scheduleBassNote(nextTime);
    }, delayMs);
  }, []);

  // ========================================================================
  // Lead scheduling - schedule one note of the melody
  // ========================================================================
  const scheduleLeadNote = useCallback((startTime: number) => {
    const nodes = nodesRef.current;
    if (!nodes || !playingRef.current) return;

    const ctx = nodes.ctx;
    const beat = beatDuration(bpmRef.current);
    const phrase = leadPhraseRef.current === 0 ? LEAD_PHRASE_A : LEAD_PHRASE_B;
    const idx = leadNoteIdxRef.current % phrase.length;
    const note = phrase[idx];

    if (note.rest) {
      // Rest: silence the lead briefly
      nodes.leadOsc.frequency.setValueAtTime(0.001, startTime);
    } else {
      // Play note with slight portamento
      nodes.leadOsc.frequency.setTargetAtTime(note.freq, startTime, 0.02);
    }

    // Track beats for phrase switching (every 32 beats = 8 bars)
    leadBeatsPlayedRef.current += note.beats;
    if (leadBeatsPlayedRef.current >= 32) {
      leadBeatsPlayedRef.current = 0;
      leadPhraseRef.current = leadPhraseRef.current === 0 ? 1 : 0;
    }

    const noteDuration = note.beats * beat;
    const nextTime = startTime + noteDuration;
    const delayMs = Math.max(0, (nextTime - ctx.currentTime - 0.05) * 1000);

    leadNoteIdxRef.current = (idx + 1) % phrase.length;
    leadTimerRef.current = setTimeout(() => {
      scheduleLeadNote(nextTime);
    }, delayMs);
  }, []);

  // ========================================================================
  // Pad filter sweep - continuous slow LFO is handled by the padLfo oscillator
  // We also do a periodic sweep reset to keep things evolving
  // ========================================================================
  const startPadSweep = useCallback(() => {
    // The pad LFO already handles the filter sweep automatically.
    // This function could add periodic chord changes, but for now
    // the sustained Em chord with filter movement is musical enough.
  }, []);

  // ========================================================================
  // Apply intensity levels (crossfade stems)
  // ========================================================================
  const applyIntensity = useCallback((level: IntensityLevel) => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const now = nodes.ctx.currentTime;
    const preset = INTENSITY_PRESETS[level];

    // Crossfade each stem to target volume
    nodes.drumGain.gain.setTargetAtTime(preset.drums, now, CROSSFADE_TIME);
    nodes.bassGain.gain.setTargetAtTime(preset.bass, now, CROSSFADE_TIME);
    nodes.padGain.gain.setTargetAtTime(preset.pad, now, CROSSFADE_TIME);
    nodes.leadGain.gain.setTargetAtTime(preset.lead, now, CROSSFADE_TIME);

    // Tempo change for climax
    const targetBpm = level === 'climax' ? CLIMAX_BPM : BASE_BPM;
    bpmRef.current = targetBpm;

    // Update delay time to match BPM
    if (nodes.leadDelay) {
      nodes.leadDelay.delayTime.setTargetAtTime(
        beatDuration(targetBpm) * 0.75,
        now,
        CROSSFADE_TIME
      );
    }

    currentIntensityRef.current = level;
  }, []);

  // ========================================================================
  // Bar boundary checker - checks for pending intensity changes
  // ========================================================================
  const scheduleBarBoundary = useCallback((nextBarTime: number) => {
    const nodes = nodesRef.current;
    if (!nodes || !playingRef.current) return;

    const ctx = nodes.ctx;

    // Apply pending intensity change at bar boundary
    if (pendingIntensityRef.current !== null && pendingIntensityRef.current !== currentIntensityRef.current) {
      applyIntensity(pendingIntensityRef.current);
      pendingIntensityRef.current = null;
    }

    // Schedule next bar boundary check
    const barLen = barDuration(bpmRef.current);
    const nextTime = nextBarTime + barLen;
    const delayMs = Math.max(0, (nextTime - ctx.currentTime - 0.02) * 1000);
    barTimerRef.current = setTimeout(() => {
      scheduleBarBoundary(nextTime);
    }, delayMs);
  }, [applyIntensity]);

  // ========================================================================
  // Clear all scheduling timers
  // ========================================================================
  const clearAllTimers = useCallback(() => {
    if (drumTimerRef.current) { clearTimeout(drumTimerRef.current); drumTimerRef.current = null; }
    if (bassTimerRef.current) { clearTimeout(bassTimerRef.current); bassTimerRef.current = null; }
    if (leadTimerRef.current) { clearTimeout(leadTimerRef.current); leadTimerRef.current = null; }
    if (padSweepTimerRef.current) { clearTimeout(padSweepTimerRef.current); padSweepTimerRef.current = null; }
    if (barTimerRef.current) { clearTimeout(barTimerRef.current); barTimerRef.current = null; }
  }, []);

  // ========================================================================
  // Public API
  // ========================================================================

  const start = useCallback(() => {
    if (playingRef.current) return;
    playingRef.current = true;
    setIsPlaying(true);

    // Build graph if needed
    if (!nodesRef.current) {
      nodesRef.current = buildGraph();
    }

    const nodes = nodesRef.current;
    bpmRef.current = BASE_BPM;
    currentIntensityRef.current = 'cruise';
    pendingIntensityRef.current = null;
    bassPatternIdxRef.current = 0;
    leadPhraseRef.current = 0;
    leadNoteIdxRef.current = 0;
    leadBeatsPlayedRef.current = 0;

    // Resume context
    if (mutedRef.current) {
      void nodes.ctx.suspend();
    } else {
      void nodes.ctx.resume();
    }

    // Fade in master gain
    const now = nodes.ctx.currentTime;
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(0, now);
    nodes.masterGain.gain.linearRampToValueAtTime(masterVolRef.current, now + 2.0);

    // Apply initial intensity
    applyIntensity('cruise');

    // Start all stem schedulers
    const startTime = now + 0.1; // Small offset to allow graph to settle
    scheduleDrumBar(startTime);
    scheduleBassNote(startTime);
    scheduleLeadNote(startTime);
    startPadSweep();

    // Start bar boundary checker
    const firstBarEnd = startTime + barDuration(bpmRef.current);
    scheduleBarBoundary(firstBarEnd);
  }, [buildGraph, applyIntensity, scheduleDrumBar, scheduleBassNote, scheduleLeadNote, startPadSweep, scheduleBarBoundary]);

  const stop = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;
    setIsPlaying(false);

    clearAllTimers();

    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;

    // Fade out master gain
    const now = nodes.ctx.currentTime;
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
    nodes.masterGain.gain.linearRampToValueAtTime(0, now + 1.0);

    // Suspend context after fade out
    setTimeout(() => {
      if (!playingRef.current && nodes.ctx.state === 'running') {
        void nodes.ctx.suspend();
      }
    }, 1100);
  }, [clearAllTimers]);

  const setIntensity = useCallback((level: IntensityLevel) => {
    if (level === currentIntensityRef.current) return;
    // Queue intensity change for next bar boundary
    pendingIntensityRef.current = level;
  }, []);

  const setMasterVolume = useCallback((vol: number) => {
    masterVolRef.current = Math.max(0, Math.min(1, vol));
    const nodes = nodesRef.current;
    if (nodes && nodes.ctx.state === 'running') {
      nodes.masterGain.gain.setTargetAtTime(masterVolRef.current, nodes.ctx.currentTime, 0.1);
    }
  }, []);

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

  // ========================================================================
  // Cleanup on unmount
  // ========================================================================
  useEffect(() => {
    return () => {
      clearAllTimers();
      const nodes = nodesRef.current;
      if (!nodes) return;
      try {
        nodes.bassOsc.stop();
        nodes.padLfo.stop();
        for (const osc of nodes.padOscs) osc.stop();
        nodes.leadOsc.stop();
        nodes.leadVibratoLfo.stop();
        void nodes.ctx.close();
      } catch {
        // Context may already be closed
      }
      nodesRef.current = null;
    };
  }, [clearAllTimers]);

  return {
    start,
    stop,
    setIntensity,
    setMasterVolume,
    setMuted,
    isPlaying,
    isMuted,
  };
}

export default useDynamicSoundtrack;
