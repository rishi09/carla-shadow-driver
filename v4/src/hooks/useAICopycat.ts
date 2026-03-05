/**
 * useAICopycat.ts - AI that mimics the player's driving mistakes
 *
 * Records the player's mistakes (crashes, spins, wrong-way driving)
 * and occasionally makes the AI "copy" them with funny commentary.
 * "Learned" mistakes are stored per-session.
 *
 * Wild Idea #20 from TODO.md
 */
import { useEffect, useRef, useCallback, useState } from 'react';

// --- Types ---
export type MistakeType = 'crash' | 'spin' | 'wrongWay' | 'offRoad' | 'slowdown' | 'wallRide';

export interface Mistake { type: MistakeType; timestamp: number; description: string }

export interface UseAICopycatOptions {
  enabled: boolean;
  playerSpeed: number;
  playerSteering: number; // -1 to 1
  playerCollisionCount: number;
  playerIsReversing: boolean;
}

export interface UseAICopycatReturn {
  recordedMistakes: Mistake[];
  aiCopyingMessage: string | null; // shown when AI copies a mistake
  isCopying: boolean;              // whether AI is currently mimicking
  mistakeCount: number;
  copyChance: number;              // 0-1, increases with more mistakes
}

// --- Constants ---

const MAX_MISTAKES = 20;             // FIFO buffer cap
const SPIN_STEER_THRESHOLD = 0.9;    // |steering| to detect a spin
const SPIN_DURATION_MS = 1500;       // how long steering must exceed threshold
const WRONG_WAY_DURATION_MS = 3000;  // how long reversing counts as wrong-way
const SLOWDOWN_SPEED_HIGH = 80;      // speed above which we start tracking
const SLOWDOWN_SPEED_LOW = 30;       // speed below which it counts as sudden stop
const SLOWDOWN_WINDOW_MS = 1000;     // time window for sudden deceleration
const WALL_RIDE_SPEED_THRESHOLD = 50; // collision above this speed = wall ride
const MESSAGE_DISPLAY_MS = 4000;     // how long copy message stays on screen
const MIN_COPY_INTERVAL_MS = 15000;  // minimum gap between copy events
const MAX_COPY_INTERVAL_MS = 30000;  // max random interval for next check
const COPY_CHANCE_PER_MISTAKE = 0.1; // probability gained per recorded mistake
const MAX_COPY_CHANCE = 0.8;         // probability cap

const COPY_MESSAGES: Record<MistakeType, string[]> = {
  crash: [
    'The AI just copied your crash from earlier...',
    'The AI saw you crash and thought "I can do that too!"',
    'Imitation is the sincerest form of mockery',
    'The AI has been studying your crash technique',
  ],
  spin: [
    'The AI saw you spin out and thought it looked fun',
    'The AI is practicing your signature spin move',
    'That spin you did? The AI just nailed it',
    'The AI says: "Watch THIS spin!"',
  ],
  wrongWay: [
    'Learning from the worst: the AI is now driving backwards too',
    'The AI decided your wrong-way driving was a valid strategy',
    'The AI is exploring the track your way -- in reverse',
    'GPS recalculating... just like yours did',
  ],
  offRoad: [
    'The AI is taking the scenic route, inspired by you',
    'Off-road mode: activated (blame yourself)',
    'The AI learned off-roading from the best... or the worst',
  ],
  slowdown: [
    'The AI just panic-braked, just like you did earlier',
    'The AI is perfecting your sudden deceleration technique',
    'Brake check! The AI learned that from you',
    'The AI is doing its best impression of your braking style',
  ],
  wallRide: [
    'The AI is doing its best impression of your wall-riding technique',
    'Wall-riding achievement unlocked -- for the AI too',
    'The AI thinks guardrails are for grinding, just like you',
    'The AI saw your wall-hugging and took notes',
  ],
};

const randomInRange = (min: number, max: number) => min + Math.random() * (max - min);
const pickRandom = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// --- Hook ---

