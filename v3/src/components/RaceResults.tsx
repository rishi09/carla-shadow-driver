import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { RaceFinished } from '../types/index.ts';
import type { PersonalBestResult } from '../hooks/usePersonalBests.ts';
import { RacingLineViz } from './RacingLineViz.tsx';
import { RaceResultCard } from './RaceResultCard.tsx';

interface RaceResultsProps {
  result: RaceFinished;
  onPlayAgain: () => void;
  onMainMenu: () => void;
  /** Race settings for instant replay and share link */
  raceSettings?: {
    track: string;
    laps: number;
    weather: string;
    model?: string;
    playerCar?: string;
    timeOfDay?: string;
  };
  /** Instant race again: same settings, skip setup */
  onInstantReplay?: () => void;
  /** Personal best result info */
  personalBestResult?: PersonalBestResult | null;
  /** Whether this was a daily challenge race */
  isDailyChallenge?: boolean;
  /** Daily challenge leaderboard position */
  dailyChallengePosition?: { position: number; total: number; isNewBest: boolean } | null;
  /** Streak info after recording the race */
  streakResult?: { newStreak: number; isNewRecord: boolean } | null;
}

const MEDAL_ICONS: Record<string, string> = {
  gold: '\uD83E\uDD47',
  silver: '\uD83E\uDD48',
  bronze: '\uD83E\uDD49',
};

/** Max number of historical times to keep per track/lap combo */
const MAX_HISTORY = 5;

/** localStorage key for race history */
function historyKey(track: string, laps: number): string {
  return `shadow_driver_race_history_${track}_${laps}`;
}

interface RaceHistoryEntry {
  time: number;
  date: string;
  won: boolean;
}

/** Load race history from localStorage */
function loadHistory(track: string, laps: number): RaceHistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey(track, laps));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RaceHistoryEntry[];
  } catch {
    return [];
  }
}

/** Save a new race time to history, keeping only the last MAX_HISTORY entries */
function saveToHistory(track: string, laps: number, entry: RaceHistoryEntry): RaceHistoryEntry[] {
  const history = loadHistory(track, laps);
  history.push(entry);
  // Keep only the last MAX_HISTORY entries
  const trimmed = history.slice(-MAX_HISTORY);
  try {
    localStorage.setItem(historyKey(track, laps), JSON.stringify(trimmed));
  } catch {
    // localStorage might be full or disabled
  }
  return trimmed;
}

/** Format gap with 3 decimal places when < 1s, 1 decimal otherwise */
function formatGap(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs < 1.0) {
    return abs.toFixed(3);
  }
  return abs.toFixed(1);
}

