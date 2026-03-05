/**
 * useMusicStems.ts - Layered music stem crossfade system
 *
 * Manages 4 procedural audio stems that crossfade based on race intensity:
 *  - Bass: Low sine oscillator (50-80 Hz) with subtle pulsing LFO
 *  - Drums: Procedural kick/snare/hihat at 120 BPM
 *  - Synth: Detuned sawtooth pair through lowpass filter (pad-like)
 *  - Lead: Square wave melody sequence (4-note ascending pattern)
 *
 * Intensity mapping (0.0 to 1.0):
 *  - 0.00-0.25: Bass only
 *  - 0.25-0.50: Bass + drums fade in
 *  - 0.50-0.75: Bass + drums + synth fade in
 *  - 0.75-1.00: All layers including lead
 *
 * All transitions use linearRampToValueAtTime synced to bar boundaries
 * (every 2 seconds at 120 BPM).
 *
 * Supplements (does NOT replace) the existing useDynamicSoundtrack and
 * useEngineSound hooks. Coordinates with engine sound by ducking music
 * volume when the engine is revving hard.
 */
import { useEffect, useRef, useCallback, useState } from 'react';

// ============================================================================
// Constants
// ============================================================================

const BPM = 120;
const BEAT_DURATION = 60 / BPM;             // 0.5 seconds per beat
const BAR_DURATION = BEAT_DURATION * 4;      // 2.0 seconds per bar
const MASTER_VOLUME = 0.18;                  // Base master volume (sits under engine sound)
const CROSSFADE_DURATION = 0.4;              // seconds for stem crossfades

// Stem volume targets at full intensity
const BASS_MAX = 0.6;
const DRUMS_MAX = 0.5;
const SYNTH_MAX = 0.35;
const LEAD_MAX = 0.3;

// Bass oscillator frequency range
const BASS_FREQ_LOW = 55;    // A1
const BASS_FREQ_HIGH = 73.4; // D2

// Bass LFO for pulsing
const BASS_LFO_RATE = 0.25;    // Hz (4-second pulse cycle)
const BASS_LFO_DEPTH = 0.15;   // volume modulation depth

// Synth pad frequencies (detuned pair for richness)
const SYNTH_FREQ_A = 220;      // A3
const SYNTH_FREQ_B = 223;      // slightly detuned A3
const SYNTH_FILTER_MIN = 400;  // lowpass cutoff minimum
const SYNTH_FILTER_MAX = 2000; // lowpass cutoff maximum (opens with intensity)

// Lead melody: simple ascending pattern in A minor (quantized to 120 BPM)
// Each note is 1 beat (0.5s). Pattern repeats every 4 beats (1 bar).
const LEAD_NOTES = [
  220,  // A3
  262,  // C4
  330,  // E4
  392,  // G4
];

// Drum pattern constants
const KICK_FREQ_START = 150;
const KICK_FREQ_END = 50;
const KICK_DECAY = 0.1;       // seconds
const SNARE_FREQ = 200;
const SNARE_DECAY = 0.08;
const HIHAT_FREQ = 8000;
const HIHAT_DECAY = 0.03;

// Overtake intensity spike
const OVERTAKE_SPIKE_DURATION = 3000; // ms
const OVERTAKE_INTENSITY = 1.0;

// Victory/defeat fade
const RESULT_FADE_DURATION = 2.0; // seconds

// Engine ducking
const ENGINE_DUCK_FACTOR = 0.5; // music volume multiplied by this when engine is revving hard

// ============================================================================
// Types
// ============================================================================

export interface MusicStemsRaceState {
  speed: number;
  maxSpeed: number;
  gap: number;          // gap_seconds (positive = behind, negative = ahead)
  lapNumber: number;
  totalLaps: number;
  isCloseRacing: boolean;
  isFinalLap: boolean;
  justOvertook: boolean;
  raceFinished: boolean;
  won: boolean;
}

export interface UseMusicStemsReturn {
  start: () => void;
  stop: () => void;
  updateRaceState: (state: MusicStemsRaceState) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  isPlaying: boolean;
}

// ============================================================================
// Audio node structures
// ============================================================================

