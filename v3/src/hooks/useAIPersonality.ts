/**
 * useAIPersonality.ts - Hook for managing AI opponent personality and trash talk
 *
 * Selects a personality based on difficulty/model, triggers context-sensitive
 * trash talk with cooldown management, and tracks grudge state via localStorage.
 */

import { useState, useCallback, useRef } from 'react';
import type { TrashTalkEvent, AIPersonality } from '../data/aiPersonalities.ts';
import { selectPersonality } from '../data/aiPersonalities.ts';

/** Grudge record stored in localStorage */
interface GrudgeRecord {
  /** How many consecutive times the player has beaten this AI personality */
  consecutiveWins: number;
  /** Total races played against this personality */
  totalRaces: number;
}

const GRUDGE_STORAGE_KEY = 'shadow_driver_grudge';
const COOLDOWN_MS = 5000;
const MESSAGE_DURATION_MS = 3500;

/** Load grudge data from localStorage */
function loadGrudge(personalityId: string): GrudgeRecord {
  try {
    const raw = localStorage.getItem(GRUDGE_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Record<string, GrudgeRecord>;
      if (data[personalityId]) return data[personalityId];
    }
  } catch { /* ignore parse errors */ }
  return { consecutiveWins: 0, totalRaces: 0 };
}

/** Save grudge data to localStorage */
function saveGrudge(personalityId: string, record: GrudgeRecord): void {
  try {
    const raw = localStorage.getItem(GRUDGE_STORAGE_KEY);
    const data: Record<string, GrudgeRecord> = raw ? JSON.parse(raw) : {};
    data[personalityId] = record;
    localStorage.setItem(GRUDGE_STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore storage errors */ }
}

export interface AIPersonalityMessage {
  text: string;
  /** Unique key for React rendering / animation triggers */
  key: number;
}

export interface UseAIPersonalityReturn {
  /** The currently active AI personality (null before race starts) */
  personality: AIPersonality | null;
  /** The current message to display (null when no message or dismissed) */
  currentMessage: AIPersonalityMessage | null;
  /** Initialize personality for a new race */
  initPersonality: (modelId?: string) => void;
  /** Trigger a trash talk line for the given event */
  triggerTrashTalk: (event: TrashTalkEvent) => void;
  /** Record a race result for the grudge system */
  recordRaceResult: (playerWon: boolean) => void;
  /** Whether the AI is in grudge mode (player has beaten them 3+ times) */
  isGrudgeMode: boolean;
}

export function useAIPersonality(): UseAIPersonalityReturn {
  const [personality, setPersonality] = useState<AIPersonality | null>(null);
  const [currentMessage, setCurrentMessage] = useState<AIPersonalityMessage | null>(null);
  const [isGrudgeMode, setIsGrudgeMode] = useState(false);

  const messageKeyRef = useRef(0);
  const cooldownRef = useRef(0); // timestamp when cooldown expires
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personalityRef = useRef<AIPersonality | null>(null);
  const grudgeRef = useRef<GrudgeRecord>({ consecutiveWins: 0, totalRaces: 0 });
  /** Track which lines have been used per event to avoid repeats within a race */
  const usedLinesRef = useRef<Record<string, Set<number>>>({});

  const initPersonality = useCallback((modelId?: string) => {
    const selected = selectPersonality(modelId);
    setPersonality(selected);
    personalityRef.current = selected;
    setCurrentMessage(null);
    cooldownRef.current = 0;
    usedLinesRef.current = {};

    // Load grudge state
    const grudge = loadGrudge(selected.id);
    grudgeRef.current = grudge;
    setIsGrudgeMode(grudge.consecutiveWins >= 3);
  }, []);

  const triggerTrashTalk = useCallback((event: TrashTalkEvent) => {
    const p = personalityRef.current;
    if (!p) return;

    const now = Date.now();
    if (now < cooldownRef.current) return; // still on cooldown

    // Decide whether to use a grudge line (30% chance when in grudge mode, for select events)
    const grudge = grudgeRef.current;
    const grudgeEligibleEvents: TrashTalkEvent[] = ['race_start', 'ai_overtakes', 'win', 'final_lap'];
    const useGrudge = grudge.consecutiveWins >= 3
      && grudgeEligibleEvents.includes(event)
      && Math.random() < 0.3
      && p.grudgeLines.length > 0;

    let lines: string[];
    let linePool: string;
    if (useGrudge) {
      lines = p.grudgeLines;
      linePool = '__grudge__';
    } else {
      lines = p.trashTalk[event];
      linePool = event;
    }

    if (!lines || lines.length === 0) return;

    // Pick a line we haven't used yet in this race (if possible)
    if (!usedLinesRef.current[linePool]) {
      usedLinesRef.current[linePool] = new Set();
    }
    const used = usedLinesRef.current[linePool];
    let availableIndices = lines.map((_, i) => i).filter(i => !used.has(i));
    if (availableIndices.length === 0) {
      // All lines used, reset pool
      used.clear();
      availableIndices = lines.map((_, i) => i);
    }
    const chosenIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    used.add(chosenIndex);
    const text = lines[chosenIndex];

    // Set cooldown
    cooldownRef.current = now + COOLDOWN_MS;

    // Clear any pending dismiss timer
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }

    messageKeyRef.current += 1;
    setCurrentMessage({ text, key: messageKeyRef.current });

    // Auto-dismiss after duration
    dismissTimerRef.current = setTimeout(() => {
      setCurrentMessage(null);
      dismissTimerRef.current = null;
    }, MESSAGE_DURATION_MS);
  }, []);

  const recordRaceResult = useCallback((playerWon: boolean) => {
    const p = personalityRef.current;
    if (!p) return;

    const grudge = { ...grudgeRef.current };
    grudge.totalRaces += 1;
    if (playerWon) {
      grudge.consecutiveWins += 1;
    } else {
      grudge.consecutiveWins = 0;
    }
    grudgeRef.current = grudge;
    setIsGrudgeMode(grudge.consecutiveWins >= 3);
    saveGrudge(p.id, grudge);
  }, []);

  return {
    personality,
    currentMessage,
    initPersonality,
    triggerTrashTalk,
    recordRaceResult,
    isGrudgeMode,
  };
}
