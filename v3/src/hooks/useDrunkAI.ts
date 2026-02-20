/**
 * useDrunkAI.ts - "Drunk AI Mode" game mode hook
 *
 * Manages the progressive deterioration of AI driving ability across laps.
 * The AI starts sober and gets progressively "drunker" each lap, with
 * increasing steering noise, reaction delay, and mistake probability.
 *
 * Wild Idea #19 from TODO.md
 */
import { useMemo } from 'react';

/** Drunk level thresholds and their labels */
const DRUNK_LEVELS = [
  { threshold: 0.0,  label: 'Sober',    emoji: '\u{1F9CA}', commentary: 'The AI is focused and sharp.' },
  { threshold: 0.15, label: 'Tipsy',    emoji: '\u{1F37A}', commentary: 'The AI just had a drink. It should be fine... right?' },
  { threshold: 0.3,  label: 'Buzzed',   emoji: '\u{1F37B}', commentary: 'The AI is starting to see two racing lines.' },
  { threshold: 0.5,  label: 'Drunk',    emoji: '\u{1F943}', commentary: 'The AI tried to overtake a lamp post.' },
  { threshold: 0.7,  label: 'Hammered', emoji: '\u{1F974}', commentary: 'The AI thinks the brake pedal is the other one.' },
  { threshold: 0.9,  label: 'Wasted',   emoji: '\u{1F635}', commentary: 'The AI is driving by memory. Bad memory.' },
] as const;

export interface UseDrunkAIReturn {
  /** Drunkenness level from 0.0 (sober) to 1.0 (wasted) */
  drunkLevel: number;
  /** Human-readable label: "Sober", "Tipsy", "Buzzed", "Drunk", "Hammered", "Wasted" */
  drunkLabel: string;
  /** Emoji representing current drunk state */
  drunkEmoji: string;
  /** Noise magnitude to add to AI steering (0.0 - 0.4) */
  steeringNoise: number;
  /** Simulated reaction delay in milliseconds (0 - 300) */
  reactionDelay: number;
  /** Probability of AI making a mistake per second (0.0 - 0.3) */
  mistakeChance: number;
  /** Funny commentary line for the current drunk level */
  commentary: string;
  /** Whether drunk AI mode is active */
  enabled: boolean;
}

interface UseDrunkAIArgs {
  /** Whether drunk AI mode is enabled */
  enabled: boolean;
  /** Current lap number (1-indexed) */
  currentLap: number;
  /** Total number of laps in the race */
  totalLaps: number;
}

/**
 * Computes the drunkenness level and its effects based on lap progress.
 *
 * Lap progression:
 *   Lap 1: 0.0 (sober)
 *   Lap 2: 0.2 (tipsy) -- for a 5-lap race
 *   Lap 3: 0.5 (drunk)
 *   Lap 4+: 0.7-1.0 (wasted)
 *
 * Formula: min(1.0, (currentLap - 1) / max(1, totalLaps - 1))
 */
export function useDrunkAI({ enabled, currentLap, totalLaps }: UseDrunkAIArgs): UseDrunkAIReturn {
  return useMemo(() => {
    if (!enabled) {
      return {
        drunkLevel: 0,
        drunkLabel: 'Sober',
        drunkEmoji: DRUNK_LEVELS[0].emoji,
        steeringNoise: 0,
        reactionDelay: 0,
        mistakeChance: 0,
        commentary: DRUNK_LEVELS[0].commentary,
        enabled: false,
      };
    }

    // Compute drunkenness from lap progress
    const drunkLevel = Math.min(1.0, (currentLap - 1) / Math.max(1, totalLaps - 1));

    // Find the appropriate level label/emoji/commentary
    let levelIndex = 0;
    for (let i = DRUNK_LEVELS.length - 1; i >= 0; i--) {
      if (drunkLevel >= DRUNK_LEVELS[i].threshold) {
        levelIndex = i;
        break;
      }
    }

    const level = DRUNK_LEVELS[levelIndex];

    // Derive gameplay modifiers from drunk level
    // Steering noise: 0.0 at sober -> 0.4 at wasted
    const steeringNoise = drunkLevel * 0.4;

    // Reaction delay: 0ms at sober -> 300ms at wasted
    const reactionDelay = Math.round(drunkLevel * 300);

    // Mistake chance: 0.0 at sober -> 0.3 at wasted (probability per second)
    const mistakeChance = drunkLevel * 0.3;

    return {
      drunkLevel,
      drunkLabel: level.label,
      drunkEmoji: level.emoji,
      steeringNoise,
      reactionDelay,
      mistakeChance,
      commentary: level.commentary,
      enabled: true,
    };
  }, [enabled, currentLap, totalLaps]);
}

export default useDrunkAI;
