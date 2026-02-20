/**
 * useBlindfoldMode.ts - Blindfold Mode game modifier
 *
 * Alternates between 3-second blackout periods and 2-second visible windows.
 * The AI has no such limitation -- pure spatial memory challenge.
 *
 * Cycle: 3s blind -> 2s visible -> repeat
 * During countdown: always visible (blackout starts when racing begins).
 * Tracks total time spent blind for post-race stats.
 * Returns blind/visible countdowns for HUD display.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const BLIND_DURATION_MS = 3000;
const VISIBLE_DURATION_MS = 2000;
const CYCLE_DURATION_MS = BLIND_DURATION_MS + VISIBLE_DURATION_MS;

export interface UseBlindfoldModeReturn {
  /** Whether the screen is currently blacked out */
  isBlind: boolean;
  /** Seconds remaining in the current blind phase (0 when visible) */
  blindTimeLeft: number;
  /** Seconds remaining in the current visible phase (0 when blind) */
  visibleTimeLeft: number;
  /** Total cumulative seconds spent blind during this race */
  totalBlindTime: number;
  /** Whether blindfold mode is enabled */
  isBlindfoldMode: boolean;
  /** Toggle blindfold mode on/off */
  setBlindfoldMode: (on: boolean) => void;
  /** Reset state for a new race */
  reset: () => void;
}

export function useBlindfoldMode(
  raceStatus: 'countdown' | 'racing' | 'finishing' | 'finished' | null,
): UseBlindfoldModeReturn {
  const [isBlindfoldMode, setBlindfoldMode] = useState(false);
  const [isBlind, setIsBlind] = useState(false);
  const [blindTimeLeft, setBlindTimeLeft] = useState(0);
  const [visibleTimeLeft, setVisibleTimeLeft] = useState(0);
  const [totalBlindTime, setTotalBlindTime] = useState(0);

  // Internal refs for tracking
  const raceStartTimeRef = useRef<number>(0);
  const totalBlindTimeRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    setIsBlind(false);
    setBlindTimeLeft(0);
    setVisibleTimeLeft(0);
    setTotalBlindTime(0);
    totalBlindTimeRef.current = 0;
    raceStartTimeRef.current = 0;
    lastTickRef.current = 0;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isBlindfoldMode) {
      setIsBlind(false);
      setBlindTimeLeft(0);
      setVisibleTimeLeft(0);
      return;
    }

    // Only run the blindfold cycle during active racing
    const isActive = raceStatus === 'racing' || raceStatus === 'finishing';

    if (!isActive) {
      setIsBlind(false);
      setBlindTimeLeft(0);
      setVisibleTimeLeft(0);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    // Record when racing started (for computing cycle position)
    if (raceStartTimeRef.current === 0) {
      // Start with a visible period so the player can orient
      raceStartTimeRef.current = performance.now() - BLIND_DURATION_MS;
      lastTickRef.current = performance.now();
    }

    const tick = (now: number) => {
      const elapsed = now - raceStartTimeRef.current;
      const posInCycle = elapsed % CYCLE_DURATION_MS;

      const wasBlind = posInCycle < BLIND_DURATION_MS;

      // Track time spent blind
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      if (wasBlind && dt > 0 && dt < 1) {
        totalBlindTimeRef.current += dt;
        setTotalBlindTime(Math.round(totalBlindTimeRef.current * 10) / 10);
      }

      setIsBlind(wasBlind);

      if (wasBlind) {
        const remaining = (BLIND_DURATION_MS - posInCycle) / 1000;
        setBlindTimeLeft(Math.max(0, Math.round(remaining * 10) / 10));
        setVisibleTimeLeft(0);
      } else {
        const visibleElapsed = posInCycle - BLIND_DURATION_MS;
        const remaining = (VISIBLE_DURATION_MS - visibleElapsed) / 1000;
        setVisibleTimeLeft(Math.max(0, Math.round(remaining * 10) / 10));
        setBlindTimeLeft(0);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isBlindfoldMode, raceStatus]);

  return {
    isBlind,
    blindTimeLeft,
    visibleTimeLeft,
    totalBlindTime,
    isBlindfoldMode,
    setBlindfoldMode,
    reset,
  };
}

export default useBlindfoldMode;
