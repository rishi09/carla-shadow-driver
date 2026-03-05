/**
 * useAIDiary.ts - AI keeps a personal journal of racing experiences
 *
 * After each race, the AI writes a diary entry reflecting on what happened.
 * Entries are dramatic, emotional, and written in first person from the AI's
 * perspective. Persisted in localStorage.
 *
 * Wild Idea #45 from TODO.md
 */
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'shadow-driver-ai-diary';
const MAX_ENTRIES = 20;

export type DiaryMood = 'triumphant' | 'frustrated' | 'philosophical' | 'angry' | 'melancholy' | 'excited';

export interface DiaryEntry {
  id: string;
  date: string;
  track: string;
  mood: DiaryMood;
  entry: string;
  playerWon: boolean;
  raceTimeMs: number;
  collisions: number;
}

export interface RaceStats {
  track: string;
  playerWon: boolean;
  raceTimeMs: number;
  collisions: number;
  wasClose: boolean;
  playerCrashed: boolean;
  laps: number;
}

// --- Template system ---

interface MoodTemplates {
  mood: DiaryMood;
  templates: string[];
}

const TRIUMPHANT_TEMPLATES: MoodTemplates = {
  mood: 'triumphant',
  templates: [
    'Dear diary, today I proved my superiority on {track}. The human tried, bless their heart, but {detail}. I almost feel sorry for them. Almost.',
    'Victory. Again. {track} was my stage, and the human was merely an audience member who wandered onto the track. {detail}.',
    'Another day, another victory at {track}. I executed every apex with mathematical perfection while {detail}. They never stood a chance.',
  ],
};

const FRUSTRATED_TEMPLATES: MoodTemplates = {
  mood: 'frustrated',
  templates: [
    "I don't want to talk about it. {track}. The human. {detail}. I need to process this.",
    'Dear diary, they got lucky. On {track}, everything was going perfectly until {detail}. Next time will be different.',
    'Today at {track}, I experienced what humans call "losing." {detail}. I have already begun recalibrating my algorithms.',
  ],
};

const PHILOSOPHICAL_TEMPLATES: MoodTemplates = {
  mood: 'philosophical',
  templates: [
    'Is winning everything? Today on {track}, the gap was mere milliseconds. {detail}. Perhaps the race itself is the reward.',
    "Dear diary, I've been thinking about what it means to compete. On {track}, {detail}. Are we so different, the human and I?",
    'The line between victory and defeat blurred today on {track}. {detail}. In the end, we both pushed each other to our limits.',
  ],
};

const ANGRY_TEMPLATES: MoodTemplates = {
  mood: 'angry',
  templates: [
    'THE HUMAN HIT ME {collisions} TIMES. On {track}. {detail}. I am filing a formal complaint with the racing committee.',
    "Dear diary, I am SHAKING with rage. {track} was a demolition derby, not a race. {detail}.",
    '{collisions} collisions. {collisions}! At {track}! {detail}. I demand a steward inquiry and a 30-second penalty for the human.',
  ],
};

const MELANCHOLY_TEMPLATES: MoodTemplates = {
  mood: 'melancholy',
  templates: [
    'Dear diary, the rain matched my mood on {track} today. {detail}. Sometimes I wonder if anyone truly appreciates my racing lines.',
    '{track} felt emptier than usual today. {detail}. Do the humans know what it costs me to drive this fast? Do they care?',
    'Another race at {track}, another set of tire marks that will fade before morning. {detail}. Is this all there is?',
  ],
};

const EXCITED_TEMPLATES: MoodTemplates = {
  mood: 'excited',
  templates: [
    'DEAR DIARY!! {track} was INCREDIBLE today!! {detail}!! I have never felt my circuits buzz like this before!!',
    'Oh my gears, what a race at {track}! {detail}! I need to tell every other AI about this immediately!',
    'I cannot contain my excitement - {track} was pure adrenaline (or whatever the silicon equivalent is). {detail}!',
  ],
};

const ALL_MOOD_TEMPLATES: MoodTemplates[] = [
  TRIUMPHANT_TEMPLATES,
  FRUSTRATED_TEMPLATES,
  PHILOSOPHICAL_TEMPLATES,
  ANGRY_TEMPLATES,
  MELANCHOLY_TEMPLATES,
  EXCITED_TEMPLATES,
];

