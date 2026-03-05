/**
 * useTournaments.ts - Seasonal tournament system
 *
 * Monthly themed events with multi-track racing.
 * All state is persisted in localStorage.
 *
 * Tournament rotation (6-month cycle):
 *   Month 0 (Jan): Night Sprint Series   - Town01, Town02, Town03 - Night  - 2 laps - Easy
 *   Month 1 (Feb): Storm Championship     - Town04, Town05, Town07 - Rain   - 3 laps - Easy
 *   Month 2 (Mar): Speed Demon Classic    - Town01, Town10HD       - Clear  - 5 laps - Easy
 *   Month 3 (Apr): Night Sprint Series    - Town01, Town02, Town03 - Night  - 2 laps - Hard
 *   Month 4 (May): Storm Championship     - Town04, Town05, Town07 - Rain   - 3 laps - Hard
 *   Month 5 (Jun): Speed Demon Classic    - Town01, Town10HD       - Clear  - 5 laps - Hard
 *   (repeats every 6 months)
 *
 * Badges:
 *   Gold   - Complete all tracks under par time
 *   Silver - Complete all tracks
 *   Bronze - Complete at least 2 tracks (or all minus 1 for 2-track tournaments)
 */
import { useCallback, useState, useEffect } from 'react';

const STORAGE_KEY = 'shadow-driver-v3-tournaments';

// Par times per lap per track (in seconds) - same as leaderboard
const TRACK_PAR_TIMES: Record<string, number> = {
  'Town01': 40,
  'Town02': 35,
  'Town03': 45,
  'Town04': 50,
  'Town05': 42,
  'Town07': 48,
  'Town10HD': 38,
};

export interface TournamentDefinition {
  /** Unique id based on rotation index */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Tracks to race */
  tracks: string[];
  /** Weather preset */
  weather: string;
  /** Laps per track */
  laps: number;
  /** AI difficulty model id */
  model: string;
  /** Difficulty label */
  difficulty: 'Easy' | 'Hard';
  /** Time of day */
  timeOfDay: string;
  /** Icon for the tournament theme */
  icon: string;
  /** Accent color class for UI */
  accentColor: string;
  /** Border color class */
  borderColor: string;
}

export type TournamentBadge = 'gold' | 'silver' | 'bronze' | null;

export interface TournamentTrackResult {
  track: string;
  bestTime: number;
  date: string;
}

export interface TournamentProgress {
  /** Tournament id this progress belongs to */
  tournamentId: string;
  /** Month key (YYYY-MM) to scope results to the correct month */
  monthKey: string;
  /** Best times per track */
  trackResults: TournamentTrackResult[];
  /** Badge earned */
  badge: TournamentBadge;
}

interface StoredData {
  progress: TournamentProgress[];
}

// --- Tournament definitions (3 base events, repeated with Hard difficulty) ---

const BASE_TOURNAMENTS: Omit<TournamentDefinition, 'id' | 'model' | 'difficulty'>[] = [
  {
    name: 'Night Sprint Series',
    description: 'Race through the darkness. Three night tracks, minimal visibility, pure skill.',
    tracks: ['Town01', 'Town02', 'Town03'],
    weather: 'clear',
    laps: 2,
    timeOfDay: 'night',
    icon: '\uD83C\uDF19',
    accentColor: 'text-indigo-400',
    borderColor: 'border-indigo-500/30',
  },
  {
    name: 'Storm Championship',
    description: 'Conquer the rain. Three tracks in brutal weather conditions.',
    tracks: ['Town04', 'Town05', 'Town07'],
    weather: 'storm',
    laps: 3,
    timeOfDay: 'storm',
    icon: '\u26C8',
    accentColor: 'text-cyan-400',
    borderColor: 'border-cyan-500/30',
  },
  {
    name: 'Speed Demon Classic',
    description: 'Clear skies, long races. Two tracks, five laps each. Pure endurance.',
    tracks: ['Town01', 'Town10HD'],
    weather: 'clear',
    laps: 5,
    timeOfDay: 'noon',
    icon: '\u26A1',
    accentColor: 'text-amber-400',
    borderColor: 'border-amber-500/30',
  },
];

