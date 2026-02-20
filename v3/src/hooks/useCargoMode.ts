/**
 * useCargoMode.ts - Fragile Cargo delivery mode
 *
 * Tracks cargo integrity (0-100%) based on driving telemetry:
 * - Collisions: -15% major (intensity > 1500), -5% minor (500-1500)
 * - Hard braking: -2% when brake > 0.9 AND speed > 80 km/h
 * - Sharp turns: -1%/s when |steer| > 0.7 AND speed > 60 km/h
 * - Big bumps: -3% when speed fluctuates > 15 km/h in 0.5s
 *
 * Damage is smoothed over 200ms for visual polish.
 */
import { useState, useRef, useCallback } from 'react';
import type { RaceState } from '../types/index.ts';

export type CargoDamageType = 'collision' | 'hard_brake' | 'sharp_turn' | 'bump' | null;

export interface UseCargoModeReturn {
  /** Current cargo integrity (0-100) */
  integrity: number;
  /** Whether cargo mode is enabled */
  isCargoMode: boolean;
  /** Toggle cargo mode on/off */
  setCargoMode: (on: boolean) => void;
  /** The type of last damage event (for UI feedback) */
  lastDamageType: CargoDamageType;
  /** Whether the cargo is currently taking damage (for shake animation) */
  isDamaged: boolean;
  /** Update cargo integrity from telemetry (call each frame) */
  update: (raceState: RaceState | null) => void;
  /** Reset cargo integrity to 100% (for new race) */
  reset: () => void;
  /** Compute combined score: lower is better */
  computeScore: (raceTimeSeconds: number) => number;
}

// Damage thresholds
const COLLISION_MAJOR_THRESHOLD = 1500;
const COLLISION_MINOR_THRESHOLD = 500;
const COLLISION_MAJOR_DAMAGE = 15;
const COLLISION_MINOR_DAMAGE = 5;
const HARD_BRAKE_DAMAGE = 2;
const HARD_BRAKE_THRESHOLD = 0.9;
const HARD_BRAKE_SPEED_THRESHOLD = 80;
const SHARP_TURN_DAMAGE_PER_SECOND = 1;
const SHARP_TURN_STEER_THRESHOLD = 0.7;
const SHARP_TURN_SPEED_THRESHOLD = 60;
const BUMP_DAMAGE = 3;
const BUMP_SPEED_DELTA_THRESHOLD = 15;
const BUMP_TIME_WINDOW = 0.5; // seconds

// Smoothing
const DAMAGE_DECAY_MS = 200;

// Cooldowns (prevent double-counting)
const HARD_BRAKE_COOLDOWN_MS = 1000;
const BUMP_COOLDOWN_MS = 1000;

