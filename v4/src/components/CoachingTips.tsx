import { useState, useEffect, useRef } from 'react';
import type { CoachingTip } from '../types/index.ts';

interface CoachingTipsProps {
  tips: CoachingTip[];
  /** Per-sector times for comparison display */
  sectorTimes?: { player: number[]; ai: number[] };
}

/** Severity configuration: colors and labels */
const SEVERITY_CONFIG: Record<string, { dot: string; border: string; bg: string; label: string }> = {
  critical: {
    dot: 'bg-red-500',
    border: 'border-red-500/20',
    bg: 'bg-red-500/[0.06]',
    label: 'Critical',
  },
  major: {
    dot: 'bg-amber-400',
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/[0.06]',
    label: 'Major',
  },
  minor: {
    dot: 'bg-green-400',
    border: 'border-green-500/20',
    bg: 'bg-green-500/[0.06]',
    label: 'Minor',
  },
};

export function CoachingTips({ tips, sectorTimes }: CoachingTipsProps) {
  const [expanded, setExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Staggered reveal: show one more tip every 200ms
  useEffect(() => {
    if (!expanded || tips.length === 0) return;

    setVisibleCount(0);
    let count = 0;

    const reveal = () => {
      count++;
      setVisibleCount(count);
      if (count < tips.length) {
        timerRef.current = setTimeout(reveal, 200);
      }
    };

    // Start after a short delay
    timerRef.current = setTimeout(reveal, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [expanded, tips]);

  if (!tips || tips.length === 0) return null;

  return (
    <div className="text-left">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-3 group cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {/* Coaching clipboard icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-cyan-400"
          >
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            <path d="M9 14l2 2 4-4" />
          </svg>
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{
              background: 'linear-gradient(90deg, #22d3ee, #60a5fa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            AI Coach Analysis
          </span>
          <span className="text-white/25 text-[10px] font-mono">
            {tips.length} {tips.length === 1 ? 'tip' : 'tips'}
          </span>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-white/30 group-hover:text-white/50 transition-all duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Content */}
      {expanded && (
        <div className="space-y-2">
          {/* Sector splits bar chart */}
          {sectorTimes && sectorTimes.player.length > 0 && sectorTimes.ai.length > 0 && (
            <SectorSplitsChart player={sectorTimes.player} ai={sectorTimes.ai} />
          )}

          {/* Tips list */}
          {tips.map((tip, i) => {
            const config = SEVERITY_CONFIG[tip.severity] || SEVERITY_CONFIG.minor;
            const isVisible = i < visibleCount;

            return (
              <div
                key={i}
                className={`rounded-lg border px-3 py-2.5 ${config.border} ${config.bg}`}
                style={{
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? 'translateY(0)' : 'translateY(12px)',
                  transition: 'opacity 0.35s ease-out, transform 0.35s ease-out',
                }}
              >
                <div className="flex items-start gap-2.5">
                  {/* Severity indicator and sector badge */}
                  <div className="flex flex-col items-center gap-1.5 min-w-[28px] pt-1">
                    <span className={`w-2 h-2 rounded-full ${config.dot}`} />
                    {tip.sector > 0 && (
                      <span className="text-[9px] font-mono text-white/40 bg-white/5 rounded px-1.5 py-0.5 border border-white/5">
                        S{tip.sector}
                      </span>
                    )}
                  </div>

                  {/* Tip content */}
                  <div className="flex-1 min-w-0">
                    {/* Delta badge */}
                    {tip.delta !== 0 && (
                      <span
                        className={`inline-block text-[10px] font-mono font-bold px-1.5 py-0.5 rounded mb-1 ${
                          tip.delta > 0
                            ? 'text-red-400 bg-red-500/10'
                            : 'text-green-400 bg-green-500/10'
                        }`}
                      >
                        {tip.delta > 0 ? '+' : ''}{tip.delta.toFixed(1)}s
                      </span>
                    )}
                    {/* Tip text */}
                    <p className="text-white/70 text-xs leading-relaxed">
                      {tip.tip}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact horizontal bar chart comparing player vs AI sector times */
function SectorSplitsChart({ player, ai }: { player: number[]; ai: number[] }) {
  const numSectors = Math.min(player.length, ai.length);
  if (numSectors === 0) return null;

  // Find max time for scaling the bars
  const allTimes = [...player.slice(0, numSectors), ...ai.slice(0, numSectors)].filter(t => t > 0);
  if (allTimes.length === 0) return null;
  const maxTime = Math.max(...allTimes);

  return (
    <div className="rounded-lg bg-dark-500/30 border border-white/5 p-3 mb-1">
      <div className="text-white/30 text-[10px] font-mono uppercase mb-2 flex items-center justify-between">
        <span>Sector Splits</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-1.5 rounded-sm bg-cyan-400/70" />
            You
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-1.5 rounded-sm bg-blue-500/50" />
            AI
          </span>
        </span>
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: numSectors }, (_, i) => {
          const pTime = player[i];
          const aTime = ai[i];
          if (pTime <= 0 && aTime <= 0) return null;

          const pWidth = maxTime > 0 ? (pTime / maxTime) * 100 : 0;
          const aWidth = maxTime > 0 ? (aTime / maxTime) * 100 : 0;
          const playerFaster = pTime > 0 && aTime > 0 && pTime < aTime;
          const delta = pTime > 0 && aTime > 0 ? pTime - aTime : 0;

          return (
            <div key={i} className="flex items-center gap-2">
              <div className="text-white/25 text-[9px] font-mono w-4 text-right flex-shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 space-y-0.5">
                {/* Player bar */}
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      playerFaster ? 'bg-cyan-400/70' : 'bg-cyan-400/35'
                    }`}
                    style={{ width: `${Math.max(pWidth, 2)}%` }}
                  />
                </div>
                {/* AI bar */}
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      !playerFaster && aTime > 0 ? 'bg-blue-500/60' : 'bg-blue-500/30'
                    }`}
                    style={{ width: `${Math.max(aWidth, 2)}%` }}
                  />
                </div>
              </div>
              {/* Times */}
              <div className="text-[9px] font-mono w-16 text-right flex-shrink-0 space-y-0.5">
                <div className={playerFaster ? 'text-cyan-400 font-bold' : 'text-white/35'}>
                  {pTime > 0 ? `${pTime.toFixed(1)}s` : '--'}
                </div>
                <div className={!playerFaster && aTime > 0 ? 'text-blue-400/70 font-bold' : 'text-white/25'}>
                  {aTime > 0 ? `${aTime.toFixed(1)}s` : '--'}
                </div>
              </div>
              {/* Delta */}
              <div className="w-10 text-right flex-shrink-0">
                {delta !== 0 ? (
                  <span className={`text-[9px] font-mono font-bold ${
                    delta < -0.1 ? 'text-green-400/70' :
                    delta > 0.1 ? 'text-red-400/60' :
                    'text-white/20'
                  }`}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                  </span>
                ) : (
                  <span className="text-[9px] font-mono text-white/15">--</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
