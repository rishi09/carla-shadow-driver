/**
 * RaceMemoryFeed.tsx - Scrollable feed of past race memories
 *
 * Shows a compact list of recent races with highlights.
 * Can be shown on the RaceSetup screen.
 *
 * Wild Idea #50 from TODO.md
 */
import { useState } from 'react';
import type { RaceMemoryEntry } from '../hooks/useRaceMemory.ts';

// --- Types ---

interface RaceMemoryFeedProps {
  memories: RaceMemoryEntry[];
  maxVisible?: number;
  onClose?: () => void;
}

// --- Helpers ---

function formatRelativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function formatRaceTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

function formatGap(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// --- Component ---

export function RaceMemoryFeed({
  memories,
  maxVisible = 5,
  onClose,
}: RaceMemoryFeedProps) {
  const [showAll, setShowAll] = useState(false);

  // Show newest first
  const sorted = [...memories].reverse();
  const visible = showAll ? sorted : sorted.slice(0, maxVisible);
  const hasMore = sorted.length > maxVisible;

  return (
    <div className="rounded-xl bg-gray-900/80 backdrop-blur border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white/60"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="text-white/80 text-sm font-semibold">Race History</span>
          {memories.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">
              {memories.length}
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Race list */}
      {visible.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-white/30 text-sm italic">
            No races yet. Your history starts now.
          </p>
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          {visible.map((entry) => (
            <div
              key={entry.id}
              className="px-3 py-2 border-b border-gray-800/50 last:border-b-0 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2">
                {/* Win/loss indicator */}
                <div className="shrink-0 w-5 flex justify-center">
                  {entry.winner === 'player' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </div>

                {/* Center: track, time, gap */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white/80 text-xs font-medium truncate">
                      {entry.track}
                    </span>
                    <span className="text-white/30 text-[10px]">|</span>
                    <span className="text-white/50 text-[11px] font-mono">
                      {formatRaceTime(entry.playerTime)}
                    </span>
                    <span className="text-white/30 text-[10px]">|</span>
                    <span
                      className={`text-[10px] font-mono ${
                        entry.winner === 'player'
                          ? 'text-green-400/70'
                          : 'text-red-400/70'
                      }`}
                    >
                      {entry.winner === 'player' ? '-' : '+'}
                      {formatGap(entry.gap)}
                    </span>
                  </div>
                </div>

                {/* Right: relative date */}
                <span className="text-white/25 text-[10px] font-mono shrink-0">
                  {formatRelativeDate(entry.date)}
                </span>
              </div>

              {/* Highlight */}
              <div className="mt-0.5 pl-7">
                <p className="text-white/25 text-[10px] italic truncate">
                  {entry.highlight}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Show more / show less toggle */}
      {hasMore && (
        <div className="px-4 py-2 border-t border-gray-800/50">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-white/30 hover:text-white/60 text-[11px] font-medium transition-colors w-full text-center"
          >
            {showAll ? 'Show less' : `Show all ${memories.length} races`}
          </button>
        </div>
      )}
    </div>
  );
}

export default RaceMemoryFeed;
