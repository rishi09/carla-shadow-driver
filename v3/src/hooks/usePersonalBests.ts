/**
 * usePersonalBests.ts - Personal best times per track/lap combo
 *
 * Stores only the single best time for each track+laps combination.
 * Awards medals by comparing current race time against personal best:
 *   Gold:   within 5% of personal best
 *   Silver: within 15% of personal best
 *   Bronze: finished the race
 *   null:   first completion (no previous time to compare against)
 */
import { useCallback, useState, useEffect } from 'react';

const STORAGE_KEY = 'shadow-driver-pb';

export interface PersonalBest {
  time: number;        // Total race time in seconds
  date: string;        // ISO date string
  track: string;
  laps: number;
  weather: string;
  difficulty: string;
  topSpeed: number;
  driftScore?: number;
}

export interface PersonalBestResult {
  isNewBest: boolean;
  previousBest: PersonalBest | null;
  medal: 'gold' | 'silver' | 'bronze' | null;
  improvement: number | null; // seconds improved (positive = faster)
}

export interface UsePersonalBestsReturn {
  /** Get the personal best for a track/lap combo, or null if none */
  getBest: (track: string, laps: number) => PersonalBest | null;
  /** Save a result. Returns true if it was a new personal best. */
  saveBest: (result: PersonalBest) => boolean;
  /** Get all personal bests keyed by track_laps */
  getAllBests: () => Record<string, PersonalBest>;
  /** Get medal for a given time compared to personal best */
  getMedal: (track: string, laps: number, time: number) => 'gold' | 'silver' | 'bronze' | null;
  /** Get full result info (medal, previous best, improvement) for a completed race */
  getResult: (track: string, laps: number, time: number) => PersonalBestResult;
}

function makeKey(track: string, laps: number): string {
  return `${track}_${laps}`;
}

function loadBests(): Record<string, PersonalBest> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PersonalBest>;
  } catch {
    return {};
  }
}

function saveBestsToStorage(bests: Record<string, PersonalBest>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bests));
  } catch {
    // localStorage might be full or disabled
  }
}

export function usePersonalBests(): UsePersonalBestsReturn {
  const [bests, setBests] = useState<Record<string, PersonalBest>>(loadBests);

  // Sync to localStorage whenever bests change
  useEffect(() => {
    saveBestsToStorage(bests);
  }, [bests]);

  const getBest = useCallback((track: string, laps: number): PersonalBest | null => {
    const key = makeKey(track, laps);
    return bests[key] ?? null;
  }, [bests]);

  const saveBest = useCallback((result: PersonalBest): boolean => {
    const key = makeKey(result.track, result.laps);
    const existing = bests[key];

    // Only save if faster than existing or no existing record
    if (existing && result.time >= existing.time) {
      return false;
    }

    setBests(prev => ({
      ...prev,
      [key]: result,
    }));
    return true;
  }, [bests]);

  const getMedal = useCallback((track: string, laps: number, time: number): 'gold' | 'silver' | 'bronze' | null => {
    const key = makeKey(track, laps);
    const best = bests[key];

    // No medal on first completion -- need a previous time to compare against
    if (!best) return null;

    // Compare against personal best
    // Gold: within 5% of PB (time <= PB * 1.05)
    // Silver: within 15% of PB (time <= PB * 1.15)
    // Bronze: finished the race
    if (time <= best.time * 1.05) return 'gold';
    if (time <= best.time * 1.15) return 'silver';
    return 'bronze';
  }, [bests]);

  const getResult = useCallback((track: string, laps: number, time: number): PersonalBestResult => {
    const key = makeKey(track, laps);
    const previousBest = bests[key] ?? null;

    const isNewBest = previousBest === null || time < previousBest.time;
    const medal = getMedal(track, laps, time);
    const improvement = previousBest ? previousBest.time - time : null;

    return {
      isNewBest,
      previousBest,
      medal,
      improvement: improvement !== null && improvement > 0 ? improvement : null,
    };
  }, [bests, getMedal]);

  const getAllBests = useCallback((): Record<string, PersonalBest> => {
    return { ...bests };
  }, [bests]);

  return { getBest, saveBest, getAllBests, getMedal, getResult };
}
