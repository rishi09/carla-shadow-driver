/**
 * HighlightReel.tsx - Post-race highlight summary
 *
 * Displays all detected highlights from the race in chronological order,
 * styled like a racing broadcast replay log. Each highlight animates in
 * with a staggered delay.
 */
import { useState, useEffect, useRef } from 'react';
import type { Highlight, HighlightType } from '../hooks/useHighlightDetector.ts';

interface HighlightReelProps {
  highlights: Highlight[];
}

/** Visual configuration for each highlight type */
const HIGHLIGHT_CONFIG: Record<HighlightType, {
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}> = {
  overtake: {
    icon: '\uD83C\uDFCE\uFE0F',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    label: 'OVERTAKE',
  },
  close_finish: {
    icon: '\uD83C\uDFC1',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
    label: 'PHOTO FINISH',
  },
  high_speed: {
    icon: '\u26A1',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    label: 'TOP SPEED',
  },
  big_drift: {
    icon: '\uD83C\uDF00',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    label: 'BIG DRIFT',
  },
  near_miss: {
    icon: '\uD83D\uDCA5',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    label: 'CLOSE CALL',
  },
  recovery: {
    icon: '\uD83D\uDD04',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
    label: 'NICE SAVE',
  },
  last_lap_overtake: {
    icon: '\uD83D\uDD25',
    color: 'text-yellow-300',
    bgColor: 'bg-yellow-500/15',
    borderColor: 'border-yellow-400/40',
    label: 'LAST LAP MOVE',
  },
};

/** Format elapsed seconds as m:ss.s */
function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

/** Intensity dots: 1-5 filled circles */
function IntensityDots({ intensity }: { intensity: number }) {
  return (
    <div className="flex gap-0.5 items-center">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${
            i < intensity ? 'bg-white/60' : 'bg-white/10'
          }`}
        />
      ))}
    </div>
  );
}

export function HighlightReel({ highlights }: HighlightReelProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Stagger items in one by one, 100ms apart, starting after a short delay
    if (visibleCount >= highlights.length) return;

    timerRef.current = setTimeout(() => {
      setVisibleCount(prev => prev + 1);
    }, visibleCount === 0 ? 300 : 100);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visibleCount, highlights.length]);

  if (highlights.length === 0) return null;

  return (
    <div className="bg-dark-400/50 rounded-lg p-4 text-left">
      <div className="text-white/40 text-xs font-mono uppercase mb-3 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
        Race Highlights
        <span className="text-white/20">({highlights.length})</span>
      </div>

      <div className="space-y-1.5">
        {highlights.map((highlight, index) => {
          const config = HIGHLIGHT_CONFIG[highlight.type];
          const isVisible = index < visibleCount;

          return (
            <div
              key={`${highlight.type}-${index}`}
              className={`flex items-center gap-2.5 rounded-md border px-3 py-2 transition-all duration-300 ${config.bgColor} ${config.borderColor}`}
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? 'translateX(0)' : 'translateX(-20px)',
                transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
              }}
            >
              {/* Time marker */}
              <div className="text-white/30 text-[10px] font-mono w-10 shrink-0 text-right">
                {formatElapsed(highlight.raceElapsed)}
              </div>

              {/* Icon */}
              <span className="text-sm shrink-0" role="img" aria-label={config.label}>
                {config.icon}
              </span>

              {/* Type label */}
              <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${config.color}`}>
                {config.label}
              </span>

              {/* Description */}
              <span className="text-white/60 text-xs truncate flex-1">
                {highlight.description}
              </span>

              {/* Intensity */}
              <div className="shrink-0">
                <IntensityDots intensity={highlight.intensity} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
