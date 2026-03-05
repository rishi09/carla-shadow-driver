/**
 * useVoiceBoost.ts - Voice-Powered Turbo Boost
 *
 * Captures microphone audio via Web Audio API, analyzes volume in real-time,
 * and provides a boost multiplier. The louder you scream, the faster the visual
 * boost effect. Uses AnalyserNode with getByteFrequencyData for RMS volume.
 *
 * Features:
 * - Noise gate: ignores ambient noise below threshold (~0.15 RMS)
 * - Smoothing: fast attack (50ms), slow release (300ms) for punchy feel
 * - Boost curve: non-linear mapping from RMS to 0.0-1.0 boost level
 * - Clean teardown of AudioContext and MediaStream on unmount
 */
import { useEffect, useRef, useCallback, useState } from 'react';

// Noise gate: RMS values below this are treated as silence
const NOISE_GATE = 0.15;

// Boost curve parameters
// boost = min(1.0, pow(max(0, rms - NOISE_GATE) / BOOST_RANGE, BOOST_EXPONENT))
const BOOST_RANGE = 0.5;
const BOOST_EXPONENT = 0.7;

// Smoothing time constants (in seconds, used with exponential smoothing)
const ATTACK_TIME = 0.05;   // 50ms - ramps up fast when you scream
const RELEASE_TIME = 0.30;  // 300ms - decays slowly when you stop

// Minimum boost level to consider "active"
const ACTIVE_THRESHOLD = 0.2;

export interface UseVoiceBoostReturn {
  /** Current boost level: 0.0 (quiet) to 1.0 (full scream) */
  boostLevel: number;
  /** Whether boost is above the active threshold (0.2) */
  isActive: boolean;
  /** Whether the microphone is currently listening */
  isListening: boolean;
  /** Toggle voice boost on/off (requests mic permission on first enable) */
  toggleVoiceBoost: () => void;
  /** Current raw RMS volume (for debug/visualization) */
  rawVolume: number;
}

export function useVoiceBoost(): UseVoiceBoostReturn {
  const [isListening, setIsListening] = useState(false);
  const [boostLevel, setBoostLevel] = useState(0);
  const [rawVolume, setRawVolume] = useState(0);

  // Refs for audio nodes (avoid re-creating on every render)
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Smoothed boost value (stored in ref for the rAF loop)
  const smoothedBoostRef = useRef(0);
  const lastTimeRef = useRef(0);

  // Desired listening state (ref to avoid stale closure in cleanup)
  const wantListeningRef = useRef(false);

  /**
   * Start capturing audio from the microphone.
   * Creates AudioContext -> MediaStreamSource -> AnalyserNode pipeline.
   */
  const startListening = useCallback(async () => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Create audio pipeline
      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      // Connect: mic -> analyser (no output to speakers to avoid feedback)
      source.connect(analyser);

      // Allocate frequency data buffer
      const bufferLength = analyser.frequencyBinCount;
      dataArrayRef.current = new Uint8Array(bufferLength);

      setIsListening(true);
      lastTimeRef.current = performance.now();

      // Start the analysis loop
      const tick = (now: number) => {
        if (!wantListeningRef.current) return;

        const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1); // cap at 100ms
        lastTimeRef.current = now;

        if (analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteFrequencyData(dataArrayRef.current);

          // Compute RMS volume from frequency data
          const data = dataArrayRef.current;
          let sumSquares = 0;
          for (let i = 0; i < data.length; i++) {
            const normalized = data[i] / 255;
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / data.length);

          // Apply noise gate
          const gatedRms = rms < NOISE_GATE ? 0 : rms;

          // Compute target boost from gated RMS
          const targetBoost = gatedRms > 0
            ? Math.min(1.0, Math.pow(Math.max(0, gatedRms - NOISE_GATE) / BOOST_RANGE, BOOST_EXPONENT))
            : 0;

          // Exponential smoothing with different attack/release rates
          const timeConstant = targetBoost > smoothedBoostRef.current ? ATTACK_TIME : RELEASE_TIME;
          const alpha = dt > 0 ? 1 - Math.exp(-dt / timeConstant) : 0;
          const smoothed = smoothedBoostRef.current + alpha * (targetBoost - smoothedBoostRef.current);

          // Snap to zero when very small (avoid floating point drift)
          smoothedBoostRef.current = smoothed < 0.005 ? 0 : smoothed;

          // Update React state (throttled by rAF, ~60fps)
          setBoostLevel(smoothedBoostRef.current);
          setRawVolume(rms);
        }

        rafIdRef.current = requestAnimationFrame(tick);
      };

      rafIdRef.current = requestAnimationFrame(tick);
    } catch (err) {
      // Microphone permission denied or not available
      console.warn('[VoiceBoost] Microphone access denied:', err);
      wantListeningRef.current = false;
      setIsListening(false);
    }
  }, []);

  /**
   * Stop capturing audio and clean up all resources.
   */
  const stopListening = useCallback(() => {
    // Cancel animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Disconnect source
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* already disconnected */ }
      sourceRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch { /* already closed */ }
      audioContextRef.current = null;
    }

    // Stop all media tracks (releases microphone)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    analyserRef.current = null;
    dataArrayRef.current = null;
    smoothedBoostRef.current = 0;

    setIsListening(false);
    setBoostLevel(0);
    setRawVolume(0);
  }, []);

  /**
   * Toggle voice boost on/off.
   * First call requests microphone permission.
   */
  const toggleVoiceBoost = useCallback(() => {
    if (wantListeningRef.current) {
      wantListeningRef.current = false;
      stopListening();
    } else {
      wantListeningRef.current = true;
      startListening();
    }
  }, [startListening, stopListening]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      // Cancel animation frame
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      // Disconnect source
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch { /* ok */ }
        sourceRef.current = null;
      }
      // Close audio context
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch { /* ok */ }
        audioContextRef.current = null;
      }
      // Stop media tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return {
    boostLevel,
    isActive: boostLevel > ACTIVE_THRESHOLD,
    isListening,
    toggleVoiceBoost,
    rawVolume,
  };
}

export default useVoiceBoost;
