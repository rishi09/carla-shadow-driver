/**
 * useAIGrudge.ts - "The AI That Holds Grudges" (Wild Idea #16)
 *
 * Maintains a persistent grudge profile in localStorage that tracks
 * how the player races against the AI across sessions. Clean racing
 * earns respect; dirty racing builds grudge. The AI mood shifts
 * accordingly, from ADMIRING to FURIOUS.
 *
 * Grudge level ranges from -100 (maximum grudge) to +100 (maximum respect).
 */
import { useState, useCallback, useEffect, useRef } from 'react';

// localStorage key
const STORAGE_KEY = 'shadow-driver-ai-grudge';

// --- Grudge score deltas ---
const CLEAN_OVERTAKE_BONUS = 5;       // +5 respect per clean overtake
const DIRTY_OVERTAKE_PENALTY = -10;   // -10 grudge per dirty overtake
const PLAYER_CRASH_INTO_AI = -8;      // -8 grudge when player rear-ends AI
const PLAYER_WIN_PENALTY = -3;        // -3 grudge (AI gets salty on loss)
const AI_WIN_BONUS = 2;              // +2 respect (AI is magnanimous in victory)
const LONG_WIN_STREAK_PENALTY = -15;  // -15 grudge when player streak > 3

const GRUDGE_MIN = -100;
const GRUDGE_MAX = 100;

// --- Mood thresholds and messages ---
type AIMood = 'FURIOUS' | 'HOSTILE' | 'ANNOYED' | 'NEUTRAL' | 'RESPECTFUL' | 'FRIENDLY' | 'ADMIRING';

interface MoodInfo {
  mood: AIMood;
  message: string;
}

function getMoodFromGrudge(grudgeLevel: number): MoodInfo {
  if (grudgeLevel < -60) return { mood: 'FURIOUS', message: "I haven't forgotten what you did." };
  if (grudgeLevel < -30) return { mood: 'HOSTILE', message: "Don't expect any favors." };
  if (grudgeLevel < -10) return { mood: 'ANNOYED', message: "You're testing my patience." };
  if (grudgeLevel <= 10) return { mood: 'NEUTRAL', message: 'May the best driver win.' };
  if (grudgeLevel <= 30) return { mood: 'RESPECTFUL', message: "You've earned my respect." };
  if (grudgeLevel <= 60) return { mood: 'FRIENDLY', message: 'Good racing with you.' };
  return { mood: 'ADMIRING', message: 'I learn from watching you drive.' };
}

// --- Grudge history interface ---
export interface GrudgeHistory {
  totalRaces: number;
  playerWins: number;
  aiWins: number;
  playerCrashesIntoAI: number;
  aiCrashesIntoPlayer: number;
  cleanOvertakes: number;
  dirtyOvertakes: number;
  grudgeLevel: number;
  lastRaceOutcome: 'win' | 'loss' | null;
  streak: number; // positive = player win streak, negative = AI win streak
}

function createDefaultHistory(): GrudgeHistory {
  return {
    totalRaces: 0,
    playerWins: 0,
    aiWins: 0,
    playerCrashesIntoAI: 0,
    aiCrashesIntoPlayer: 0,
    cleanOvertakes: 0,
    dirtyOvertakes: 0,
    grudgeLevel: 0,
    lastRaceOutcome: null,
    streak: 0,
  };
}

function loadHistory(): GrudgeHistory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultHistory();
    const parsed = JSON.parse(raw);
    // Validate structure -- fall back to defaults for missing fields
    return {
      totalRaces: typeof parsed.totalRaces === 'number' ? parsed.totalRaces : 0,
      playerWins: typeof parsed.playerWins === 'number' ? parsed.playerWins : 0,
      aiWins: typeof parsed.aiWins === 'number' ? parsed.aiWins : 0,
      playerCrashesIntoAI: typeof parsed.playerCrashesIntoAI === 'number' ? parsed.playerCrashesIntoAI : 0,
      aiCrashesIntoPlayer: typeof parsed.aiCrashesIntoPlayer === 'number' ? parsed.aiCrashesIntoPlayer : 0,
      cleanOvertakes: typeof parsed.cleanOvertakes === 'number' ? parsed.cleanOvertakes : 0,
      dirtyOvertakes: typeof parsed.dirtyOvertakes === 'number' ? parsed.dirtyOvertakes : 0,
      grudgeLevel: typeof parsed.grudgeLevel === 'number' ? parsed.grudgeLevel : 0,
      lastRaceOutcome: parsed.lastRaceOutcome === 'win' || parsed.lastRaceOutcome === 'loss' ? parsed.lastRaceOutcome : null,
      streak: typeof parsed.streak === 'number' ? parsed.streak : 0,
    };
  } catch {
    return createDefaultHistory();
  }
}