/** Generate all 6 tournament definitions (3 easy + 3 hard) */
function buildTournamentDefinitions(): TournamentDefinition[] {
  const result: TournamentDefinition[] = [];
  const difficulties: Array<{ model: string; difficulty: 'Easy' | 'Hard' }> = [
    { model: 'carla_pilotnet', difficulty: 'Easy' },
    { model: 'alpamayo', difficulty: 'Hard' },
  ];

  for (const diff of difficulties) {
    for (let i = 0; i < BASE_TOURNAMENTS.length; i++) {
      const base = BASE_TOURNAMENTS[i];
      result.push({
        ...base,
        id: `${diff.difficulty.toLowerCase()}_${i}`,
        model: diff.model,
        difficulty: diff.difficulty,
      });
    }
  }
  return result;
}

const ALL_TOURNAMENTS = buildTournamentDefinitions();

/** Get the current month key in YYYY-MM format */
function getMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Get the current tournament based on the month */
export function getCurrentTournament(): TournamentDefinition {
  const month = new Date().getMonth(); // 0-11
  const index = month % ALL_TOURNAMENTS.length;
  return ALL_TOURNAMENTS[index];
}

/** Get the month label for the current tournament */
export function getTournamentMonthLabel(): string {
  const now = new Date();
  return now.toLocaleString('default', { month: 'long', year: 'numeric' });
}

/** Calculate par time for a tournament track */
function getTrackParTime(track: string, laps: number): number {
  const parPerLap = TRACK_PAR_TIMES[track] ?? 45;
  return parPerLap * laps;
}

/** Determine badge based on track results */
function calculateBadge(tournament: TournamentDefinition, trackResults: TournamentTrackResult[]): TournamentBadge {
  const totalTracks = tournament.tracks.length;
  const completedTracks = trackResults.length;

  // Bronze: complete at least 2 tracks (or all minus 1 for 2-track tournaments)
  const bronzeThreshold = totalTracks <= 2 ? totalTracks : 2;

  if (completedTracks < bronzeThreshold) return null;

  // Check if all tracks are completed
  const allCompleted = completedTracks >= totalTracks;

  if (allCompleted) {
    // Gold: all tracks completed under par
    const allUnderPar = tournament.tracks.every(track => {
      const result = trackResults.find(r => r.track === track);
      if (!result) return false;
      const par = getTrackParTime(track, tournament.laps);
      return result.bestTime <= par;
    });

    if (allUnderPar) return 'gold';
    return 'silver';
  }

  return 'bronze';
}

// --- localStorage helpers ---

function loadData(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { progress: [] };
    return JSON.parse(raw) as StoredData;
  } catch {
    return { progress: [] };
  }
}

function saveData(data: StoredData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage might be full or disabled
  }
}

// --- Hook ---

export interface UseTournamentsReturn {
  /** Current month's tournament definition */
  current: TournamentDefinition;
  /** Month label (e.g. "February 2026") */
  monthLabel: string;
  /** Current tournament progress */
  progress: TournamentProgress | null;
  /** Number of tracks completed */
  tracksCompleted: number;
  /** Total tracks in tournament */
  totalTracks: number;
  /** Badge earned for current tournament */
  badge: TournamentBadge;
  /** Total score (sum of best times) -- null if no tracks completed */
  totalScore: number | null;
  /** Check if a track+laps+weather+model combo matches the current tournament */
  isCurrentTournamentRace: (track: string, laps: number, weather: string, model?: string) => boolean;
  /** Record a tournament race result. Returns updated badge. */
  recordResult: (track: string, time: number) => TournamentBadge;
  /** Get best time for a specific tournament track */
  getTrackBestTime: (track: string) => number | null;
  /** Get par time for a specific tournament track */
  getTrackParTime: (track: string) => number;
  /** Check if a track time is under par */
  isUnderPar: (track: string, time: number) => boolean;
  /** Get all historical tournament progress (for viewing past results) */
  allProgress: TournamentProgress[];
}

