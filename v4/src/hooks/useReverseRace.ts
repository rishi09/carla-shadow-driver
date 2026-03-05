/**
 * useReverseRace.ts - Race the track in reverse checkpoint order
 *
 * When enabled, reverses the checkpoint array so the player races
 * the track backwards. Also provides a visual indicator and
 * track name modifier.
 *
 * Wild Idea #24 from TODO.md
 */
import { useState, useCallback } from 'react';

/** Options for the useReverseRace hook */
export interface UseReverseRaceOptions {
  /** Whether reverse mode starts enabled (default: false) */
  enabled?: boolean;
}

export interface UseReverseRaceReturn {
  /** Whether reverse mode is currently active */
  isReversed: boolean;
  /** Reverse checkpoint order when enabled, pass-through when disabled */
  reverseCheckpoints: <T extends { x: number; y: number }>(checkpoints: T[]) => T[];
  /** Append " (Reversed)" to track name when enabled */
  getTrackName: (originalName: string) => string;
  /** Toggle reverse mode on/off */
  toggleReverse: () => void;
  /** Whether reverse mode is enabled */
  enabled: boolean;
  /** Set reverse mode enabled state */
  setEnabled: (v: boolean) => void;
}

/**
 * Utility function: reverses a checkpoint array.
 * Can be used outside of React (e.g. in server-side logic or tests).
 */
export function reverseCheckpointOrder<T extends { x: number; y: number }>(
  checkpoints: T[],
): T[] {
  return [...checkpoints].reverse();
}

export function useReverseRace(
  options: UseReverseRaceOptions = {},
): UseReverseRaceReturn {
  const [enabled, setEnabled] = useState(options.enabled ?? false);

  const reverseCheckpoints = useCallback(
    <T extends { x: number; y: number }>(checkpoints: T[]): T[] => {
      if (!enabled || checkpoints.length === 0) return checkpoints;
      return reverseCheckpointOrder(checkpoints);
    },
    [enabled],
  );

  const getTrackName = useCallback(
    (originalName: string): string => {
      return enabled ? `${originalName} (Reversed)` : originalName;
    },
    [enabled],
  );

  const toggleReverse = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return {
    isReversed: enabled,
    reverseCheckpoints,
    getTrackName,
    toggleReverse,
    enabled,
    setEnabled,
  };
}

export default useReverseRace;
