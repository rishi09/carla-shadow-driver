/**
 * useCopsAndRobbers.ts - Evasion-based chase game mode
 *
 * Player is the robber, AI is the cop. Robber must reach checkpoints
 * while staying away from the cop. Cop "arrests" by getting within
 * 5 meters for 3 consecutive seconds. Client-side scoring.
 *
 * Chase detection: AI within 30m triggers "being chased" state.
 * Arrest mechanic: cop within 5m starts arrest progress (fills over 3s).
 * If player gets >15m away during arrest, progress resets (escape!).
 * Wanted level: starts at 1, +1 for each 2 escapes (max 5).
 * Higher wanted level = arrest fills faster (3s -> 2s -> 1.5s).
 * Siren intensity: 1.0 when chasing, fades to 0 when >50m.
 *
 * Wild Idea #26 from TODO.md
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// Distance thresholds (meters)
const CHASE_RADIUS = 30;
const ARREST_RADIUS = 5;
const ESCAPE_RADIUS = 15;
const SIREN_FADE_RADIUS = 50;

// Arrest timing per wanted level (seconds to fill 0-100%)
const ARREST_DURATION_BY_LEVEL: Record<number, number> = {
  1: 3.0, 2: 2.5, 3: 2.0, 4: 1.75, 5: 1.5,
};

const ESCAPES_PER_LEVEL = 2;
const MAX_WANTED_LEVEL = 5;
const TICK_INTERVAL_MS = 100; // 10 Hz update loop

interface Position { x: number; y: number }

export interface UseCopsAndRobbersOptions {
  enabled: boolean;
  playerPosition: Position | null;
  aiPosition: Position | null;
  isRacing: boolean;
  role?: 'robber' | 'cop';
}

export interface UseCopsAndRobbersReturn {
  role: 'robber' | 'cop';
  isBeingChased: boolean;
  chaseDuration: number;
  arrestProgress: number;
  isArrested: boolean;
  escapesCount: number;
  checkpointsReached: number;
  wantedLevel: number;
  statusText: string;
  sirenIntensity: number;
  reset: () => void;
}

function distance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function useCopsAndRobbers(options: UseCopsAndRobbersOptions): UseCopsAndRobbersReturn {
  const { enabled, playerPosition, aiPosition, isRacing, role: roleOption = 'robber' } = options;

  // Core state
  const [role] = useState<'robber' | 'cop'>(roleOption);
  const [isBeingChased, setIsBeingChased] = useState(false);
  const [chaseDuration, setChaseDuration] = useState(0);
  const [arrestProgress, setArrestProgress] = useState(0);
  const [isArrested, setIsArrested] = useState(false);
  const [escapesCount, setEscapesCount] = useState(0);
  const [checkpointsReached] = useState(0);
  const [wantedLevel, setWantedLevel] = useState(1);
  const [statusText, setStatusText] = useState('SAFE');
  const [sirenIntensity, setSirenIntensity] = useState(0);

  // Refs for tick-loop mutable state (avoids stale closures)
  const chaseStartRef = useRef<number | null>(null);
  const arrestProgressRef = useRef(0);
  const escapesRef = useRef(0);
  const isArrestedRef = useRef(false);
  const wasInArrestZoneRef = useRef(false);

  // Latest positions in refs so the interval always reads fresh values
  const playerPosRef = useRef<Position | null>(null);
  const aiPosRef = useRef<Position | null>(null);
  const isRacingRef = useRef(false);
  const enabledRef = useRef(false);

  useEffect(() => { playerPosRef.current = playerPosition; }, [playerPosition]);
  useEffect(() => { aiPosRef.current = aiPosition; }, [aiPosition]);
  useEffect(() => { isRacingRef.current = isRacing; }, [isRacing]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const reset = useCallback(() => {
    chaseStartRef.current = null;
    arrestProgressRef.current = 0;
    escapesRef.current = 0;
    isArrestedRef.current = false;
    wasInArrestZoneRef.current = false;
    setIsBeingChased(false);
    setChaseDuration(0);
    setArrestProgress(0);
    setIsArrested(false);
    setEscapesCount(0);
    setWantedLevel(1);
    setStatusText('SAFE');
    setSirenIntensity(0);
  }, []);

  // Reset when racing ends
  const prevRacingRef = useRef(false);
  useEffect(() => {
    if (prevRacingRef.current && !isRacing) reset();
    prevRacingRef.current = isRacing;
  }, [isRacing, reset]);

  // Main tick loop
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      if (!enabledRef.current || !isRacingRef.current || isArrestedRef.current) return;

      const pPos = playerPosRef.current;
      const aPos = aiPosRef.current;
      if (!pPos || !aPos) return;

      const dist = distance(pPos, aPos);
      const now = performance.now();
      const tickSec = TICK_INTERVAL_MS / 1000;

      // Chase detection
      const chasing = dist <= CHASE_RADIUS;
      if (chasing && !chaseStartRef.current) {
        chaseStartRef.current = now;
      } else if (!chasing) {
        chaseStartRef.current = null;
      }

      const currentChaseDuration = chaseStartRef.current
        ? (now - chaseStartRef.current) / 1000 : 0;
      setIsBeingChased(chasing);
      setChaseDuration(currentChaseDuration);

      // Arrest mechanic
      const inArrestZone = dist <= ARREST_RADIUS;
      const currentWantedLevel = Math.min(
        MAX_WANTED_LEVEL,
        1 + Math.floor(escapesRef.current / ESCAPES_PER_LEVEL)
      );
      const arrestDuration = ARREST_DURATION_BY_LEVEL[currentWantedLevel] ?? 3.0;

      if (inArrestZone) {
        const progressPerTick = (tickSec / arrestDuration) * 100;
        arrestProgressRef.current = clamp(arrestProgressRef.current + progressPerTick, 0, 100);
        wasInArrestZoneRef.current = true;
      } else if (wasInArrestZoneRef.current && dist > ESCAPE_RADIUS) {
        // Player escaped -- reset progress and count the escape
        if (arrestProgressRef.current > 0) {
          escapesRef.current += 1;
          setEscapesCount(escapesRef.current);
          setWantedLevel(Math.min(
            MAX_WANTED_LEVEL,
            1 + Math.floor(escapesRef.current / ESCAPES_PER_LEVEL)
          ));
        }
        arrestProgressRef.current = 0;
        wasInArrestZoneRef.current = false;
      }
      // Between ARREST_RADIUS and ESCAPE_RADIUS: progress holds (no fill, no reset)

      // Check for completed arrest
      if (arrestProgressRef.current >= 100 && !isArrestedRef.current) {
        isArrestedRef.current = true;
        setIsArrested(true);
        setArrestProgress(100);
        setStatusText('BUSTED!');
        setSirenIntensity(1);
        return;
      }

      setArrestProgress(arrestProgressRef.current);
      setWantedLevel(currentWantedLevel);

      // Status text
      if (arrestProgressRef.current > 0) {
        setStatusText('CLOSING IN...');
      } else if (chasing) {
        setStatusText('EVADE!');
      } else {
        setStatusText('SAFE');
      }

      // Siren intensity: 1.0 at chase radius, fades linearly to 0 at siren fade radius
      let intensity: number;
      if (dist <= CHASE_RADIUS) {
        intensity = 1.0;
      } else if (dist >= SIREN_FADE_RADIUS) {
        intensity = 0;
      } else {
        intensity = 1 - (dist - CHASE_RADIUS) / (SIREN_FADE_RADIUS - CHASE_RADIUS);
      }
      setSirenIntensity(clamp(intensity, 0, 1));
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled]);

  return {
    role,
    isBeingChased,
    chaseDuration,
    arrestProgress,
    isArrested,
    escapesCount,
    checkpointsReached,
    wantedLevel,
    statusText,
    sirenIntensity,
    reset,
  };
}

export default useCopsAndRobbers;