export function RaceResults({ result, onPlayAgain, onMainMenu, raceSettings, onInstantReplay, personalBestResult, isDailyChallenge, dailyChallengePosition, streakResult }: RaceResultsProps) {
  const playerWon = result.winner === 'player';

  // Staggered reveal animation state
  const [revealStep, setRevealStep] = useState(0);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Share link copied state
  const [shareCopied, setShareCopied] = useState(false);

  // Copy results text state
  const [resultsCopied, setResultsCopied] = useState(false);

  // Race history: load previous attempts and save current one on mount
  const [raceHistory, setRaceHistory] = useState<RaceHistoryEntry[]>([]);
  const historySavedRef = useRef(false);

  useEffect(() => {
    if (!raceSettings || result.player_time == null || historySavedRef.current) return;
    historySavedRef.current = true;

    // Load existing history BEFORE saving current (so we can show previous attempts)
    const previousHistory = loadHistory(raceSettings.track, raceSettings.laps);

    // Save this race to history
    const entry: RaceHistoryEntry = {
      time: result.player_time,
      date: new Date().toISOString(),
      won: playerWon,
    };
    const updated = saveToHistory(raceSettings.track, raceSettings.laps, entry);
    setRaceHistory(updated);

    // Store previous history for "first race" comparison
    if (previousHistory.length > 0) {
      setFirstRaceTime(previousHistory[0].time);
    }
  }, [raceSettings, result.player_time, playerWon]);

  // First race time on this track/lap combo (from history, before this race was added)
  const [firstRaceTime, setFirstRaceTime] = useState<number | null>(null);

  // Compute improvement from first race
  const firstRaceImprovement = useMemo(() => {
    if (firstRaceTime == null || result.player_time == null) return null;
    const diff = firstRaceTime - result.player_time;
    // Only show if meaningful improvement (> 0.1s) and at least 2 races exist
    if (diff <= 0.1) return null;
    return diff;
  }, [firstRaceTime, result.player_time]);

  useEffect(() => {
    // Stagger reveal: increment step every 150ms up to 10 steps
    let step = 0;
    const advance = () => {
      step++;
      setRevealStep(step);
      if (step < 13) {
        revealTimerRef.current = setTimeout(advance, 150);
      }
    };
    // Start with a slight delay for the initial banner
    revealTimerRef.current = setTimeout(advance, 300);

    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, []);

  // Compute derived stats
  const playerBestLap = result.player_laps.length > 0 ? Math.min(...result.player_laps) : null;
  const playerWorstLap = result.player_laps.length > 0 ? Math.max(...result.player_laps) : null;
  const aiBestLap = result.ai_laps.length > 0 ? Math.min(...result.ai_laps) : null;
  const aiWorstLap = result.ai_laps.length > 0 ? Math.max(...result.ai_laps) : null;

  const playerAvgSpeed = result.player_time != null && result.player_distance != null && result.player_time > 0
    ? (result.player_distance / result.player_time) * 3.6 // m/s -> km/h
    : null;
  const aiAvgSpeed = result.ai_time != null && result.ai_distance != null && result.ai_time > 0
    ? (result.ai_distance / result.ai_time) * 3.6
    : null;

  // Build share URL
  const handleShare = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (raceSettings) {
      params.set('track', raceSettings.track);
      params.set('laps', String(raceSettings.laps));
      params.set('weather', raceSettings.weather);
      if (raceSettings.model) params.set('model', raceSettings.model);
      if (raceSettings.playerCar) params.set('playerCar', raceSettings.playerCar);
      if (raceSettings.timeOfDay) params.set('timeOfDay', raceSettings.timeOfDay);
    }
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?${params.toString()}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }).catch(() => {
      // Fallback: just ignore
    });
  }, [raceSettings]);

  // Copy Wordle-style text results to clipboard
  const handleCopyResults = useCallback(() => {
    const DIFFICULTY_MAP: Record<string, string> = {
      carla_pilotnet: 'Easy',
      pilotnet: 'Medium',
      alpamayo: 'Hard',
    };

    const trackName = raceSettings?.track ?? 'Unknown';
    const timeStr = result.player_time != null ? formatRaceTime(result.player_time) : 'DNF';
    const difficulty = raceSettings?.model ? (DIFFICULTY_MAP[raceSettings.model] ?? raceSettings.model) : 'Easy';
    const laps = raceSettings?.laps ?? result.player_laps.length;

    // Gap description
    let gapStr = '';
    if (result.player_time != null && result.ai_time != null) {
      const gap = formatGap(result.player_time - result.ai_time);
      gapStr = playerWon ? `Beat AI by ${gap}s` : `Lost to AI by ${gap}s`;
    }

    const topSpeed = result.player_max_speed != null ? `Top Speed: ${result.player_max_speed.toFixed(0)} km/h` : '';

    const line2Parts = [timeStr, gapStr, topSpeed].filter(Boolean);

    const lines = [
      `Shadow Driver v3 - ${trackName}`,
      line2Parts.join(' | '),
      `${difficulty} | ${laps} laps`,
      `shadow-driver-v3.vercel.app`,
    ];

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setResultsCopied(true);
      setTimeout(() => setResultsCopied(false), 2000);
    }).catch(() => {});
  }, [result, raceSettings, playerWon]);

  // Reveal helper: returns style for staggered animation
  const revealStyle = (step: number): React.CSSProperties => ({
    opacity: revealStep >= step ? 1 : 0,
    transform: revealStep >= step ? 'translateY(0)' : 'translateY(20px)',
    transition: 'opacity 0.4s ease-out, transform 0.4s ease-out',
  });

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      {/* Keyframe animations */}
      <style>{`
        @keyframes victory-glow {
          0% { text-shadow: 0 0 20px rgba(76, 175, 80, 0.5); }
          50% { text-shadow: 0 0 60px rgba(76, 175, 80, 0.8), 0 0 120px rgba(76, 175, 80, 0.4); }
          100% { text-shadow: 0 0 20px rgba(76, 175, 80, 0.5); }
        }
        @keyframes defeat-pulse {
          0% { text-shadow: 0 0 20px rgba(239, 68, 68, 0.5); }
          50% { text-shadow: 0 0 40px rgba(239, 68, 68, 0.7); }
          100% { text-shadow: 0 0 20px rgba(239, 68, 68, 0.5); }
        }
        @keyframes banner-slam {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.1); }
          70% { transform: scale(0.95); }
          100% { transform: scale(1.0); opacity: 1; }
        }
        @keyframes particle-burst {
          0% { transform: translate(0, 0) scale(1); opacity: 1; }
          100% { transform: translate(var(--px), var(--py)) scale(0); opacity: 0; }
        }
        @keyframes stat-highlight {
          0% { background-color: rgba(76, 175, 80, 0.3); }
          100% { background-color: transparent; }
        }
        @keyframes pb-glow {
          0% { text-shadow: 0 0 10px rgba(255, 215, 0, 0.4); }
          50% { text-shadow: 0 0 30px rgba(255, 215, 0, 0.8), 0 0 60px rgba(255, 215, 0, 0.3); }
          100% { text-shadow: 0 0 10px rgba(255, 215, 0, 0.4); }
        }
        @keyframes pb-slide-in {
          0% { transform: translateY(-20px) scale(0.8); opacity: 0; }
          60% { transform: translateY(4px) scale(1.05); }
          100% { transform: translateY(0) scale(1.0); opacity: 1; }
        }
        @keyframes streak-results-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(249, 115, 22, 0.2); }
          50% { box-shadow: 0 0 20px rgba(249, 115, 22, 0.4); }
        }
      `}</style>

      <div className="bg-dark-300 rounded-xl border border-white/10 max-w-lg w-full p-8 text-center relative overflow-hidden">
        {/* Particle burst for victory */}
        {playerWon && revealStep >= 1 && (
          <ParticleBurst />
        )}

        {/* Winner/Loser banner */}
        <div
          style={{
            animation: revealStep >= 1 ? 'banner-slam 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none',
            opacity: revealStep >= 1 ? 1 : 0,
          }}
        >
          <h2
            className={`text-5xl font-black mb-1 tracking-tight ${playerWon ? 'text-player' : 'text-warning'}`}
            style={{
              animation: playerWon ? 'victory-glow 2s ease-in-out infinite' : 'defeat-pulse 2s ease-in-out infinite',
            }}
          >
            {playerWon ? 'VICTORY' : 'DEFEATED'}
          </h2>
          <p className="text-white/50 mb-6 text-sm">
            {playerWon ? 'You beat the AI!' : 'The AI was faster this time.'}
          </p>
        </div>

        {/* Daily Challenge badge */}
        {isDailyChallenge && revealStep >= 1 && (
          <div className="mb-4" style={revealStyle(1)}>
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 border border-amber-500/30 bg-amber-500/10">
              <span className="text-amber-400 text-xs font-bold uppercase tracking-wider">Daily Challenge</span>
              {dailyChallengePosition && (
                <span className="text-amber-400/60 text-xs font-mono">
                  #{dailyChallengePosition.position} of {dailyChallengePosition.total}
                  {dailyChallengePosition.isNewBest && (
                    <span className="text-amber-300 ml-1">-- New Best!</span>
                  )}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Times comparison -- big cards */}
        <div className="grid grid-cols-2 gap-4 mb-6" style={revealStyle(2)}>
          <div className={`rounded-lg p-4 border ${playerWon ? 'bg-player/10 border-player/30' : 'bg-dark-400 border-white/10'}`}>
            <div className="text-white/50 text-xs font-mono uppercase mb-1">Your Time</div>
            <div className="text-white text-2xl font-bold font-mono flex items-center justify-center gap-2">
              {result.player_time != null ? formatRaceTime(result.player_time) : 'DNF'}
              {personalBestResult?.medal && (
                <span className="text-lg" title={`${personalBestResult.medal} medal`}>
                  {MEDAL_ICONS[personalBestResult.medal]}
                </span>
              )}
            </div>
          </div>
          <div className={`rounded-lg p-4 border ${!playerWon ? 'bg-ai/10 border-ai/30' : 'bg-dark-400 border-white/10'}`}>
            <div className="text-white/50 text-xs font-mono uppercase mb-1">AI Time</div>
            <div className="text-white text-2xl font-bold font-mono">
              {result.ai_time != null ? formatRaceTime(result.ai_time) : 'DNF'}
            </div>
          </div>
        </div>

        {/* Personal Best banner */}
        {personalBestResult && revealStep >= 2 && (
          <div style={revealStyle(2)} className="mb-4">
            {personalBestResult.isNewBest ? (
              <div
                className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3"
                style={{ animation: 'pb-slide-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}
              >
                <div
                  className="text-yellow-400 text-lg font-black tracking-wide"
                  style={{ animation: 'pb-glow 2s ease-in-out infinite' }}
                >
                  NEW PERSONAL BEST!
                </div>
                {personalBestResult.previousBest && personalBestResult.improvement != null && (
                  <div className="text-yellow-400/70 text-xs font-mono mt-1">
                    Previous best: {formatRaceTime(personalBestResult.previousBest.time)}
                    <span className="text-green-400 ml-2">
                      {formatGap(personalBestResult.improvement)}s faster
                    </span>
                  </div>
                )}
                {firstRaceImprovement != null && raceHistory.length >= 3 && (
                  <div className="text-yellow-400/50 text-[10px] font-mono mt-1">
                    {firstRaceImprovement.toFixed(1)}s faster than your first race on this track
                  </div>
                )}
              </div>
            ) : personalBestResult.previousBest ? (
              <div className="text-white/40 text-xs font-mono">
                Personal best: {formatRaceTime(personalBestResult.previousBest.time)}
                {result.player_time != null && (
                  <span className="text-warning/70 ml-2">
                    +{(result.player_time - personalBestResult.previousBest.time).toFixed(2)}s
                  </span>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Streak update */}
        {streakResult && streakResult.newStreak > 0 && revealStep >= 3 && (
          <div style={revealStyle(3)} className="mb-4">
            <div
              className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 border ${
                streakResult.isNewRecord
                  ? 'border-orange-400/50 bg-orange-500/15'
                  : 'border-orange-500/30 bg-orange-500/10'
              }`}
              style={streakResult.isNewRecord ? { animation: 'streak-results-glow 2s ease-in-out infinite' } : undefined}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-orange-400">
                <path d="M12 23c-3.6 0-7-2.4-7-7 0-3.1 2.1-5.7 4-7.6l.7-.8c.4-.4 1-.4 1.3.1L13 11l2.5-6.5c.2-.4.6-.6 1-.5.4.1.7.5.7.9V9c2.3 2 4 4.7 4 7.5 0 4.3-3.4 6.5-7 6.5h-2.2z"/>
              </svg>
              <span className="text-orange-400 text-xs font-bold">
                Day {streakResult.newStreak} streak!
              </span>
              {streakResult.isNewRecord && (
                <span className="text-orange-300 text-[10px] font-mono ml-1">New streak record!</span>
              )}
            </div>
          </div>
        )}

        {/* Time difference callout */}
        {result.player_time != null && result.ai_time != null && (
          <div style={revealStyle(3)} className="mb-6">
            <div className={`inline-block rounded-full px-4 py-1.5 text-sm font-mono font-bold border ${
              playerWon
                ? 'bg-player/10 border-player/30 text-player'
                : 'bg-warning/10 border-warning/30 text-warning'
            }`}>
              {playerWon ? '-' : '+'}{formatGap(result.player_time - result.ai_time)}s
              {playerWon ? ' ahead' : ' behind'}
            </div>
          </div>
        )}

        {/* Stats comparison grid */}
        <div className="bg-dark-400/50 rounded-lg p-4 mb-6 text-left" style={revealStyle(4)}>
          <div className="text-white/40 text-xs font-mono uppercase mb-3">Race Statistics</div>
          <div className="grid grid-cols-3 gap-y-2.5 gap-x-3 text-xs font-mono">
            {/* Header */}
            <div className="text-white/30" />
            <div className="text-player/70 font-bold">You</div>
            <div className="text-ai/70 font-bold">AI</div>

            {/* Best Lap */}
            {playerBestLap != null && aiBestLap != null && (
              <div className="contents" style={revealStyle(5)}>
                <div className="text-white/50">Best Lap</div>
                <div className={playerBestLap <= aiBestLap ? 'text-green-400 font-bold' : 'text-white/70'}>
                  {formatRaceTime(playerBestLap)}
                </div>
                <div className={aiBestLap <= playerBestLap ? 'text-green-400 font-bold' : 'text-white/70'}>
                  {formatRaceTime(aiBestLap)}
                </div>
              </div>
            )}

            {/* Worst Lap */}
            {playerWorstLap != null && aiWorstLap != null && result.player_laps.length > 1 && (
              <div className="contents" style={revealStyle(5)}>
                <div className="text-white/50">Worst Lap</div>
                <div className="text-white/70">{formatRaceTime(playerWorstLap)}</div>
                <div className="text-white/70">{formatRaceTime(aiWorstLap)}</div>
              </div>
            )}

            {/* Top Speed */}
            {result.player_max_speed != null && result.ai_max_speed != null && (
              <div className="contents" style={revealStyle(6)}>
                <div className="text-white/50">Top Speed</div>
                <div className={result.player_max_speed >= result.ai_max_speed ? 'text-green-400 font-bold' : 'text-white/70'}>
                  {result.player_max_speed.toFixed(1)} km/h
                </div>
                <div className={result.ai_max_speed >= result.player_max_speed ? 'text-green-400 font-bold' : 'text-white/70'}>
                  {result.ai_max_speed.toFixed(1)} km/h
                </div>
              </div>
            )}

            {/* Average Speed */}
            {playerAvgSpeed != null && aiAvgSpeed != null && (
              <div className="contents" style={revealStyle(6)}>
                <div className="text-white/50">Avg Speed</div>
                <div className={playerAvgSpeed >= aiAvgSpeed ? 'text-green-400 font-bold' : 'text-white/70'}>
                  {playerAvgSpeed.toFixed(1)} km/h
                </div>
                <div className={aiAvgSpeed >= playerAvgSpeed ? 'text-green-400 font-bold' : 'text-white/70'}>
                  {aiAvgSpeed.toFixed(1)} km/h
                </div>
              </div>
            )}

            {/* Distance */}
            {result.player_distance != null && result.ai_distance != null && (
              <div className="contents" style={revealStyle(7)}>
                <div className="text-white/50">Distance</div>
                <div className="text-white/70">{formatDistance(result.player_distance)}</div>
                <div className="text-white/70">{formatDistance(result.ai_distance)}</div>
              </div>
            )}

            {/* Collisions */}
            {result.player_collisions != null && (
              <div className="contents" style={revealStyle(7)}>
                <div className="text-white/50">Collisions</div>
                <div className={`text-white/70 ${result.player_collisions > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                  {result.player_collisions}
                </div>
                <div className="text-white/30">--</div>
              </div>
            )}

            {/* Drift Score */}
            {result.total_drift_score != null && result.total_drift_score > 0 && (
              <div className="contents" style={revealStyle(7)}>
                <div className="text-white/50">Drift Score</div>
                <div className="text-purple-400 font-bold">
                  {result.total_drift_score.toLocaleString()}
                </div>
                <div className="text-white/30">
                  {result.drift_count != null ? `${result.drift_count} drifts` : '--'}
                </div>
              </div>
            )}

            {result.best_single_drift != null && result.best_single_drift > 0 && (
              <div className="contents" style={revealStyle(7)}>
                <div className="text-white/50">Best Drift</div>
                <div className="text-orange-400">
                  {result.best_single_drift.toLocaleString()}
                </div>
                <div className="text-white/30">pts</div>
              </div>
            )}
          </div>
        </div>

        {/* Lap breakdown */}
        {result.player_laps.length > 0 && (
          <div className="bg-dark-400/50 rounded-lg p-4 mb-6 text-left" style={revealStyle(8)}>
            <div className="text-white/40 text-xs font-mono uppercase mb-2">Lap Times</div>
            <div className="grid grid-cols-3 gap-1 text-xs font-mono">
              <div className="text-white/30">Lap</div>
              <div className="text-player/70">You</div>
              <div className="text-ai/70">AI</div>
              {result.player_laps.map((lap, i) => {
                const aiLap = result.ai_laps[i];
                const playerFaster = aiLap != null && lap < aiLap;
                const aiFaster = aiLap != null && aiLap < lap;
                return (
                  <div key={i} className="contents">
                    <div className="text-white/30">{i + 1}</div>
                    <div className={playerFaster ? 'text-green-400 font-bold' : 'text-white/70'}>
                      {formatRaceTime(lap)}
                    </div>
                    <div className={aiFaster ? 'text-green-400 font-bold' : 'text-white/70'}>
                      {aiLap != null ? formatRaceTime(aiLap) : '--'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Time Progression -- last 5 attempts on this track */}
        {raceHistory.length >= 2 && (
          <div className="bg-dark-400/50 rounded-lg p-4 mb-6 text-left" style={revealStyle(9)}>
            <div className="text-white/40 text-xs font-mono uppercase mb-3 flex items-center justify-between">
              <span>Recent Attempts</span>
              {firstRaceImprovement != null && (
                <span className="text-cyan-400/80 font-bold normal-case">
                  {firstRaceImprovement.toFixed(1)}s faster since first race
                </span>
              )}
            </div>
            <TimeProgressionChart history={raceHistory} />
          </div>
        )}

        {/* Racing line visualization */}
        {(result.player_path || result.ai_path) && (
          <div className="mb-6" style={revealStyle(10)}>
            <RacingLineViz
              playerPath={result.player_path}
              aiPath={result.ai_path}
            />
          </div>
        )}

        {/* Shareable race result card */}
        <div className="mb-6" style={revealStyle(11)}>
          <RaceResultCard
            result={result}
            raceSettings={raceSettings}
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-3" style={revealStyle(12)}>
          {/* Instant Race Again (same settings) -- primary action */}
          <button
            onClick={onInstantReplay ?? onPlayAgain}
            className="flex-1 py-3 px-6 bg-gradient-to-r from-player to-ai rounded-lg text-white font-bold hover:opacity-90 transition-opacity text-lg shadow-lg shadow-player/20"
            title="Same track, same settings, instant restart"
          >
            Race Again
          </button>
          <button
            onClick={onPlayAgain}
            className="py-3 px-4 bg-dark-400 border border-white/10 rounded-lg text-white/70 font-medium hover:text-white hover:border-white/20 transition-colors text-sm"
            title="Change track, weather, or AI difficulty"
          >
            Setup
          </button>
          <button
            onClick={onMainMenu}
            className="py-3 px-4 bg-dark-400 border border-white/10 rounded-lg text-white/70 font-medium hover:text-white hover:border-white/20 transition-colors text-sm"
          >
            Exit
          </button>
        </div>

        {/* Share buttons */}
        {raceSettings && (
          <div className="mt-4 flex items-center justify-center gap-4" style={revealStyle(13)}>
            <button
              onClick={handleCopyResults}
              className="text-white/40 hover:text-white/70 text-xs font-mono transition-colors inline-flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {resultsCopied ? 'Copied!' : 'Copy Results'}
            </button>
            <button
              onClick={handleShare}
              className="text-white/40 hover:text-white/70 text-xs font-mono transition-colors inline-flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              {shareCopied ? 'Link copied!' : 'Share race link'}
            </button>
          </div>
        )}

        {/* Keyboard shortcut hint */}
        <div className="mt-3 text-white/20 text-xs font-mono" style={revealStyle(13)}>
          Press Enter to race again
        </div>
      </div>
    </div>
  );
}

/** Victory particle burst effect */
function ParticleBurst() {
  // Generate particles once on mount
  const particles = useRef(
    Array.from({ length: 30 }, () => ({
      px: `${(Math.random() - 0.5) * 300}px`,
      py: `${(Math.random() - 0.5) * 300}px`,
      size: 3 + Math.random() * 6,
      duration: 0.8 + Math.random() * 0.8,
      delay: Math.random() * 0.3,
      color: [
        '#4CAF50', '#81C784', '#FFD700', '#FFE44D', '#66BB6A', '#A5D6A7',
      ][Math.floor(Math.random() * 6)],
    }))
  ).current;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-1/3 rounded-full"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            '--px': p.px,
            '--py': p.py,
            animation: `particle-burst ${p.duration}s ease-out ${p.delay}s forwards`,
            opacity: 0.8,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/** Mini sparkline chart showing time progression over recent attempts */
function TimeProgressionChart({ history }: { history: RaceHistoryEntry[] }) {
  const times = history.map(h => h.time);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const range = maxTime - minTime;

  // Chart dimensions
  const chartWidth = 100; // percentage-based
  const chartHeight = 40; // px
  const padding = 4;

  // Normalize time to y position (lower time = higher on chart = better)
  const normalize = (t: number): number => {
    if (range === 0) return chartHeight / 2;
    return padding + ((t - minTime) / range) * (chartHeight - padding * 2);
  };

  // Show delta from previous for each attempt
  const deltas: (number | null)[] = times.map((t, i) => {
    if (i === 0) return null;
    return times[i - 1] - t; // positive = improvement
  });

  return (
    <div>
      {/* Mini sparkline */}
      <div
        className="relative w-full rounded bg-dark-500/50 border border-white/5 mb-2"
        style={{ height: chartHeight + 8 }}
      >
        {/* Best time line */}
        <div
          className="absolute left-0 right-0 border-t border-dashed border-green-500/20"
          style={{ top: normalize(minTime) + 4 }}
        />
        {/* SVG sparkline */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${(times.length - 1) * 100} ${chartHeight + 8}`}
          preserveAspectRatio="none"
        >
          {/* Line path */}
          <polyline
            fill="none"
            stroke="url(#sparkline-gradient)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={times.map((t, i) => {
              const x = times.length === 1 ? 50 : (i / (times.length - 1)) * ((times.length - 1) * 100);
              const y = normalize(t) + 4;
              return `${x},${y}`;
            }).join(' ')}
          />
          {/* Gradient */}
          <defs>
            <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
              <stop offset="100%" stopColor="rgba(74,222,128,0.8)" />
            </linearGradient>
          </defs>
          {/* Data points */}
          {times.map((t, i) => {
            const x = times.length === 1 ? 50 : (i / (times.length - 1)) * ((times.length - 1) * 100);
            const y = normalize(t) + 4;
            const isBest = t === minTime;
            const isLatest = i === times.length - 1;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={isLatest ? 4 : 3}
                fill={isBest ? '#4ade80' : isLatest ? '#60a5fa' : 'rgba(255,255,255,0.4)'}
                stroke={isLatest ? '#60a5fa' : 'none'}
                strokeWidth={isLatest ? 2 : 0}
              />
            );
          })}
        </svg>
      </div>

      {/* Time labels row */}
      <div className="flex justify-between items-end gap-1">
        {history.map((entry, i) => {
          const isBest = entry.time === minTime;
          const isLatest = i === history.length - 1;
          const delta = deltas[i];
          return (
            <div key={i} className="flex-1 text-center">
              <div className={`text-[10px] font-mono ${
                isLatest ? 'text-blue-400 font-bold' : isBest ? 'text-green-400 font-bold' : 'text-white/40'
              }`}>
                {formatRaceTime(entry.time)}
              </div>
              {delta != null && (
                <div className={`text-[9px] font-mono ${
                  delta > 0 ? 'text-green-500/70' : delta < 0 ? 'text-red-400/70' : 'text-white/20'
                }`}>
                  {delta > 0 ? '-' : '+'}{formatGap(delta)}s
                </div>
              )}
              {delta == null && (
                <div className="text-[9px] font-mono text-white/15">1st</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatRaceTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}
