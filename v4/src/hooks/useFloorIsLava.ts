/**
 * useFloorIsLava.ts - Random lava zones on the track
 *
 * Creates randomly shifting danger zones on the track. When the player
 * is in a danger zone, they take "damage" (timer penalty). Zones shift
 * every 15 seconds. Pure client-side overlay using player position data.
 *
 * Wild Idea #27 from TODO.md
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// --- Constants ---
const MIN_ZONES = 3;
const MAX_ZONES = 5;
const MIN_RADIUS = 20;       // world units
const MAX_RADIUS = 50;
const SHIFT_INTERVAL_S = 15; // seconds between partial reshuffles
const SHIFT_REMOVE_MIN = 1;
const SHIFT_REMOVE_MAX = 2;
const DEFAULT_EXTENT = 200;  // track bounds: random positions in [-200, 200]
const DAMAGE_PER_SECOND = 0.5;
const PULSE_SPEED = 2;       // sin(time * PULSE_SPEED) for glow animation
const TICK_MS = 50;           // game loop tick rate

// --- Interfaces ---

export interface LavaZone {
  id: string;
  centerX: number;
  centerY: number;
  radius: number;
  intensity: number;
  createdAt: number;
}

export interface UseFloorIsLavaOptions {
  enabled: boolean;
  playerPosition: { x: number; y: number } | null;
  isRacing: boolean;
}

export type DangerLevel = 'safe' | 'warning' | 'danger' | 'critical';

export interface UseFloorIsLavaReturn {
  zones: LavaZone[];
  isInDangerZone: boolean;
  damage: number;
  dangerLevel: DangerLevel;
  nextShiftIn: number;
}

// --- Helpers ---

let zoneIdCounter = 0;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function createRandomZone(): LavaZone {
  zoneIdCounter += 1;
  return {
    id: `lava-${zoneIdCounter}-${Date.now().toString(36)}`,
    centerX: randRange(-DEFAULT_EXTENT, DEFAULT_EXTENT),
    centerY: randRange(-DEFAULT_EXTENT, DEFAULT_EXTENT),
    radius: randRange(MIN_RADIUS, MAX_RADIUS),
    intensity: 0,
    createdAt: performance.now(),
  };
}

function generateInitialZones(): LavaZone[] {
  const count = randInt(MIN_ZONES, MAX_ZONES);
  return Array.from({ length: count }, () => createRandomZone());
}

function distanceTo(px: number, py: number, zone: LavaZone): number {
  const dx = px - zone.centerX;
  const dy = py - zone.centerY;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Compute danger level from closest zone distance / radius ratio */
function computeDangerLevel(
  px: number,
  py: number,
  zones: LavaZone[],
): { level: DangerLevel; inZone: boolean } {
  if (zones.length === 0) return { level: 'safe', inZone: false };

  let closestRatio = Infinity;
  for (const zone of zones) {
    const ratio = distanceTo(px, py, zone) / zone.radius;
    if (ratio < closestRatio) closestRatio = ratio;
  }

  if (closestRatio < 0.5) return { level: 'critical', inZone: true };
  if (closestRatio < 1.0) return { level: 'danger', inZone: true };
  if (closestRatio < 2.0) return { level: 'warning', inZone: false };
  return { level: 'safe', inZone: false };
}

// --- Hook ---

export function useFloorIsLava(options: UseFloorIsLavaOptions): UseFloorIsLavaReturn {
  const { enabled, playerPosition, isRacing } = options;

  const [zones, setZones] = useState<LavaZone[]>([]);
  const [damage, setDamage] = useState(0);
  const [isInDangerZone, setIsInDangerZone] = useState(false);
  const [dangerLevel, setDangerLevel] = useState<DangerLevel>('safe');
  const [nextShiftIn, setNextShiftIn] = useState(SHIFT_INTERVAL_S);

  const zonesRef = useRef<LavaZone[]>([]);
  const damageRef = useRef(0);
  const lastShiftRef = useRef(0);
  const lastTickRef = useRef(0);
  const playerPosRef = useRef(playerPosition);

  // Keep player position ref in sync (avoids stale closure in setInterval)
  useEffect(() => { playerPosRef.current = playerPosition; }, [playerPosition]);

  // Partial reshuffle: remove 1-2 oldest zones, add 1-2 new ones
  const reshuffleZones = useCallback((current: LavaZone[]): LavaZone[] => {
    const removeCount = Math.min(randInt(SHIFT_REMOVE_MIN, SHIFT_REMOVE_MAX), current.length);
    const sorted = [...current].sort((a, b) => a.createdAt - b.createdAt);
    const remaining = sorted.slice(removeCount);
    const targetCount = randInt(MIN_ZONES, MAX_ZONES);
    const addCount = Math.max(0, targetCount - remaining.length);
    const result = [...remaining];
    for (let i = 0; i < addCount; i++) result.push(createRandomZone());
    return result;
  }, []);

  // Initialize zones when the feature is enabled and a race starts
  useEffect(() => {
    if (!enabled || !isRacing) {
      setZones([]); setDamage(0); setIsInDangerZone(false);
      setDangerLevel('safe'); setNextShiftIn(SHIFT_INTERVAL_S);
      zonesRef.current = []; damageRef.current = 0;
      lastShiftRef.current = 0; lastTickRef.current = 0;
      return;
    }

    const initial = generateInitialZones();
    const now = performance.now();
    zonesRef.current = initial;
    damageRef.current = 0;
    lastShiftRef.current = now;
    lastTickRef.current = now;
    setZones(initial);
    setDamage(0);
    setNextShiftIn(SHIFT_INTERVAL_S);
  }, [enabled, isRacing]);

  // Main game loop: pulse animation, zone shifting, damage accumulation
  useEffect(() => {
    if (!enabled || !isRacing) return;

    const interval = setInterval(() => {
      const now = performance.now();
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // Zone reshuffle timer
      const timeSinceShift = (now - lastShiftRef.current) / 1000;
      setNextShiftIn(Math.max(0, Math.round(SHIFT_INTERVAL_S - timeSinceShift)));

      let currentZones = zonesRef.current;
      if (timeSinceShift >= SHIFT_INTERVAL_S) {
        currentZones = reshuffleZones(currentZones);
        zonesRef.current = currentZones;
        lastShiftRef.current = now;
      }

      // Update zone intensity (pulsing glow via sin wave)
      const timeSeconds = now / 1000;
      const updatedZones = currentZones.map(zone => ({
        ...zone,
        intensity: (Math.sin(timeSeconds * PULSE_SPEED) + 1) / 2,
      }));
      zonesRef.current = updatedZones;
      setZones(updatedZones);

      // Player danger detection + damage accumulation
      const pos = playerPosRef.current;
      if (pos) {
        const result = computeDangerLevel(pos.x, pos.y, updatedZones);
        setDangerLevel(result.level);
        setIsInDangerZone(result.inZone);
        if (result.inZone) {
          damageRef.current += DAMAGE_PER_SECOND * dt;
          setDamage(damageRef.current);
        }
      } else {
        setDangerLevel('safe');
        setIsInDangerZone(false);
      }
    }, TICK_MS);

    return () => { clearInterval(interval); };
  }, [enabled, isRacing, reshuffleZones]);

  return useMemo(() => ({
    zones, isInDangerZone, damage, dangerLevel, nextShiftIn,
  }), [zones, isInDangerZone, damage, dangerLevel, nextShiftIn]);
}

export default useFloorIsLava;
