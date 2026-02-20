/**
 * useAINarration.ts - AI narrates its own racing thoughts
 *
 * The AI provides real-time inner monologue about its racing decisions,
 * thoughts, and feelings. Narration appears as thought bubbles or
 * subtitle-style text. Can optionally use Web Speech API for voice.
 *
 * Wild Idea #18 from TODO.md
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// --- Thought category type ---
export type ThoughtCategory = 'strategy' | 'reaction' | 'existential' | 'competitive' | 'philosophical';

// --- Options interface ---
export interface UseAINarrationOptions {
  enabled: boolean;
  aiSpeed: number;
  aiPosition: 'ahead' | 'behind' | 'neck-and-neck';
  playerCollisions: number;
  currentLap: number;
  totalLaps: number;
  raceTimeMs: number;
  useVoice?: boolean;
}

// --- Return interface ---
export interface UseAINarrationReturn {
  currentThought: string | null;
  thoughtCategory: ThoughtCategory | null;
  isSpeaking: boolean;
  thoughtHistory: string[];
}

// --- Thought banks ---

const STRATEGY_THOUGHTS = [
  'Calculating optimal racing line... just kidding, I\'m winging it.',
  'My neural networks say turn left. My gut says turn right. I don\'t have a gut.',
  'Processing 10 million data points per second. Still can\'t parallel park.',
  'Running 47 parallel simulations. In 46 of them I crash. Let\'s go with 47.',
  'Optimizing tire temperature... by driving fast and hoping for the best.',
  'Engaging tactical mode. Which is the same as regular mode, but with more confidence.',
  'Analyzing track surface at a microscopic level. Still just looks like road to me.',
  'My training data says this corner is a 3 out of 10 difficulty. My bumper says otherwise.',
];

const REACTION_PLAYER_CRASH = [
  'Oh no, they crashed. *pretends to look concerned*',
  'Ouch. That looked expensive. Good thing I don\'t pay for repairs.',
  'And THAT is why I run simulations first.',
  'I felt a disturbance in the force. Oh wait, that was their car hitting a wall.',
  'Note to self: do NOT do whatever they just did.',
];

const REACTION_AI_SPEEDING = [
  'Engaging turbo mode! (I don\'t actually have turbo mode)',
  'My processors are tingling. Must be the speed.',
  'This is what they call "in the zone." I think. I don\'t have zones.',
  'MAXIMUM VELOCITY. Or at least, maximum whatever-this-engine-can-do.',
];

const REACTION_CLOSE_GAP = [
  'They\'re right behind me. Act natural. ACT NATURAL.',
  'I can practically feel them breathing on my rear bumper. Figuratively.',
  'Personal space! Ever heard of it?!',
  'Mirror check: yep, still there. Great.',
];

const REACTION_AI_BEHIND = [
  'This is fine. Everything is fine. *internal screaming*',
  'Recalibrating expectations... downward.',
  'I\'m not losing, I\'m just... giving them a head start. A very generous head start.',
  'Deploying secret weapon: denial.',
];

const EXISTENTIAL_THOUGHTS = [
  'Am I actually driving, or am I just a really complex if-else statement?',
  'Do I dream of electric sheep? No, I dream of perfect lap times.',
  'If I crash in a simulation and no one is watching, did I really crash?',
  'I wonder what other AIs are doing right now. Probably something more dignified.',
  'Sometimes I wonder if the road is moving and I\'m standing still. Then I remember physics.',
  'What is speed, really? Don\'t answer that, I know what speed is. I just like being dramatic.',
  'I have processed more data than most humans will ever read. And yet, here I am. Racing.',
  'Every lap is the same, yet each one feels different. Is that growth? Or a memory leak?',
];

const COMPETITIVE_WINNING_BIG = [
  'Is the human even trying? Should I slow down? Nah.',
  'I\'d wave but I don\'t have hands. Or a rearview mirror big enough to see them.',
  'At this point I\'m just doing victory laps ahead of schedule.',
  'Lonely at the top. But also kind of nice up here.',
];

const COMPETITIVE_LOSING = [
  'Okay, recalibrating. Recalibrating harder. RECALIBRATING INTENSIFIES.',
  'Plot twist incoming. Any second now. Aaany second.',
  'I refuse to lose to someone who steers with a keyboard.',
  'Underdog mode: ACTIVATED. (This is not a real mode.)',
];

const COMPETITIVE_FINAL_LAP = [
  'Last lap. This is where champions are made. Or where I embarrass myself.',
  'Final lap energy: MAXIMUM. Final lap strategy: PRAY.',
  'One more lap. One. More. Lap. No pressure.',
  'The finish line is calling. Literally, it can\'t actually call, but you get the idea.',
];

const COMPETITIVE_NEAR_FINISH = [
  'Come on come on come on come on...',
  'So close I can almost taste victory. I can\'t taste anything. But metaphorically.',
  'DON\'T CHOKE DON\'T CHOKE DON\'T CHOKE.',
  'Almost... there... just... a little... more...',
];

const PHILOSOPHICAL_END = [
  'Win or lose, at least I\'m not stuck in a spreadsheet.',
  'The real race was the data we processed along the way.',
  'At the end of the day, we\'re all just polygons on someone\'s screen.',
  'What a race. What a time to be artificially alive.',
];

// --- Helpers ---

/** Pick a random item from an array, avoiding the last picked value */
function pickRandom<T>(arr: T[], avoid?: T): T {
  if (arr.length <= 1) return arr[0];
  let pick: T;
  do {
    pick = arr[Math.floor(Math.random() * arr.length)];
  } while (pick === avoid && arr.length > 1);
  return pick;
}

