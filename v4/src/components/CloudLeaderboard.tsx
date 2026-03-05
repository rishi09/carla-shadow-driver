/**
 * CloudLeaderboard.tsx - Global leaderboard display component
 *
 * Shows top 50 times for a track/lap combo from the cloud leaderboard.
 * Each entry shows rank, player name, time, difficulty, and a button
 * to race against that player's ghost.
 */
import { useState, useEffect, useCallback } from 'react';
import type { CloudLeaderboardEntry } from '../hooks/useCloudLeaderboard.ts';
import { useCloudLeaderboard } from '../hooks/useCloudLeaderboard.ts';

interface CloudLeaderboardProps {
  track: string;
  laps: number;
  /** The current player's name for highlighting their entries */
  playerName: string;
  /** Called when the user clicks "Race Ghost" on an entry */
  onRaceGhost?: (ghostId: string, entry: CloudLeaderboardEntry) => void;
  /** Whether to show the component (controlled visibility) */
  visible?: boolean;
  /** Called to close the leaderboard */
  onClose?: () => void;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  carla_pilotnet: 'Easy',
  pilotnet: 'Medium',
  alpamayo: 'Hard',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  Easy: 'text-green-400',
  Medium: 'text-yellow-400',
  Hard: 'text-red-400',
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function CloudLeaderboard({
  track,
  laps,
  playerName,
  onRaceGhost,
  visible = true,
  onClose,
}: CloudLeaderboardProps) {
  const cloud = useCloudLeaderboard();
  const [entries, setEntries] = useState<CloudLeaderboardEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [fetchError, setFetchError] = useState(false);
  const [loadingGhost, setLoadingGhost] = useState<string | null>(null);

  // Fetch leaderboard when visible and track/laps change
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setFetchError(false);

    cloud.getLeaderboard(track, laps).then((result) => {
      if (cancelled) return;
      if (result) {
        setEntries(result.entries);
        setTotal(result.total);
      } else {
        setFetchError(true);
      }
    });

    return () => { cancelled = true; };
  }, [visible, track, laps]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRaceGhost = useCallback(async (entry: CloudLeaderboardEntry) => {
    if (!entry.ghostId || !onRaceGhost) return;
    setLoadingGhost(entry.ghostId);
    try {
      const ghostData = await cloud.getGhostData(entry.ghostId);
      if (ghostData) {
        onRaceGhost(entry.ghostId, entry);
      }
    } finally {
      setLoadingGhost(null);
    }
  }, [cloud, onRaceGhost]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    setFetchError(false);
    cloud.getLeaderboard(track, laps, true).then((result) => {
      if (result) {
        setEntries(result.entries);
        setTotal(result.total);
      } else {
        setFetchError(true);
      }
    });
  }, [cloud, track, laps]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const normalizedPlayerName = playerName.trim().toLowerCase();

