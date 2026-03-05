/**
 * usePhotographyRally.ts - Scavenger hunt photography game mode
 *
 * Defines "photo spots" on the map. Player drives to them and
 * captures a screenshot. Scored on time to reach all spots.
 * Client-side scoring with position-based spot detection.
 *
 * Wild Idea #32 from TODO.md
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// --- Types ---

export interface PhotoSpot {
  id: string;
  name: string;
  position: { x: number; y: number };
  captureRadius: number;
  captured: boolean;
  captureTime: number | null;
  description: string;
}

export interface UsePhotographyRallyOptions {
  enabled: boolean;
  playerPosition: { x: number; y: number } | null;
  isRacing: boolean;
}

export interface UsePhotographyRallyReturn {
  spots: PhotoSpot[];
  activeSpot: PhotoSpot | null;
  capturedCount: number;
  totalSpots: number;
  isNearSpot: boolean;
  capturePhoto: () => void;
  totalTime: number;
  isComplete: boolean;
  score: number;
}

// --- Constants ---

const AUTO_CAPTURE_DWELL_MS = 2000;
const SCORE_BASE_PER_SPOT = 1000;
const SCORE_TIME_PENALTY_PER_SEC = 2;
const SCORE_MIN_PER_SPOT = 100;

// --- Default photo spots (6 locations) ---

const DEFAULT_SPOTS: Omit<PhotoSpot, 'captured' | 'captureTime'>[] = [
  { id: 'overpass',   name: 'The Overpass',        position: { x: 0, y: 100 },     captureRadius: 20, description: 'Drive under the highway overpass and snap the concrete arches.' },
  { id: 'market',     name: 'Market Square',       position: { x: -80, y: -50 },   captureRadius: 25, description: 'Find the open-air market stalls in the town center.' },
  { id: 'fountain',   name: 'The Fountain',        position: { x: 50, y: -120 },   captureRadius: 15, description: 'A stone fountain tucked away in a quiet courtyard.' },
  { id: 'hilltop',    name: 'Hilltop View',        position: { x: 150, y: 80 },    captureRadius: 30, description: 'Climb to the hilltop for a panoramic view of the city.' },
  { id: 'tunnel',     name: 'The Tunnel Entrance', position: { x: -120, y: 60 },   captureRadius: 20, description: 'The dark mouth of the railway tunnel on the outskirts.' },
  { id: 'waterfront', name: 'Waterfront',          position: { x: 30, y: 180 },    captureRadius: 25, description: 'Pull up to the waterfront promenade at the edge of town.' },
];

// --- Helpers ---

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function createInitialSpots(): PhotoSpot[] {
  return DEFAULT_SPOTS.map((spot) => ({ ...spot, captured: false, captureTime: null }));
}

// --- Hook ---

export function usePhotographyRally(options: UsePhotographyRallyOptions): UsePhotographyRallyReturn {
  const { enabled, playerPosition, isRacing } = options;

  const [spots, setSpots] = useState<PhotoSpot[]>(createInitialSpots);
  const [isNearSpot, setIsNearSpot] = useState(false);
  const [totalTime, setTotalTime] = useState(0);

  const startTimeRef = useRef<number | null>(null);
  const dwellStartRef = useRef<number | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived state
  const activeSpot = useMemo(() => spots.find((s) => !s.captured) ?? null, [spots]);
  const capturedCount = useMemo(() => spots.filter((s) => s.captured).length, [spots]);
  const totalSpots = spots.length;
  const isComplete = capturedCount === totalSpots;

  const score = useMemo(() => {
    return spots.reduce((acc, spot) => {
      if (!spot.captured || spot.captureTime === null) return acc;
      const elapsedSec = spot.captureTime / 1000;
      const spotScore = Math.max(
        SCORE_MIN_PER_SPOT,
        SCORE_BASE_PER_SPOT - Math.floor(elapsedSec * SCORE_TIME_PENALTY_PER_SEC),
      );
      return acc + spotScore;
    }, 0);
  }, [spots]);

  // Helper to mark a spot as captured with current elapsed time
  const markCaptured = useCallback((spotId: string) => {
    const now = performance.now();
    const elapsed = startTimeRef.current !== null ? now - startTimeRef.current : 0;
    setSpots((prev) =>
      prev.map((s) => (s.id === spotId ? { ...s, captured: true, captureTime: elapsed } : s)),
    );
  }, []);

  // Manually capture the current active spot
  const capturePhoto = useCallback(() => {
    if (!enabled || !activeSpot || !isNearSpot) return;
    markCaptured(activeSpot.id);
    // Clear dwell timer since we captured manually
    if (dwellTimerRef.current) { clearTimeout(dwellTimerRef.current); dwellTimerRef.current = null; }
    dwellStartRef.current = null;
  }, [enabled, activeSpot, isNearSpot, markCaptured]);

  // Reset spots when the mode is toggled on or a new race starts
  useEffect(() => {
    if (!enabled) return;
    setSpots(createInitialSpots());
    setTotalTime(0);
    setIsNearSpot(false);
    startTimeRef.current = null;
    dwellStartRef.current = null;
    if (dwellTimerRef.current) { clearTimeout(dwellTimerRef.current); dwellTimerRef.current = null; }
  }, [enabled, isRacing]);

  // Elapsed time clock — ticks every 100ms while racing
  useEffect(() => {
    if (!enabled || !isRacing) {
      if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
      return;
    }
    startTimeRef.current = performance.now();
    timerIntervalRef.current = setInterval(() => {
      if (startTimeRef.current !== null) setTotalTime(performance.now() - startTimeRef.current);
    }, 100);
    return () => {
      if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
    };
  }, [enabled, isRacing]);

  // Stop the clock once all spots are captured
  useEffect(() => {
    if (isComplete && timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, [isComplete]);

  // Proximity detection and auto-capture
  useEffect(() => {
    if (!enabled || !playerPosition || !activeSpot || isComplete) {
      setIsNearSpot(false);
      if (dwellTimerRef.current) { clearTimeout(dwellTimerRef.current); dwellTimerRef.current = null; }
      dwellStartRef.current = null;
      return;
    }

    const dist = distanceBetween(playerPosition, activeSpot.position);
    const withinRadius = dist <= activeSpot.captureRadius;
    setIsNearSpot(withinRadius);

    if (withinRadius) {
      // Player just entered radius — start dwell timer for auto-capture
      if (dwellStartRef.current === null) {
        dwellStartRef.current = performance.now();
        const spotId = activeSpot.id;
        dwellTimerRef.current = setTimeout(() => {
          markCaptured(spotId);
          dwellStartRef.current = null;
          dwellTimerRef.current = null;
        }, AUTO_CAPTURE_DWELL_MS);
      }
    } else {
      // Player left radius — cancel auto-capture
      if (dwellTimerRef.current) { clearTimeout(dwellTimerRef.current); dwellTimerRef.current = null; }
      dwellStartRef.current = null;
    }
  }, [enabled, playerPosition, activeSpot, isComplete, markCaptured]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (dwellTimerRef.current) { clearTimeout(dwellTimerRef.current); dwellTimerRef.current = null; }
      if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
    };
  }, []);

  return {
    spots, activeSpot, capturedCount, totalSpots,
    isNearSpot, capturePhoto, totalTime, isComplete, score,
  };
}

export default usePhotographyRally;