function saveHistory(history: GrudgeHistory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Ignore -- private browsing or storage full
  }
}

function clampGrudge(value: number): number {
  return Math.max(GRUDGE_MIN, Math.min(GRUDGE_MAX, value));
}

/** Recompute grudge level from cumulative history stats */
function computeGrudge(history: GrudgeHistory): number {
  let grudge = 0;

  grudge += history.cleanOvertakes * CLEAN_OVERTAKE_BONUS;
  grudge += history.dirtyOvertakes * DIRTY_OVERTAKE_PENALTY;
  grudge += history.playerCrashesIntoAI * PLAYER_CRASH_INTO_AI;
  grudge += history.playerWins * PLAYER_WIN_PENALTY;
  grudge += history.aiWins * AI_WIN_BONUS;

  // Long player win streak frustration
  if (history.streak > 3) {
    grudge += LONG_WIN_STREAK_PENALTY;
  }

  return clampGrudge(grudge);
}

// --- Hook return type ---
export interface UseAIGrudgeReturn {
  grudgeLevel: number;
  mood: AIMood;
  moodMessage: string;
  grudgeHistory: GrudgeHistory;
  recordCollision: (playerWasBehind: boolean) => void;
  recordOvertake: (wasClean: boolean) => void;
  recordRaceEnd: (playerWon: boolean) => void;
  resetGrudge: () => void;
}

export function useAIGrudge(): UseAIGrudgeReturn {
  const [history, setHistory] = useState<GrudgeHistory>(loadHistory);
  const historyRef = useRef(history);

  // Keep ref in sync for use in callbacks without re-creating them
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // Persist to localStorage whenever history changes
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const recordCollision = useCallback((playerWasBehind: boolean) => {
    setHistory(prev => {
      const next = { ...prev };
      if (playerWasBehind) {
        next.playerCrashesIntoAI += 1;
      } else {
        next.aiCrashesIntoPlayer += 1;
      }
      next.grudgeLevel = computeGrudge(next);
      return next;
    });
  }, []);

  const recordOvertake = useCallback((wasClean: boolean) => {
    setHistory(prev => {
      const next = { ...prev };
      if (wasClean) {
        next.cleanOvertakes += 1;
      } else {
        next.dirtyOvertakes += 1;
      }
      next.grudgeLevel = computeGrudge(next);
      return next;
    });
  }, []);

  const recordRaceEnd = useCallback((playerWon: boolean) => {
    setHistory(prev => {
      const next = { ...prev };
      next.totalRaces += 1;

      if (playerWon) {
        next.playerWins += 1;
        next.lastRaceOutcome = 'win';
        // Update streak: extend player streak or start new one
        next.streak = prev.streak > 0 ? prev.streak + 1 : 1;
      } else {
        next.aiWins += 1;
        next.lastRaceOutcome = 'loss';
        // Update streak: extend AI streak or start new one
        next.streak = prev.streak < 0 ? prev.streak - 1 : -1;
      }

      next.grudgeLevel = computeGrudge(next);
      return next;
    });
  }, []);

  const resetGrudge = useCallback(() => {
    const fresh = createDefaultHistory();
    setHistory(fresh);
  }, []);

  const { mood, message: moodMessage } = getMoodFromGrudge(history.grudgeLevel);

  return {
    grudgeLevel: history.grudgeLevel,
    mood,
    moodMessage,
    grudgeHistory: history,
    recordCollision,
    recordOvertake,
    recordRaceEnd,
    resetGrudge,
  };
}

export default useAIGrudge;
