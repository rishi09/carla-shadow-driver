import { useState, useEffect, useCallback } from 'react';

export interface LeaderboardEntry {
  id: string;
  playerName: string;
  time: number;
  lapTimes: number[];
  date: string;
  crashes: number;
  perfectLaps: number;
}

interface UseLeaderboardReturn {
  entries: LeaderboardEntry[];
  isLoading: boolean;
  addEntry: (entry: Omit<LeaderboardEntry, 'id' | 'date'>) => LeaderboardEntry;
  getPlayerBest: (playerName: string) => LeaderboardEntry | null;
  getRank: (time: number) => number;
  clearLeaderboard: () => void;
}

const STORAGE_KEY_PREFIX = 'shadow-driver-leaderboard-';
const MAX_ENTRIES = 10;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function getStorageKey(trackId: string): string {
  return `${STORAGE_KEY_PREFIX}${trackId}`;
}

function loadFromStorage(trackId: string): LeaderboardEntry[] {
  try {
    const stored = localStorage.getItem(getStorageKey(trackId));
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    // Validate and filter entries
    return parsed.filter((entry): entry is LeaderboardEntry => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.id === 'string' &&
        typeof entry.playerName === 'string' &&
        typeof entry.time === 'number' &&
        Array.isArray(entry.lapTimes) &&
        typeof entry.date === 'string'
      );
    });
  } catch (error) {
    console.error('Failed to load leaderboard from localStorage:', error);
    return [];
  }
}

function saveToStorage(trackId: string, entries: LeaderboardEntry[]): void {
  try {
    localStorage.setItem(getStorageKey(trackId), JSON.stringify(entries));
  } catch (error) {
    console.error('Failed to save leaderboard to localStorage:', error);
  }
}

export function useLeaderboard(trackId: string): UseLeaderboardReturn {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load entries on mount or when trackId changes
  useEffect(() => {
    setIsLoading(true);
    const loaded = loadFromStorage(trackId);
    // Sort by time ascending (fastest first)
    const sorted = [...loaded].sort((a, b) => a.time - b.time);
    setEntries(sorted.slice(0, MAX_ENTRIES));
    setIsLoading(false);
  }, [trackId]);

  const addEntry = useCallback(
    (entryData: Omit<LeaderboardEntry, 'id' | 'date'>): LeaderboardEntry => {
      // Validate time is a positive number
      if (typeof entryData.time !== 'number' || entryData.time < 0 || !isFinite(entryData.time)) {
        console.error('Invalid time value for leaderboard entry:', entryData.time);
        // Return a dummy entry to avoid breaking the UI
        return {
          ...entryData,
          id: generateId(),
          date: new Date().toISOString(),
          time: 0,
        };
      }

      const newEntry: LeaderboardEntry = {
        ...entryData,
        id: generateId(),
        date: new Date().toISOString(),
      };

      setEntries((prevEntries) => {
        // Add new entry and sort by time
        const updated = [...prevEntries, newEntry]
          .sort((a, b) => a.time - b.time)
          .slice(0, MAX_ENTRIES);

        // Persist to storage
        saveToStorage(trackId, updated);

        return updated;
      });

      return newEntry;
    },
    [trackId]
  );

  const getPlayerBest = useCallback(
    (playerName: string): LeaderboardEntry | null => {
      const playerEntries = entries.filter(
        (entry) => entry.playerName.toLowerCase() === playerName.toLowerCase()
      );
      if (playerEntries.length === 0) return null;
      // Already sorted by time, so first is best
      return playerEntries[0];
    },
    [entries]
  );

  const getRank = useCallback(
    (time: number): number => {
      // Returns 1-based rank
      const rank = entries.filter((entry) => entry.time < time).length + 1;
      return rank;
    },
    [entries]
  );

  const clearLeaderboard = useCallback(() => {
    setEntries([]);
    try {
      localStorage.removeItem(getStorageKey(trackId));
    } catch (error) {
      console.error('Failed to clear leaderboard from localStorage:', error);
    }
  }, [trackId]);

  return {
    entries,
    isLoading,
    addEntry,
    getPlayerBest,
    getRank,
    clearLeaderboard,
  };
}
