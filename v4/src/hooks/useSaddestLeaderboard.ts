/**
 * useSaddestLeaderboard.ts - "The Saddest Leaderboard"
 *
 * Tracks the WORST race times and performance metrics, creating a
 * "hall of shame" leaderboard. Stores per-track worst records in
 * localStorage and generates humorous shame messages.
 */
import { useCallback, useMemo } from 'react';

const STORAGE_KEY = 'shadow-driver-worst-times';

/** Worst performance records for a single track */
export interface WorstRecords {
  /** Slowest completion time in milliseconds */
  worstTime: number;
  /** ISO date string of the worst time */
  worstDate: string;
  /** Highest collision count in a single race */
  totalCollisions: number;
  /** Longest time spent in reverse during a single race (seconds) */
  mostReversing: number;
  /** Lowest top speed achieved while completing a race (km/h) */
  slowestTopSpeed: number;
}

/** All tracks' worst records, keyed by track name */
export type AllWorstTimes = Record<string, WorstRecords>;

/** Format milliseconds as M:SS.mmm */
function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(ms % 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

/** Read all worst times from localStorage */
function readStorage(): AllWorstTimes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as AllWorstTimes;
  } catch {
    return {};
  }
}

/** Write all worst times to localStorage */
function writeStorage(data: AllWorstTimes): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage may be full or unavailable; silently ignore
  }
}

export interface UseSaddestLeaderboardReturn {
  /** Record a race result, updating worst records if this race was worse */
  recordResult: (track: string, time: number, collisions: number, reverseTime: number, topSpeed: number) => void;
  /** Get worst records for a specific track (or null if none exist) */
  getWorstTimes: (track: string) => WorstRecords | null;
  /** Get all tracks' worst records */
  getAllWorstTimes: () => AllWorstTimes;
  /** Generate a funny shame message about the worst performance on a track */
  getShameMessage: (track: string) => string;
  /** Whether any worst times have been recorded at all */
  hasWorstTimes: boolean;
}

export function useSaddestLeaderboard(): UseSaddestLeaderboardReturn {
  const recordResult = useCallback(
    (track: string, time: number, collisions: number, reverseTime: number, topSpeed: number) => {
      const all = readStorage();
      const existing = all[track];

      if (!existing) {
        // First completion on this track -- everything is the worst by default
        all[track] = {
          worstTime: time,
          worstDate: new Date().toISOString(),
          totalCollisions: collisions,
          mostReversing: reverseTime,
          slowestTopSpeed: topSpeed,
        };
      } else {
        // Update individual records if this race was worse
        if (time > existing.worstTime) {
          existing.worstTime = time;
          existing.worstDate = new Date().toISOString();
        }
        if (collisions > existing.totalCollisions) {
          existing.totalCollisions = collisions;
        }
        if (reverseTime > existing.mostReversing) {
          existing.mostReversing = reverseTime;
        }
        // Lower top speed = worse performance
        if (topSpeed < existing.slowestTopSpeed) {
          existing.slowestTopSpeed = topSpeed;
        }
        all[track] = existing;
      }

      writeStorage(all);
    },
    [],
  );

  const getWorstTimes = useCallback((track: string): WorstRecords | null => {
    const all = readStorage();
    return all[track] ?? null;
  }, []);

  const getAllWorstTimes = useCallback((): AllWorstTimes => {
    return readStorage();
  }, []);

  const getShameMessage = useCallback((track: string): string => {
    const records = readStorage()[track];
    if (!records) return 'No shameful records yet. Keep trying!';

    // Collect all possible shame messages and pick the most egregious one
    const messages: Array<{ score: number; message: string }> = [];

    // Worst time messages (score based on how absurdly long)
    const timeFormatted = formatTime(records.worstTime);
    if (records.worstTime > 600000) {
      // Over 10 minutes
      messages.push({
        score: 4,
        message: `Your worst lap was ${timeFormatted}. The AI finished, made a coffee, and read a book.`,
      });
    } else if (records.worstTime > 300000) {
      // Over 5 minutes
      messages.push({
        score: 3,
        message: `Your worst lap was ${timeFormatted}. A sloth would have been faster.`,
      });
    } else if (records.worstTime > 120000) {
      // Over 2 minutes
      messages.push({
        score: 2,
        message: `Your worst lap was ${timeFormatted}. Were you sightseeing?`,
      });
    } else {
      messages.push({
        score: 1,
        message: `Your worst lap was ${timeFormatted}. Not great, but at least you finished.`,
      });
    }

    // Collision messages
    if (records.totalCollisions > 30) {
      messages.push({
        score: 4,
        message: `You hit ${records.totalCollisions} objects in one race. The insurance company dropped you.`,
      });
    } else if (records.totalCollisions > 15) {
      messages.push({
        score: 3,
        message: `${records.totalCollisions} collisions in a single race. The car filed a restraining order.`,
      });
    } else if (records.totalCollisions > 5) {
      messages.push({
        score: 2,
        message: `${records.totalCollisions} collisions. The traffic cones are forming a support group.`,
      });
    } else if (records.totalCollisions > 0) {
      messages.push({
        score: 1,
        message: `${records.totalCollisions} collision${records.totalCollisions > 1 ? 's' : ''}. It happens to the best of us. You are not the best of us.`,
      });
    }

    // Reverse time messages
    if (records.mostReversing > 30) {
      messages.push({
        score: 4,
        message: `You spent ${Math.round(records.mostReversing)} seconds in reverse. Were you looking for your dignity?`,
      });
    } else if (records.mostReversing > 15) {
      messages.push({
        score: 3,
        message: `${Math.round(records.mostReversing)} seconds in reverse. You unlocked the "wrong way" achievement.`,
      });
    } else if (records.mostReversing > 5) {
      messages.push({
        score: 2,
        message: `${Math.round(records.mostReversing)} seconds reversing. The GPS gave up.`,
      });
    }

    // Slowest top speed messages
    if (records.slowestTopSpeed < 30) {
      messages.push({
        score: 4,
        message: `Your top speed was ${Math.round(records.slowestTopSpeed)} km/h. A bicycle passed you.`,
      });
    } else if (records.slowestTopSpeed < 60) {
      messages.push({
        score: 3,
        message: `Top speed: ${Math.round(records.slowestTopSpeed)} km/h. School zones have higher limits.`,
      });
    } else if (records.slowestTopSpeed < 100) {
      messages.push({
        score: 2,
        message: `Top speed: ${Math.round(records.slowestTopSpeed)} km/h. Your grandma drives faster.`,
      });
    }

    // Return the most shameful message (highest score)
    messages.sort((a, b) => b.score - a.score);
    return messages[0]?.message ?? 'No shameful records yet. Keep trying!';
  }, []);

  const hasWorstTimes = useMemo(() => {
    const all = readStorage();
    return Object.keys(all).length > 0;
  }, []);

  return { recordResult, getWorstTimes, getAllWorstTimes, getShameMessage, hasWorstTimes };
}

export default useSaddestLeaderboard;
