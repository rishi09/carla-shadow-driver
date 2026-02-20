/**
 * useEngineSound.ts - Web Audio API engine sound synthesis
 *
 * Generates realistic engine sounds using layered oscillators:
 * - Fundamental: triangle wave for smooth base tone
 * - 2nd harmonic: sawtooth for midrange growl
 * - 3rd harmonic: square wave (quiet) for upper-register buzz
 * - Sub-bass: sine wave one octave below fundamental for chest rumble
 * - Exhaust crackle: filtered noise bursts on throttle lift-off
 *
 * Also provides tire screech, countdown beeps, and collision impact sounds.
 */
import { useEffect, useRef, useCallback, useState } from 'react';

// Engine frequency mapping - wider range for more dynamic sound
const IDLE_FREQ = 55;     // Hz at idle RPM (lower = deeper idle rumble)
const REDLINE_FREQ = 350; // Hz at redline (not too high to stay musical)
const IDLE_RPM = 800;
const REDLINE_RPM = 7000;

// Harmonic volume ratios relative to fundamental
const HARMONIC_2_GAIN = 0.35;   // 2nd harmonic: midrange growl
const HARMONIC_3_GAIN = 0.12;   // 3rd harmonic: subtle upper buzz
const SUB_BASS_GAIN = 0.5;      // Sub-bass: deep rumble (one octave below)

// Filter settings - wider range to let more harmonics through at high RPM
const FILTER_MIN_FREQ = 300;     // Low-pass cutoff at idle (muffled)
const FILTER_MAX_FREQ = 6000;    // Low-pass cutoff at redline (opens up)

// Tire screech thresholds
const SCREECH_SPEED_THRESHOLD = 50;    // km/h (slightly lower threshold)
const SCREECH_STEER_THRESHOLD = 0.4;   // absolute steer value

// Master volume
const MASTER_VOLUME = 0.35;

// Exhaust crackle settings
const CRACKLE_CHANCE = 0.25;           // Probability per check cycle during lift-off
const CRACKLE_DURATION = 0.04;         // seconds
const CRACKLE_VOLUME = 0.3;

interface AudioNodes {
  ctx: AudioContext;
  masterGain: GainNode;
  // Engine oscillators
  osc1: OscillatorNode;       // Fundamental (triangle)
  osc2: OscillatorNode;       // 2nd harmonic (sawtooth)
  osc3: OscillatorNode;       // 3rd harmonic (square)
  oscSub: OscillatorNode;     // Sub-bass (sine, one octave below)
  gain1: GainNode;
  gain2: GainNode;
  gain3: GainNode;
  gainSub: GainNode;
  engineGain: GainNode;
  lowPass: BiquadFilterNode;
  // Tire screech
  screechSource: AudioBufferSourceNode | null;
  screechGain: GainNode;
  screechFilter: BiquadFilterNode;
  // Wind/air rush noise (always present, volume from speed)
  windSource: AudioBufferSourceNode;
  windGain: GainNode;
  windFilter: BiquadFilterNode;
}

