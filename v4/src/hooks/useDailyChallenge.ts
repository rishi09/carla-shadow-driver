/**
 * useDailyChallenge.ts - Deterministic daily race challenge
 *
 * Generates a daily challenge config from a date-based seed.
 * The seed is deterministic: Math.floor(Date.now() / 86400000) picks track + weather.
 * Always 3 laps, Medium difficulty.
 *
 * Daily challenge results are stored in localStorage for leaderboard display.
 */

// Available options for daily challenge selection
const DAILY_TRACKS = ['Town03', 'Town04', 'Town01', 'Town05', 'Town02', 'Town10HD'];
const DAILY_WEATHER = ['clear', 'cloudy', 'rain', 'sunset', 'night'];
const DAILY_TIME_OF_DAY = ['morning', 'noon', 'sunset', 'night'];

export interface DailyChallengeConfig {
  track: string;
  weather: string;
  laps: number;
  difficulty: string;
  model: string;
  timeOfDay: string;
  /** The day seed used to generate this config */
  daySeed: number;
  /** Human-readable date string (e.g., "Feb 19, 2026") */
  dateLabel: string;
}

export interface DailyChallengeResult {
  time: number;
  date: string;    // ISO date string
  daySeed: number;
}

const DAILY_RESULTS_KEY = 'shadow-driver-daily';

/**
 * Simple seeded pseudo-random number generator (mulberry32).
 * Returns a function that produces deterministic floats in [0, 1).
 */
function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Get today's daily challenge configuration.
 * Deterministic: same config for everyone on the same UTC day.
 */
export function getDailyChallenge(): DailyChallengeConfig {
  const daySeed = Math.floor(Date.now() / 86400000);
  const rng = seededRandom(daySeed);

  const trackIndex = Math.floor(rng() * DAILY_TRACKS.length);
  const weatherIndex = Math.floor(rng() * DAILY_WEATHER.length);
  const timeOfDayIndex = Math.floor(rng() * DAILY_TIME_OF_DAY.length);

  // Format today's date for display
  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return {
    track: DAILY_TRACKS[trackIndex],
    weather: DAILY_WEATHER[weatherIndex],
    laps: 3,
    difficulty: 'Medium',
    model: 'pilotnet',
    timeOfDay: DAILY_TIME_OF_DAY[timeOfDayIndex],
    daySeed,
    dateLabel,
  };
}

/**
 * Load daily challenge results from localStorage.
 */
function loadDailyResults(): DailyChallengeResult[] {
  try {
    const raw = localStorage.getItem(DAILY_RESULTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DailyChallengeResult[];
  } catch {
    return [];
  }
}

/**
 * Save a daily challenge result to localStorage.
 * Only saves if it's a better time than existing for the same daySeed.
 */
export function saveDailyChallengeResult(time: number, daySeed: number): { position: number; total: number; isNewBest: boolean } {
  const results = loadDailyResults();

  // Find existing result for this day
  const existingIndex = results.findIndex(r => r.daySeed === daySeed);
  let isNewBest = false;

  if (existingIndex >= 0) {
    if (time < results[existingIndex].time) {
      results[existingIndex] = { time, date: new Date().toISOString(), daySeed };
      isNewBest = true;
    }
  } else {
    results.push({ time, date: new Date().toISOString(), daySeed });
    isNewBest = true;
  }

  try {
    localStorage.setItem(DAILY_RESULTS_KEY, JSON.stringify(results));
  } catch {
    // localStorage might be full
  }

  // Compute position: how many past daily results are faster
  const todayResults = results.filter(r => r.daySeed === daySeed);
  const currentTime = todayResults.length > 0 ? todayResults[0].time : time;
  const allTimes = results.map(r => r.time).sort((a, b) => a - b);
  const position = allTimes.findIndex(t => t >= currentTime) + 1;

  return { position, total: allTimes.length, isNewBest };
}

/**
 * Get the best time for today's daily challenge, or null if not completed.
 */
export function getDailyBest(daySeed: number): DailyChallengeResult | null {
  const results = loadDailyResults();
  return results.find(r => r.daySeed === daySeed) ?? null;
}
