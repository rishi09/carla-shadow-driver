/**
 * useInfiniteHighway.ts - Endless runner distance challenge
 *
 * No laps, no finish. Drive as far as possible without crashing.
 * Distance-based scoring with increasing difficulty. Obstacles get
 * denser, weather worsens, road narrows. Client-side scoring/tracking.
 *
 * Wild Idea #49 from TODO.md
 */
import { useState, useEffect, useRef, useMemo } from 'react';

// Types

export interface UseInfiniteHighwayOptions {
  enabled: boolean;
  speed: number;         // km/h
  collisionCount: number;
  isRacing: boolean;
}

export type InfinitePhase = 'warmup' | 'cruising' | 'intense' | 'insane' | 'impossible';

export interface SuggestedWeather {
  cloudiness: number;
  rain: number;
  fog: number;
}

export interface HighScoreEntry {
  distance: number;
  date: string;
}

export interface UseInfiniteHighwayReturn {
  distance: number;            // meters traveled
  score: number;               // distance * multiplier accumulation
  multiplier: number;          // 1x-5x, resets on crash
  phase: InfinitePhase;
  phaseMessage: string;
  crashesRemaining: number;    // starts at 3
  isGameOver: boolean;
  suggestedWeather: SuggestedWeather;
  suggestedDifficulty: number; // 0-1
  personalBest: number;        // from localStorage
  isNewRecord: boolean;
  highScores: HighScoreEntry[];
}

// Constants

const STORAGE_KEY = 'shadow-driver-infinite-highway';
const MAX_HIGH_SCORES = 5;
const STARTING_LIVES = 3;
const MAX_MULTIPLIER = 5;
const MULTIPLIER_INCREMENT = 0.1;
const MULTIPLIER_INTERVAL_S = 10;

const PHASE_THRESHOLDS: { phase: InfinitePhase; minDistance: number }[] = [
  { phase: 'impossible', minDistance: 10_000 },
  { phase: 'insane', minDistance: 5_000 },
  { phase: 'intense', minDistance: 2_000 },
  { phase: 'cruising', minDistance: 500 },
  { phase: 'warmup', minDistance: 0 },
];

const PHASE_MESSAGES: Record<InfinitePhase, string> = {
  warmup: 'Just getting started...',
  cruising: 'Finding your rhythm.',
  intense: 'Things are heating up!',
  insane: 'Hold on tight!',
  impossible: 'Beyond mortal limits.',
};

const PHASE_WEATHER: Record<InfinitePhase, SuggestedWeather> = {
  warmup: { cloudiness: 0, rain: 0, fog: 0 },
  cruising: { cloudiness: 30, rain: 0, fog: 10 },
  intense: { cloudiness: 60, rain: 50, fog: 20 },
  insane: { cloudiness: 80, rain: 80, fog: 50 },
  impossible: { cloudiness: 100, rain: 100, fog: 70 },
};

const PHASE_DIFFICULTY: Record<InfinitePhase, number> = {
  warmup: 0.1,
  cruising: 0.3,
  intense: 0.55,
  insane: 0.8,
  impossible: 1.0,
};

// Helpers

function loadHighScores(): HighScoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HighScoreEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => typeof e.distance === 'number' && typeof e.date === 'string')
      .sort((a, b) => b.distance - a.distance)
      .slice(0, MAX_HIGH_SCORES);
  } catch {
    return [];
  }
}