export function useAICopycat(options: UseAICopycatOptions): UseAICopycatReturn {
  const { enabled, playerSpeed, playerSteering, playerCollisionCount, playerIsReversing } = options;

  const [recordedMistakes, setRecordedMistakes] = useState<Mistake[]>([]);
  const [aiCopyingMessage, setAiCopyingMessage] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);

  // Mutable refs for mistake detection (no re-renders)
  const prevCollisionCountRef = useRef(playerCollisionCount);
  const spinStartRef = useRef<number | null>(null);
  const wrongWayStartRef = useRef<number | null>(null);
  const highSpeedTimestampRef = useRef<number | null>(null);
  const highSpeedValueRef = useRef(0);

  // Refs for copy-event scheduling
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCopyTimeRef = useRef(0);
  const mistakesRef = useRef<Mistake[]>([]);

  // Keep mistakesRef in sync so timer callbacks see fresh data
  const syncMistakes = useCallback((mistakes: Mistake[]) => {
    mistakesRef.current = mistakes;
    setRecordedMistakes(mistakes);
  }, []);

  // Add a mistake (FIFO, capped at MAX_MISTAKES)
  const addMistake = useCallback((type: MistakeType, description: string) => {
    const updated = [...mistakesRef.current, { type, timestamp: Date.now(), description }]
      .slice(-MAX_MISTAKES);
    syncMistakes(updated);
  }, [syncMistakes]);

  // Detect mistakes by watching player state changes
  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();

    // Crash / wall-ride: collisionCount increased
    if (playerCollisionCount > prevCollisionCountRef.current) {
      if (playerSpeed > WALL_RIDE_SPEED_THRESHOLD) {
        addMistake('wallRide', `Wall ride at ${Math.round(playerSpeed)} km/h`);
      } else {
        addMistake('crash', `Crashed at ${Math.round(playerSpeed)} km/h`);
      }
    }
    prevCollisionCountRef.current = playerCollisionCount;

    // Spin: |steering| > 0.9 for > 1.5s
    if (Math.abs(playerSteering) > SPIN_STEER_THRESHOLD) {
      if (spinStartRef.current === null) {
        spinStartRef.current = now;
      } else if (now - spinStartRef.current > SPIN_DURATION_MS) {
        addMistake('spin', `Spun out with steering at ${playerSteering.toFixed(2)}`);
        spinStartRef.current = null;
      }
    } else {
      spinStartRef.current = null;
    }

    // Wrong way: reversing for > 3s
    if (playerIsReversing) {
      if (wrongWayStartRef.current === null) {
        wrongWayStartRef.current = now;
      } else if (now - wrongWayStartRef.current > WRONG_WAY_DURATION_MS) {
        addMistake('wrongWay', 'Drove the wrong way for over 3 seconds');
        wrongWayStartRef.current = null;
      }
    } else {
      wrongWayStartRef.current = null;
    }

    // Slowdown: speed drops from >80 to <30 in <1s
    if (playerSpeed > SLOWDOWN_SPEED_HIGH) {
      highSpeedTimestampRef.current = now;
      highSpeedValueRef.current = playerSpeed;
    }
    if (
      playerSpeed < SLOWDOWN_SPEED_LOW &&
      highSpeedTimestampRef.current !== null &&
      now - highSpeedTimestampRef.current < SLOWDOWN_WINDOW_MS
    ) {
      addMistake('slowdown', `Sudden stop from ${Math.round(highSpeedValueRef.current)} to ${Math.round(playerSpeed)} km/h`);
      highSpeedTimestampRef.current = null;
    }
  }, [enabled, playerSpeed, playerSteering, playerCollisionCount, playerIsReversing, addMistake]);

  // Schedule periodic AI copy events (every 15-30s random)
  useEffect(() => {
    if (!enabled) {
      if (copyTimerRef.current) { clearTimeout(copyTimerRef.current); copyTimerRef.current = null; }
      return;
    }

    const scheduleCopyEvent = () => {
      copyTimerRef.current = setTimeout(() => {
        const mistakes = mistakesRef.current;
        if (mistakes.length === 0) { scheduleCopyEvent(); return; }

        const chance = Math.min(MAX_COPY_CHANCE, mistakes.length * COPY_CHANCE_PER_MISTAKE);
        const now = Date.now();
        if (now - lastCopyTimeRef.current < MIN_COPY_INTERVAL_MS) { scheduleCopyEvent(); return; }

        if (Math.random() < chance) {
          const mistake = pickRandom(mistakes);
          const message = pickRandom(COPY_MESSAGES[mistake.type]);
          lastCopyTimeRef.current = now;
          setAiCopyingMessage(message);
          setIsCopying(true);

          if (messageClearTimerRef.current) clearTimeout(messageClearTimerRef.current);
          messageClearTimerRef.current = setTimeout(() => {
            setAiCopyingMessage(null);
            setIsCopying(false);
            messageClearTimerRef.current = null;
          }, MESSAGE_DISPLAY_MS);
        }
        scheduleCopyEvent();
      }, randomInRange(MIN_COPY_INTERVAL_MS, MAX_COPY_INTERVAL_MS));
    };

    scheduleCopyEvent();
    return () => {
      if (copyTimerRef.current) { clearTimeout(copyTimerRef.current); copyTimerRef.current = null; }
    };
  }, [enabled]);

  // Cleanup message timer on unmount
  useEffect(() => () => {
    if (messageClearTimerRef.current) {
      clearTimeout(messageClearTimerRef.current);
      messageClearTimerRef.current = null;
    }
  }, []);

  const mistakeCount = recordedMistakes.length;
  const copyChance = Math.min(MAX_COPY_CHANCE, mistakeCount * COPY_CHANCE_PER_MISTAKE);

  return { recordedMistakes, aiCopyingMessage, isCopying, mistakeCount, copyChance };
}

export default useAICopycat;
