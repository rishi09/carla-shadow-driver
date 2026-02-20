/**
 * useNPCSpectators.ts - Virtual crowd that reacts to your racing
 *
 * Simulates a crowd of NPC spectators watching the race. They react
 * to events with emoji reactions and comments. Creates a sense of
 * being watched and performing for an audience.
 *
 * Wild Idea #47 from TODO.md
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// --- Types ---

export type SpectatorPersonality = 'enthusiast' | 'critic' | 'casual' | 'superfan' | 'troll';

export type CrowdMood = 'excited' | 'bored' | 'shocked' | 'impressed' | 'disappointed';

export interface Spectator {
  id: string;
  name: string;
  personality: SpectatorPersonality;
}

export interface SpectatorReaction {
  spectatorId: string;
  spectatorName: string;
  emoji: string;
  comment: string;
  timestamp: number;
}

export interface UseNPCSpectatorsOptions {
  enabled: boolean;
  speed: number;
  collisionCount: number;
  gapToAI: number; // seconds
  isLeading: boolean;
  currentLap: number;
  isDrifting: boolean;
}

export interface UseNPCSpectatorsReturn {
  spectators: Spectator[];
  reactions: SpectatorReaction[];
  crowdMood: CrowdMood;
  crowdSize: number;
  chantText: string | null;
}

// --- Constants ---

const FIRST_NAMES = [
  'Jake', 'Emma', 'Carlos', 'Yuki', 'Priya', 'Omar',
  'Sophie', 'Liam', 'Mei', 'Diego', 'Aisha', 'Felix',
];

const LAST_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const PERSONALITIES: SpectatorPersonality[] = [
  'enthusiast', 'critic', 'casual', 'superfan', 'troll',
];

const MAX_VISIBLE_REACTIONS = 5;

const MIN_REACTION_INTERVAL_MS = 3000;
const MAX_REACTION_INTERVAL_MS = 6000;

const CROWD_CHANTS = ['GO! GO! GO!', 'FASTER! FASTER!', 'ONE MORE LAP!'];

const BORED_SPEED_THRESHOLD = 30;
const BORED_DURATION_MS = 5000;

const MIN_CROWD_SIZE = 8;
const MAX_CROWD_SIZE = 12;

// --- Reaction comment pools by trigger and personality ---

interface ReactionOption {
  emoji: string;
  comment: string;
}

type ReactionPool = Partial<Record<SpectatorPersonality, ReactionOption[]>>;

const SPEED_HIGH_REACTIONS: ReactionPool = {
  enthusiast: [
    { emoji: '\uD83C\uDFCE\uFE0F', comment: 'GO GO GO!' },
    { emoji: '\uD83D\uDE80', comment: 'FULL SEND!' },
  ],
  superfan: [
    { emoji: '\uD83D\uDD25', comment: 'MAXIMUM SPEED!' },
    { emoji: '\uD83C\uDFC1', comment: 'UNSTOPPABLE!' },
  ],
  casual: [
    { emoji: '\uD83D\uDE2E', comment: 'Woah, that\'s fast' },
  ],
  troll: [
    { emoji: '\uD83E\uDD21', comment: 'Still not fast enough' },
  ],
};

const SPEED_LOW_REACTIONS: ReactionPool = {
  critic: [
    { emoji: '\uD83D\uDE34', comment: 'Is this a race or a parking lot?' },
    { emoji: '\uD83E\uDD71', comment: 'I\'m falling asleep here' },
  ],
  troll: [
    { emoji: '\uD83D\uDC80', comment: 'MY GRANDMA DRIVES FASTER' },
    { emoji: '\uD83D\uDC0C', comment: 'Even a snail would overtake you' },
  ],
  casual: [
    { emoji: '\uD83D\uDE05', comment: 'Taking the scenic route?' },
  ],
};

const COLLISION_REACTIONS: ReactionPool = {
  critic: [
    { emoji: '\uD83D\uDE2C', comment: 'That\'s gonna leave a mark' },
    { emoji: '\uD83E\uDD26', comment: 'Not the best line there' },
  ],
  casual: [
    { emoji: '\uD83D\uDCA5', comment: 'Ooof' },
    { emoji: '\uD83D\uDE31', comment: 'That looked painful!' },
  ],
  troll: [
    { emoji: '\uD83D\uDE02', comment: 'LMAOOO' },
    { emoji: '\uD83E\uDD23', comment: 'WRECKED' },
  ],
  enthusiast: [
    { emoji: '\uD83D\uDE32', comment: 'Oh no!!' },
  ],
  superfan: [
    { emoji: '\uD83D\uDE22', comment: 'Shake it off! You got this!' },
  ],
};

const LEADING_REACTIONS: ReactionPool = {
  superfan: [
    { emoji: '\uD83D\uDC51', comment: 'CHAMPION!' },
    { emoji: '\uD83C\uDFC6', comment: 'Nobody can stop you!' },
  ],
  enthusiast: [
    { emoji: '\uD83C\uDF89', comment: 'Keep it up!' },
    { emoji: '\uD83D\uDCAA', comment: 'You\'re crushing it!' },
  ],
  troll: [
    { emoji: '\uD83E\uDD37', comment: 'The AI is letting you win' },
    { emoji: '\uD83E\uDD14', comment: 'Is the AI even trying?' },
  ],
  casual: [
    { emoji: '\uD83D\uDE0E', comment: 'Looking good out there' },
  ],
};

const BEHIND_REACTIONS: ReactionPool = {
  casual: [
    { emoji: '\uD83D\uDE05', comment: 'Better luck next time' },
    { emoji: '\uD83E\uDD1E', comment: 'You can still catch up' },
  ],
  critic: [
    { emoji: '\uD83D\uDC4E', comment: 'Disappointing' },
    { emoji: '\uD83D\uDE44', comment: 'Expected more honestly' },
  ],
  troll: [
    { emoji: '\uD83D\uDE0F', comment: 'Get rekt' },
    { emoji: '\uD83D\uDCA4', comment: 'Wake me up when you catch up' },
  ],
  superfan: [
    { emoji: '\uD83D\uDE24', comment: 'Don\'t give up! PUSH!' },
  ],
};

const DRIFT_REACTIONS: ReactionPool = {
  enthusiast: [
    { emoji: '\uD83D\uDD25', comment: 'SICK DRIFT!' },
    { emoji: '\uD83C\uDFCE\uFE0F', comment: 'SIDEWAYS!' },
  ],
  superfan: [
    { emoji: '\u26A1', comment: 'DEJA VU!' },
    { emoji: '\uD83C\uDF0A', comment: 'EUROBEAT INTENSIFIES!' },
  ],
  casual: [
    { emoji: '\uD83D\uDE2F', comment: 'How did you do that?!' },
  ],
  troll: [
    { emoji: '\uD83E\uDD37', comment: 'That was probably an accident' },
  ],
};

// --- Helpers ---

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSpectatorName(): string {
  const firstName = randomElement(FIRST_NAMES);
  const lastInitial = LAST_INITIALS[randomInt(0, LAST_INITIALS.length - 1)];
  return `${firstName} ${lastInitial}.`;
}

function generateSpectators(): Spectator[] {
  const count = randomInt(MIN_CROWD_SIZE, MAX_CROWD_SIZE);
  const usedNames = new Set<string>();
  const spectators: Spectator[] = [];

  for (let i = 0; i < count; i++) {
    let name = generateSpectatorName();
    // Avoid duplicate names
    while (usedNames.has(name)) {
      name = generateSpectatorName();
    }
    usedNames.add(name);
    spectators.push({
      id: `spec_${i}_${Date.now()}`,
      name,
      personality: randomElement(PERSONALITIES),
    });
  }

  return spectators;
}

function pickReaction(pool: ReactionPool, spectator: Spectator): ReactionOption | null {
  const options = pool[spectator.personality];
  if (!options || options.length === 0) return null;
  return randomElement(options);
}

function getNextReactionDelay(): number {
  return randomInt(MIN_REACTION_INTERVAL_MS, MAX_REACTION_INTERVAL_MS);
}

// --- Hook ---

export function useNPCSpectators(options: UseNPCSpectatorsOptions): UseNPCSpectatorsReturn {
  const { enabled, speed, collisionCount, gapToAI, isLeading, currentLap, isDrifting } = options;

  // Generate spectators once on mount
  const [spectators] = useState<Spectator[]>(() => generateSpectators());
  const [reactions, setReactions] = useState<SpectatorReaction[]>([]);
  const [crowdMood, setCrowdMood] = useState<CrowdMood>('excited');
  const [chantText, setChantText] = useState<string | null>(null);

  // Refs for tracking state between ticks
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCollisionCountRef = useRef(collisionCount);
  const collisionJustHappenedRef = useRef(false);
  const lowSpeedStartRef = useRef<number | null>(null);
  const chantTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest options in refs so the timer callback always sees current values
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const crowdSize = useMemo(() => spectators.length, [spectators]);

  // Detect collision events
  useEffect(() => {
    if (collisionCount > prevCollisionCountRef.current) {
      collisionJustHappenedRef.current = true;
    }
    prevCollisionCountRef.current = collisionCount;
  }, [collisionCount]);

  // Track low speed duration for bored mood
  useEffect(() => {
    if (speed < BORED_SPEED_THRESHOLD) {
      if (lowSpeedStartRef.current === null) {
        lowSpeedStartRef.current = Date.now();
      }
    } else {
      lowSpeedStartRef.current = null;
    }
  }, [speed]);

  // Calculate crowd mood
  const computeCrowdMood = useCallback((): CrowdMood => {
    const opts = optionsRef.current;

    // Shocked takes priority -- collision just happened
    if (collisionJustHappenedRef.current) {
      return 'shocked';
    }

    // Impressed: drifting or very close gap (< 0.5s)
    if (opts.isDrifting || (Math.abs(opts.gapToAI) < 0.5 && Math.abs(opts.gapToAI) > 0)) {
      return 'impressed';
    }

    // Excited: fast and leading
    if (opts.speed > 120 && opts.isLeading) {
      return 'excited';
    }

    // Bored: slow for too long
    if (
      lowSpeedStartRef.current !== null &&
      Date.now() - lowSpeedStartRef.current > BORED_DURATION_MS
    ) {
      return 'bored';
    }

    // Disappointed: far behind AI (gap > 3 seconds)
    if (!opts.isLeading && opts.gapToAI > 3) {
      return 'disappointed';
    }

    // Default: moderate excitement
    if (opts.speed > 80) {
      return 'excited';
    }

    return 'impressed';
  }, []);

  // Determine the most relevant reaction trigger and pick a reaction
  const generateReaction = useCallback((): SpectatorReaction | null => {
    const opts = optionsRef.current;
    const spectator = randomElement(spectators);

    // Priority 1: Collision just happened
    if (collisionJustHappenedRef.current) {
      collisionJustHappenedRef.current = false;
      const reaction = pickReaction(COLLISION_REACTIONS, spectator);
      if (reaction) {
        return {
          spectatorId: spectator.id,
          spectatorName: spectator.name,
          emoji: reaction.emoji,
          comment: reaction.comment,
          timestamp: Date.now(),
        };
      }
    }

    // Priority 2: Drifting
    if (opts.isDrifting) {
      const reaction = pickReaction(DRIFT_REACTIONS, spectator);
      if (reaction) {
        return {
          spectatorId: spectator.id,
          spectatorName: spectator.name,
          emoji: reaction.emoji,
          comment: reaction.comment,
          timestamp: Date.now(),
        };
      }
    }

    // Priority 3: Very high speed
    if (opts.speed > 150) {
      const reaction = pickReaction(SPEED_HIGH_REACTIONS, spectator);
      if (reaction) {
        return {
          spectatorId: spectator.id,
          spectatorName: spectator.name,
          emoji: reaction.emoji,
          comment: reaction.comment,
          timestamp: Date.now(),
        };
      }
    }

    // Priority 4: Very low speed
    if (opts.speed < 10) {
      const reaction = pickReaction(SPEED_LOW_REACTIONS, spectator);
      if (reaction) {
        return {
          spectatorId: spectator.id,
          spectatorName: spectator.name,
          emoji: reaction.emoji,
          comment: reaction.comment,
          timestamp: Date.now(),
        };
      }
    }

    // Priority 5: Position-based (leading vs behind)
    if (opts.isLeading) {
      const reaction = pickReaction(LEADING_REACTIONS, spectator);
      if (reaction) {
        return {
          spectatorId: spectator.id,
          spectatorName: spectator.name,
          emoji: reaction.emoji,
          comment: reaction.comment,
          timestamp: Date.now(),
        };
      }
    } else {
      const reaction = pickReaction(BEHIND_REACTIONS, spectator);
      if (reaction) {
        return {
          spectatorId: spectator.id,
          spectatorName: spectator.name,
          emoji: reaction.emoji,
          comment: reaction.comment,
          timestamp: Date.now(),
        };
      }
    }

    return null;
  }, [spectators]);

  // Schedule the next reaction tick
  const scheduleNextReaction = useCallback(() => {
    if (reactionTimerRef.current !== null) {
      clearTimeout(reactionTimerRef.current);
    }

    reactionTimerRef.current = setTimeout(() => {
      if (!optionsRef.current.enabled) {
        // If disabled, keep scheduling but skip generation
        scheduleNextReaction();
        return;
      }

      // Generate a reaction
      const reaction = generateReaction();
      if (reaction) {
        setReactions(prev => {
          const next = [...prev, reaction];
          // Keep only the last MAX_VISIBLE_REACTIONS
          if (next.length > MAX_VISIBLE_REACTIONS) {
            return next.slice(next.length - MAX_VISIBLE_REACTIONS);
          }
          return next;
        });
      }

      // Update crowd mood
      setCrowdMood(computeCrowdMood());

      // Schedule next
      scheduleNextReaction();
    }, getNextReactionDelay());
  }, [generateReaction, computeCrowdMood]);

  // Manage chant text based on crowd mood
  useEffect(() => {
    if (!enabled) {
      setChantText(null);
      return;
    }

    if (crowdMood === 'excited') {
      // Show a chant, rotate every 4 seconds
      const showChant = () => {
        setChantText(randomElement(CROWD_CHANTS));
      };
      showChant();

      chantTimerRef.current = setInterval(showChant, 4000);
      return () => {
        if (chantTimerRef.current !== null) {
          clearInterval(chantTimerRef.current);
          chantTimerRef.current = null;
        }
      };
    } else {
      setChantText(null);
      if (chantTimerRef.current !== null) {
        clearInterval(chantTimerRef.current);
        chantTimerRef.current = null;
      }
    }
  }, [crowdMood, enabled]);

  // Start reaction loop when enabled, clean up on disable/unmount
  useEffect(() => {
    if (enabled) {
      scheduleNextReaction();
    }

    return () => {
      if (reactionTimerRef.current !== null) {
        clearTimeout(reactionTimerRef.current);
        reactionTimerRef.current = null;
      }
    };
  }, [enabled, scheduleNextReaction]);

  // Clear reactions when disabled
  useEffect(() => {
    if (!enabled) {
      setReactions([]);
      setCrowdMood('excited');
    }
  }, [enabled]);

  // Force mood update on lap change (new lap = excitement spike)
  useEffect(() => {
    if (enabled && currentLap > 1) {
      setCrowdMood('excited');
    }
  }, [currentLap, enabled]);

  // Cleanup chant timer on unmount
  useEffect(() => {
    return () => {
      if (chantTimerRef.current !== null) {
        clearInterval(chantTimerRef.current);
        chantTimerRef.current = null;
      }
    };
  }, []);

  return {
    spectators,
    reactions,
    crowdMood,
    crowdSize,
    chantText,
  };
}

export default useNPCSpectators;
