/**
 * useGhostRecorder.ts - Ghost replay recording system
 *
 * Records the player's position, yaw, and speed at 10Hz during a race.
 * After a race finishes, the ghost data can be saved as a personal best
 * ghost in localStorage, keyed by track and lap count.
 *
 * Ghost data at 10Hz for 2 minutes = ~1200 frames * ~30 bytes = ~36KB uncompressed.
 * The ghost car rendering is a separate feature; this hook only records and stores data.
 */
import { useRef, useCallback } from 'react';

/** A single ghost frame recorded at 10Hz */
export interface GhostFrame {
  /** Time offset in seconds since recording started */
  t: number;
  /** World X position */
  x: number;
  /** World Y position */
  y: number;
  /** Yaw in degrees */
  yaw: number;
  /** Speed in km/h */
  speed: number;
}

/** The full ghost recording for a race */
export interface GhostData {
  frames: GhostFrame[];
}

/** What gets stored in localStorage (ghost data + race time for PB comparison) */
interface StoredGhost {
  ghost: GhostData;
  raceTime: number;
  date: string;
}

const STORAGE_KEY_PREFIX = 'shadow_driver_ghost_';

/** Minimum interval between recorded frames (100ms = 10Hz) */
const RECORD_INTERVAL_MS = 100;

export interface UseGhostRecorderReturn {
  /** Start recording ghost frames. Call when race status becomes 'racing'. */
  start: () => void;
  /** Stop recording. Call when race finishes. */
  stop: () => void;
  /** Reset all recorded data. */
  reset: () => void;
  /** Record a frame. Call from RAF loop; internally throttled to 10Hz. */
  recordFrame: (x: number, y: number, yaw: number, speed: number) => void;
  /** Get the recorded ghost data. */
  getGhostData: () => GhostData;
  /**
   * Save the ghost as a personal best if the race time beats the stored ghost.
   * Returns true if saved (new PB), false otherwise.
   */
  saveAsPersonalBest: (track: string, laps: number, raceTime: number) => boolean;
}

export function useGhostRecorder(): UseGhostRecorderReturn {
  const framesRef = useRef<GhostFrame[]>([]);
  const isRecordingRef = useRef(false);
  const startTimeRef = useRef(0);
  const lastRecordTimeRef = useRef(0);

  const start = useCallback(() => {
    framesRef.current = [];
    isRecordingRef.current = true;
    startTimeRef.current = performance.now();
    lastRecordTimeRef.current = 0;
  }, []);

  const stop = useCallback(() => {
    isRecordingRef.current = false;
  }, []);

  const reset = useCallback(() => {
    framesRef.current = [];
    isRecordingRef.current = false;
    startTimeRef.current = 0;
    lastRecordTimeRef.current = 0;
  }, []);

  const recordFrame = useCallback((x: number, y: number, yaw: number, speed: number) => {
    if (!isRecordingRef.current) return;

    const now = performance.now();
    const elapsed = now - startTimeRef.current;

    // Throttle to 10Hz
    if (elapsed - lastRecordTimeRef.current < RECORD_INTERVAL_MS) return;
    lastRecordTimeRef.current = elapsed;

    framesRef.current.push({
      t: Math.round(elapsed) / 1000, // Convert to seconds, rounded to ms precision
      x,
      y,
      yaw,
      speed,
    });
  }, []);

  const getGhostData = useCallback((): GhostData => {
    return { frames: [...framesRef.current] };
  }, []);

  const saveAsPersonalBest = useCallback((track: string, laps: number, raceTime: number): boolean => {
    if (framesRef.current.length === 0) return false;

    const key = `${STORAGE_KEY_PREFIX}${track}_${laps}`;

    try {
      // Check if there's an existing ghost with a better time
      const existingRaw = localStorage.getItem(key);
      if (existingRaw) {
        const existing: StoredGhost = JSON.parse(existingRaw);
        if (existing.raceTime <= raceTime) {
          // Existing ghost is faster or equal, don't overwrite
          return false;
        }
      }

      // Save the new ghost
      const stored: StoredGhost = {
        ghost: { frames: framesRef.current },
        raceTime,
        date: new Date().toISOString(),
      };
      localStorage.setItem(key, JSON.stringify(stored));
      return true;
    } catch {
      // localStorage full or unavailable
      return false;
    }
  }, []);

  return {
    start,
    stop,
    reset,
    recordFrame,
    getGhostData,
    saveAsPersonalBest,
  };
}
