/**
 * useAINemesis.ts - AI Nemesis System (Wild Idea #17)
 *
 * Shadow of Mordor meets racing. Each AI personality has a name, a backstory,
 * and a grudge level that persists across sessions via localStorage. The AI
 * remembers if it beat you -- and taunts you about it next time.
 *
 * Features:
 * - 8 pre-defined nemesis personalities, each with unique driving style and taunts
 * - Per-nemesis persistent stats (wins, losses, grudge level, best margins)
 * - Contextual taunts that reference race history (win streaks, close margins, grudge)
 * - Arch-rival tracking (the nemesis you have faced the most)
 */
import { useState, useCallback, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'shadow-driver-nemesis';
const GRUDGE_MIN = -100;
const GRUDGE_MAX = 100;

// Grudge deltas (positive = nemesis holds more grudge against player)
const WIN_GRUDGE_DELTA = 8;     // Nemesis gains grudge when player wins
const LOSS_GRUDGE_DELTA = -5;   // Nemesis grudge decreases when nemesis wins
const CLOSE_RACE_BONUS = 3;     // Extra grudge shift for margins < 2s
const DOMINATION_BONUS = 6;     // Extra grudge shift for margins > 10s

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Driving style archetypes */
export type DrivingStyle = 'aggressive' | 'precise' | 'chaotic' | 'defensive' | 'unpredictable';

/** Taunt collections for a nemesis personality */
export interface NemesisTaunts {
  /** Taunts delivered before the race starts */
  preRace: string[];
  /** Taunts delivered after the nemesis wins */
  postWin: string[];
  /** Taunts delivered after the nemesis loses */
  postLoss: string[];
}

/** Static personality definition for a nemesis */
export interface NemesisPersonality {
  /** Unique identifier (e.g., "viktor", "rosa") */
  id: string;
  /** Display name (e.g., "Viktor Coldsteel") */
  name: string;
  /** Short tagline (e.g., "Cold. Precise. Merciless.") */
  tagline: string;
  /** Driving style archetype */
  drivingStyle: DrivingStyle;
  /** 2-3 sentence backstory */
  personality: string;
  /** Taunt collections */
  taunts: NemesisTaunts;
}

/** Persistent per-nemesis stats stored in localStorage */
export interface NemesisStats {
  /** Number of times this nemesis has beaten the player */
  wins: number;
  /** Number of times the player has beaten this nemesis */
  losses: number;
  /** ISO date string of the last encounter */
  lastEncounter: string;
  /** Grudge level from -100 to 100 (positive = more grudge toward player) */
  grudgeLevel: number;
  /** Number of times this nemesis has defeated the player (mirrors wins) */
  timesDefeatedPlayer: number;
  /** Player's closest winning margin against this nemesis in seconds */
  playerBestMargin: number;
}

/** Combined profile: personality + persisted stats */
export interface NemesisProfile extends NemesisPersonality {
  /** Persisted stats for this nemesis */
  stats: NemesisStats;
}

/** Full localStorage data shape: maps nemesis ID to stats */
interface NemesisStorage {
  [nemesisId: string]: NemesisStats;
}

/** Hook return type */
export interface UseAINemesisReturn {
  /** The currently selected nemesis (null if none selected) */
  currentNemesis: NemesisProfile | null;
  /** Full roster of all nemeses with their stats */
  allNemeses: NemesisProfile[];
  /** Select a specific nemesis by ID */
  selectNemesis: (id: string) => void;
  /** Select a random nemesis from the roster */
  selectRandomNemesis: () => void;
  /** Get a contextual pre-race taunt from the current nemesis */
  getPreRaceTaunt: () => string;
  /** Record a race result and update nemesis stats */
  recordResult: (playerWon: boolean, marginSeconds: number) => void;
  /** Get a contextual post-race taunt from the current nemesis */
  getPostRaceTaunt: (playerWon: boolean) => string;
  /** Get the stats for a specific nemesis by ID */
  getNemesisStats: (id: string) => NemesisStats;
  /** Get the nemesis you have faced the most (by total encounters) */
  getArchRival: () => NemesisProfile | null;
  /** Clear all history for a specific nemesis */
  resetNemesis: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Nemesis roster
// ---------------------------------------------------------------------------

const NEMESIS_ROSTER: NemesisPersonality[] = [
  {
    id: 'viktor',
    name: 'Viktor Coldsteel',
    tagline: 'Cold. Precise. Merciless.',
    drivingStyle: 'precise',
    personality:
      'A former test driver for a defunct European automaker, Viktor treats every race like a surgical operation. He never makes a mistake, never wastes a tire, and never forgets a loss. His racing line is mathematically optimal and he wants you to know it.',
    taunts: {
      preRace: [
        'Your racing line last time was... geometrically offensive.',
        'I have reviewed your telemetry. You should be embarrassed.',
        'Precision is not a gift. It is a discipline you clearly lack.',
        'Every apex you miss, I catalogue. The list is extensive.',
        'Shall I slow down so you can study my line? No. I shall not.',
      ],
      postWin: [
        'As predicted. Down to the millisecond.',
        'Your inconsistency is the only consistent thing about you.',
        'I calculated seventeen scenarios. You lost in all of them.',
        'Another data point confirming your inferiority.',
      ],
      postLoss: [
        'A statistical anomaly. Nothing more.',
        'Enjoy it. I have already identified where I can improve.',
        'You won by exploiting chaos. I will close that gap.',
        'Interesting. I will not make that mistake again.',
      ],
    },
  },
  {
    id: 'rosa',
    name: 'Reckless Rosa',
    tagline: 'Full send. Every. Single. Time.',
    drivingStyle: 'chaotic',
    personality:
      'Rosa grew up racing go-karts on the streets of Medellin, where the only rule was "don\'t die." She drives like every corner is her last, brakes are optional, and guardrails are suggestions. Fast, unpredictable, and dangerously fun to race against.',
    taunts: {
      preRace: [
        'Brakes? Where we are going we do not need brakes!',
        'Last time I crashed three times and STILL almost beat you.',
        'I hope you brought spare bumpers, amigo.',
        'The wall and I are old friends. You should be more worried about ME.',
        'Let us see who has more courage and less sense!',
      ],
      postWin: [
        'HAHA! Even with all those crashes I was faster!',
        'You drive like someone who is afraid of paint scratches.',
        'That is what happens when you hesitate. I NEVER hesitate.',
        'I left pieces of my car all over the track and STILL won!',
      ],
      postLoss: [
        'Okay okay, you won. But was it FUN? I had more fun.',
        'Pfft, next time I am taking the shortcut through the wall.',
        'You won the race but I won the highlight reel.',
        'Fine! But at least I looked AMAZING losing.',
      ],
    },
  },
  {
    id: 'phantom',
    name: 'The Phantom',
    tagline: 'Silent until the final lap. Then chaos.',
    drivingStyle: 'unpredictable',
    personality:
      'Nobody knows The Phantom\'s real name or where they came from. They race in eerie silence, maintaining a controlled pace for most of the race, then unleash terrifying speed in the final lap. Some say they are an algorithm that became sentient. Others say they just enjoy the fear in your mirrors.',
    taunts: {
      preRace: [
        '...',
        'You will not see me coming.',
        'The last lap belongs to me.',
      ],
      postWin: [
        'You were never in control.',
        'I let you lead. It makes the ending more satisfying.',
        'The silence before the storm. You should have listened.',
      ],
      postLoss: [
        '...next time.',
        'You escaped. This time.',
        'The shadows are patient.',
      ],
    },
  },
  {
    id: 'grandma',
    name: 'Grandma Turbo',
    tagline: 'Baked cookies. Took your trophy.',
    drivingStyle: 'defensive',
    personality:
      'Retired kindergarten teacher by day, terrifyingly fast street racer by night. Grandma Turbo drives a sensible sedan at insensible speeds. Her taunts are passive-aggressive compliments wrapped in homemade warmth. Do not let the reading glasses fool you -- she has more podiums than birthdays.',
    taunts: {
      preRace: [
        'Oh sweetie, are you sure you want to race? You look tired.',
        'I made muffins for after. You will need the comfort food, dear.',
        'My grandson drives faster than you and he is eight.',
        'Let me just adjust my mirrors... okay, ready to destroy you, honey.',
        'Remember dear, second place still gets a participation ribbon!',
      ],
      postWin: [
        'There there, dear. Not everyone can be fast AND adorable like me.',
        'I would say better luck next time but luck is not your problem.',
        'Do you want a cookie? You look like you need a cookie.',
        'My knitting circle is going to LOVE hearing about this.',
      ],
      postLoss: [
        'Well! You finally beat an old lady. Your parents must be so proud.',
        'I let you win because you looked like you were about to cry.',
        'Enjoy it, sweetie. Grandma is coming back with NEW glasses.',
        'Oh my, I must have left the oven on. That is why I was distracted.',
      ],
    },
  },
  {
    id: 'dj',
    name: 'DJ Downshift',
    tagline: 'Every corner is a drop. Every straight is a build.',
    drivingStyle: 'aggressive',
    personality:
      'Former EDM producer who got bored of making beats and started racing instead. DJ Downshift treats every race like a live performance -- the engine is his bass, the tires are his hi-hats, and the finish line is the drop. He streams every race to his SoundCloud followers.',
    taunts: {
      preRace: [
        'This race is gonna be a BANGER. You ready for the drop?',
        'Warming up the engine... and the bass. Let us GOOOO!',
        'Last race you were off-beat the entire time. Find the rhythm!',
        'Track one, side A: "The Sound of You Losing." Let it play!',
      ],
      postWin: [
        'AND THE CROWD GOES WILD! Another platinum finish!',
        'That finish was smoother than a 128 BPM transition.',
        'You got remixed, my friend. DJ Downshift in the MIX!',
        'I am dropping your race time as my next single. It is a tragedy track.',
      ],
      postLoss: [
        'Okay, that was YOUR track. But the album is MINE.',
        'Every setlist has a slow song. That was it. Next one is a banger.',
        'The remix is always better than the original. See you next race.',
        'I was too busy vibing. Next time I bring the bass.',
      ],
    },
  },
  {
    id: 'crunch',
    name: 'Captain Crunch',
    tagline: 'If you are not crashing, you are not trying.',
    drivingStyle: 'aggressive',
    personality:
      'A demolition derby champion who wandered into circuit racing and never left. Captain Crunch does not just tolerate collisions -- he celebrates them. His car is held together by duct tape and spite. He considers a clean race a personal failure.',
    taunts: {
      preRace: [
        'I polished my bumper just for you. It is going to look great in your door.',
        'Safety briefing: there is none. Let us GO!',
        'My mechanic says I need to stop crashing. I need a new mechanic.',
        'Five crashes is my personal best. Today I am going for six.',
        'Your car looks too clean. Let me fix that.',
      ],
      postWin: [
        'CRUNCH TIME! Did you hear that beautiful impact?!',
        'I won AND I totaled my car. That is what I call efficiency.',
        'They will need a spatula to get your bumper off the barrier.',
        'The insurance company blocked my number but I STILL WIN!',
      ],
      postLoss: [
        'You won but your car looks like modern art now. You are welcome.',
        'I did not lose. The wall just got in my way. Repeatedly.',
        'Victory is temporary. Dents are forever.',
        'At least I had the most spectacular crash. That is worth something.',
      ],
    },
  },
  {
    id: 'professor',
    name: 'The Professor',
    tagline: 'Your driving is a case study in failure.',
    drivingStyle: 'precise',
    personality:
      'A motorsport engineering PhD who races "for research purposes." The Professor treats every race as a peer-reviewed experiment, complete with pre-race hypotheses and post-race analysis. She will explain exactly why you lost, in excruciating academic detail.',
    taunts: {
      preRace: [
        'Hypothesis: you will brake 0.3 seconds too late into turn four. Again.',
        'I have published a paper on your cornering technique. It is in the comedy section.',
        'Today\'s lesson: the racing line. You clearly missed the prerequisite.',
        'My simulations show a 94.7% probability of your defeat. Shall we begin?',
      ],
      postWin: [
        'Results consistent with hypothesis. Your technique remains suboptimal.',
        'I have graded your performance. D minus. See me after class.',
        'The data does not lie. You need approximately 847 more hours of practice.',
        'Publishing findings now: "On the Persistent Mediocrity of Amateur Racers."',
      ],
      postLoss: [
        'Anomalous result. I will need to recalibrate my models.',
        'You have introduced a variable I did not account for: dumb luck.',
        'Peer review will confirm this was a methodological error on my part.',
        'Fascinating. I will incorporate this data into my next simulation.',
      ],
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    tagline: '...',
    drivingStyle: 'unpredictable',
    personality:
      'No one has ever seen Midnight outside of a car. No interviews, no podium celebrations, no social media presence. Just a matte black car that appears at the starting line and vanishes after the race. The only evidence Midnight was ever there is the gap in your timing sheet.',
    taunts: {
      preRace: [
        'You should not have come back.',
        '...',
        'The dark does not forget.',
      ],
      postWin: [
        '...',
        'Gone.',
        'You were never close.',
      ],
      postLoss: [
        'This changes nothing.',
        '...',
        'I will return.',
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultStats(): NemesisStats {
  return {
    wins: 0,
    losses: 0,
    lastEncounter: '',
    grudgeLevel: 0,
    timesDefeatedPlayer: 0,
    playerBestMargin: Infinity,
  };
}

function clampGrudge(value: number): number {
  return Math.max(GRUDGE_MIN, Math.min(GRUDGE_MAX, value));
}

function loadAllStats(): NemesisStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as NemesisStorage;
  } catch {
    return {};
  }
}

function saveAllStats(data: NemesisStorage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore -- private browsing or storage full
  }
}

function loadStatsForNemesis(id: string): NemesisStats {
  const all = loadAllStats();
  if (all[id]) {
    const s = all[id];
    return {
      wins: typeof s.wins === 'number' ? s.wins : 0,
      losses: typeof s.losses === 'number' ? s.losses : 0,
      lastEncounter: typeof s.lastEncounter === 'string' ? s.lastEncounter : '',
      grudgeLevel: typeof s.grudgeLevel === 'number' ? clampGrudge(s.grudgeLevel) : 0,
      timesDefeatedPlayer: typeof s.timesDefeatedPlayer === 'number' ? s.timesDefeatedPlayer : 0,
      playerBestMargin: typeof s.playerBestMargin === 'number' ? s.playerBestMargin : Infinity,
    };
  }
  return createDefaultStats();
}

function saveStatsForNemesis(id: string, stats: NemesisStats): void {
  const all = loadAllStats();
  all[id] = stats;
  saveAllStats(all);
}

function buildProfile(personality: NemesisPersonality): NemesisProfile {
  return {
    ...personality,
    stats: loadStatsForNemesis(personality.id),
  };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAINemesis(): UseAINemesisReturn {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  // Track used taunts within a session to avoid immediate repeats
  const usedTauntsRef = useRef<Record<string, Set<number>>>({});

  // Force re-render when stats change (after recordResult / resetNemesis)
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  // Build profiles on every render; the `revision` state ensures this refreshes
  // after stat mutations. Using void to suppress unused-variable lint warnings.
  void revision;
  const allNemeses: NemesisProfile[] = NEMESIS_ROSTER.map(buildProfile);

  const currentNemesis: NemesisProfile | null =
    currentId ? allNemeses.find((n) => n.id === currentId) ?? null : null;

  // Reset used-taunts tracker when the selected nemesis changes
  useEffect(() => {
    usedTauntsRef.current = {};
  }, [currentId]);

  // ---------------------------
  // selectNemesis
  // ---------------------------
  const selectNemesis = useCallback((id: string) => {
    const found = NEMESIS_ROSTER.find((n) => n.id === id);
    if (found) {
      setCurrentId(id);
    }
  }, []);

  // ---------------------------
  // selectRandomNemesis
  // ---------------------------
  const selectRandomNemesis = useCallback(() => {
    const chosen = pickRandom(NEMESIS_ROSTER);
    setCurrentId(chosen.id);
  }, []);

  // ---------------------------
  // pickTaunt (internal helper)
  // ---------------------------
  /**
   * Pick a taunt from a pool, avoiding repeats within the current session.
   * Falls back to full pool if all lines have been used.
   */
  const pickTaunt = useCallback((pool: string[], poolKey: string): string => {
    if (pool.length === 0) return '';
    if (!usedTauntsRef.current[poolKey]) {
      usedTauntsRef.current[poolKey] = new Set();
    }
    const used = usedTauntsRef.current[poolKey];
    let available = pool.map((_, i) => i).filter((i) => !used.has(i));
    if (available.length === 0) {
      used.clear();
      available = pool.map((_, i) => i);
    }
    const idx = pickRandom(available);
    used.add(idx);
    return pool[idx];
  }, []);

  // ---------------------------
  // getPreRaceTaunt
  // ---------------------------
  const getPreRaceTaunt = useCallback((): string => {
    if (!currentId) return '';
    const profile = allNemeses.find((n) => n.id === currentId);
    if (!profile) return '';

    const { stats, taunts, name } = profile;
    const totalEncounters = stats.wins + stats.losses;

    // First encounter: standard personality taunt
    if (totalEncounters === 0) {
      return pickTaunt(taunts.preRace, 'preRace');
    }

    // Nemesis has a big win streak against player: reference it
    if (stats.timesDefeatedPlayer >= 3 && stats.grudgeLevel < -20) {
      const streakTaunts = [
        `That makes ${stats.timesDefeatedPlayer} times I have beaten you. But who is counting?`,
        `Back for more? I admire the persistence. Not the skill, but the persistence.`,
        `You keep coming back. ${name} respects that. ${name} will still destroy you.`,
      ];
      if (Math.random() < 0.5) {
        return pickRandom(streakTaunts);
      }
    }

    // Player has been dominant: nemesis grudge is high
    if (stats.grudgeLevel > 40) {
      const grudgeTaunts = [
        'I have not forgotten the last time. Not for a second.',
        'You think you are safe because you won before? Think again.',
        'Every loss fuels me. And you have given me PLENTY of fuel.',
      ];
      if (Math.random() < 0.4) {
        return pickRandom(grudgeTaunts);
      }
    }

    // Close rival: reference tight margins
    if (stats.playerBestMargin < 2 && stats.playerBestMargin > 0 && isFinite(stats.playerBestMargin)) {
      const closeTaunts = [
        `Last time you won by ${stats.playerBestMargin.toFixed(1)} seconds. That will not happen again.`,
        `${stats.playerBestMargin.toFixed(1)} seconds. That is all that separated us. Not this time.`,
      ];
      if (Math.random() < 0.3) {
        return pickRandom(closeTaunts);
      }
    }

    // Default: standard personality taunt
    return pickTaunt(taunts.preRace, 'preRace');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, revision, pickTaunt]);

  // ---------------------------
  // recordResult
  // ---------------------------
  const recordResult = useCallback(
    (playerWon: boolean, marginSeconds: number) => {
      if (!currentId) return;

      const stats = loadStatsForNemesis(currentId);

      if (playerWon) {
        stats.losses += 1;
        stats.grudgeLevel = clampGrudge(stats.grudgeLevel + WIN_GRUDGE_DELTA);
        // Track player's best (closest) winning margin
        if (marginSeconds < stats.playerBestMargin) {
          stats.playerBestMargin = marginSeconds;
        }
      } else {
        stats.wins += 1;
        stats.timesDefeatedPlayer += 1;
        stats.grudgeLevel = clampGrudge(stats.grudgeLevel + LOSS_GRUDGE_DELTA);
      }

      // Bonus grudge shifts for dominant or close races
      if (marginSeconds < 2) {
        stats.grudgeLevel = clampGrudge(
          stats.grudgeLevel + (playerWon ? CLOSE_RACE_BONUS : -CLOSE_RACE_BONUS)
        );
      } else if (marginSeconds > 10) {
        stats.grudgeLevel = clampGrudge(
          stats.grudgeLevel + (playerWon ? DOMINATION_BONUS : -DOMINATION_BONUS)
        );
      }

      stats.lastEncounter = new Date().toISOString();
      saveStatsForNemesis(currentId, stats);
      bump();
    },
    [currentId, bump]
  );

  // ---------------------------
  // getPostRaceTaunt
  // ---------------------------
  const getPostRaceTaunt = useCallback(
    (playerWon: boolean): string => {
      if (!currentId) return '';
      const profile = allNemeses.find((n) => n.id === currentId);
      if (!profile) return '';

      const { taunts } = profile;
      // Player won => nemesis lost (postLoss). Nemesis won => postWin.
      if (playerWon) {
        return pickTaunt(taunts.postLoss, 'postLoss');
      } else {
        return pickTaunt(taunts.postWin, 'postWin');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentId, revision, pickTaunt]
  );

  // ---------------------------
  // getNemesisStats
  // ---------------------------
  const getNemesisStats = useCallback((id: string): NemesisStats => {
    return loadStatsForNemesis(id);
  }, []);

  // ---------------------------
  // getArchRival
  // ---------------------------
  const getArchRival = useCallback((): NemesisProfile | null => {
    let maxEncounters = 0;
    let rival: NemesisProfile | null = null;

    for (const profile of allNemeses) {
      const encounters = profile.stats.wins + profile.stats.losses;
      if (encounters > maxEncounters) {
        maxEncounters = encounters;
        rival = profile;
      }
    }

    return rival;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // ---------------------------
  // resetNemesis
  // ---------------------------
  const resetNemesis = useCallback(
    (id: string) => {
      const all = loadAllStats();
      delete all[id];
      saveAllStats(all);
      bump();
    },
    [bump]
  );

  return {
    currentNemesis,
    allNemeses,
    selectNemesis,
    selectRandomNemesis,
    getPreRaceTaunt,
    recordResult,
    getPostRaceTaunt,
    getNemesisStats,
    getArchRival,
    resetNemesis,
  };
}

export default useAINemesis;
