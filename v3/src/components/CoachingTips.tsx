import { useState, useEffect, useRef } from 'react';
import type { CoachingTip } from '../types/index.ts';

interface CoachingTipsProps {
  tips: CoachingTip[];
  /** Per-sector times for comparison display */
  sectorTimes?: { player: number[]; ai: number[] };
}

/** Pick icon and visual category based on structured tip data. */
function classifyTip(tip: CoachingTip): { icon: string; category: 'sector' | 'collision' | 'praise' | 'general' } {
  const lower = tip.tip.toLowerCase();

  // Positive tips (player was faster)
  if (tip.delta < -0.1 || lower.includes('great work') || lower.includes('replicate')) {
    return { icon: '\uD83C\uDFC6', category: 'praise' };
  }

  // Collision tips
  if (lower.includes('collision') || lower.includes('hit') || (tip as Record<string, unknown>)._is_collision_general) {
    return { icon: '\u26A0\uFE0F', category: 'collision' };
  }

  // Sector-specific tips (sector > 0)
  if (tip.sector > 0) {
    return { icon: '\uD83C\uDFAF', category: 'sector' };
  }

  return { icon: '\uD83D\uDCA1', category: 'general' };
}

/** Background color for each category */
function categoryBg(category: string): string {
  switch (category) {
    case 'praise': return 'border-green-500/20 bg-green-500/[0.06]';
    case 'collision': return 'border-amber-500/20 bg-amber-500/[0.06]';
    case 'sector': return 'border-cyan-500/20 bg-cyan-500/[0.06]';
    default: return 'border-white/10 bg-white/[0.03]';
  }
}

/** Severity indicator dot color */
function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-red-400';
    case 'major': return 'bg-amber-400';
    case 'minor': return 'bg-white/30';
    default: return 'bg-white/20';
  }
}

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
          <div
            className="text-xs font-bold uppercase tracking-wider"
            style={{
              background: 'linear-gradient(90deg, #60a5fa, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            AI Coach
          </div>
          <div className="text-white/30 text-[10px] font-mono">
            {tips.length} tips
          </div>
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

      {/* Tips list */}
      {expanded && (
        <div className="space-y-2">
          {tips.map((tip, i) => {
            const { icon, category } = classifyTip(tip);
            const isVisible = i < visibleCount;

            return (
              <div
                key={i}
                className={`rounded-lg border px-3 py-2.5 ${categoryBg(category)}`}
                style={{
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? 'translateY(0)' : 'translateY(12px)',
                  transition: 'opacity 0.35s ease-out, transform 0.35s ease-out',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-sm flex-shrink-0 mt-0.5">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-white/70 text-xs leading-relaxed font-mono">
                      {tip.tip}
                    </span>
                    {/* Metadata row: sector badge + severity dot + delta */}
                    <div className="flex items-center gap-2 mt-1.5">
                      {tip.sector > 0 && (
                        <span className="text-[9px] font-mono text-white/30 bg-white/5 rounded px-1.5 py-0.5">
                          S{tip.sector}
                        </span>
                      )}
                      <span className={`w-1.5 h-1.5 rounded-full ${severityColor(tip.severity)}`} />
                      {tip.delta !== 0 && (
                        <span className={`text-[9px] font-mono ${
                          tip.delta > 0 ? 'text-red-400/60' : 'text-green-400/70'
                        }`}>
                          {tip.delta > 0 ? '+' : ''}{tip.delta.toFixed(1)}s
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Sector times comparison bar (compact) */}
          {sectorTimes && sectorTimes.player.length > 0 && sectorTimes.ai.length > 0 && (
            <SectorComparison player={sectorTimes.player} ai={sectorTimes.ai} />
          )}
        </div>
      )}
    </div>
  );
}

/** Compact horizontal sector comparison bars */
function SectorComparison({ player, ai }: { player: number[]; ai: number[] }) {
  const numSectors = Math.min(player.length, ai.length);
  if (numSectors === 0) return null;

  // Find max time for scaling the bars
  const allTimes = [...player.slice(0, numSectors), ...ai.slice(0, numSectors)].filter(t => t > 0);
  if (allTimes.length === 0) return null;
  const maxTime = Math.max(...allTimes);

  return (
    <div className="mt-3 pt-3 border-t border-white/5">
      <div className="text-white/30 text-[10px] font-mono uppercase mb-2 flex items-center justify-between">
        <span>Sector Times</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500/70" />
            You
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500/70" />
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
                      playerFaster ? 'bg-green-500/70' : 'bg-green-500/40'
                    }`}
                    style={{ width: `${pWidth}%` }}
                  />
                </div>
                {/* AI bar */}
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      !playerFaster && aTime > 0 ? 'bg-blue-500/70' : 'bg-blue-500/40'
                    }`}
                    style={{ width: `${aWidth}%` }}
                  />
                </div>
              </div>
              {/* Delta */}
              <div className={`text-[9px] font-mono w-12 text-right flex-shrink-0 ${
                delta < -0.1 ? 'text-green-400/70' :
                delta > 0.1 ? 'text-red-400/60' :
                'text-white/20'
              }`}>
                {delta !== 0 ? (
                  <>
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}s
                  </>
                ) : (
                  '--'
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