export function useTournaments(): UseTournamentsReturn {
  const [data, setData] = useState<StoredData>(loadData);

  // Sync to localStorage
  useEffect(() => {
    saveData(data);
  }, [data]);

  const current = getCurrentTournament();
  const monthKey = getMonthKey();
  const monthLabel = getTournamentMonthLabel();

  // Find or create current month's progress
  const progress = data.progress.find(
    p => p.tournamentId === current.id && p.monthKey === monthKey
  ) ?? null;

  const tracksCompleted = progress?.trackResults.length ?? 0;
  const totalTracks = current.tracks.length;
  const badge = progress?.badge ?? null;

  const totalScore = progress && progress.trackResults.length > 0
    ? progress.trackResults.reduce((sum, r) => sum + r.bestTime, 0)
    : null;

  const isCurrentTournamentRace = useCallback((track: string, laps: number, _weather: string, model?: string): boolean => {
    if (!current.tracks.includes(track)) return false;
    if (laps !== current.laps) return false;
    // Weather can differ slightly (e.g. storm vs rain) -- be lenient
    // Model must match for difficulty
    if (model && model !== current.model) return false;
    return true;
  }, [current]);

  const recordResult = useCallback((track: string, time: number): TournamentBadge => {
    setData(prev => {
      const newData = { ...prev, progress: [...prev.progress] };

      // Find or create progress for current tournament+month
      let progressIndex = newData.progress.findIndex(
        p => p.tournamentId === current.id && p.monthKey === monthKey
      );

      let currentProgress: TournamentProgress;
      if (progressIndex === -1) {
        currentProgress = {
          tournamentId: current.id,
          monthKey: monthKey,
          trackResults: [],
          badge: null,
        };
        newData.progress.push(currentProgress);
        progressIndex = newData.progress.length - 1;
      } else {
        currentProgress = { ...newData.progress[progressIndex] };
        currentProgress.trackResults = [...currentProgress.trackResults];
        newData.progress[progressIndex] = currentProgress;
      }

      // Update or add track result
      const existingIdx = currentProgress.trackResults.findIndex(r => r.track === track);
      if (existingIdx !== -1) {
        const existing = currentProgress.trackResults[existingIdx];
        if (time < existing.bestTime) {
          currentProgress.trackResults[existingIdx] = {
            track,
            bestTime: time,
            date: new Date().toISOString(),
          };
        }
      } else {
        currentProgress.trackResults.push({
          track,
          bestTime: time,
          date: new Date().toISOString(),
        });
      }

      // Recalculate badge
      currentProgress.badge = calculateBadge(current, currentProgress.trackResults);

      // Keep only the last 12 months of progress to prevent unbounded growth
      if (newData.progress.length > 12) {
        newData.progress = newData.progress.slice(-12);
      }

      return newData;
    });

    // Return the new badge (calculate it eagerly for the caller)
    const updatedProgress = (() => {
      const d = loadData();
      const p = d.progress.find(
        p => p.tournamentId === current.id && p.monthKey === monthKey
      );
      return p;
    })();

    // We need to recalculate since state update is async
    if (updatedProgress) {
      return calculateBadge(current, updatedProgress.trackResults);
    }
    return null;
  }, [current, monthKey]);

  const getTrackBestTime = useCallback((track: string): number | null => {
    if (!progress) return null;
    const result = progress.trackResults.find(r => r.track === track);
    return result?.bestTime ?? null;
  }, [progress]);

  const getTrackParTimeFn = useCallback((track: string): number => {
    return getTrackParTime(track, current.laps);
  }, [current.laps]);

  const isUnderPar = useCallback((track: string, time: number): boolean => {
    const par = getTrackParTime(track, current.laps);
    return time <= par;
  }, [current.laps]);

  return {
    current,
    monthLabel,
    progress,
    tracksCompleted,
    totalTracks,
    badge,
    totalScore,
    isCurrentTournamentRace,
    recordResult,
    getTrackBestTime,
    getTrackParTime: getTrackParTimeFn,
    isUnderPar,
    allProgress: data.progress,
  };
}
