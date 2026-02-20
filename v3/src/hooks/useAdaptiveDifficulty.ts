/**
 * useAdaptiveDifficulty.ts - Hidden difficulty adaptation
 *
 * Tracks win/loss ratio in localStorage using a sliding window of the last 10 races.
 * If the player wins >60% of races, the AI speed factor increases by 0.05 (max 1.3).
 * If the player wins <30%, the AI speed factor decreases by 0.05 (min 0.7).
 * Target: ~40% player win rate.
 *
 * This is separate from the explicit difficulty selector (Easy/Medium/Hard).
 * The speed factor can be sent to the server to adjust AI behavior once supported.
 */
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'shadow_driver_adaptive';
const WINDOW_SIZE = 10;
const FACTOR_STEP = 0.05;
const FACTOR_MIN = 0.7;
const FACTOR_MAX = 1.3;
const WIN_RATE_HIGH = 0.6;
const WIN_RATE_LOW = 0.3;

interface AdaptiveData {
  /** Sliding window of recent race results: true = player won, false = player lost */
  results: boolean[];
  /** Current AI speed factor (1.0 = neutral) */
  factor: number;
}

function loadAdaptive(): AdaptiveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AdaptiveData;
      if (Array.isArray(parsed.results) && typeof parsed.factor === 'number') {
        return parsed;
      }
    }
  } catch {
    // Corrupted data -- reset
  }
  return { results: [], factor: 1.0 };
}

function saveAdaptive(data: AdaptiveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage not available -- ignore
  }
}

export function useAdaptiveDifficulty() {
  const [data, setData] = useState<AdaptiveData>(loadAdaptive);

  const recordResult = useCallback((won: boolean): void => {
    const current = loadAdaptive(); // Re-read to avoid stale closures

    // Add result to sliding window, keep only the last WINDOW_SIZE entries
    const results = [...current.results, won].slice(-WINDOW_SIZE);

    // Calculate win rate from the sliding window
    let factor = current.factor;
    if (results.length >= 3) {
      // Only adjust after at least 3 races for stability
      const wins = results.filter(Boolean).length;
      const winRate = wins / results.length;

      if (winRate > WIN_RATE_HIGH) {
        // Player winning too much -- make AI harder
        factor = Math.min(FACTOR_MAX, factor + FACTOR_STEP);
      } else if (winRate < WIN_RATE_LOW) {
        // Player losing too much -- make AI easier
        factor = Math.max(FACTOR_MIN, factor - FACTOR_STEP);
      }
      // Otherwise: no change (in the sweet spot)
    }

    // Round to avoid floating point drift
    factor = Math.round(factor * 100) / 100;

    const updated: AdaptiveData = { results, factor };
    saveAdaptive(updated);
    setData(updated);
  }, []);

  const getSpeedFactor = useCallback((): number => {
    return data.factor;
  }, [data.factor]);

  const getWinRate = useCallback((): number | null => {
    if (data.results.length === 0) return null;
    const wins = data.results.filter(Boolean).length;
    return wins / data.results.length;
  }, [data.results]);

  const isAdjusted = data.factor !== 1.0;

  return {
    /** Current AI speed factor (1.0 = neutral, >1.0 = harder, <1.0 = easier) */
    speedFactor: data.factor,
    /** Whether the factor has been adjusted from neutral */
    isAdjusted,
    /** Number of races tracked so far */
    totalRaces: data.results.length,
    /** Record a race result (true = player won) */
    recordResult,
    /** Get the current speed factor */
    getSpeedFactor,
    /** Get the current win rate (null if no races yet) */
    getWinRate,
  };
}