interface StemNodes {
  ctx: AudioContext;
  masterGain: GainNode;

  // Bass stem
  bassOsc: OscillatorNode;
  bassGain: GainNode;
  bassLfo: OscillatorNode;
  bassLfoGain: GainNode;

  // Drums stem
  drumsGain: GainNode;
  noiseBuffer: AudioBuffer;

  // Synth stem
  synthOscA: OscillatorNode;
  synthOscB: OscillatorNode;
  synthFilter: BiquadFilterNode;
  synthGain: GainNode;

  // Lead stem
  leadOsc: OscillatorNode;
  leadGain: GainNode;
}

// ============================================================================
// Utility
// ============================================================================

/** Create a white noise AudioBuffer */
function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Compute how much a stem should be "on" (0-1) given the global intensity
 * and the stem's activation range.
 *
 * Example: drums activate at 0.25, full at 0.5.
 *   - intensity 0.0 => 0
 *   - intensity 0.25 => 0
 *   - intensity 0.375 => 0.5
 *   - intensity 0.5+ => 1.0
 */
function stemLevel(intensity: number, activateAt: number, fullAt: number): number {
  if (intensity <= activateAt) return 0;
  if (intensity >= fullAt) return 1;
  return (intensity - activateAt) / (fullAt - activateAt);
}

// ============================================================================
// Hook implementation
// ============================================================================

