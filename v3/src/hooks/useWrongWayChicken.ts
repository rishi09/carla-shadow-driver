/**
 * useWrongWayChicken.ts - Head-on collision game of chicken
 *
 * Tracks when player and AI are heading toward each other. The player
 * who swerves first loses nerve points. If they collide, both lose.
 * Pure client-side scoring overlay using position/heading data.
 *
 * Wild Idea #31 from TODO.md
 */
import { useState, useRef, useCallback, useEffect } from 'react';

// --- Constants ---
const HEAD_ON_DOT_THRESHOLD = -0.7;   // Dot product for "facing each other" (-1 = perfect)
const ACTIVATION_DISTANCE = 100;       // Max distance (m) to start a round
const MIN_CLOSING_SPEED = 30;          // Min combined approach speed (km/h)
const PLAYER_SWERVE_THRESHOLD = 0.5;   // |steering| to count as swerved
const AI_SWERVE_DEGREES = 30;          // AI heading change to count as swerved
const COLLISION_DISTANCE = 5;          // Distance (m) = collision
const MISS_DISTANCE = 15;              // Distance (m) = near miss
const NERVE_GAIN = 10;                 // Points gained per round won
const NERVE_LOSS = 5;                  // Points lost per round lost
const RESULT_DISPLAY_MS = 3000;        // How long to show dramatic text
const MAX_HISTORY = 5;                 // Max rounds kept in history

// --- Types ---
export interface ChickenRound {
  startTime: number;
  closingSpeed: number;
  distance: number;
  result: 'player_swerved' | 'ai_swerved' | 'collision' | 'miss' | 'ongoing';
}

export interface NerveScore {
  player: number;
  ai: number;
}

export interface UseWrongWayChickenOptions {
  enabled: boolean;
  playerPosition: { x: number; y: number } | null;
  aiPosition: { x: number; y: number } | null;
  playerHeading: number;   // degrees
  aiHeading: number;       // degrees
  playerSpeed: number;     // km/h
  aiSpeed: number;         // km/h
  playerSteering: number;  // -1 to 1
}

export interface UseWrongWayChickenReturn {
  isChickenActive: boolean;
  closingSpeed: number;
  distance: number;
  nerveScore: NerveScore;
  currentRound: ChickenRound | null;
  roundHistory: ChickenRound[];
  lastResult: string | null;
}

