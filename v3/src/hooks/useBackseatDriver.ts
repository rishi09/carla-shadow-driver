/**
 * useBackseatDriver.ts - AI gives unsolicited driving commentary
 *
 * The AI acts as a backseat driver, commenting on your driving
 * with increasingly annoying/funny observations. Comments are
 * triggered by driving events (speeding, crashing, going wrong way, etc.)
 *
 * Wild Idea #21 from TODO.md
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// --- Comment mood types ---
type CommentMood = 'helpful' | 'sarcastic' | 'panicked' | 'impressed' | 'bored';

// --- Comment categories (for per-category cooldown) ---
type CommentCategory =
  | 'speed_high'
  | 'speed_low'
  | 'speed_stopped'
  | 'collision'
  | 'reverse'
  | 'steering_hard'
  | 'steering_swerve'
  | 'gap_close'
  | 'gap_far';

interface CommentEntry {
  text: string;
  mood: CommentMood;
}

// --- Comment pools keyed by category ---
const COMMENT_POOLS: Record<CommentCategory, CommentEntry[]> = {
  speed_high: [
    { text: "Might want to ease off the gas...", mood: 'helpful' },
    { text: "Are we running from the law?", mood: 'sarcastic' },
    { text: "I can feel my face peeling off!", mood: 'panicked' },
    { text: "This is fine. Everything is fine.", mood: 'sarcastic' },
    { text: "My life is flashing before my eyes!", mood: 'panicked' },
    { text: "You know speed limits exist, right?", mood: 'helpful' },
  ],
  speed_low: [
    { text: "Are we... parking?", mood: 'bored' },
    { text: "I've seen glaciers move faster", mood: 'sarcastic' },
    { text: "Did you switch to eco mode?", mood: 'sarcastic' },
    { text: "My grandmother drives faster than this", mood: 'bored' },
    { text: "We're in a race, not a parade", mood: 'bored' },
  ],
  speed_stopped: [
    { text: "Did you forget which pedal is the gas?", mood: 'sarcastic' },
    { text: "Hello? Anyone home?", mood: 'bored' },
    { text: "Are we admiring the scenery?", mood: 'sarcastic' },
    { text: "I could walk faster than this", mood: 'bored' },
    { text: "Taking a nap, are we?", mood: 'bored' },
  ],
  collision: [
    // Index 0-1: first collision
    { text: "Watch out!", mood: 'helpful' },
    { text: "MY NECK!", mood: 'panicked' },
    // Index 2-3: 3+ collisions
    { text: "You DO know the goal is to avoid things, right?", mood: 'sarcastic' },
    { text: "Have you considered NOT hitting things?", mood: 'sarcastic' },
    // Index 4-5: 5+ collisions
    { text: "I want to speak to your driving instructor", mood: 'sarcastic' },
    { text: "Is this a demolition derby?", mood: 'panicked' },
    // Index 6-7: 10+ collisions
    { text: "I'm updating my will on my phone", mood: 'panicked' },
    { text: "I should have taken the bus", mood: 'sarcastic' },
  ],
  reverse: [
    { text: "Wrong way! WRONG WAY!", mood: 'panicked' },
    { text: "The finish line is the OTHER direction", mood: 'helpful' },
    { text: "Interesting strategy, going backwards", mood: 'sarcastic' },
    { text: "Is this a new speedrun technique?", mood: 'sarcastic' },
    { text: "You know reverse isn't a gear for racing, right?", mood: 'helpful' },
  ],
  steering_hard: [
    { text: "TURN TURN TURN!", mood: 'panicked' },
    { text: "Are you trying to do donuts?", mood: 'sarcastic' },
    { text: "My lunch is coming back up!", mood: 'panicked' },
    { text: "This isn't a merry-go-round!", mood: 'sarcastic' },
  ],
  steering_swerve: [
    { text: "Make up your mind!", mood: 'sarcastic' },
    { text: "Are you swatting a bee?", mood: 'sarcastic' },
    { text: "Pick a lane! ANY lane!", mood: 'panicked' },
    { text: "Is the steering wheel okay?", mood: 'helpful' },
  ],
  gap_close: [
    { text: "Ooh, this is close!", mood: 'impressed' },
    { text: "DON'T CHOKE NOW!", mood: 'panicked' },
    { text: "I believe in you! Maybe.", mood: 'impressed' },
    { text: "Neck and neck! My neck hurts btw", mood: 'panicked' },
    { text: "This is actually exciting!", mood: 'impressed' },
  ],
  gap_far: [
    { text: "The AI is in a different zip code", mood: 'bored' },
    { text: "Maybe try going faster?", mood: 'helpful' },
    { text: "I can't even see the AI anymore", mood: 'bored' },
    { text: "At this rate we'll finish next week", mood: 'sarcastic' },
    { text: "You know this is a competition, right?", mood: 'sarcastic' },
  ],
};

// --- Timing constants ---
const CHECK_INTERVAL_MS = 2000;       // Check for comment triggers every 2s
const COMMENT_DISPLAY_MS = 3000;      // Show each comment for 3s
const MIN_BETWEEN_COMMENTS_MS = 4000; // Min 4s between any two comments
const CATEGORY_COOLDOWN_MS = 15000;   // 15s cooldown per category
const SLOW_SPEED_THRESHOLD_MS = 3000; // Speed < 20 for 3s triggers comment
const STOPPED_THRESHOLD_MS = 5000;    // Speed === 0 for 5s triggers comment
const HARD_STEER_THRESHOLD_MS = 2000; // abs(steer) > 0.8 for 2s triggers comment
const MAX_HISTORY = 10;               // Keep last 10 comments in history

// --- Options interface ---
interface UseBackseatDriverOptions {
  enabled: boolean;
  speed: number;
  isReversing: boolean;
  collisionCount: number;
  isOffRoad: boolean;
  gapToAI: number;
  steeringInput: number;
}

// --- Return interface ---
interface UseBackseatDriverReturn {
  currentComment: string | null;
  commentMood: CommentMood | null;
  commentHistory: string[];
  dismiss: () => void;
}

/** Pick a random entry from an array */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Pick a collision comment based on total collision count */
function pickCollisionComment(count: number): CommentEntry {
  const pool = COMMENT_POOLS.collision;
  if (count >= 10) return pickRandom(pool.slice(6));
  if (count >= 5) return pickRandom(pool.slice(4, 6));
  if (count >= 3) return pickRandom(pool.slice(2, 4));
  return pickRandom(pool.slice(0, 2));
}

