/**
 * useMusicalChairs.ts - Musical chairs-style zone racing
 *
 * Music plays normally, then randomly stops. When music stops,
 * players have 5 seconds to reach a randomly placed safe zone.
 * Failing to reach it costs a life. 3 lives total.
 *
 * Wild Idea #30 from TODO.md
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const MUSIC_MIN_DURATION = 15;   // Min seconds music plays before stopping
const MUSIC_MAX_DURATION = 30;   // Max seconds music plays before stopping
const REACH_ZONE_TIMEOUT = 5;    // Seconds to reach the safe zone
const ROUND_PAUSE = 3;           // Pause between rounds (seconds)
const ZONE_RADIUS_MIN = 25;      // Safe zone min radius (world units)
const ZONE_RADIUS_MAX = 40;      // Safe zone max radius (world units)
const ZONE_SPAWN_RANGE = 150;    // Max distance from origin for zone spawn
const INITIAL_LIVES = 3;
const SAFE_BONUS = 100;          // Points for reaching the zone in time
const RESULT_DISPLAY_MS = 2000;  // How long to show SAFE!/OUT! result

export interface SafeZone {
  position: { x: number; y: number };
  radius: number;
  isActive: boolean;
}

export interface UseMusicalChairsOptions {
  enabled: boolean;
  playerPosition: { x: number; y: number } | null;
  isRacing: boolean;
}

export interface UseMusicalChairsReturn {
  isMusicPlaying: boolean;
  timeUntilStop: number | null;
  safeZone: SafeZone | null;
  isInSafeZone: boolean;
  timeToReachZone: number | null;
  lives: number;
  roundNumber: number;
  isGameOver: boolean;
  statusText: string;
  urgency: number;
}

type Phase = 'idle' | 'music' | 'scramble' | 'result_safe' | 'result_out' | 'round_pause' | 'game_over';

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function generateSafeZone(): SafeZone {
  return {
    position: {
      x: randomRange(-ZONE_SPAWN_RANGE, ZONE_SPAWN_RANGE),
      y: randomRange(-ZONE_SPAWN_RANGE, ZONE_SPAWN_RANGE),
    },
    radius: randomRange(ZONE_RADIUS_MIN, ZONE_RADIUS_MAX),
    isActive: true,
  };
}

export function useMusicalChairs(options: UseMusicalChairsOptions): UseMusicalChairsReturn {
  const { enabled, playerPosition, isRacing } = options;

  const [phase, setPhase] = useState<Phase>('idle');
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [roundNumber, setRoundNumber] = useState(0);
  const [safeZone, setSafeZone] = useState<SafeZone | null>(null);
  const [timeUntilStop, setTimeUntilStop] = useState<number | null>(null);
  const [timeToReachZone, setTimeToReachZone] = useState<number | null>(null);

  const phaseRef = useRef<Phase>('idle');
  const deadlineRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const livesRef = useRef(INITIAL_LIVES);

  phaseRef.current = phase;
  livesRef.current = lives;

  // --- Derived values ---
  const isInSafeZone = useMemo(() => {
    if (!safeZone?.isActive || !playerPosition) return false;
    return dist(playerPosition, safeZone.position) <= safeZone.radius;
  }, [safeZone, playerPosition]);

  const urgency = useMemo(() => {
    if (phase !== 'scramble' || timeToReachZone === null) return 0;
    return Math.max(0, Math.min(1, 1 - timeToReachZone / REACH_ZONE_TIMEOUT));
  }, [phase, timeToReachZone]);

  const statusText = useMemo(() => {
    switch (phase) {
      case 'idle': return '';
      case 'music': return 'Music playing...';
      case 'scramble': {
        const t = timeToReachZone !== null ? Math.ceil(timeToReachZone) : '?';
        return `GET TO THE ZONE! ${t}s`;
      }
      case 'result_safe': return `SAFE! +${SAFE_BONUS} pts`;
      case 'result_out': return 'OUT!';
      case 'round_pause': return 'Next round starting...';
      case 'game_over': return 'GAME OVER';
      default: return '';
    }
  }, [phase, timeToReachZone]);

  // --- Phase transitions ---
  const startMusicPhase = useCallback(() => {
    const duration = randomRange(MUSIC_MIN_DURATION, MUSIC_MAX_DURATION);
    deadlineRef.current = performance.now() + duration * 1000;
    setTimeUntilStop(duration);
    setTimeToReachZone(null);
    setSafeZone(null);
    setPhase('music');
  }, []);

  const startScramblePhase = useCallback(() => {
    setSafeZone(generateSafeZone());
    deadlineRef.current = performance.now() + REACH_ZONE_TIMEOUT * 1000;
    setTimeUntilStop(null);
    setTimeToReachZone(REACH_ZONE_TIMEOUT);
    setPhase('scramble');
  }, []);

  // --- Main tick (~10 Hz) ---
  const tick = useCallback(() => {
    const now = performance.now();
    const remaining = Math.max(0, (deadlineRef.current - now) / 1000);

    switch (phaseRef.current) {
      case 'music':
        setTimeUntilStop(remaining);
        if (remaining <= 0) startScramblePhase();
        break;

      case 'scramble':
        setTimeToReachZone(remaining);
        if (remaining <= 0) {
          // Deactivate zone and set optimistic result (corrected in effect)
          setSafeZone(prev => prev ? { ...prev, isActive: false } : prev);
          setPhase('result_safe');
        }
        break;

      case 'result_safe':
      case 'result_out':
        if (remaining <= 0) {
          if (livesRef.current <= 0) {
            setPhase('game_over');
          } else {
            deadlineRef.current = now + ROUND_PAUSE * 1000;
            setPhase('round_pause');
          }
        }
        break;

      case 'round_pause':
        if (remaining <= 0) {
          setRoundNumber(r => r + 1);
          startMusicPhase();
        }
        break;
    }
  }, [startMusicPhase, startScramblePhase]);

  // Resolve scramble outcome: correct result_safe to result_out if player missed
  useEffect(() => {
    if (phase !== 'result_safe' && phase !== 'result_out') return;
    if (phase === 'result_safe' && !isInSafeZone) {
      const newLives = livesRef.current - 1;
      setLives(newLives);
      livesRef.current = newLives;
      setPhase('result_out');
    }
    deadlineRef.current = performance.now() + RESULT_DISPLAY_MS;
  }, [phase, isInSafeZone]);

  // Start/stop tick interval based on enabled + isRacing
  useEffect(() => {
    if (enabled && isRacing) {
      setLives(INITIAL_LIVES);
      livesRef.current = INITIAL_LIVES;
      setRoundNumber(1);
      startMusicPhase();
      tickRef.current = setInterval(tick, 100);
    } else {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      setPhase('idle');
      setTimeUntilStop(null);
      setTimeToReachZone(null);
      setSafeZone(null);
    }
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [enabled, isRacing, tick, startMusicPhase]);

  return {
    isMusicPlaying: phase === 'music',
    timeUntilStop: phase === 'music' ? timeUntilStop : null,
    safeZone,
    isInSafeZone,
    timeToReachZone: phase === 'scramble' ? timeToReachZone : null,
    lives,
    roundNumber,
    isGameOver: phase === 'game_over',
    statusText,
    urgency,
  };
}

export default useMusicalChairs;
