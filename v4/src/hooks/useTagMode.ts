/**
 * useTagMode.ts - Tag/chase game mode
 *
 * One car is "It" (on fire). Being "It" drains health. Tag the other
 * car by getting close to transfer "It" status. Client-side tracking
 * using position data.
 *
 * Wild Idea #25 from TODO.md
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// --- Constants ---

/** Health drain rate while "It" (HP per second) */
const DRAIN_RATE = 5;

/** Distance threshold for a tag transfer (meters) */
const TAG_DISTANCE = 8;

/** Immunity window after a tag (milliseconds) */
const IMMUNITY_DURATION_MS = 3000;

/** Starting health for both players */
const MAX_HEALTH = 100;

/** Tick rate for the game loop (milliseconds) */
const TICK_INTERVAL_MS = 100;

// --- Types ---

export interface UseTagModeOptions {
  /** Whether tag mode is active */
  enabled: boolean;
  /** Player car world position (from RaceState.player.x/y) */
  playerPosition: { x: number; y: number } | null;
  /** AI car world position (from RaceState.ai.x/y) */
  aiPosition: { x: number; y: number } | null;
  /** Whether the race is currently in progress */
  isRacing: boolean;
}

export interface UseTagModeReturn {
  /** True if the player is currently "It" */
  isPlayerIt: boolean;
  /** Player health (0-100, drains when player is "It") */
  playerHealth: number;
  /** AI health (0-100, drains when AI is "It") */
  aiHealth: number;
  /** Total number of tag transfers this race */
  tagCount: number;
  /** Timestamp of the most recent tag (performance.now), or null */
  lastTagTime: number | null;
  /** HUD status text */
  statusText: string;
  /** True when someone's health has reached 0 */
  gameOver: boolean;
  /** The winner once game is over, null while in progress */
  winner: 'player' | 'ai' | null;
}

// --- Helpers ---

/** Euclidean distance between two 2D points */
function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Random boolean (50/50) */
function coinFlip(): boolean {
  return Math.random() < 0.5;
}

// --- Hook ---

export function useTagMode(options: UseTagModeOptions): UseTagModeReturn {
  const { enabled, playerPosition, aiPosition, isRacing } = options;

  // --- State ---
  const [isPlayerIt, setIsPlayerIt] = useState(false);
  const [playerHealth, setPlayerHealth] = useState(MAX_HEALTH);
  const [aiHealth, setAiHealth] = useState(MAX_HEALTH);
  const [tagCount, setTagCount] = useState(0);
  const [lastTagTime, setLastTagTime] = useState<number | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<'player' | 'ai' | null>(null);

  // Refs for values that the tick loop reads without re-rendering
  const isPlayerItRef = useRef(false);
  const playerHealthRef = useRef(MAX_HEALTH);
  const aiHealthRef = useRef(MAX_HEALTH);
  const lastTagTimeRef = useRef<number | null>(null);
  const gameOverRef = useRef(false);
  const playerPosRef = useRef<{ x: number; y: number } | null>(null);
  const aiPosRef = useRef<{ x: number; y: number } | null>(null);

  // Keep position refs in sync with props
  useEffect(() => {
    playerPosRef.current = playerPosition;
  }, [playerPosition]);

  useEffect(() => {
    aiPosRef.current = aiPosition;
  }, [aiPosition]);

  // --- Reset when a new race starts or mode is toggled ---
  const resetState = useCallback(() => {
    const startAsIt = coinFlip();
    setIsPlayerIt(startAsIt);
    isPlayerItRef.current = startAsIt;

    setPlayerHealth(MAX_HEALTH);
    playerHealthRef.current = MAX_HEALTH;

    setAiHealth(MAX_HEALTH);
    aiHealthRef.current = MAX_HEALTH;

    setTagCount(0);
    setLastTagTime(null);
    lastTagTimeRef.current = null;

    setGameOver(false);
    gameOverRef.current = false;

    setWinner(null);
  }, []);

  // Reset when the race starts or enabled toggles
  useEffect(() => {
    if (enabled && isRacing) {
      resetState();
    }
  }, [enabled, isRacing, resetState]);

  // --- Game tick loop ---
  useEffect(() => {
    if (!enabled || !isRacing) return;

    const interval = setInterval(() => {
      if (gameOverRef.current) return;

      const now = performance.now();
      const dtSeconds = TICK_INTERVAL_MS / 1000;

      // --- Health drain ---
      if (isPlayerItRef.current) {
        const newHealth = Math.max(0, playerHealthRef.current - DRAIN_RATE * dtSeconds);
        playerHealthRef.current = newHealth;
        setPlayerHealth(newHealth);

        if (newHealth <= 0) {
          gameOverRef.current = true;
          setGameOver(true);
          setWinner('ai');
          return;
        }
      } else {
        const newHealth = Math.max(0, aiHealthRef.current - DRAIN_RATE * dtSeconds);
        aiHealthRef.current = newHealth;
        setAiHealth(newHealth);

        if (newHealth <= 0) {
          gameOverRef.current = true;
          setGameOver(true);
          setWinner('player');
          return;
        }
      }

      // --- Tag detection ---
      const pPos = playerPosRef.current;
      const aPos = aiPosRef.current;
      if (!pPos || !aPos) return;

      // Check immunity window
      const immuneUntil = lastTagTimeRef.current
        ? lastTagTimeRef.current + IMMUNITY_DURATION_MS
        : 0;
      if (now < immuneUntil) return;

      // Check distance
      const dist = distance(pPos, aPos);
      if (dist < TAG_DISTANCE) {
        // Transfer "It" status
        const newIsPlayerIt = !isPlayerItRef.current;
        isPlayerItRef.current = newIsPlayerIt;
        setIsPlayerIt(newIsPlayerIt);

        lastTagTimeRef.current = now;
        setLastTagTime(now);

        setTagCount(prev => prev + 1);
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, isRacing]);

  // --- Derive status text ---
  let statusText: string;
  if (!enabled) {
    statusText = '';
  } else if (gameOver) {
    statusText = winner === 'player' ? 'YOU WIN!' : 'AI WINS!';
  } else if (isPlayerIt) {
    statusText = "YOU'RE IT!";
  } else {
    statusText = 'Chase the AI!';
  }

  return {
    isPlayerIt,
    playerHealth,
    aiHealth,
    tagCount,
    lastTagTime,
    statusText,
    gameOver,
    winner,
  };
}

export default useTagMode;
