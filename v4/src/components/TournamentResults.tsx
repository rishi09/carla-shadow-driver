/**
 * TournamentResults.tsx - Full tournament results view
 *
 * Accessible from the landing page. Shows all tracks, best times,
 * total score, badge, and "Race" buttons for incomplete tracks.
 */
import { useTournaments } from '../hooks/useTournaments.ts';
import type { TournamentBadge } from '../hooks/useTournaments.ts';

const BADGE_ICONS: Record<string, string> = {
  gold: '\uD83E\uDD47',
  silver: '\uD83E\uDD48',
  bronze: '\uD83E\uDD49',
};

const BADGE_LABELS: Record<string, string> = {
  gold: 'Gold -- All tracks under par',
  silver: 'Silver -- All tracks completed',
  bronze: 'Bronze -- Most tracks completed',
};

const BADGE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  gold: { border: 'border-yellow-500/40', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  silver: { border: 'border-gray-400/40', bg: 'bg-gray-400/10', text: 'text-gray-300' },
  bronze: { border: 'border-amber-600/40', bg: 'bg-amber-600/10', text: 'text-amber-500' },
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

function BadgeCard({ badge }: { badge: TournamentBadge }) {
  if (!badge) return null;
  const colors = BADGE_COLORS[badge];
  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-4 text-center`}>
      <div className="text-3xl mb-2">{BADGE_ICONS[badge]}</div>
      <div className={`${colors.text} font-bold text-sm`}>{BADGE_LABELS[badge]}</div>
    </div>
  );
}

interface TournamentResultsProps {
  onClose: () => void;
}

export function TournamentResults({ onClose }: TournamentResultsProps) {
  const tournament = useTournaments();
  const { current, monthLabel, tracksCompleted, totalTracks, badge, totalScore } = tournament;

  const handleRaceTrack = (track: string) => {
    const params = new URLSearchParams();
    const wsUrl = new URLSearchParams(window.location.search).get('ws');
    if (wsUrl) params.set('ws', wsUrl);
    params.set('track', track);
    params.set('laps', String(current.laps));
    params.set('weather', current.weather);
    params.set('model', current.model);
    params.set('timeOfDay', current.timeOfDay);

    window.location.href = `/race?${params.toString()}`;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a0a12] rounded-2xl border border-white/10 max-w-lg w-full p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{current.icon}</span>
            <div>
              <div className={`${current.accentColor} font-bold text-xs uppercase tracking-[0.15em]`}>
                {monthLabel}
              </div>
              <h2 className="text-white font-black text-xl tracking-tight">{current.name}</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/60 transition-colors p-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Description */}
        <p className="text-white/40 text-sm mb-6">{current.description}</p>

        {/* Tournament settings */}
        <div className="flex items-center gap-3 text-xs text-white/30 font-mono mb-6 pb-4 border-b border-white/[0.06]">
          <span>{current.weather === 'storm' ? 'Storm' : current.weather === 'clear' ? 'Clear' : current.weather} weather</span>
          <span className="text-white/10">|</span>
          <span>{current.laps} laps per track</span>
          <span className="text-white/10">|</span>
          <span className={current.accentColor}>{current.difficulty} AI</span>
        </div>

        {/* Badge display */}
        {badge && (
          <div className="mb-6">
            <BadgeCard badge={badge} />
          </div>
        )}

        {/* Track results */}
        <div className="space-y-3 mb-6">
          {current.tracks.map((track, idx) => {
            const bestTime = tournament.getTrackBestTime(track);
            const parTime = tournament.getTrackParTime(track);
            const completed = bestTime !== null;
            const underPar = completed && bestTime <= parTime;

            return (
              <div
                key={track}
                className={`rounded-xl border p-4 ${
                  completed
                    ? underPar
                      ? 'border-green-500/30 bg-green-500/[0.04]'
                      : 'border-white/10 bg-white/[0.02]'
                    : 'border-white/[0.06] bg-white/[0.01]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-white/20 text-xs font-mono w-4">{idx + 1}.</span>
                    <span className="text-white font-bold text-sm">{track}</span>
                    {completed && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={underPar ? '#4ade80' : 'rgba(255,255,255,0.4)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  {!completed ? (
                    <button
                      onClick={() => handleRaceTrack(track)}
                      className="px-3 py-1 rounded-lg text-xs font-bold text-white transition-all hover:scale-105"
                      style={{
                        background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
                        boxShadow: '0 0 10px rgba(34,197,94,0.2)',
                      }}
                    >
                      Race
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRaceTrack(track)}
                      className="px-3 py-1 rounded-lg text-xs font-medium text-white/50 border border-white/10 hover:text-white/80 hover:border-white/20 transition-all"
                    >
                      Retry
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-4 pl-7">
                  {completed ? (
                    <>
                      <div>
                        <span className="text-white/30 text-[10px] font-mono uppercase">Time</span>
                        <div className={`font-mono text-sm font-bold ${underPar ? 'text-green-400' : 'text-white/70'}`}>
                          {formatTime(bestTime)}
                        </div>
                      </div>
                      <div>
                        <span className="text-white/30 text-[10px] font-mono uppercase">Par</span>
                        <div className="font-mono text-sm text-white/30">{formatTime(parTime)}</div>
                      </div>
                      {underPar && (
                        <div>
                          <span className="text-white/30 text-[10px] font-mono uppercase">Under par</span>
                          <div className="font-mono text-sm text-green-400/70">
                            -{formatTime(parTime - bestTime)}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-white/20 text-xs font-mono">
                      Par time: {formatTime(parTime)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Total score */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-white/30 text-xs font-mono uppercase">Total Score</span>
              <div className="text-white font-mono font-bold text-lg">
                {totalScore !== null ? formatTime(totalScore) : '--:--.-'}
              </div>
            </div>
            <div className="text-right">
              <span className="text-white/30 text-xs font-mono uppercase">Progress</span>
              <div className="text-white/60 text-sm font-bold">
                {tracksCompleted}/{totalTracks} tracks
              </div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${(tracksCompleted / totalTracks) * 100}%`,
                background: badge === 'gold'
                  ? 'linear-gradient(90deg, #ffd700, #ffed4a)'
                  : badge === 'silver'
                  ? 'linear-gradient(90deg, #c0c0c0, #e0e0e0)'
                  : 'linear-gradient(90deg, #22C55E, #00D2FF)',
              }}
            />
          </div>
        </div>

        {/* Badge requirements hint */}
        {!badge && (
          <div className="text-center text-white/20 text-xs font-mono space-y-1 mb-6">
            <div>{BADGE_ICONS.bronze} Bronze: Complete {current.tracks.length <= 2 ? 'all' : '2'} tracks</div>
            <div>{BADGE_ICONS.silver} Silver: Complete all {totalTracks} tracks</div>
            <div>{BADGE_ICONS.gold} Gold: Complete all tracks under par time</div>
          </div>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl border border-white/10 text-white/60 font-medium hover:text-white hover:border-white/20 transition-colors text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
