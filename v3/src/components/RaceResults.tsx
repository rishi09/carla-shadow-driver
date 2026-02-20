import { useState, useEffect, useRef, useCallback } from 'react';
import type { RaceFinished } from '../types/index.ts';
import type { PersonalBestResult } from '../hooks/usePersonalBests.ts';
import { RacingLineViz } from './RacingLineViz.tsx';

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
  };
  /** Instant race again: same settings, skip setup */
  onInstantReplay?: () => void;
  /** Personal best result info */
  personalBestResult?: PersonalBestResult | null;
}

const MEDAL_ICONS: Record<string, string> = {
  gold: '\uD83E\uDD47',
  silver: '\uD83E\uDD48',
  bronze: '\uD83E\uDD49',
};

export function RaceResults({ result, onPlayAgain, onMainMenu, raceSettings, onInstantReplay, personalBestResult }: RaceResultsProps) {
  const playerWon = result.winner === 'player';

  // Staggered reveal animation state
  const [revealStep, setRevealStep] = useState(0);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Share link copied state
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    // Stagger reveal: increment step every 150ms up to 10 steps
    let step = 0;
    const advance = () => {
      step++;
      setRevealStep(step);
      if (step < 10) {
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
                      Improved by {personalBestResult.improvement.toFixed(2)}s
                    </span>
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

        {/* Time difference callout */}
        {result.player_time != null && result.ai_time != null && (
          <div style={revealStyle(3)} className="mb-6">
            <div className={`inline-block rounded-full px-4 py-1.5 text-sm font-mono font-bold border ${
              playerWon
                ? 'bg-player/10 border-player/30 text-player'
                : 'bg-warning/10 border-warning/30 text-warning'
            }`}>
              {playerWon ? '-' : '+'}{Math.abs(result.player_time - result.ai_time).toFixed(1)}s
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

        {/* Racing line visualization */}
        {(result.player_path || result.ai_path) && (
          <div className="mb-6" style={revealStyle(9)}>
            <RacingLineViz
              playerPath={result.player_path}
              aiPath={result.ai_path}
            />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3" style={revealStyle(9)}>
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

        {/* Share button */}
        {raceSettings && (
          <div className="mt-4" style={revealStyle(10)}>
            <button
              onClick={handleShare}
              className="text-white/40 hover:text-white/70 text-xs font-mono transition-colors inline-flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              {shareCopied ? 'Link copied!' : 'Share this race'}
            </button>
          </div>
        )}

        {/* Keyboard shortcut hint */}
        <div className="mt-3 text-white/20 text-xs font-mono" style={revealStyle(10)}>
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
