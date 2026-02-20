/**
 * useRaceMemory.ts - Persistent memory of all past races
 *
 * Stores a log of every race ever run: who won, the time, track,
 * conditions, and notable events. Creates a sense of history.
 *
 * Wild Idea #50 from TODO.md
 */
import { useState, useCallback, useRef } from 'react';

// --- Types ---

export interface RaceMemoryEntry {
  id: string;
  date: string;
  track: string;
  winner: 'player' | 'ai';
  playerTime: number;
  aiTime: number;
  gap: number;
  weather: string;
  laps: number;
  collisions: number;
  topSpeed: number;
  highlight: string;
}

export type RaceMemoryInput = Omit<RaceMemoryEntry, 'id' | 'date' | 'highlight'>;

export interface TrackStats {
  races: number;
  playerWins: number;
  bestTime: number;
  avgCollisions: number;
}

export interface StreakInfo {
  type: 'player' | 'ai' | 'none';
  count: number;
}

export interface UseRaceMemoryOptions {
  maxEntries?: number;
}

export interface UseRaceMemoryReturn {
  memories: RaceMemoryEntry[];
  addMemory: (data: RaceMemoryInput) => RaceMemoryEntry;
  getTrackStats: (track: string) => TrackStats;
  getStreak: () => StreakInfo;
  totalRaces: number;
  clearMemory: () => void;
}

// --- Constants ---

const STORAGE_KEY = 'shadow-driver-race-memory';
const DEFAULT_MAX_ENTRIES = 50;

// --- Helpers ---

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadMemories(): RaceMemoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RaceMemoryEntry[];
  } catch {
    return [];
  }
}

function saveMemories(memories: RaceMemoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memories));
  } catch { /* ignore — private browsing, quota exceeded, etc. */ }
}

function generateHighlight(
  data: RaceMemoryInput,
  previousMemories: RaceMemoryEntry[],
): string {
  // Photo finish
  if (data.gap < 500) {
    return `Photo finish -- ${data.gap}ms apart!`;
  }

  // Demolition derby
  if (data.collisions > 10) {
    return `Demolition derby -- ${data.collisions} collisions`;
  }

  // Speed demon
  if (data.topSpeed > 180) {
    return `Hit ${Math.round(data.topSpeed)} km/h -- speed demon!`;
  }

  // Sub-minute race
  if (data.playerTime < 60000) {
    return 'Sub-minute race!';
  }

  // Revenge race — player won but previously lost on this track
  if (data.winner === 'player') {
    const previousLoss = previousMemories.find(
      (m) => m.track === data.track && m.winner === 'ai',
    );
    if (previousLoss) {
      return 'Revenge race -- finally won!';
    }
  }

  // AI winning streak
  if (data.winner === 'ai') {
    let streak = 0;
    for (let i = previousMemories.length - 1; i >= 0; i--) {
      if (previousMemories[i].winner === 'ai') {
        streak++;
      } else {
        break;
      }
    }
    // Current race adds 1 more to the streak
    const totalStreak = streak + 1;
    if (totalStreak > 3) {
      return `AI on a ${totalStreak}-race winning streak`;
    }
  }

  // Default
  return `Standard race on ${data.track}`;
}

// --- Hook ---

export function useRaceMemory(
  options?: UseRaceMemoryOptions,
): UseRaceMemoryReturn {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const [memories, setMemories] = useState<RaceMemoryEntry[]>(loadMemories);
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;

  const addMemory = useCallback(
    (data: RaceMemoryInput): RaceMemoryEntry => {
      const current = memoriesRef.current;
      const highlight = generateHighlight(data, current);

      const entry: RaceMemoryEntry = {
        id: generateId(),
        date: new Date().toISOString(),
        highlight,
        ...data,
      };

      const updated = [...current, entry];
      // Prune oldest if over limit
      const pruned =
        updated.length > maxEntries
          ? updated.slice(updated.length - maxEntries)
          : updated;

      setMemories(pruned);
      memoriesRef.current = pruned;
      saveMemories(pruned);
      return entry;
    },
    [maxEntries],
  );

  const getTrackStats = useCallback(
    (track: string): TrackStats => {
      const trackRaces = memoriesRef.current.filter((m) => m.track === track);
      if (trackRaces.length === 0) {
        return { races: 0, playerWins: 0, bestTime: 0, avgCollisions: 0 };
      }

      const playerWins = trackRaces.filter((m) => m.winner === 'player').length;
      const bestTime = Math.min(...trackRaces.map((m) => m.playerTime));
      const avgCollisions =
        trackRaces.reduce((sum, m) => sum + m.collisions, 0) /
        trackRaces.length;

      return {
        races: trackRaces.length,
        playerWins,
        bestTime,
        avgCollisions: Math.round(avgCollisions * 10) / 10,
      };
    },
    [],
  );

  const getStreak = useCallback((): StreakInfo => {
    const current = memoriesRef.current;
    if (current.length === 0) {
      return { type: 'none', count: 0 };
    }

    const lastWinner = current[current.length - 1].winner;
    let count = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      if (current[i].winner === lastWinner) {
        count++;
      } else {
        break;
      }
    }

    return { type: lastWinner, count };
  }, []);

  const clearMemory = useCallback(() => {
    setMemories([]);
    memoriesRef.current = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  return {
    memories,
    addMemory,
    getTrackStats,
    getStreak,
    totalRaces: memories.length,
    clearMemory,
  };
}

export default useRaceMemory;
