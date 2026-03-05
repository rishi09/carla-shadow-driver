/**
 * LeaderboardPanel.tsx - Personal best times display
 *
 * Shows best times per track with medals (Gold/Silver/Bronze).
 * Displayed on the RaceSetup page.
 */
import { useLeaderboard } from '../hooks/useLeaderboard.ts';

const MEDAL_ICONS: Record<string, { icon: string; color: string }> = {
  gold: { icon: '\uD83E\uDD47', color: 'text-yellow-400' },
  silver: { icon: '\uD83E\uDD48', color: 'text-gray-300' },
  bronze: { icon: '\uD83E\uDD49', color: 'text-amber-600' },
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

interface LeaderboardPanelProps {
  selectedTrack: string;
  selectedLaps: number;
}

export function LeaderboardPanel({ selectedTrack, selectedLaps }: LeaderboardPanelProps) {
  const leaderboard = useLeaderboard();
  const record = leaderboard.getTrackRecord(selectedTrack, selectedLaps);
  const allRecords = leaderboard.getAllRecords();

  const hasAnyRecords = allRecords.length > 0;

  return (
    <div className="bg-black/40 rounded-lg border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white/60 text-xs font-mono uppercase tracking-wider">Personal Records</h3>
        {hasAnyRecords && (
          <button
            onClick={() => {
              if (confirm('Clear all leaderboard data?')) {
                leaderboard.clearAll();
              }
            }}
            className="text-white/20 hover:text-white/40 text-[10px] font-mono transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Current track record */}
      {record.bestTime !== null ? (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white/40 text-xs font-mono">{selectedTrack} ({selectedLaps}L)</span>
            {record.medal && (
              <span className={MEDAL_ICONS[record.medal].color}>
                {MEDAL_ICONS[record.medal].icon}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-white/30 text-[10px] font-mono uppercase">Best Race</div>
              <div className="text-accent text-sm font-bold font-mono">
                {formatTime(record.bestTime)}
              </div>
            </div>
            {record.bestLap !== null && (
              <div>
                <div className="text-white/30 text-[10px] font-mono uppercase">Best Lap</div>
                <div className="text-white text-sm font-bold font-mono">
                  {formatTime(record.bestLap)}
                </div>
              </div>
            )}
          </div>
          {record.entries.length > 1 && (
            <div className="mt-2 space-y-1">
              <div className="text-white/20 text-[10px] font-mono uppercase">Recent</div>
              {record.entries.slice(0, 3).map((entry, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-white/30">#{i + 1}</span>
                  <span className="text-white/50">{formatTime(entry.time)}</span>
                  <span className="text-white/20">
                    {entry.difficulty}
                  </span>
                  <span className="text-white/20">
                    {new Date(entry.date).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-white/20 text-xs font-mono mb-3 text-center py-4">
          No records yet for {selectedTrack} ({selectedLaps}L).
          <br />
          Race to set your first time!
        </div>
      )}

      {/* Medal guide */}
      <div className="border-t border-white/5 pt-2 mt-2">
        <div className="text-white/20 text-[10px] font-mono uppercase mb-1">Medal Targets</div>
        <div className="flex gap-3 text-[10px] font-mono">
          <span className="text-yellow-400">{MEDAL_ICONS.gold.icon} Par time</span>
          <span className="text-gray-300">{MEDAL_ICONS.silver.icon} +30%</span>
          <span className="text-amber-600">{MEDAL_ICONS.bronze.icon} +70%</span>
        </div>
      </div>
    </div>
  );
}
