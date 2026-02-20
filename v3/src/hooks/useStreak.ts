import { useState, useCallback } from 'react';

const STORAGE_KEY = 'shadow_driver_streak';

interface StreakData {
  streak: number;
  lastPlayDate: string; // YYYY-MM-DD
  bestStreak: number;
}

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayDate(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadStreak(): StreakData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StreakData;
      if (parsed.streak != null && parsed.lastPlayDate && parsed.bestStreak != null) {
        return parsed;
      }
    }
  } catch {
    // Corrupted data -- reset
  }
  return { streak: 0, lastPlayDate: '', bestStreak: 0 };
}

function saveStreak(data: StreakData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage not available -- ignore
  }
}

export function useStreak() {
  const [streakData, setStreakData] = useState<StreakData>(loadStreak);

  const recordRace = useCallback((): { newStreak: number; isNewRecord: boolean } => {
    const today = getTodayDate();
    const yesterday = getYesterdayDate();
    const current = loadStreak(); // Re-read to avoid stale closures

    let newStreak: number;
    let isNewRecord = false;

    if (current.lastPlayDate === today) {
      // Already played today -- no change
      return { newStreak: current.streak, isNewRecord: false };
    } else if (current.lastPlayDate === yesterday) {
      // Consecutive day -- increment streak
      newStreak = current.streak + 1;
    } else {
      // Gap in playing -- reset streak to 1
      newStreak = 1;
    }

    const newBest = Math.max(current.bestStreak, newStreak);
    isNewRecord = newStreak > current.bestStreak;

    const updated: StreakData = {
      streak: newStreak,
      lastPlayDate: today,
      bestStreak: newBest,
    };

    saveStreak(updated);
    setStreakData(updated);

    return { newStreak, isNewRecord };
  }, []);

  return {
    streak: streakData.streak,
    bestStreak: streakData.bestStreak,
    lastPlayDate: streakData.lastPlayDate,
    recordRace,
  };
}