export function useCargoMode(): UseCargoModeReturn {
  const [isCargoMode, setCargoMode] = useState(false);
  const [integrity, setIntegrity] = useState(100);
  const [lastDamageType, setLastDamageType] = useState<CargoDamageType>(null);
  const [isDamaged, setIsDamaged] = useState(false);

  // Internal refs for smooth damage application
  const rawIntegrityRef = useRef(100);
  const displayIntegrityRef = useRef(100);
  const lastUpdateTimeRef = useRef(0);

  // Cooldown refs
  const lastHardBrakeTimeRef = useRef(0);
  const lastBumpTimeRef = useRef(0);

  // Speed history for bump detection (ring buffer of {time, speed} samples)
  const speedHistoryRef = useRef<Array<{ time: number; speed: number }>>([]);

  // Track last collision array reference to avoid double-processing
  const lastCollisionsRef = useRef<Array<{ intensity: number }> | undefined>(undefined);

  // Damage clear timeout
  const damageClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyDamage = useCallback((amount: number, type: CargoDamageType) => {
    rawIntegrityRef.current = Math.max(0, rawIntegrityRef.current - amount);
    setLastDamageType(type);
    setIsDamaged(true);

    // Clear damaged state after animation
    if (damageClearRef.current) clearTimeout(damageClearRef.current);
    damageClearRef.current = setTimeout(() => {
      setIsDamaged(false);
      setLastDamageType(null);
    }, 500);
  }, []);

  const update = useCallback((raceState: RaceState | null) => {
    if (!isCargoMode || !raceState) return;

    const now = performance.now();
    const dt = lastUpdateTimeRef.current > 0 ? (now - lastUpdateTimeRef.current) / 1000 : 0;
    lastUpdateTimeRef.current = now;

    const player = raceState.player;
    if (!player) return;

    const speed = player.speed_kmh ?? 0;
    const brake = player.brake ?? 0;
    const steer = player.steer ?? 0;

    // Skip processing if race hasn't started
    if (raceState.race_status !== 'racing' && raceState.race_status !== 'finishing') return;

    // --- Collision damage ---
    const collisions = raceState.collisions;
    if (collisions && collisions.length > 0 && collisions !== lastCollisionsRef.current) {
      lastCollisionsRef.current = collisions;
      for (const collision of collisions) {
        if (collision.intensity > COLLISION_MAJOR_THRESHOLD) {
          applyDamage(COLLISION_MAJOR_DAMAGE, 'collision');
        } else if (collision.intensity > COLLISION_MINOR_THRESHOLD) {
          applyDamage(COLLISION_MINOR_DAMAGE, 'collision');
        }
      }
    }

    // --- Hard braking damage ---
    if (brake > HARD_BRAKE_THRESHOLD && speed > HARD_BRAKE_SPEED_THRESHOLD) {
      if (now - lastHardBrakeTimeRef.current > HARD_BRAKE_COOLDOWN_MS) {
        lastHardBrakeTimeRef.current = now;
        applyDamage(HARD_BRAKE_DAMAGE, 'hard_brake');
      }
    }

    // --- Sharp turn damage (continuous, per second) ---
    if (Math.abs(steer) > SHARP_TURN_STEER_THRESHOLD && speed > SHARP_TURN_SPEED_THRESHOLD && dt > 0) {
      const turnDamage = SHARP_TURN_DAMAGE_PER_SECOND * dt;
      applyDamage(turnDamage, 'sharp_turn');
    }

    // --- Bump detection (speed fluctuation > 15 km/h in 0.5s) ---
    const history = speedHistoryRef.current;
    history.push({ time: now, speed });
    // Remove entries older than the bump time window
    while (history.length > 0 && now - history[0].time > BUMP_TIME_WINDOW * 1000) {
      history.shift();
    }
    if (history.length >= 2) {
      const maxSpeed = Math.max(...history.map(h => h.speed));
      const minSpeed = Math.min(...history.map(h => h.speed));
      if (maxSpeed - minSpeed > BUMP_SPEED_DELTA_THRESHOLD) {
        if (now - lastBumpTimeRef.current > BUMP_COOLDOWN_MS) {
          lastBumpTimeRef.current = now;
          applyDamage(BUMP_DAMAGE, 'bump');
        }
      }
    }

    // --- Smooth display integrity toward raw integrity ---
    const target = rawIntegrityRef.current;
    const current = displayIntegrityRef.current;
    if (Math.abs(current - target) > 0.01) {
      // Exponential decay toward target over DAMAGE_DECAY_MS
      const alpha = dt > 0 ? Math.min(1, dt / (DAMAGE_DECAY_MS / 1000)) : 1;
      displayIntegrityRef.current = current + (target - current) * alpha;
    } else {
      displayIntegrityRef.current = target;
    }

    setIntegrity(Math.round(displayIntegrityRef.current * 10) / 10);
  }, [isCargoMode, applyDamage]);

  const reset = useCallback(() => {
    rawIntegrityRef.current = 100;
    displayIntegrityRef.current = 100;
    setIntegrity(100);
    setLastDamageType(null);
    setIsDamaged(false);
    lastUpdateTimeRef.current = 0;
    lastHardBrakeTimeRef.current = 0;
    lastBumpTimeRef.current = 0;
    speedHistoryRef.current = [];
    lastCollisionsRef.current = undefined;
  }, []);

  const computeScore = useCallback((raceTimeSeconds: number): number => {
    // Combined score: race_time_seconds * 100 + (100 - integrity) * 10
    // Lower score is better (fast time + high integrity = low score)
    const currentIntegrity = rawIntegrityRef.current;
    return Math.round(raceTimeSeconds * 100 + (100 - currentIntegrity) * 10);
  }, []);

  return {
    integrity,
    isCargoMode,
    setCargoMode,
    lastDamageType,
    isDamaged,
    update,
    reset,
    computeScore,
  };
}

export default useCargoMode;
