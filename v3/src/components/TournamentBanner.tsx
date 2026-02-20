/**
 * TournamentBanner.tsx - Current tournament card for the landing page
 *
 * Shows the active monthly tournament with progress and an "Enter" button.
 */
import { useTournaments } from '../hooks/useTournaments.ts';
import type { TournamentBadge } from '../hooks/useTournaments.ts';

const BADGE_ICONS: Record<string, string> = {
  gold: '\uD83E\uDD47',
  silver: '\uD83E\uDD48',
  bronze: '\uD83E\uDD49',
};

const BADGE_LABELS: Record<string, string> = {
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
};

function BadgeDisplay({ badge }: { badge: TournamentBadge }) {
  if (!badge) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border"
      style={{
        borderColor: badge === 'gold' ? 'rgba(255,215,0,0.4)' : badge === 'silver' ? 'rgba(192,192,192,0.4)' : 'rgba(205,127,50,0.4)',
        backgroundColor: badge === 'gold' ? 'rgba(255,215,0,0.1)' : badge === 'silver' ? 'rgba(192,192,192,0.1)' : 'rgba(205,127,50,0.1)',
        color: badge === 'gold' ? '#ffd700' : badge === 'silver' ? '#c0c0c0' : '#cd7f32',
      }}
    >
      {BADGE_ICONS[badge]} {BADGE_LABELS[badge]}
    </span>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

interface TournamentBannerProps {
  /** Whether to show the full results view or just the banner */
  compact?: boolean;
}

export function TournamentBanner({ compact }: TournamentBannerProps) {
  const tournament = useTournaments();
  const { current, monthLabel, tracksCompleted, totalTracks, badge, totalScore } = tournament;

  // Build URL to enter the tournament (navigates to /race with pre-filled settings for first incomplete track)
  const handleEnter = () => {
    // Find first incomplete track
    const firstIncomplete = current.tracks.find(track => tournament.getTrackBestTime(track) === null);
    const targetTrack = firstIncomplete ?? current.tracks[0];

    const params = new URLSearchParams();
    const wsUrl = new URLSearchParams(window.location.search).get('ws');
    if (wsUrl) params.set('ws', wsUrl);
    params.set('track', targetTrack);
    params.set('laps', String(current.laps));
    params.set('weather', current.weather);
    params.set('model', current.model);
    params.set('timeOfDay', current.timeOfDay);

    window.location.href = `/race?${params.toString()}`;
  };

  if (compact) {
    return (
      <button
        onClick={handleEnter}
        className={`w-full p-4 rounded-xl border ${current.borderColor} bg-gradient-to-r from-white/[0.03] to-white/[0.01] hover:from-white/[0.06] hover:to-white/[0.03] transition-all text-left group`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{current.icon}</span>
            <span className={`${current.accentColor} font-bold text-sm uppercase tracking-wider`}>
              Monthly Tournament
            </span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
        <div className="text-white font-bold text-base mb-1">{current.name}</div>
        <div className="flex items-center gap-3 text-xs text-white/40">
          <span>{current.tracks.length} tracks</span>
          <span className="text-white/15">|</span>
          <span>{current.laps} laps each</span>
          <span className="text-white/15">|</span>
          <span className={current.accentColor}>{current.difficulty}</span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          {/* Progress bar */}
          <div className="flex-1 mr-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white/50 text-xs font-mono">
                {tracksCompleted}/{totalTracks} tracks
              </span>
              {badge && <BadgeDisplay badge={badge} />}
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
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
          {totalScore !== null && (
            <span className="text-white/30 text-xs font-mono whitespace-nowrap">
              {formatTime(totalScore)}
            </span>
          )}
        </div>
        <div className="mt-1 text-white/20 text-[10px] font-mono">{monthLabel}</div>
      </button>
    );
  }

  // Full banner (used on landing page)
  return (
    <div className="w-full max-w-5xl mx-auto">
      <div
        className={`rounded-2xl border ${current.borderColor} bg-gradient-to-r from-white/[0.03] to-white/[0.01] p-6 sm:p-8 relative overflow-hidden`}
      >
        {/* Background glow */}
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            background: `radial-gradient(ellipse 60% 50% at 80% 50%, ${
              current.accentColor.includes('indigo') ? 'rgba(99,102,241,0.15)' :
              current.accentColor.includes('cyan') ? 'rgba(34,211,238,0.15)' :
              'rgba(251,191,36,0.15)'
            } 0%, transparent 70%)`,
          }}
        />

        <div className="relative z-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl sm:text-3xl">{current.icon}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`${current.accentColor} font-bold text-xs sm:text-sm uppercase tracking-[0.15em]`}>
                    Monthly Tournament
                  </span>
                  <span className="text-white/15 text-xs font-mono">{monthLabel}</span>
                </div>
                <h3 className="text-white font-black text-xl sm:text-2xl tracking-tight mt-0.5">
                  {current.name}
                </h3>
              </div>
            </div>
            {badge && <BadgeDisplay badge={badge} />}
          </div>

          {/* Description */}
          <p className="text-white/40 text-sm mb-5 max-w-lg">{current.description}</p>

          {/* Track list with progress */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            {current.tracks.map((track) => {
              const bestTime = tournament.getTrackBestTime(track);
              const parTime = tournament.getTrackParTime(track);
              const completed = bestTime !== null;
              const underPar = completed && bestTime <= parTime;

              return (
                <div
                  key={track}
                  className={`rounded-lg border p-3 ${
                    completed
                      ? underPar
                        ? 'border-green-500/30 bg-green-500/[0.06]'
                        : 'border-white/15 bg-white/[0.04]'
                      : 'border-white/[0.06] bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-medium text-sm">{track}</span>
                    {completed ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={underPar ? '#4ade80' : '#fff'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: underPar ? 1 : 0.4 }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <span className="w-3 h-3 rounded-full border border-white/20" />
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    {completed ? (
                      <span className={`text-xs font-mono ${underPar ? 'text-green-400' : 'text-white/60'}`}>
                        {formatTime(bestTime)}
                      </span>
                    ) : (
                      <span className="text-xs text-white/25 font-mono">Not raced</span>
                    )}
                    <span className="text-xs text-white/20 font-mono">
                      Par: {formatTime(parTime)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer: progress bar + enter button */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-white/50 text-xs font-mono">
                  {tracksCompleted}/{totalTracks} completed
                </span>
                {totalScore !== null && (
                  <span className="text-white/30 text-xs font-mono">
                    Total: {formatTime(totalScore)}
                  </span>
                )}
              </div>
              <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
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
            <button
              onClick={handleEnter}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 hover:scale-105 ${
                tracksCompleted >= totalTracks
                  ? 'bg-white/10 border border-white/20 text-white/70 hover:text-white'
                  : 'text-white'
              }`}
              style={tracksCompleted < totalTracks ? {
                background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
                boxShadow: '0 0 15px rgba(34,197,94,0.25)',
              } : undefined}
            >
              {tracksCompleted >= totalTracks ? 'Improve Times' : tracksCompleted > 0 ? 'Continue' : 'Enter Tournament'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