export function useMusicStems(): UseMusicStemsReturn {
  const [isPlaying, setIsPlaying] = useState(false);

  const nodesRef = useRef<StemNodes | null>(null);
  const playingRef = useRef(false);
  const mutedRef = useRef(true);
  const volumeRef = useRef(MASTER_VOLUME);

  // Intensity tracking
  const intensityRef = useRef(0);
  const targetIntensityRef = useRef(0);

  // Overtake spike state
  const overtakeSpikeRef = useRef(false);
  const overtakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-overtake intensity (to restore after spike)
  const preOvertakeIntensityRef = useRef(0);

  // Scheduling timers
  const drumTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lead melody position
  const leadNoteIdxRef = useRef(0);

  // Race state tracking for engine ducking
  const engineDuckRef = useRef(1.0); // 1.0 = no duck, ENGINE_DUCK_FACTOR = ducked

  // ========================================================================
  // Build the audio graph
  // ========================================================================
  const buildGraph = useCallback((): StemNodes => {
    const ctx = new AudioContext();

    // Master gain: starts silent
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);

    // Shared noise buffer
    const noiseBuffer = createNoiseBuffer(ctx);

    // ------------------------------------------------------------------
    // BASS STEM: Sine oscillator with LFO pulsing
    // ------------------------------------------------------------------
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0;
    bassGain.connect(masterGain);

    const bassOsc = ctx.createOscillator();
    bassOsc.type = 'sine';
    bassOsc.frequency.value = BASS_FREQ_LOW;
    bassOsc.connect(bassGain);

    // LFO for subtle volume pulsing
    const bassLfo = ctx.createOscillator();
    bassLfo.type = 'sine';
    bassLfo.frequency.value = BASS_LFO_RATE;
    const bassLfoGain = ctx.createGain();
    bassLfoGain.gain.value = BASS_LFO_DEPTH;
    bassLfo.connect(bassLfoGain);
    bassLfoGain.connect(bassGain.gain);

    // ------------------------------------------------------------------
    // DRUMS STEM: GainNode hub (individual hits scheduled ad-hoc)
    // ------------------------------------------------------------------
    const drumsGain = ctx.createGain();
    drumsGain.gain.value = 0;
    drumsGain.connect(masterGain);

    // ------------------------------------------------------------------
    // SYNTH STEM: Detuned sawtooth pair -> lowpass filter
    // ------------------------------------------------------------------
    const synthFilter = ctx.createBiquadFilter();
    synthFilter.type = 'lowpass';
    synthFilter.frequency.value = SYNTH_FILTER_MIN;
    synthFilter.Q.value = 1.5;

    const synthGain = ctx.createGain();
    synthGain.gain.value = 0;

    synthFilter.connect(synthGain);
    synthGain.connect(masterGain);

    const synthOscA = ctx.createOscillator();
    synthOscA.type = 'sawtooth';
    synthOscA.frequency.value = SYNTH_FREQ_A;
    const synthOscAGain = ctx.createGain();
    synthOscAGain.gain.value = 0.3;
    synthOscA.connect(synthOscAGain);
    synthOscAGain.connect(synthFilter);

    const synthOscB = ctx.createOscillator();
    synthOscB.type = 'sawtooth';
    synthOscB.frequency.value = SYNTH_FREQ_B;
    const synthOscBGain = ctx.createGain();
    synthOscBGain.gain.value = 0.3;
    synthOscB.connect(synthOscBGain);
    synthOscBGain.connect(synthFilter);

    // ------------------------------------------------------------------
    // LEAD STEM: Square wave melody
    // ------------------------------------------------------------------
    const leadGain = ctx.createGain();
    leadGain.gain.value = 0;
    leadGain.connect(masterGain);

    const leadOsc = ctx.createOscillator();
    leadOsc.type = 'square';
    leadOsc.frequency.value = LEAD_NOTES[0];

    // Volume shape for lead: quieter square wave
    const leadOscGain = ctx.createGain();
    leadOscGain.gain.value = 0.25;
    leadOsc.connect(leadOscGain);
    leadOscGain.connect(leadGain);

    // ------------------------------------------------------------------
    // Start all continuous oscillators
    // ------------------------------------------------------------------
    bassOsc.start();
    bassLfo.start();
    synthOscA.start();
    synthOscB.start();
    leadOsc.start();

    return {
      ctx,
      masterGain,
      bassOsc,
      bassGain,
      bassLfo,
      bassLfoGain,
      drumsGain,
      noiseBuffer,
      synthOscA,
      synthOscB,
      synthFilter,
      synthGain,
      leadOsc,
      leadGain,
    };
  }, []);

  // ========================================================================
  // Schedule one bar of drum hits
  // ========================================================================
  const scheduleDrumBar = useCallback((barStartTime: number) => {
    const nodes = nodesRef.current;
    if (!nodes || !playingRef.current) return;

    const ctx = nodes.ctx;

    // Pattern per bar (4 beats at 120 BPM = 2 seconds):
    // Beat 1: kick + hihat
    // Beat 1.5 (eighth): hihat
    // Beat 2: snare + hihat
    // Beat 2.5: hihat
    // Beat 3: kick + hihat
    // Beat 3.5: hihat
    // Beat 4: snare + hihat
    // Beat 4.5: hihat

    for (let eighth = 0; eighth < 8; eighth++) {
      const t = barStartTime + eighth * (BEAT_DURATION / 2);
      if (t < ctx.currentTime - 0.01) continue; // skip past events

      const beatNum = Math.floor(eighth / 2); // 0-3
      const isDownbeat = eighth % 2 === 0;

      // Kick on beats 1 and 3 (beatNum 0 and 2)
      if (isDownbeat && (beatNum === 0 || beatNum === 2)) {
        const kickOsc = ctx.createOscillator();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(KICK_FREQ_START, t);
        kickOsc.frequency.exponentialRampToValueAtTime(KICK_FREQ_END, t + KICK_DECAY);

        const kickGain = ctx.createGain();
        kickGain.gain.setValueAtTime(0.8, t);
        kickGain.gain.exponentialRampToValueAtTime(0.001, t + KICK_DECAY + 0.05);

        kickOsc.connect(kickGain);
        kickGain.connect(nodes.drumsGain);
        kickOsc.start(t);
        kickOsc.stop(t + KICK_DECAY + 0.1);
      }

      // Snare on beats 2 and 4 (beatNum 1 and 3)
      if (isDownbeat && (beatNum === 1 || beatNum === 3)) {
        // Noise burst through bandpass
        const snareSource = ctx.createBufferSource();
        snareSource.buffer = nodes.noiseBuffer;
        const snareBp = ctx.createBiquadFilter();
        snareBp.type = 'bandpass';
        snareBp.frequency.value = 1200;
        snareBp.Q.value = 1.0;
        const snareGain = ctx.createGain();
        snareGain.gain.setValueAtTime(0.6, t);
        snareGain.gain.exponentialRampToValueAtTime(0.001, t + SNARE_DECAY + 0.04);
        snareSource.connect(snareBp);
        snareBp.connect(snareGain);
        snareGain.connect(nodes.drumsGain);
        snareSource.start(t);
        snareSource.stop(t + SNARE_DECAY + 0.06);

        // Tonal component: short sine at 200 Hz
        const snareTone = ctx.createOscillator();
        snareTone.type = 'sine';
        snareTone.frequency.value = SNARE_FREQ;
        const snareToneGain = ctx.createGain();
        snareToneGain.gain.setValueAtTime(0.25, t);
        snareToneGain.gain.exponentialRampToValueAtTime(0.001, t + SNARE_DECAY);
        snareTone.connect(snareToneGain);
        snareToneGain.connect(nodes.drumsGain);
        snareTone.start(t);
        snareTone.stop(t + SNARE_DECAY + 0.02);
      }

      // Hi-hat on every eighth note
      {
        const hhSource = ctx.createBufferSource();
        hhSource.buffer = nodes.noiseBuffer;
        const hhFilter = ctx.createBiquadFilter();
        hhFilter.type = 'highpass';
        hhFilter.frequency.value = HIHAT_FREQ;
        hhFilter.Q.value = 1;
        const hhGain = ctx.createGain();
        const hhVol = isDownbeat ? 0.2 : 0.1;
        hhGain.gain.setValueAtTime(hhVol, t);
        hhGain.gain.exponentialRampToValueAtTime(0.001, t + HIHAT_DECAY);
        hhSource.connect(hhFilter);
        hhFilter.connect(hhGain);
        hhGain.connect(nodes.drumsGain);
        hhSource.start(t);
        hhSource.stop(t + HIHAT_DECAY + 0.02);
      }
    }

    // Schedule next bar
    const nextBarTime = barStartTime + BAR_DURATION;
    const delayMs = Math.max(0, (nextBarTime - ctx.currentTime - 0.05) * 1000);
    drumTimerRef.current = setTimeout(() => {
      scheduleDrumBar(nextBarTime);
    }, delayMs);
  }, []);

  // ========================================================================
  // Schedule lead melody notes (one note per beat)
  // ========================================================================
  const scheduleLeadNote = useCallback((noteTime: number) => {
    const nodes = nodesRef.current;
    if (!nodes || !playingRef.current) return;

    const ctx = nodes.ctx;
    const idx = leadNoteIdxRef.current % LEAD_NOTES.length;
    const freq = LEAD_NOTES[idx];

    // Portamento to new note
    nodes.leadOsc.frequency.setTargetAtTime(freq, noteTime, 0.02);

    leadNoteIdxRef.current = idx + 1;

    // Schedule next note (one beat later)
    const nextTime = noteTime + BEAT_DURATION;
    const delayMs = Math.max(0, (nextTime - ctx.currentTime - 0.05) * 1000);
    leadTimerRef.current = setTimeout(() => {
      scheduleLeadNote(nextTime);
    }, delayMs);
  }, []);

  // ========================================================================
  // Apply intensity to stem gains (called on bar boundaries)
  // ========================================================================
  const applyIntensity = useCallback((intensity: number) => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const now = nodes.ctx.currentTime;
    const duck = engineDuckRef.current;

    // Bass: always present but scales 0.3-1.0 with intensity
    const bassLevel = 0.3 + 0.7 * Math.min(1, intensity * 2);
    const bassTarget = BASS_MAX * bassLevel * duck;
    nodes.bassGain.gain.linearRampToValueAtTime(bassTarget, now + CROSSFADE_DURATION);

    // Bass frequency: rises with intensity
    const bassFreq = BASS_FREQ_LOW + (BASS_FREQ_HIGH - BASS_FREQ_LOW) * intensity;
    nodes.bassOsc.frequency.setTargetAtTime(bassFreq, now, CROSSFADE_DURATION);

    // Drums: activate at 0.25, full at 0.5
    const drumsLevel = stemLevel(intensity, 0.25, 0.5);
    nodes.drumsGain.gain.linearRampToValueAtTime(DRUMS_MAX * drumsLevel * duck, now + CROSSFADE_DURATION);

    // Synth: activate at 0.5, full at 0.75
    const synthLevel = stemLevel(intensity, 0.5, 0.75);
    nodes.synthGain.gain.linearRampToValueAtTime(SYNTH_MAX * synthLevel * duck, now + CROSSFADE_DURATION);

    // Synth filter opens with intensity
    const filterFreq = SYNTH_FILTER_MIN + (SYNTH_FILTER_MAX - SYNTH_FILTER_MIN) * intensity;
    nodes.synthFilter.frequency.setTargetAtTime(filterFreq, now, CROSSFADE_DURATION);

    // Lead: activate at 0.75, full at 1.0
    const leadLevel = stemLevel(intensity, 0.75, 1.0);
    nodes.leadGain.gain.linearRampToValueAtTime(LEAD_MAX * leadLevel * duck, now + CROSSFADE_DURATION);

    intensityRef.current = intensity;
  }, []);

  // ========================================================================
  // Bar boundary scheduler: applies pending intensity changes
  // ========================================================================
  const scheduleBarBoundary = useCallback((nextBarTime: number) => {
    const nodes = nodesRef.current;
    if (!nodes || !playingRef.current) return;

    const ctx = nodes.ctx;

    // Apply the target intensity at this bar boundary
    const target = overtakeSpikeRef.current
      ? OVERTAKE_INTENSITY
      : targetIntensityRef.current;
    if (target !== intensityRef.current) {
      applyIntensity(target);
    }

    // Schedule next bar boundary
    const nextTime = nextBarTime + BAR_DURATION;
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
    if (leadTimerRef.current) { clearTimeout(leadTimerRef.current); leadTimerRef.current = null; }
    if (barTimerRef.current) { clearTimeout(barTimerRef.current); barTimerRef.current = null; }
    if (overtakeTimerRef.current) { clearTimeout(overtakeTimerRef.current); overtakeTimerRef.current = null; }
  }, []);

  // ========================================================================
  // Public API: start
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

    // Reset state
    intensityRef.current = 0;
    targetIntensityRef.current = 0;
    overtakeSpikeRef.current = false;
    leadNoteIdxRef.current = 0;
    engineDuckRef.current = 1.0;

    // Resume or suspend context based on mute state
    if (mutedRef.current) {
      void nodes.ctx.suspend();
    } else {
      void nodes.ctx.resume();
    }

    // Fade in master gain over 2 seconds
    const now = nodes.ctx.currentTime;
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(0, now);
    nodes.masterGain.gain.linearRampToValueAtTime(volumeRef.current, now + 2.0);

    // Apply initial intensity (bass only)
    applyIntensity(0);

    // Start stem schedulers
    const startTime = now + 0.1;
    scheduleDrumBar(startTime);
    scheduleLeadNote(startTime);

    // Start bar boundary checker
    scheduleBarBoundary(startTime + BAR_DURATION);
  }, [buildGraph, applyIntensity, scheduleDrumBar, scheduleLeadNote, scheduleBarBoundary]);

  // ========================================================================
  // Public API: stop
  // ========================================================================
  const stop = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;
    setIsPlaying(false);

    clearAllTimers();

    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;

    // Fade out master gain over 1 second
    const now = nodes.ctx.currentTime;
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
    nodes.masterGain.gain.linearRampToValueAtTime(0, now + 1.0);

    // Suspend context after fade
    setTimeout(() => {
      if (!playingRef.current && nodes.ctx.state === 'running') {
        void nodes.ctx.suspend();
      }
    }, 1100);
  }, [clearAllTimers]);

  // ========================================================================
  // Public API: updateRaceState
  // Computes intensity from race parameters and triggers overtake spikes
  // ========================================================================
  const updateRaceState = useCallback((state: MusicStemsRaceState) => {
    if (!playingRef.current) return;

    const {
      speed,
      maxSpeed,
      gap,
      lapNumber,
      totalLaps,
      isCloseRacing,
      isFinalLap,
      justOvertook,
      raceFinished,
      won,
    } = state;

    // --- Handle race finished: fade to low intensity ---
    if (raceFinished) {
      const nodes = nodesRef.current;
      if (nodes && nodes.ctx.state === 'running') {
        const now = nodes.ctx.currentTime;
        // Victory: brief bright swell then fade. Defeat: just fade.
        if (won) {
          // Swell to max intensity briefly
          applyIntensity(1.0);
          nodes.masterGain.gain.cancelScheduledValues(now);
          nodes.masterGain.gain.setValueAtTime(volumeRef.current * 1.3, now);
          nodes.masterGain.gain.linearRampToValueAtTime(0, now + RESULT_FADE_DURATION);
        } else {
          nodes.masterGain.gain.cancelScheduledValues(now);
          nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
          nodes.masterGain.gain.linearRampToValueAtTime(0, now + RESULT_FADE_DURATION);
          applyIntensity(0);
        }
      }
      return;
    }

    // --- Overtake spike ---
    if (justOvertook && !overtakeSpikeRef.current) {
      overtakeSpikeRef.current = true;
      preOvertakeIntensityRef.current = targetIntensityRef.current;

      // Clear any existing timer
      if (overtakeTimerRef.current) clearTimeout(overtakeTimerRef.current);

      // After spike duration, release back to computed intensity
      overtakeTimerRef.current = setTimeout(() => {
        overtakeSpikeRef.current = false;
        overtakeTimerRef.current = null;
      }, OVERTAKE_SPIKE_DURATION);
    }

    // --- Compute base intensity from race state ---
    // Speed contribution (0-0.3)
    const speedNorm = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
    const speedContribution = speedNorm * 0.3;

    // Gap closeness contribution (0-0.3): closer gap = higher intensity
    const absGap = Math.abs(gap);
    const gapCloseness = absGap < 10 ? (1 - absGap / 10) : 0;
    const gapContribution = gapCloseness * 0.3;

    // Lap progress contribution (0-0.2)
    const lapProgress = totalLaps > 0 ? (lapNumber - 1) / totalLaps : 0;
    const lapContribution = lapProgress * 0.2;

    // Close racing contribution (0-0.2)
    const closeRacingContribution = isCloseRacing ? 0.2 : 0;

    let intensity = speedContribution + gapContribution + lapContribution + closeRacingContribution;

    // Final lap multiplier
    if (isFinalLap) {
      intensity = Math.min(1.0, intensity * 1.3);
    }

    // Clamp
    intensity = Math.max(0, Math.min(1.0, intensity));

    // Store as target (applied at bar boundaries)
    targetIntensityRef.current = intensity;

    // --- Engine ducking: high speed = duck music ---
    const newDuck = speedNorm > 0.7 ? ENGINE_DUCK_FACTOR + (1 - ENGINE_DUCK_FACTOR) * (1 - speedNorm) : 1.0;
    if (Math.abs(newDuck - engineDuckRef.current) > 0.05) {
      engineDuckRef.current = newDuck;
      // Re-apply intensity immediately with new duck factor
      const nodes = nodesRef.current;
      if (nodes && nodes.ctx.state === 'running') {
        const effectiveIntensity = overtakeSpikeRef.current ? OVERTAKE_INTENSITY : intensity;
        applyIntensity(effectiveIntensity);
      }
    }
  }, [applyIntensity]);

  // ========================================================================
  // Public API: setVolume
  // ========================================================================
  const setVolume = useCallback((volume: number) => {
    volumeRef.current = Math.max(0, Math.min(1, volume));
    const nodes = nodesRef.current;
    if (nodes && nodes.ctx.state === 'running') {
      nodes.masterGain.gain.setTargetAtTime(volumeRef.current, nodes.ctx.currentTime, 0.1);
    }
  }, []);

  // ========================================================================
  // Public API: setMuted
  // ========================================================================
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
        nodes.bassLfo.stop();
        nodes.synthOscA.stop();
        nodes.synthOscB.stop();
        nodes.leadOsc.stop();
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
    updateRaceState,
    setVolume,
    setMuted,
    isPlaying,
  };
}

export default useMusicStems;