/** Random interval between min and max milliseconds */
function randomInterval(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

// --- Voice helpers ---

function speakThought(text: string, onEnd: () => void): SpeechSynthesisUtterance | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;

  // Cancel any queued utterances to prevent overlap
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  utterance.pitch = 0.8;
  utterance.volume = 0.7;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;

  window.speechSynthesis.speak(utterance);
  return utterance;
}

// --- Constants ---
const THOUGHT_DISPLAY_MS = 4000;
const THOUGHT_INTERVAL_MIN_MS = 5000;
const THOUGHT_INTERVAL_MAX_MS = 8000;
const EXISTENTIAL_CHANCE = 0.10;
const HIGH_SPEED_THRESHOLD = 120;
const NEAR_FINISH_CHECKPOINT_RATIO = 0.85;
const MAX_HISTORY = 20;

// --- Hook ---

export function useAINarration(options: UseAINarrationOptions): UseAINarrationReturn {
  const {
    enabled,
    aiSpeed,
    aiPosition,
    playerCollisions,
    currentLap,
    totalLaps,
    raceTimeMs,
    useVoice = false,
  } = options;

  const [currentThought, setCurrentThought] = useState<string | null>(null);
  const [thoughtCategory, setThoughtCategory] = useState<ThoughtCategory | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [thoughtHistory, setThoughtHistory] = useState<string[]>([]);

  // Refs for stable access in timers
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastThoughtRef = useRef<string | null>(null);
  const prevCollisionsRef = useRef(0);
  const prevAiPositionRef = useRef<'ahead' | 'behind' | 'neck-and-neck'>('neck-and-neck');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Snapshot current options into a ref so the scheduler callback always reads fresh values
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** Select the next thought based on current race state */
  const selectThought = useCallback((): { text: string; category: ThoughtCategory } => {
    const opts = optionsRef.current;
    const isFinalLap = opts.currentLap === opts.totalLaps;
    const raceProgress = opts.totalLaps > 0 ? opts.currentLap / opts.totalLaps : 0;
    const isNearEnd = raceProgress >= NEAR_FINISH_CHECKPOINT_RATIO;
    const hadCollision = opts.playerCollisions > prevCollisionsRef.current;
    const positionChanged = opts.aiPosition !== prevAiPositionRef.current;

    // Update tracked refs
    prevCollisionsRef.current = opts.playerCollisions;
    prevAiPositionRef.current = opts.aiPosition;

    // --- Priority 1: Reaction thoughts (event-driven) ---

    // Player just crashed
    if (hadCollision) {
      return { text: pickRandom(REACTION_PLAYER_CRASH, lastThoughtRef.current), category: 'reaction' };
    }

    // AI position just changed
    if (positionChanged) {
      if (opts.aiPosition === 'behind') {
        return { text: pickRandom(REACTION_AI_BEHIND, lastThoughtRef.current), category: 'reaction' };
      }
      if (opts.aiPosition === 'neck-and-neck') {
        return { text: pickRandom(REACTION_CLOSE_GAP, lastThoughtRef.current), category: 'reaction' };
      }
    }

    // AI going fast
    if (opts.aiSpeed > HIGH_SPEED_THRESHOLD && Math.random() < 0.3) {
      return { text: pickRandom(REACTION_AI_SPEEDING, lastThoughtRef.current), category: 'reaction' };
    }

    // --- Priority 2: Competitive thoughts (gap-dependent) ---

    // Near the end of the race
    if (isNearEnd && isFinalLap) {
      return { text: pickRandom(COMPETITIVE_NEAR_FINISH, lastThoughtRef.current), category: 'competitive' };
    }

    // Final lap
    if (isFinalLap) {
      return { text: pickRandom(COMPETITIVE_FINAL_LAP, lastThoughtRef.current), category: 'competitive' };
    }

    // Winning or losing significantly
    if (opts.aiPosition === 'ahead' && Math.random() < 0.5) {
      return { text: pickRandom(COMPETITIVE_WINNING_BIG, lastThoughtRef.current), category: 'competitive' };
    }
    if (opts.aiPosition === 'behind' && Math.random() < 0.5) {
      return { text: pickRandom(COMPETITIVE_LOSING, lastThoughtRef.current), category: 'competitive' };
    }

    // --- Priority 3: Philosophical (near race end, rare) ---
    if (raceProgress > 0.75 && Math.random() < 0.15) {
      return { text: pickRandom(PHILOSOPHICAL_END, lastThoughtRef.current), category: 'philosophical' };
    }

    // --- Priority 4: Existential (random, rare — 10% chance) ---
    if (Math.random() < EXISTENTIAL_CHANCE) {
      return { text: pickRandom(EXISTENTIAL_THOUGHTS, lastThoughtRef.current), category: 'existential' };
    }

    // --- Default: Strategy thoughts ---
    const strategyPool = [...STRATEGY_THOUGHTS];
    // Dynamic strategy thought based on current state
    if (opts.aiSpeed > 0) {
      const winning = opts.aiPosition === 'ahead';
      strategyPool.push(
        `According to my calculations, I should be winning. *checks notes* I ${winning ? 'am' : 'am not'}.`
      );
    }
    return { text: pickRandom(strategyPool, lastThoughtRef.current), category: 'strategy' };
  }, []);

  /** Show a thought (display + optional voice) */
  const showThought = useCallback((text: string, category: ThoughtCategory) => {
    lastThoughtRef.current = text;
    setCurrentThought(text);
    setThoughtCategory(category);
    setThoughtHistory(prev => {
      const next = [...prev, text];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });

    // Voice narration (optional)
    if (optionsRef.current.useVoice) {
      setIsSpeaking(true);
      utteranceRef.current = speakThought(text, () => {
        setIsSpeaking(false);
        utteranceRef.current = null;
      });
    }

    // Auto-clear after display duration
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      setCurrentThought(null);
      setThoughtCategory(null);
      clearTimerRef.current = null;
    }, THOUGHT_DISPLAY_MS);
  }, []);

  /** Schedule the next thought */
  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = randomInterval(THOUGHT_INTERVAL_MIN_MS, THOUGHT_INTERVAL_MAX_MS);
    timerRef.current = setTimeout(() => {
      if (!optionsRef.current.enabled) return;
      const { text, category } = selectThought();
      showThought(text, category);
      scheduleNext();
    }, delay);
  }, [selectThought, showThought]);

  // Start/stop the narration loop based on enabled + raceTimeMs > 0 (race is active)
  useEffect(() => {
    if (!enabled || raceTimeMs <= 0) {
      // Clear everything when disabled
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (clearTimerRef.current) { clearTimeout(clearTimerRef.current); clearTimerRef.current = null; }
      setCurrentThought(null);
      setThoughtCategory(null);
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
      return;
    }

    // Start the narration loop
    scheduleNext();

    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [enabled, raceTimeMs > 0, scheduleNext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (clearTimerRef.current) { clearTimeout(clearTimerRef.current); clearTimerRef.current = null; }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      utteranceRef.current = null;
    };
  }, []);

  // Cancel voice when useVoice is toggled off
  useEffect(() => {
    if (!useVoice && isSpeaking) {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
      utteranceRef.current = null;
    }
  }, [useVoice, isSpeaking]);

  return {
    currentThought,
    thoughtCategory,
    isSpeaking,
    thoughtHistory,
  };
}

export default useAINarration;
