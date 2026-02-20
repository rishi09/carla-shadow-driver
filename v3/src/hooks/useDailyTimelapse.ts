/**
 * useDailyTimelapse.ts - Collect daily race highlights
 *
 * Records key moments from each race for a daily summary.
 *
 * Wild Idea #15 from TODO.md
 */
import { useState, useCallback, useMemo } from 'react';

interface TimelapseFrame {
  timestamp: number;
  type: 'start' | 'overtake' | 'crash' | 'finish' | 'drift' | 'photo_finish';
  description: string;
  speed: number;
  track: string;
  raceId: string;
}

interface DaySummary {
  date: string;
  totalRaces: number;
  totalPlayTime: number;
  frames: TimelapseFrame[];
  bestMoment: TimelapseFrame | null;
}

const STORAGE_KEY = 'shadow-driver-timelapse';
const MAX_FRAMES = 50;
const MAX_DAYS = 30;

function getDateKey(): string {
  return new Date().toISOString().split('T')[0];
}

function loadData(): Record<string, DaySummary> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveData(data: Record<string, DaySummary>): void {
  try {
    const keys = Object.keys(data).sort().reverse();
    const pruned: Record<string, DaySummary> = {};
    keys.slice(0, MAX_DAYS).forEach(k => { pruned[k] = data[k]; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch { /* storage full */ }
}

const PRIORITY: Record<string, number> = {
  photo_finish: 6, drift: 5, overtake: 4, crash: 3, finish: 2, start: 1,
};

function findBest(frames: TimelapseFrame[]): TimelapseFrame | null {
  if (frames.length === 0) return null;
  return frames.reduce((best, f) =>
    (PRIORITY[f.type] ?? 0) > (PRIORITY[best.type] ?? 0) ? f : best
  );
}

export function useDailyTimelapse() {
  const [data, setData] = useState<Record<string, DaySummary>>(loadData);

  const todaysSummary = useMemo((): DaySummary => {
    const key = getDateKey();
    return data[key] ?? { date: key, totalRaces: 0, totalPlayTime: 0, frames: [], bestMoment: null };
  }, [data]);

  const addFrame = useCallback((frame: Omit<TimelapseFrame, 'timestamp'>) => {
    setData(prev => {
      const key = getDateKey();
      const day = prev[key] ?? { date: key, totalRaces: 0, totalPlayTime: 0, frames: [], bestMoment: null };
      if (day.frames.length >= MAX_FRAMES) return prev;

      const newFrame: TimelapseFrame = { ...frame, timestamp: Date.now() };
      const frames = [...day.frames, newFrame];
      const totalRaces = frame.type === 'start' ? day.totalRaces + 1 : day.totalRaces;
      const updated = { ...prev, [key]: { ...day, totalRaces, frames, bestMoment: findBest(frames) } };
      saveData(updated);
      return updated;
    });
  }, []);

  const getDay = useCallback((date: string): DaySummary | null => data[date] ?? null, [data]);

  const recentDays = useMemo((): DaySummary[] =>
    Object.keys(data).sort().reverse().slice(0, 7).map(k => data[k]),
    [data],
  );

  const totalFrames = useMemo(() =>
    Object.values(data).reduce((sum, d) => sum + d.frames.length, 0), [data],
  );

  const clearHistory = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setData({});
  }, []);

  return { todaysSummary, addFrame, getDay, recentDays, totalFrames, clearHistory };
}

export default useDailyTimelapse;