// --- Helpers ---
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function headingVector(deg: number): { x: number; y: number } {
  const rad = degToRad(deg);
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

function dot2d(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x * b.x + a.y * b.y;
}

function dist2d(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleDiff(a: number, b: number): number {
  return ((b - a) % 360 + 540) % 360 - 180;
}

function resultToText(result: ChickenRound['result']): string | null {
  switch (result) {
    case 'player_swerved': return 'YOU BLINKED!';
    case 'ai_swerved':     return 'AI CHICKENED OUT!';
    case 'collision':      return 'HEAD-ON CRASH!';
    case 'miss':           return 'NERVES OF STEEL!';
    default:               return null;
  }
}

// --- Hook ---
export function useWrongWayChicken(options: UseWrongWayChickenOptions): UseWrongWayChickenReturn {
  const {
    enabled, playerPosition, aiPosition,
    playerHeading, aiHeading, playerSpeed, aiSpeed, playerSteering,
  } = options;

  const [isChickenActive, setIsChickenActive] = useState(false);
  const [closingSpeed, setClosingSpeed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [nerveScore, setNerveScore] = useState<NerveScore>({ player: 50, ai: 50 });
  const [currentRound, setCurrentRound] = useState<ChickenRound | null>(null);
  const [roundHistory, setRoundHistory] = useState<ChickenRound[]>([]);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const aiHeadingAtStartRef = useRef(0);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundActiveRef = useRef(false);

  /** End the current round with a result and update scores */
  const endRound = useCallback((result: ChickenRound['result'], round: ChickenRound) => {
    const finishedRound: ChickenRound = { ...round, result };

    setNerveScore(prev => {
      const next = { ...prev };
      switch (result) {
        case 'player_swerved':
          next.player = Math.max(0, next.player - NERVE_LOSS);
          next.ai = Math.min(100, next.ai + NERVE_GAIN);
          break;
        case 'ai_swerved':
          next.player = Math.min(100, next.player + NERVE_GAIN);
          next.ai = Math.max(0, next.ai - NERVE_LOSS);
          break;
        case 'collision':
          next.player = Math.max(0, next.player - NERVE_LOSS);
          next.ai = Math.max(0, next.ai - NERVE_LOSS);
          break;
        case 'miss':
          next.player = Math.min(100, next.player + NERVE_GAIN);
          next.ai = Math.min(100, next.ai + NERVE_GAIN);
          break;
      }
      return next;
    });

    setRoundHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), finishedRound]);

    // Show dramatic result text for RESULT_DISPLAY_MS
    setLastResult(resultToText(result));
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => {
      setLastResult(null);
      resultTimerRef.current = null;
    }, RESULT_DISPLAY_MS);

    setCurrentRound(null);
    setIsChickenActive(false);
    roundActiveRef.current = false;
  }, []);

  // Main update logic -- runs when any tracked input changes
  useEffect(() => {
    if (!enabled || !playerPosition || !aiPosition) {
      if (roundActiveRef.current) {
        setCurrentRound(null);
        setIsChickenActive(false);
        roundActiveRef.current = false;
      }
      return;
    }

    const d = dist2d(playerPosition, aiPosition);
    setDistance(d);

    const playerDir = headingVector(playerHeading);
    const aiDir = headingVector(aiHeading);
    const headingDot = dot2d(playerDir, aiDir);

    // Compute closing speed by projecting velocities onto the line between cars
    const dx = aiPosition.x - playerPosition.x;
    const dy = aiPosition.y - playerPosition.y;
    const dMag = Math.max(d, 0.001);
    const lineX = dx / dMag;
    const lineY = dy / dMag;
    const playerToward = playerDir.x * playerSpeed * lineX + playerDir.y * playerSpeed * lineY;
    const aiToward = -(aiDir.x * aiSpeed * lineX + aiDir.y * aiSpeed * lineY);
    const combined = Math.max(0, playerToward + aiToward);
    setClosingSpeed(combined);

    if (roundActiveRef.current && currentRound) {
      // Active round -- check for resolution
      const updatedRound: ChickenRound = { ...currentRound, closingSpeed: combined, distance: d };
      setCurrentRound(updatedRound);

      // Player swerved?
      if (Math.abs(playerSteering) > PLAYER_SWERVE_THRESHOLD) {
        endRound('player_swerved', updatedRound);
        return;
      }
      // AI swerved?
      if (Math.abs(angleDiff(aiHeadingAtStartRef.current, aiHeading)) > AI_SWERVE_DEGREES) {
        endRound('ai_swerved', updatedRound);
        return;
      }
      // Collision?
      if (d < COLLISION_DISTANCE) {
        endRound('collision', updatedRound);
        return;
      }
      // Near miss? (passed close, now moving apart)
      if (d < MISS_DISTANCE && combined < MIN_CLOSING_SPEED * 0.3) {
        endRound('miss', updatedRound);
        return;
      }
      // Round fizzled -- cars diverged at distance
      if (headingDot > -0.3 || d > ACTIVATION_DISTANCE * 1.5) {
        setCurrentRound(null);
        setIsChickenActive(false);
        roundActiveRef.current = false;
      }
    } else {
      // Not in a round -- check activation
      const shouldActivate =
        headingDot < HEAD_ON_DOT_THRESHOLD &&
        d < ACTIVATION_DISTANCE &&
        d > MISS_DISTANCE &&
        combined > MIN_CLOSING_SPEED;

      if (shouldActivate) {
        aiHeadingAtStartRef.current = aiHeading;
        setCurrentRound({
          startTime: Date.now(),
          closingSpeed: combined,
          distance: d,
          result: 'ongoing',
        });
        setIsChickenActive(true);
        roundActiveRef.current = true;
      }
    }
  }, [
    enabled, playerPosition, aiPosition,
    playerHeading, aiHeading, playerSpeed, aiSpeed, playerSteering,
    currentRound, endRound,
  ]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
        resultTimerRef.current = null;
      }
    };
  }, []);

  return {
    isChickenActive, closingSpeed, distance,
    nerveScore, currentRound, roundHistory, lastResult,
  };
}

export default useWrongWayChicken;