export function useBackseatDriver(options: UseBackseatDriverOptions): UseBackseatDriverReturn {
  const { enabled, speed, isReversing, collisionCount, isOffRoad: _isOffRoad, gapToAI, steeringInput } = options;

  // --- State ---
  const [currentComment, setCurrentComment] = useState<string | null>(null);
  const [commentMood, setCommentMood] = useState<CommentMood | null>(null);
  const [commentHistory, setCommentHistory] = useState<string[]>([]);

  // --- Refs for tracking timing and state across checks ---
  const lastCommentTimeRef = useRef<number>(0);
  const categoryCooldownsRef = useRef<Map<CommentCategory, number>>(new Map());
  const commentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Duration trackers: how long a condition has been true
  const slowSinceRef = useRef<number | null>(null);     // timestamp when speed dropped below 20
  const stoppedSinceRef = useRef<number | null>(null);  // timestamp when speed hit 0
  const hardSteerSinceRef = useRef<number | null>(null); // timestamp when |steer| > 0.8 started

  // Swerve detection: track steering direction changes
  const lastSteerSignRef = useRef<number>(0);
  const swerveCountRef = useRef<number>(0);
  const swerveWindowStartRef = useRef<number>(0);

  // Collision tracking: detect new collisions
  const prevCollisionCountRef = useRef<number>(0);

  // Refs for latest option values (avoid stale closures in interval)
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // --- Show a comment (with cooldown + display timer logic) ---
  const showComment = useCallback((category: CommentCategory, entry: CommentEntry) => {
    const now = Date.now();

    // Enforce minimum gap between any two comments
    if (now - lastCommentTimeRef.current < MIN_BETWEEN_COMMENTS_MS) return;

    // Enforce per-category cooldown
    const lastCategoryTime = categoryCooldownsRef.current.get(category) ?? 0;
    if (now - lastCategoryTime < CATEGORY_COOLDOWN_MS) return;

    // Set the comment
    lastCommentTimeRef.current = now;
    categoryCooldownsRef.current.set(category, now);

    setCurrentComment(entry.text);
    setCommentMood(entry.mood);
    setCommentHistory(prev => {
      const next = [...prev, entry.text];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });

    // Clear any existing display timer
    if (commentTimerRef.current) clearTimeout(commentTimerRef.current);

    // Auto-dismiss after display duration
    commentTimerRef.current = setTimeout(() => {
      setCurrentComment(null);
      setCommentMood(null);
      commentTimerRef.current = null;
    }, COMMENT_DISPLAY_MS);
  }, []);

  // --- Dismiss current comment manually ---
  const dismiss = useCallback(() => {
    if (commentTimerRef.current) {
      clearTimeout(commentTimerRef.current);
      commentTimerRef.current = null;
    }
    setCurrentComment(null);
    setCommentMood(null);
  }, []);

  // --- Main check logic (runs every CHECK_INTERVAL_MS) ---
  const checkTriggers = useCallback(() => {
    const opts = optionsRef.current;
    if (!opts.enabled) return;

    const now = Date.now();

    // --- Collision check (reactive: fires when count increases) ---
    if (opts.collisionCount > prevCollisionCountRef.current) {
      prevCollisionCountRef.current = opts.collisionCount;
      const entry = pickCollisionComment(opts.collisionCount);
      showComment('collision', entry);
      return; // Only one comment per check cycle
    }
    prevCollisionCountRef.current = opts.collisionCount;

    // --- Reverse check ---
    if (opts.isReversing) {
      showComment('reverse', pickRandom(COMMENT_POOLS.reverse));
      return;
    }

    // --- Speed: stopped (0 km/h for > 5s) ---
    if (opts.speed === 0) {
      if (!stoppedSinceRef.current) stoppedSinceRef.current = now;
      if (now - stoppedSinceRef.current > STOPPED_THRESHOLD_MS) {
        showComment('speed_stopped', pickRandom(COMMENT_POOLS.speed_stopped));
        stoppedSinceRef.current = now; // Reset so it doesn't spam
        return;
      }
    } else {
      stoppedSinceRef.current = null;
    }

    // --- Speed: slow (< 20 km/h for > 3s, but not stopped) ---
    if (opts.speed > 0 && opts.speed < 20) {
      if (!slowSinceRef.current) slowSinceRef.current = now;
      if (now - slowSinceRef.current > SLOW_SPEED_THRESHOLD_MS) {
        showComment('speed_low', pickRandom(COMMENT_POOLS.speed_low));
        slowSinceRef.current = now; // Reset
        return;
      }
    } else {
      slowSinceRef.current = null;
    }

    // --- Speed: high (> 150 km/h) ---
    if (opts.speed > 150) {
      showComment('speed_high', pickRandom(COMMENT_POOLS.speed_high));
      return;
    }

    // --- Steering: hard turn (|steer| > 0.8 for > 2s) ---
    if (Math.abs(opts.steeringInput) > 0.8) {
      if (!hardSteerSinceRef.current) hardSteerSinceRef.current = now;
      if (now - hardSteerSinceRef.current > HARD_STEER_THRESHOLD_MS) {
        showComment('steering_hard', pickRandom(COMMENT_POOLS.steering_hard));
        hardSteerSinceRef.current = now; // Reset
        return;
      }
    } else {
      hardSteerSinceRef.current = null;
    }

    // --- Steering: swerving (frequent direction changes) ---
    const currentSign = opts.steeringInput > 0.2 ? 1 : opts.steeringInput < -0.2 ? -1 : 0;
    if (currentSign !== 0 && currentSign !== lastSteerSignRef.current && lastSteerSignRef.current !== 0) {
      // Direction changed
      if (now - swerveWindowStartRef.current > 5000) {
        // Reset swerve window every 5 seconds
        swerveCountRef.current = 0;
        swerveWindowStartRef.current = now;
      }
      swerveCountRef.current++;
      if (swerveCountRef.current >= 4) {
        showComment('steering_swerve', pickRandom(COMMENT_POOLS.steering_swerve));
        swerveCountRef.current = 0;
        swerveWindowStartRef.current = now;
        lastSteerSignRef.current = currentSign;
        return;
      }
    }
    if (currentSign !== 0) lastSteerSignRef.current = currentSign;

    // --- Gap: close race (gap < 1s) ---
    if (Math.abs(opts.gapToAI) < 1) {
      showComment('gap_close', pickRandom(COMMENT_POOLS.gap_close));
      return;
    }

    // --- Gap: falling behind (gap > 10s) ---
    if (opts.gapToAI > 10) {
      showComment('gap_far', pickRandom(COMMENT_POOLS.gap_far));
      return;
    }
  }, [showComment]);

  // --- Start/stop the check interval based on enabled state ---
  useEffect(() => {
    if (!enabled) {
      // Clear everything when disabled
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      if (commentTimerRef.current) {
        clearTimeout(commentTimerRef.current);
        commentTimerRef.current = null;
      }
      setCurrentComment(null);
      setCommentMood(null);
      // Reset duration trackers
      slowSinceRef.current = null;
      stoppedSinceRef.current = null;
      hardSteerSinceRef.current = null;
      swerveCountRef.current = 0;
      lastSteerSignRef.current = 0;
      prevCollisionCountRef.current = 0;
      categoryCooldownsRef.current.clear();
      lastCommentTimeRef.current = 0;
      return;
    }

    // Initialize collision count baseline when enabling
    prevCollisionCountRef.current = collisionCount;

    // Start the periodic check
    checkIntervalRef.current = setInterval(checkTriggers, CHECK_INTERVAL_MS);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [enabled, checkTriggers, collisionCount]);

  // --- Reactive collision detection (don't wait for interval) ---
  useEffect(() => {
    if (!enabled) return;
    if (collisionCount > prevCollisionCountRef.current) {
      prevCollisionCountRef.current = collisionCount;
      const entry = pickCollisionComment(collisionCount);
      showComment('collision', entry);
    }
  }, [enabled, collisionCount, showComment]);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      if (commentTimerRef.current) {
        clearTimeout(commentTimerRef.current);
        commentTimerRef.current = null;
      }
    };
  }, []);

  return {
    currentComment,
    commentMood,
    commentHistory,
    dismiss,
  };
}

export default useBackseatDriver;
