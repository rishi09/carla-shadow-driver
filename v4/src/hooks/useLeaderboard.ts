/**
 * useLeaderboard.ts - Personal best times stored in localStorage
 *
 * Tracks best race times per track/lap-count combination.
 * Shows medals: Gold (top 10%), Silver (top 25%), Bronze (top 50%).
 */
import { useCallback, useState, useEffect } from 'react';

const STORAGE_KEY = 'shadow-driver-v3-leaderboard';

export interface LeaderboardEntry {
  track: string;
  laps: number;
  time: number;         // Total race time in seconds
  bestLap: number;      // Best single lap time
  maxSpeed: number;     // Top speed achieved
  driftScore: number;   // Total drift score
  date: string;         // ISO date string
  difficulty: string;   // AI difficulty
  playerCar: string;    // Car used
  winner?: 'player' | 'ai';  // Who won the race
  aiTime?: number | null;     // AI's total race time in seconds
}

export interface TrackRecord {
  track: string;
  laps: number;
  entries: LeaderboardEntry[];
  bestTime: number | null;
  bestLap: number | null;
  medal: 'gold' | 'silver' | 'bronze' | null;
}

// Medal thresholds per track (seconds per lap)
// Gold = under this per lap, Silver = under 1.5x, Bronze = under 2x
const TRACK_PAR_TIMES: Record<string, number> = {
  'Town01': 40,
  'Town02': 35,
  'Town03': 45,
  'Town04': 50,
  'Town05': 42,
  'Town07': 48,
  'Town10HD': 38,
};

function getMedal(totalTime: number, laps: number, track: string): 'gold' | 'silver' | 'bronze' | null {
  const parPerLap = TRACK_PAR_TIMES[track] ?? 45;
  const parTotal = parPerLap * laps;

  if (totalTime <= parTotal) return 'gold';
  if (totalTime <= parTotal * 1.3) return 'silver';
  if (totalTime <= parTotal * 1.7) return 'bronze';
  return null;
}

function loadEntries(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LeaderboardEntry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: LeaderboardEntry[]) {
  try {
    // Keep only the last 100 entries
    const trimmed = entries.slice(-100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage might be full or disabled
  }
}

export interface UseLeaderboardReturn {
  /** Add a new race result. Returns the medal earned (or null). */
  addResult: (entry: Omit<LeaderboardEntry, 'date'>) => 'gold' | 'silver' | 'bronze' | null;
  /** Get records for a specific track/lap combo */
  getTrackRecord: (track: string, laps: number) => TrackRecord;
  /** Get all track records (for leaderboard display) */
  getAllRecords: () => TrackRecord[];
  /** Check if a time would be a new personal best */
  isPersonalBest: (track: string, laps: number, time: number) => boolean;
  /** Clear all leaderboard data */
  clearAll: () => void;
}

export function useLeaderboard(): UseLeaderboardReturn {
  const [entries, setEntries] = useState<LeaderboardEntry[]>(loadEntries);

  // Sync to localStorage whenever entries change
  useEffect(() => {
    saveEntries(entries);
  }, [entries]);

  const addResult = useCallback((entry: Omit<LeaderboardEntry, 'date'>): 'gold' | 'silver' | 'bronze' | null => {
    const fullEntry: LeaderboardEntry = {
      ...entry,
      date: new Date().toISOString(),
    };
    setEntries(prev => [...prev, fullEntry]);
    return getMedal(entry.time, entry.laps, entry.track);
  }, []);

  const getTrackRecord = useCallback((track: string, laps: number): TrackRecord => {
    const trackEntries = entries
      .filter(e => e.track === track && e.laps === laps)
      .sort((a, b) => a.time - b.time);

    const bestTime = trackEntries.length > 0 ? trackEntries[0].time : null;
    const bestLap = trackEntries.length > 0
      ? Math.min(...trackEntries.map(e => e.bestLap))
      : null;
    const medal = bestTime !== null ? getMedal(bestTime, laps, track) : null;

    return {
      track,
      laps,
      entries: trackEntries.slice(0, 10), // Top 10
      bestTime,
      bestLap,
      medal,
    };
  }, [entries]);

  const getAllRecords = useCallback((): TrackRecord[] => {
    // Get unique track/lap combinations
    const seen = new Set<string>();
    const records: TrackRecord[] = [];

    for (const entry of entries) {
      const key = `${entry.track}:${entry.laps}`;
      if (!seen.has(key)) {
        seen.add(key);
        records.push(getTrackRecord(entry.track, entry.laps));
      }
    }

    return records.sort((a, b) => a.track.localeCompare(b.track) || a.laps - b.laps);
  }, [entries, getTrackRecord]);

  const isPersonalBest = useCallback((track: string, laps: number, time: number): boolean => {
    const record = getTrackRecord(track, laps);
    return record.bestTime === null || time < record.bestTime;
  }, [getTrackRecord]);

  const clearAll = useCallback(() => {
    setEntries([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { addResult, getTrackRecord, getAllRecords, isPersonalBest, clearAll };
}