function rpmToFrequency(rpm: number): number {
  const t = Math.max(0, Math.min(1, (rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
  // Slight exponential curve for more natural feel - frequencies climb faster at high RPM
  const curved = t * t * 0.3 + t * 0.7;
  return IDLE_FREQ + curved * (REDLINE_FREQ - IDLE_FREQ);
}

function rpmToFilterFreq(rpm: number): number {
  const t = Math.max(0, Math.min(1, (rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
  // Exponential curve: filter opens up more dramatically at high RPM
  const curved = t * t;
  return FILTER_MIN_FREQ + curved * (FILTER_MAX_FREQ - FILTER_MIN_FREQ);
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
  playImpact: (intensity: number) => void;
  playDownshiftBlip: () => void;
  playPassingWhoosh: () => void;
  triggerEvent: (event: 'overtake' | 'close_gap' | 'final_lap' | 'collision_hit') => void;
  stopCloseGapTension: () => void;
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
  // Track previous throttle for crackle on lift-off
  const prevThrottleRef = useRef(0);
  const crackleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Adaptive music event state ---
  // Track active event boosts so they can decay independently
  const overtakeBoostRef = useRef(0);      // 0..1 gain multiplier for overtake intensity
  const closeGapActiveRef = useRef(false);  // Whether close-gap tension layer is active
  const finalLapActiveRef = useRef(false);  // Whether final-lap boost is active
  const overtakeDecayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tension oscillator for close-gap dissonant undertone
  const tensionOscRef = useRef<OscillatorNode | null>(null);
  const tensionGainRef = useRef<GainNode | null>(null);

  // Initialize audio context and nodes
  const initAudio = useCallback(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const ctx = new AudioContext();
    const masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_VOLUME;
    masterGain.connect(ctx.destination);

    // Low-pass filter for engine - shapes the overall tone
    const lowPass = ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = FILTER_MIN_FREQ;
    lowPass.Q.value = 2.0; // Slight resonance peak for character
    lowPass.connect(masterGain);

    // Engine gain (controlled by throttle + RPM)
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.06; // Start quiet at idle
    engineGain.connect(lowPass);

    // Fundamental oscillator (triangle - smoother than sawtooth for base tone)
    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.value = IDLE_FREQ;
    const gain1 = ctx.createGain();
    gain1.gain.value = 1.0;
    osc1.connect(gain1);
    gain1.connect(engineGain);

    // 2nd harmonic (sawtooth - provides the growl/character)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = IDLE_FREQ * 2;
    const gain2 = ctx.createGain();
    gain2.gain.value = HARMONIC_2_GAIN;
    osc2.connect(gain2);
    gain2.connect(engineGain);

    // 3rd harmonic (square - subtle upper buzz)
    const osc3 = ctx.createOscillator();
    osc3.type = 'square';
    osc3.frequency.value = IDLE_FREQ * 3;
    const gain3 = ctx.createGain();
    gain3.gain.value = HARMONIC_3_GAIN;
    osc3.connect(gain3);
    gain3.connect(engineGain);

    // Sub-bass oscillator (pure sine, one octave below fundamental)
    const oscSub = ctx.createOscillator();
    oscSub.type = 'sine';
    oscSub.frequency.value = IDLE_FREQ / 2;
    const gainSub = ctx.createGain();
    gainSub.gain.value = SUB_BASS_GAIN;
    oscSub.connect(gainSub);
    // Sub-bass bypasses the low-pass filter for full deep rumble
    gainSub.connect(masterGain);

    // Start oscillators
    osc1.start();
    osc2.start();
    osc3.start();
    oscSub.start();

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

    // Wind/air rush noise: looping highpass-filtered white noise, volume from speed
    const windSource = ctx.createBufferSource();
    windSource.buffer = noiseBufferRef.current;
    windSource.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'highpass';
    windFilter.frequency.value = 1000; // Updated dynamically based on speed
    windFilter.Q.value = 0.7;

    const windGain = ctx.createGain();
    windGain.gain.value = 0; // Silent until speed > 80 km/h

    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGain);
    windSource.start();

    nodesRef.current = {
      ctx,
      masterGain,
      osc1, osc2, osc3, oscSub,
      gain1, gain2, gain3, gainSub,
      engineGain,
      lowPass,
      screechSource: null,
      screechGain,
      screechFilter,
      windSource,
      windGain,
      windFilter,
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

  // Play exhaust crackle (short filtered noise burst)
  const playCrackle = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running' || !noiseBufferRef.current) return;

    // Random chance per call for organic feel
    if (Math.random() > CRACKLE_CHANCE) return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = noiseBufferRef.current;
    source.loop = false;

    // Bandpass filter: mid-frequency pop (800-2000 Hz range)
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800 + Math.random() * 1200;
    bp.Q.value = 3;

    const crackleGain = ctx.createGain();
    crackleGain.gain.setValueAtTime(CRACKLE_VOLUME, now);
    crackleGain.gain.exponentialRampToValueAtTime(0.001, now + CRACKLE_DURATION);

    source.connect(bp);
    bp.connect(crackleGain);
    crackleGain.connect(nodes.masterGain);

    source.start(now);
    source.stop(now + CRACKLE_DURATION);
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
    nodes.oscSub.frequency.setTargetAtTime(freq / 2, now, 0.05); // Sub-bass tracks slower

    // Engine volume: shaped by throttle and RPM for dynamic range
    // Idle: quiet but audible (0.06). Full throttle: loud (1.0).
    // Mid-throttle gets a bump from RPM so coasting at high RPM still sounds present.
    const rpmFactor = Math.max(0, Math.min(1, (rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM)));
    const engineVol = 0.06 + throttle * 0.7 + rpmFactor * 0.24;
    nodes.engineGain.gain.setTargetAtTime(Math.min(1.0, engineVol), now, 0.04);

    // Sub-bass volume: louder with throttle, adds chest-thumping feel
    const subVol = SUB_BASS_GAIN * (0.3 + throttle * 0.7) * (0.5 + rpmFactor * 0.5);
    nodes.gainSub.gain.setTargetAtTime(subVol, now, 0.06);

    // 2nd harmonic gain: gets louder at higher RPM, boosted under throttle load
    const throttleBoost = throttle > 0.5 ? 1.3 : 1.0; // Engine load differentiation
    const h2Vol = HARMONIC_2_GAIN * (0.6 + rpmFactor * 0.4) * throttleBoost;
    nodes.gain2.gain.setTargetAtTime(h2Vol, now, 0.05);

    // Update low-pass filter based on RPM (opens up at high RPM)
    // Under throttle load, open filter an extra 20% for more aggressive tone
    const filterFreq = rpmToFilterFreq(rpm) * (throttle > 0.5 ? 1.2 : 1.0);
    nodes.lowPass.frequency.setTargetAtTime(filterFreq, now, 0.05);

    // Exhaust crackle on throttle lift-off at decent RPM
    if (prevThrottleRef.current > 0.4 && throttle < 0.1 && rpm > 2500) {
      // Start crackle burst series
      if (!crackleIntervalRef.current) {
        crackleIntervalRef.current = setInterval(playCrackle, 40);
        // Stop crackles after ~300ms
        setTimeout(() => {
          if (crackleIntervalRef.current) {
            clearInterval(crackleIntervalRef.current);
            crackleIntervalRef.current = null;
          }
        }, 300);
      }
    }
    prevThrottleRef.current = throttle;

    // Tire screech: speed > threshold && |steer| > threshold
    const shouldScreech = speed > SCREECH_SPEED_THRESHOLD && Math.abs(steer) > SCREECH_STEER_THRESHOLD;
    if (shouldScreech) {
      if (!screechActiveRef.current) {
        startScreech();
      }
      // Volume proportional to how hard the turn is
      const screechVol = Math.min(1, (Math.abs(steer) - SCREECH_STEER_THRESHOLD) * 2) * 0.5;
      nodes.screechGain.gain.setTargetAtTime(screechVol, now, 0.02);
      // Frequency modulation: mild turns = clean high squeal, aggressive = rough low scrub
      const screechFreq = 3500 - Math.abs(steer) * 1500;
      nodes.screechFilter.frequency.setTargetAtTime(screechFreq, now, 0.05);
    } else {
      if (screechActiveRef.current) {
        stopScreech();
      }
    }

    // Wind/air rush noise: starts at 80 km/h, increases with speed
    const windVol = speed > 80 ? Math.min(0.15, (speed - 80) / 800) : 0;
    nodes.windGain.gain.setTargetAtTime(windVol, now, 0.1);
    // Shift highpass upward with speed for more "hiss" character
    const windFreq = 1000 + speed * 5;
    nodes.windFilter.frequency.setTargetAtTime(windFreq, now, 0.1);
  }, [startScreech, stopScreech, playCrackle]);

  // Play countdown beeps: 3 short beeps (ascending) + exciting GO chord
  const playCountdownBeeps = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed') return;

    // If context is suspended (muted), skip beeps
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
      gain.gain.setValueAtTime(volume, startTime + duration - 0.03);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);
      osc.connect(gain);
      gain.connect(nodes.masterGain);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    // 3 beeps ascending in pitch (builds anticipation)
    playBeep(now + 0.0, 0.2, 660, 0.5);   // E5 - "3"
    playBeep(now + 1.0, 0.2, 784, 0.55);   // G5 - "2"
    playBeep(now + 2.0, 0.2, 880, 0.6);    // A5 - "1"

    // GO: higher frequency chord burst (exciting climax, not lower)
    playBeep(now + 3.0, 0.5, 1047, 0.7);   // C6 - bright and exciting
    playBeep(now + 3.0, 0.5, 1319, 0.4);   // E6 - major third for uplifting feel
  }, []);

  // Play collision impact sound: layered low thud + mid crunch
  const playImpact = useCallback((intensity: number) => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state === 'closed' || nodes.ctx.state === 'suspended') return;
    if (!noiseBufferRef.current) return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    // Normalized volume: intensity / 3000, capped at 1.0 (more sensitive than before)
    const volume = Math.min(1.0, intensity / 3000);

    // Duration scales with intensity: 80-300ms
    const duration = 0.08 + 0.22 * volume;

    // Layer 1: Low-frequency thud (sub-200Hz noise burst)
    {
      const source = ctx.createBufferSource();
      source.buffer = noiseBufferRef.current;
      source.loop = false;

      const lpFilter = ctx.createBiquadFilter();
      lpFilter.type = 'lowpass';
      lpFilter.frequency.value = 200;
      lpFilter.Q.value = 2.0;

      const impactGain = ctx.createGain();
      impactGain.gain.setValueAtTime(volume * 0.8, now);
      impactGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      source.connect(lpFilter);
      lpFilter.connect(impactGain);
      impactGain.connect(nodes.masterGain);

      source.start(now);
      source.stop(now + duration + 0.01);
    }

    // Layer 2: Mid-frequency crunch (400-2000Hz bandpass)
    {
      const source = ctx.createBufferSource();
      source.buffer = noiseBufferRef.current;
      source.loop = false;

      const bpFilter = ctx.createBiquadFilter();
      bpFilter.type = 'bandpass';
      bpFilter.frequency.value = 800;
      bpFilter.Q.value = 1.5;

      const crunchGain = ctx.createGain();
      crunchGain.gain.setValueAtTime(volume * 0.4, now);
      crunchGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.6);

      source.connect(bpFilter);
      bpFilter.connect(crunchGain);
      crunchGain.connect(nodes.masterGain);

      source.start(now);
      source.stop(now + duration + 0.01);
    }

    // Layer 3: Short sine pulse for low-end punch (like a kick drum body)
    {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.05);

      const punchGain = ctx.createGain();
      punchGain.gain.setValueAtTime(volume * 0.6, now);
      punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(punchGain);
      punchGain.connect(nodes.masterGain);

      osc.start(now);
      osc.stop(now + 0.1);
    }
  }, []);

  // Play a brief rev-match blip on downshift: 30ms sine burst at 250Hz
  // Simulates the rev-match downshift sound. Volume 0.2 (subtle).
  const playDownshiftBlip = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running') return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    const blipOsc = ctx.createOscillator();
    blipOsc.type = 'sine';
    blipOsc.frequency.value = 250;

    const blipOscGain = ctx.createGain();
    // Quick attack (~2ms), sustain at 0.2, sharp cutoff at 30ms
    blipOscGain.gain.setValueAtTime(0, now);
    blipOscGain.gain.linearRampToValueAtTime(0.2, now + 0.002);
    blipOscGain.gain.setValueAtTime(0.2, now + 0.025);
    blipOscGain.gain.linearRampToValueAtTime(0, now + 0.03);

    blipOsc.connect(blipOscGain);
    blipOscGain.connect(nodes.masterGain);
    blipOsc.start(now);
    blipOsc.stop(now + 0.035);
  }, []);

  // Play a passing whoosh: 200ms shaped white noise burst through bandpass at 800Hz, volume 0.3
  // Triggered when gap_seconds changes sign (overtake or get overtaken)
  const playPassingWhoosh = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running' || !noiseBufferRef.current) return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = noiseBufferRef.current;
    source.loop = false;

    // Bandpass filter centered at 800Hz
    const bpFilter = ctx.createBiquadFilter();
    bpFilter.type = 'bandpass';
    bpFilter.frequency.value = 800;
    bpFilter.Q.value = 1.5;

    const whooshGain = ctx.createGain();
    // Quick attack (10ms), sustain at 0.3, quick decay -- 200ms total
    whooshGain.gain.setValueAtTime(0, now);
    whooshGain.gain.linearRampToValueAtTime(0.3, now + 0.01);
    whooshGain.gain.setValueAtTime(0.3, now + 0.15);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    source.connect(bpFilter);
    bpFilter.connect(whooshGain);
    whooshGain.connect(nodes.masterGain);
    source.start(now);
    source.stop(now + 0.21);
  }, []);

  // --- Adaptive music event triggers ---
  // These create momentary audio effects layered on top of the engine sound
  const triggerEvent = useCallback((event: 'overtake' | 'close_gap' | 'final_lap' | 'collision_hit') => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.ctx.state !== 'running' || !noiseBufferRef.current) return;

    const ctx = nodes.ctx;
    const now = ctx.currentTime;

    switch (event) {
      case 'overtake': {
        // Briefly boost master gain to 1.5x for 3 seconds, then fade back
        overtakeBoostRef.current = 1;
        nodes.masterGain.gain.cancelScheduledValues(now);
        nodes.masterGain.gain.setValueAtTime(MASTER_VOLUME * 1.5, now);
        nodes.masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME, now + 3.0);

        // Play a short celebratory rising tone
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.3);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.connect(gain);
        gain.connect(nodes.masterGain);
        osc.start(now);
        osc.stop(now + 0.5);

        // Clear previous decay timer
        if (overtakeDecayTimerRef.current) clearTimeout(overtakeDecayTimerRef.current);
        overtakeDecayTimerRef.current = setTimeout(() => {
          overtakeBoostRef.current = 0;
        }, 3000);
        break;
      }

      case 'close_gap': {
        // Add a slightly dissonant tension undertone when gap < 1s
        if (closeGapActiveRef.current) return; // Already active
        closeGapActiveRef.current = true;

        // Create a tritone interval (dissonant) for tension
        const tensionOsc = ctx.createOscillator();
        tensionOsc.type = 'sine';
        tensionOsc.frequency.value = 185; // F#3 - tritone with C
        const tensionGain = ctx.createGain();
        tensionGain.gain.setValueAtTime(0, now);
        tensionGain.gain.linearRampToValueAtTime(0.08, now + 0.5); // Fade in gently
        tensionOsc.connect(tensionGain);
        tensionGain.connect(nodes.masterGain);
        tensionOsc.start(now);

        tensionOscRef.current = tensionOsc;
        tensionGainRef.current = tensionGain;
        break;
      }

      case 'final_lap': {
        // Permanent intensity boost for the final lap
        if (finalLapActiveRef.current) return; // Already active
        finalLapActiveRef.current = true;

        // Boost master volume by 20% for rest of the race
        nodes.masterGain.gain.cancelScheduledValues(now);
        nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
        nodes.masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME * 1.2, now + 1.0);

        // Play a brief ascending fanfare
        const freqs = [523, 659, 784]; // C5, E5, G5 (major arpeggio)
        freqs.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0, now + i * 0.1);
          gain.gain.linearRampToValueAtTime(0.25, now + i * 0.1 + 0.05);
          gain.gain.linearRampToValueAtTime(0, now + i * 0.1 + 0.3);
          osc.connect(gain);
          gain.connect(nodes.masterGain);
          osc.start(now + i * 0.1);
          osc.stop(now + i * 0.1 + 0.35);
        });
        break;
      }

      case 'collision_hit': {
        // Brief percussive white noise burst (100ms)
        const source = ctx.createBufferSource();
        source.buffer = noiseBufferRef.current;
        source.loop = false;

        // Highpass for percussive snap
        const hpFilter = ctx.createBiquadFilter();
        hpFilter.type = 'highpass';
        hpFilter.frequency.value = 2000;
        hpFilter.Q.value = 1.0;

        const hitGain = ctx.createGain();
        hitGain.gain.setValueAtTime(0.5, now);
        hitGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

        source.connect(hpFilter);
        hpFilter.connect(hitGain);
        hitGain.connect(nodes.masterGain);

        source.start(now);
        source.stop(now + 0.1);
        break;
      }
    }
  }, []);

  // Stop close-gap tension layer (called when gap widens)
  const stopCloseGapTension = useCallback(() => {
    if (!closeGapActiveRef.current) return;
    closeGapActiveRef.current = false;

    const nodes = nodesRef.current;
    if (!nodes) return;

    const now = nodes.ctx.currentTime;
    if (tensionGainRef.current) {
      tensionGainRef.current.gain.linearRampToValueAtTime(0, now + 0.5);
    }
    if (tensionOscRef.current) {
      setTimeout(() => {
        try { tensionOscRef.current?.stop(); } catch { /* ok */ }
        tensionOscRef.current = null;
        tensionGainRef.current = null;
      }, 600);
    }
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
      if (crackleIntervalRef.current) {
        clearInterval(crackleIntervalRef.current);
        crackleIntervalRef.current = null;
      }
      if (overtakeDecayTimerRef.current) {
        clearTimeout(overtakeDecayTimerRef.current);
        overtakeDecayTimerRef.current = null;
      }
      // Stop tension oscillator if active
      if (tensionOscRef.current) {
        try { tensionOscRef.current.stop(); } catch { /* ok */ }
        tensionOscRef.current = null;
        tensionGainRef.current = null;
      }
      const nodes = nodesRef.current;
      if (!nodes) return;
      try {
        nodes.osc1.stop();
        nodes.osc2.stop();
        nodes.osc3.stop();
        nodes.oscSub.stop();
        if (nodes.windSource) {
          try { nodes.windSource.stop(); } catch { /* ok */ }
        }
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

  return { update, playCountdownBeeps, playImpact, playDownshiftBlip, playPassingWhoosh, triggerEvent, stopCloseGapTension, setMuted, isMuted };
}

export default useEngineSound;