  return (
    <div className="bg-dark-400/80 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-dark-500/50">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
            <path d="M8 21h8" />
            <path d="M12 17V21" />
            <path d="M7 4h10" />
            <path d="M5 8h14" />
            <path d="M4 12h16" />
            <rect x="2" y="4" width="20" height="12" rx="2" />
          </svg>
          <span className="text-white/80 text-sm font-bold uppercase tracking-wider">
            Global Leaderboard
          </span>
          {total > 0 && (
            <span className="text-white/30 text-xs font-mono">
              ({total} {total === 1 ? 'racer' : 'racers'})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={cloud.loading}
            className="text-white/30 hover:text-white/60 transition-colors disabled:opacity-30"
            title="Refresh leaderboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cloud.loading ? 'animate-spin' : ''}>
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/30 hover:text-white/60 transition-colors"
              title="Close leaderboard"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Track/Laps info */}
      <div className="px-4 py-2 border-b border-white/5 flex items-center gap-3">
        <span className="text-white/50 text-xs font-mono">{track}</span>
        <span className="text-white/20 text-xs">|</span>
        <span className="text-white/50 text-xs font-mono">{laps} {laps === 1 ? 'lap' : 'laps'}</span>
      </div>

      {/* Content */}
      <div className="max-h-[400px] overflow-y-auto">
        {/* Loading state */}
        {cloud.loading && entries.length === 0 && (
          <div className="py-8 text-center">
            <div className="text-white/30 text-sm">Loading leaderboard...</div>
          </div>
        )}

        {/* Error state */}
        {fetchError && entries.length === 0 && (
          <div className="py-8 text-center">
            <div className="text-white/30 text-sm mb-2">Could not load leaderboard</div>
            <button
              onClick={handleRefresh}
              className="text-cyan-400/60 hover:text-cyan-400 text-xs font-mono transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty state */}
        {!cloud.loading && !fetchError && entries.length === 0 && (
          <div className="py-8 text-center">
            <div className="text-white/30 text-sm mb-1">No times recorded yet</div>
            <div className="text-white/20 text-xs">Be the first to set a time!</div>
          </div>
        )}

        {/* Leaderboard table */}
        {entries.length > 0 && (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-white/30 border-b border-white/5">
                <th className="px-3 py-2 text-left w-10">#</th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-right">Time</th>
                <th className="px-2 py-2 text-right hidden sm:table-cell">Best Lap</th>
                <th className="px-2 py-2 text-center hidden sm:table-cell">Diff</th>
                <th className="px-2 py-2 text-right hidden sm:table-cell">When</th>
                {onRaceGhost && <th className="px-3 py-2 w-20" />}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isOwnEntry = entry.playerName.trim().toLowerCase() === normalizedPlayerName;
                const diffLabel = DIFFICULTY_LABELS[entry.difficulty] || entry.difficulty;
                const diffColor = DIFFICULTY_COLORS[diffLabel] || 'text-white/50';

                return (
                  <tr
                    key={entry.id}
                    className={`border-b border-white/5 transition-colors ${
                      isOwnEntry
                        ? 'bg-yellow-500/10 hover:bg-yellow-500/15'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    {/* Rank */}
                    <td className="px-3 py-2">
                      <span className={`${
                        entry.rank === 1 ? 'text-yellow-400 font-bold' :
                        entry.rank === 2 ? 'text-gray-300 font-bold' :
                        entry.rank === 3 ? 'text-amber-600 font-bold' :
                        'text-white/40'
                      }`}>
                        {entry.rank}
                      </span>
                    </td>

                    {/* Player name */}
                    <td className="px-2 py-2">
                      <span className={`${
                        isOwnEntry ? 'text-yellow-400 font-bold' : 'text-white/70'
                      } truncate block max-w-[120px]`}>
                        {entry.playerName}
                        {isOwnEntry && (
                          <span className="text-yellow-400/50 ml-1 text-[10px]">(you)</span>
                        )}
                      </span>
                    </td>

                    {/* Total time */}
                    <td className="px-2 py-2 text-right">
                      <span className={`${
                        entry.rank === 1 ? 'text-green-400 font-bold' : 'text-white/70'
                      }`}>
                        {formatTime(entry.time)}
                      </span>
                    </td>

                    {/* Best lap */}
                    <td className="px-2 py-2 text-right hidden sm:table-cell">
                      <span className="text-white/40">
                        {entry.bestLap > 0 ? formatTime(entry.bestLap) : '--'}
                      </span>
                    </td>

                    {/* Difficulty */}
                    <td className="px-2 py-2 text-center hidden sm:table-cell">
                      <span className={`${diffColor} text-[10px]`}>
                        {diffLabel}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="px-2 py-2 text-right hidden sm:table-cell">
                      <span className="text-white/25">
                        {formatDate(entry.date)}
                      </span>
                    </td>

                    {/* Race Ghost button */}
                    {onRaceGhost && (
                      <td className="px-3 py-2 text-right">
                        {entry.ghostId ? (
                          <button
                            onClick={() => handleRaceGhost(entry)}
                            disabled={loadingGhost === entry.ghostId}
                            className="text-cyan-400/60 hover:text-cyan-400 text-[10px] uppercase tracking-wider font-bold transition-colors disabled:opacity-40"
                          >
                            {loadingGhost === entry.ghostId ? '...' : 'Ghost'}
                          </button>
                        ) : (
                          <span className="text-white/15 text-[10px]">--</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
