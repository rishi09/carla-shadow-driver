/**
 * useShrinkingTrack.ts - Battle royale shrinking boundary
 *
 * The "safe zone" radius shrinks over time. Being outside the
 * safe zone accumulates damage. Creates increasing pressure as
 * the race progresses.
 *
 * Wild Idea #28 from TODO.md
 */
import { useState, useEffect, useRef, useMemo } from 'react';

// --- Constants ---
const INITIAL_RADIUS = 300;
const FINAL_RADIUS = 50;
const CENTER_SHIFT_RANGE = 20;       // ±20 units random shift
const CENTER_SHIFT_INTERVAL = 30000; // Shift center every 30s
const DAMAGE_PER_SECOND = 1;         // 1 penalty second per real second outside
const WARNING_EDGE_FRACTION = 0.2;   // Warn when within 20% of radius from edge
const UPDATE_INTERVAL = 100;         // Recalculate every 100ms

// Shrink schedule thresholds (milliseconds)
const PHASE_STABLE_END = 30_000;     // 0-30s: stable
const PHASE_SLOW_END = 120_000;      // 30s-2min: slow shrink to 200
const PHASE_MEDIUM_END = 180_000;    // 2min-3min: medium shrink to 100

// Shrink schedule radius targets
const RADIUS_AFTER_SLOW = 200;
const RADIUS_AFTER_MEDIUM = 100;

type ShrinkPhase = 'stable' | 'shrinking' | 'final' | 'expanding';

interface UseShrinkingTrackOptions {
  enabled: boolean;
  playerPosition: { x: number; y: number } | null;
  raceTimeMs: number;
  isRacing: boolean;
  totalLaps: number;
}

export interface UseShrinkingTrackReturn {
  /** Current safe zone radius (starts at 300, shrinks to 50) */
  safeRadius: number;
  /** Center of the safe zone (shifts slightly over time) */
  safeCenter: { x: number; y: number };
  /** Whether the player is currently outside the safe zone */
  isOutsideZone: boolean;
  /** Distance to edge: positive = inside, negative = outside */
  distanceToEdge: number;
  /** Accumulated penalty seconds from being outside the zone */
  damageAccumulated: number;
  /** 0-100: how much the zone has shrunk from its initial size */
  shrinkPercent: number;
  /** Current shrink phase for UI display */
  phase: ShrinkPhase;
  /** Warning text shown when near or outside the edge */
  warningText: string | null;
}

/** Linearly interpolate between two values */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/** Compute the safe radius based on elapsed race time */
function computeRadius(raceTimeMs: number): number {
  if (raceTimeMs <= PHASE_STABLE_END) {
    // 0-30s: no shrink
    return INITIAL_RADIUS;
  }
  if (raceTimeMs <= PHASE_SLOW_END) {
    // 30s-2min: slow shrink 300 -> 200
    const t = (raceTimeMs - PHASE_STABLE_END) / (PHASE_SLOW_END - PHASE_STABLE_END);
    return lerp(INITIAL_RADIUS, RADIUS_AFTER_SLOW, t);
  }
  if (raceTimeMs <= PHASE_MEDIUM_END) {
    // 2min-3min: medium shrink 200 -> 100
    const t = (raceTimeMs - PHASE_SLOW_END) / (PHASE_MEDIUM_END - PHASE_SLOW_END);
    return lerp(RADIUS_AFTER_SLOW, RADIUS_AFTER_MEDIUM, t);
  }
  // 3min+: fast shrink 100 -> 50 over the next 60s, then hold at 50
  const fastDuration = 60_000;
  const t = (raceTimeMs - PHASE_MEDIUM_END) / fastDuration;
  return lerp(RADIUS_AFTER_MEDIUM, FINAL_RADIUS, t);
}

/** Determine the current shrink phase */
function computePhase(raceTimeMs: number): ShrinkPhase {
  if (raceTimeMs <= PHASE_STABLE_END) return 'stable';
  if (raceTimeMs <= PHASE_SLOW_END) return 'shrinking';
  if (raceTimeMs <= PHASE_MEDIUM_END) return 'shrinking';
  return 'final';
}