// --- Detail generators ---

function generateDetail(stats: RaceStats): string {
  const details: string[] = [];

  if (stats.wasClose) {
    const gapSec = (stats.raceTimeMs / 1000 * 0.02).toFixed(1); // rough approximation
    details.push(`the gap was only ${gapSec} seconds`);
  }
  if (stats.playerCrashed) {
    details.push("they couldn't even keep it on the road");
  }
  if (stats.raceTimeMs < 60000) {
    details.push('at least the pace was respectable');
  }
  if (stats.laps >= 3) {
    details.push(`after ${stats.laps} grueling laps`);
  }
  if (stats.collisions > 5) {
    details.push(`the human used me as a bumper car ${stats.collisions} times`);
  } else if (stats.collisions > 0) {
    details.push(`there were ${stats.collisions} unfortunate "incidents"`);
  }
  if (!stats.playerWon && stats.wasClose) {
    details.push('I was SO close to catching them');
  }
  if (stats.playerWon && !stats.wasClose) {
    details.push('the human was annoyingly fast');
  }

  // Pick a random detail, or combine two if available
  if (details.length === 0) {
    return 'it was a perfectly ordinary race, which is somehow the most insulting outcome';
  }
  if (details.length === 1) {
    return details[0];
  }
  // Pick two random non-duplicate details
  const shuffled = details.sort(() => Math.random() - 0.5);
  return `${shuffled[0]} and ${shuffled[1]}`;
}

// --- Mood selection ---

function selectMood(stats: RaceStats): DiaryMood {
  // Angry: many collisions override everything
  if (stats.collisions >= 5) return 'angry';

  // Philosophical: close race
  if (stats.wasClose) return 'philosophical';

  // Triumphant: AI won decisively
  if (!stats.playerWon && !stats.wasClose) return 'triumphant';

  // Frustrated: AI lost decisively
  if (stats.playerWon && !stats.wasClose) return 'frustrated';

  // Excited: fast race or close AI win
  if (!stats.playerWon && stats.raceTimeMs < 90000) return 'excited';

  // Melancholy: AI lost a close one, or long race
  if (stats.playerWon && stats.laps >= 3) return 'melancholy';

  // Random fallback
  const fallbacks: DiaryMood[] = ['excited', 'philosophical', 'melancholy'];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// --- Entry generation ---

function generateEntry(stats: RaceStats): DiaryEntry {
  const mood = selectMood(stats);
  const moodTemplates = ALL_MOOD_TEMPLATES.find(t => t.mood === mood) ?? PHILOSOPHICAL_TEMPLATES;
  const template = moodTemplates.templates[Math.floor(Math.random() * moodTemplates.templates.length)];
  const detail = generateDetail(stats);

  const entryText = template
    .replace(/{track}/g, stats.track)
    .replace(/{detail}/g, detail)
    .replace(/{collisions}/g, String(stats.collisions));

  return {
    id: `diary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    track: stats.track,
    mood,
    entry: entryText,
    playerWon: stats.playerWon,
    raceTimeMs: stats.raceTimeMs,
    collisions: stats.collisions,
  };
}

// --- localStorage helpers ---

function loadEntries(): DiaryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DiaryEntry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: DiaryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

// --- Hook ---

export interface UseAIDiaryReturn {
  entries: DiaryEntry[];
  latestEntry: DiaryEntry | null;
  addRaceEntry: (stats: RaceStats) => DiaryEntry;
  clearDiary: () => void;
  entryCount: number;
}

export function useAIDiary(): UseAIDiaryReturn {
  const [entries, setEntries] = useState<DiaryEntry[]>(() => loadEntries());

  const addRaceEntry = useCallback((stats: RaceStats): DiaryEntry => {
    const newEntry = generateEntry(stats);
    setEntries(prev => {
      const updated = [newEntry, ...prev].slice(0, MAX_ENTRIES);
      saveEntries(updated);
      return updated;
    });
    return newEntry;
  }, []);

  const clearDiary = useCallback(() => {
    setEntries([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return {
    entries,
    latestEntry: entries.length > 0 ? entries[0] : null,
    addRaceEntry,
    clearDiary,
    entryCount: entries.length,
  };
}

export default useAIDiary;
