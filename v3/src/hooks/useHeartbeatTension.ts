/**
 * useHeartbeatTension.ts - Heartbeat audio that scales with race tension
 *
 * Uses Web Audio API to generate a heartbeat sound (two quick thumps)
 * that speeds up as the gap between player and AI shrinks.
 * Gap > 5s = no heartbeat. Gap 3-5s = slow pulse. Gap < 1s = rapid pulse.
 *
 * Wild Idea #35 from TODO.md
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';

// BPM thresholds based on gap (seconds)
const GAP_THRESHOLDS = [
  { maxGap: 0.5, bpm: 180, level: 'critical' as const },
  { maxGap: 1.0, bpm: 140, level: 'high' as const },
  { maxGap: 2.0, bpm: 110, level: 'medium' as const },
  { maxGap: 3.0, bpm: 80,  level: 'medium' as const },
  { maxGap: 5.0, bpm: 60,  level: 'low' as const },
] as const;

// Heartbeat pulse parameters
const LUB_FREQ = 60;       // Hz - first pulse (lub)
const DUB_FREQ = 50;       // Hz - second pulse (dub)
const LUB_DURATION = 0.08; // 80ms
const DUB_DURATION = 0.06; // 60ms
const DUB_DELAY = 0.12;    // 120ms after lub starts
const LUB_VOLUME = 1.0;    // Relative volume for lub (louder)
const DUB_VOLUME = 0.6;    // Relative volume for dub (softer)

// Gain envelope timings
const ATTACK_TIME = 0.005;  // 5ms attack
const RELEASE_TIME = 0.04;  // 40ms release

type TensionLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

interface UseHeartbeatTensionOptions {
  enabled: boolean;
  gapSeconds: number;
  volume?: number;
}

interface UseHeartbeatTensionReturn {
  isBeating: boolean;
  bpm: number;
  tensionLevel: TensionLevel;
}

function getHeartbeatParams(gap: number): { bpm: number; level: TensionLevel } {
  const absGap = Math.abs(gap);
  for (const threshold of GAP_THRESHOLDS) {
    if (absGap < threshold.maxGap) {
      return { bpm: threshold.bpm, level: threshold.level };
    }
  }
  // Gap >= 5s: no heartbeat
  return { bpm: 0, level: 'none' };
}

export function useHeartbeatTension(options: UseHeartbeatTensionOptions): UseHeartbeatTensionReturn {
  const { enabled, gapSeconds, volume = 0.3 } = options;

  const [isBeating, setIsBeating] = useState(false);
  const [bpm, setBpm] = useState(0);
  const [tensionLevel, setTensionLevel] = useState<TensionLevel>('none');

  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const beatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActiveRef = useRef(false);
  const currentBpmRef = useRef(0);
  const volumeRef = useRef(volume);
  const enabledRef = useRef(enabled);
  const documentHiddenRef = useRef(false);

  // Keep refs in sync with props
  volumeRef.current = volume;
  enabledRef.current = enabled;

  // Lazily create AudioContext
  const getAudioContext = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      return ctxRef.current;
    }
    try {
      const ctx = new AudioContext();
      const masterGain = ctx.createGain();
      masterGain.gain.value = volumeRef.current;
      masterGain.connect(ctx.destination);
      ctxRef.current = ctx;
      masterGainRef.current = masterGain;
      return ctx;
    } catch {
      return null;
    }
  }, []);

  // Play a single heartbeat (lub-dub)
  const playHeartbeat = useCallback(() => {
    const ctx = ctxRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx || !masterGain || ctx.state !== 'running') return;

    const now = ctx.currentTime;

    // Lub (first pulse) - louder, 60Hz sine, 80ms
    const lubOsc = ctx.createOscillator();
    lubOsc.type = 'sine';
    lubOsc.frequency.value = LUB_FREQ;

    const lubGain = ctx.createGain();
    lubGain.gain.setValueAtTime(0, now);
    lubGain.gain.linearRampToValueAtTime(LUB_VOLUME, now + ATTACK_TIME);
    lubGain.gain.setValueAtTime(LUB_VOLUME, now + LUB_DURATION - RELEASE_TIME);
    lubGain.gain.exponentialRampToValueAtTime(0.001, now + LUB_DURATION);

    lubOsc.connect(lubGain);
    lubGain.connect(masterGain);
    lubOsc.start(now);
    lubOsc.stop(now + LUB_DURATION + 0.01);

    // Dub (second pulse) - softer, 50Hz sine, 60ms, delayed by 120ms
    const dubStart = now + DUB_DELAY;
    const dubOsc = ctx.createOscillator();
    dubOsc.type = 'sine';
    dubOsc.frequency.value = DUB_FREQ;

    const dubGain = ctx.createGain();
    dubGain.gain.setValueAtTime(0, dubStart);
    dubGain.gain.linearRampToValueAtTime(DUB_VOLUME, dubStart + ATTACK_TIME);
    dubGain.gain.setValueAtTime(DUB_VOLUME, dubStart + DUB_DURATION - RELEASE_TIME);
    dubGain.gain.exponentialRampToValueAtTime(0.001, dubStart + DUB_DURATION);

    dubOsc.connect(dubGain);
    dubGain.connect(masterGain);
    dubOsc.start(dubStart);
    dubOsc.stop(dubStart + DUB_DURATION + 0.01);
  }, []);

  // Schedule the next heartbeat
  const scheduleNextBeat = useCallback(() => {
    if (!isActiveRef.current || currentBpmRef.current <= 0) return;

    const intervalMs = (60 / currentBpmRef.current) * 1000;

    beatTimeoutRef.current = setTimeout(() => {
      if (!isActiveRef.current || documentHiddenRef.current) {
        // Still schedule next check even when hidden (so it resumes)
        scheduleNextBeat();
        return;
      }
      playHeartbeat();
      scheduleNextBeat();
    }, intervalMs);
  }, [playHeartbeat]);

  // Start the heartbeat loop
  const startBeating = useCallback(() => {
    if (isActiveRef.current) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    isActiveRef.current = true;
    setIsBeating(true);
    playHeartbeat();
    scheduleNextBeat();
  }, [getAudioContext, playHeartbeat, scheduleNextBeat]);

  // Stop the heartbeat loop
  const stopBeating = useCallback(() => {
    isActiveRef.current = false;
    setIsBeating(false);

    if (beatTimeoutRef.current !== null) {
      clearTimeout(beatTimeoutRef.current);
      beatTimeoutRef.current = null;
    }
  }, []);

  // React to gap and enabled changes
  useEffect(() => {
    const { bpm: newBpm, level } = getHeartbeatParams(gapSeconds);

    setBpm(newBpm);
    setTensionLevel(level);
    currentBpmRef.current = newBpm;

    // Update master gain volume
    if (masterGainRef.current && ctxRef.current && ctxRef.current.state !== 'closed') {
      masterGainRef.current.gain.setTargetAtTime(
        volumeRef.current,
        ctxRef.current.currentTime,
        0.05
      );
    }

    if (!enabled || newBpm === 0) {
      stopBeating();
    } else if (!isActiveRef.current) {
      startBeating();
    }
  }, [enabled, gapSeconds, startBeating, stopBeating]);

  // Handle document visibility changes (mute when hidden)
  useEffect(() => {
    const handleVisibility = () => {
      documentHiddenRef.current = document.hidden;
      if (document.hidden) {
        // Suspend audio context to save resources
        if (ctxRef.current && ctxRef.current.state === 'running') {
          void ctxRef.current.suspend();
        }
      } else {
        // Resume if heartbeat should be active
        if (isActiveRef.current && ctxRef.current && ctxRef.current.state === 'suspended') {
          void ctxRef.current.resume();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isActiveRef.current = false;

      if (beatTimeoutRef.current !== null) {
        clearTimeout(beatTimeoutRef.current);
        beatTimeoutRef.current = null;
      }

      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        try {
          void ctxRef.current.close();
        } catch {
          // Context may already be closed
        }
      }
      ctxRef.current = null;
      masterGainRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({ isBeating, bpm, tensionLevel }),
    [isBeating, bpm, tensionLevel]
  );
}

export default useHeartbeatTension;