function saveHighScores(scores: HighScoreEntry[]): void {
  try {
    const sorted = scores.sort((a, b) => b.distance - a.distance).slice(0, MAX_HIGH_SCORES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch { /* localStorage unavailable */ }
}

function resolvePhase(distance: number): InfinitePhase {
  for (const { phase, minDistance } of PHASE_THRESHOLDS) {
    if (distance >= minDistance) return phase;
  }
  return 'warmup';
}

// Hook

export function useInfiniteHighway(options: UseInfiniteHighwayOptions): UseInfiniteHighwayReturn {
  const { enabled, speed, collisionCount, isRacing } = options;

  const [distance, setDistance] = useState(0);
  const [score, setScore] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [crashesRemaining, setCrashesRemaining] = useState(STARTING_LIVES);
  const [isGameOver, setIsGameOver] = useState(false);
  const [highScores, setHighScores] = useState<HighScoreEntry[]>(() => loadHighScores());

  const lastTickRef = useRef<number | null>(null);
  const secondsWithoutCrashRef = useRef(0);
  const prevCollisionCountRef = useRef(collisionCount);
  const scoreSavedRef = useRef(false);
  const animFrameRef = useRef<number | null>(null);

  // Derived values
  const phase = useMemo(() => resolvePhase(distance), [distance]);
  const phaseMessage = PHASE_MESSAGES[phase];
  const suggestedWeather = PHASE_WEATHER[phase];
  const suggestedDifficulty = PHASE_DIFFICULTY[phase];
  const personalBest = useMemo(
    () => (highScores.length > 0 ? highScores[0].distance : 0),
    [highScores],
  );
  const isNewRecord = distance > personalBest && distance > 0;

  // Reset when mode is toggled on
  useEffect(() => {
    if (!enabled) return;
    setDistance(0);
    setScore(0);
    setMultiplier(1);
    setCrashesRemaining(STARTING_LIVES);
    setIsGameOver(false);
    scoreSavedRef.current = false;
    lastTickRef.current = null;
    secondsWithoutCrashRef.current = 0;
    prevCollisionCountRef.current = collisionCount;
    setHighScores(loadHighScores());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Crash detection: react to collision count increases
  useEffect(() => {
    if (!enabled || !isRacing || isGameOver) return;
    const newCrashes = collisionCount - prevCollisionCountRef.current;
    if (newCrashes > 0) {
      prevCollisionCountRef.current = collisionCount;
      setMultiplier(1);
      secondsWithoutCrashRef.current = 0;
      setCrashesRemaining((prev) => {
        const next = Math.max(0, prev - newCrashes);
        if (next <= 0) setIsGameOver(true);
        return next;
      });
    }
  }, [enabled, isRacing, isGameOver, collisionCount]);

  // Save score on game over
  useEffect(() => {
    if (!isGameOver || scoreSavedRef.current) return;
    scoreSavedRef.current = true;
    const entry: HighScoreEntry = {
      distance: Math.round(distance),
      date: new Date().toISOString(),
    };
    setHighScores((prev) => {
      const updated = [...prev, entry]
        .sort((a, b) => b.distance - a.distance)
        .slice(0, MAX_HIGH_SCORES);
      saveHighScores(updated);
      return updated;
    });
  }, [isGameOver, distance]);

  // Main game loop via requestAnimationFrame
  useEffect(() => {
    if (!enabled || !isRacing || isGameOver) {
      lastTickRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (lastTickRef.current !== null) {
        const deltaSec = Math.min((now - lastTickRef.current) / 1000, 0.1);

        // Integrate distance: speed (km/h) -> m/s * dt
        const meters = (speed / 3.6) * deltaSec;
        setDistance((prev) => prev + meters);
        setScore((prev) => prev + meters * multiplier);

        // Multiplier growth: +0.1x every 10s without crash, max 5x
        secondsWithoutCrashRef.current += deltaSec;
        if (secondsWithoutCrashRef.current >= MULTIPLIER_INTERVAL_S) {
          secondsWithoutCrashRef.current -= MULTIPLIER_INTERVAL_S;
          setMultiplier((prev) => Math.min(MAX_MULTIPLIER, prev + MULTIPLIER_INCREMENT));
        }
      }
      lastTickRef.current = now;
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [enabled, isRacing, isGameOver, speed, multiplier]);

  return useMemo(() => ({
    distance, score, multiplier, phase, phaseMessage,
    crashesRemaining, isGameOver, suggestedWeather, suggestedDifficulty,
    personalBest, isNewRecord, highScores,
  }), [
    distance, score, multiplier, phase, phaseMessage,
    crashesRemaining, isGameOver, suggestedWeather, suggestedDifficulty,
    personalBest, isNewRecord, highScores,
  ]);
}

export default useInfiniteHighway;