export function useShrinkingTrack(options: UseShrinkingTrackOptions): UseShrinkingTrackReturn {
  const { enabled, playerPosition, raceTimeMs, isRacing } = options;

  const [safeRadius, setSafeRadius] = useState(INITIAL_RADIUS);
  const [safeCenter, setSafeCenter] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isOutsideZone, setIsOutsideZone] = useState(false);
  const [distanceToEdge, setDistanceToEdge] = useState(INITIAL_RADIUS);
  const [damageAccumulated, setDamageAccumulated] = useState(0);
  const [phase, setPhase] = useState<ShrinkPhase>('stable');
  const [warningText, setWarningText] = useState<string | null>(null);

  // Refs for values that update frequently without triggering re-renders
  const damageRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const centerShiftTimerRef = useRef(0);

  // Deterministic seed for center shifts (based on race start)
  const seedRef = useRef(Math.random());

  // Reset state when race starts or feature toggles
  useEffect(() => {
    if (!enabled || !isRacing) {
      setSafeRadius(INITIAL_RADIUS);
      setSafeCenter({ x: 0, y: 0 });
      setIsOutsideZone(false);
      setDistanceToEdge(INITIAL_RADIUS);
      setDamageAccumulated(0);
      setPhase('stable');
      setWarningText(null);
      damageRef.current = 0;
      lastUpdateRef.current = 0;
      centerShiftTimerRef.current = 0;
      seedRef.current = Math.random();
    }
  }, [enabled, isRacing]);

  // Main update loop
  useEffect(() => {
    if (!enabled || !isRacing) return;

    const interval = setInterval(() => {
      const now = performance.now();
      const dtSeconds = lastUpdateRef.current > 0
        ? (now - lastUpdateRef.current) / 1000
        : 0;
      lastUpdateRef.current = now;

      // --- Compute radius ---
      const newRadius = computeRadius(raceTimeMs);
      setSafeRadius(newRadius);

      // --- Compute phase ---
      const newPhase = computePhase(raceTimeMs);
      setPhase(newPhase);

      // --- Shift center periodically ---
      const shiftIndex = Math.floor(raceTimeMs / CENTER_SHIFT_INTERVAL);
      if (shiftIndex !== centerShiftTimerRef.current) {
        centerShiftTimerRef.current = shiftIndex;
        // Pseudo-random but deterministic shift based on seed + index
        const angle = (seedRef.current + shiftIndex * 2.399) * Math.PI * 2;
        const magnitude = CENTER_SHIFT_RANGE * (0.5 + 0.5 * Math.sin(seedRef.current * 100 + shiftIndex));
        setSafeCenter({
          x: Math.cos(angle) * magnitude,
          y: Math.sin(angle) * magnitude,
        });
      }

      // --- Compute player distance to edge ---
      if (playerPosition) {
        const dx = playerPosition.x - (safeCenter.x || 0);
        const dy = playerPosition.y - (safeCenter.y || 0);
        const distFromCenter = Math.sqrt(dx * dx + dy * dy);
        const edge = newRadius - distFromCenter; // positive = inside
        setDistanceToEdge(edge);

        const outside = edge < 0;
        setIsOutsideZone(outside);

        // --- Accumulate damage when outside ---
        if (outside && dtSeconds > 0) {
          damageRef.current += DAMAGE_PER_SECOND * dtSeconds;
          setDamageAccumulated(Math.round(damageRef.current * 10) / 10);
        }

        // --- Warning text ---
        const warningThreshold = newRadius * WARNING_EDGE_FRACTION;
        if (outside) {
          setWarningText('GET BACK IN THE ZONE!');
        } else if (edge < warningThreshold) {
          setWarningText('ZONE SHRINKING!');
        } else {
          setWarningText(null);
        }
      } else {
        // No position data yet
        setDistanceToEdge(newRadius);
        setIsOutsideZone(false);
        setWarningText(null);
      }
    }, UPDATE_INTERVAL);

    return () => clearInterval(interval);
  }, [enabled, isRacing, raceTimeMs, playerPosition, safeCenter]);

  // --- Shrink percent ---
  const shrinkPercent = useMemo(() => {
    const shrunk = INITIAL_RADIUS - safeRadius;
    const totalRange = INITIAL_RADIUS - FINAL_RADIUS;
    return Math.round((shrunk / totalRange) * 100);
  }, [safeRadius]);

  return {
    safeRadius,
    safeCenter,
    isOutsideZone,
    distanceToEdge,
    damageAccumulated,
    shrinkPercent,
    phase,
    warningText,
  };
}

export default useShrinkingTrack;
