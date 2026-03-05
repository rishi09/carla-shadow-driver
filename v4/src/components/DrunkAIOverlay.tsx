/**
 * DrunkAIOverlay.tsx - Visual indicator for Drunk AI Mode
 *
 * Displays a small overlay in the top-right area showing the AI's
 * current drunkenness level with progressively chaotic animations:
 * - Text wobble at higher levels
 * - Green -> Yellow -> Orange -> Red color progression
 * - Hiccup pulse animation when drunk > 0.5
 *
 * Wild Idea #19 from TODO.md
 */
import { useEffect, useState } from 'react';

interface DrunkAIOverlayProps {
  /** Drunkenness level from 0.0 to 1.0 */
  drunkLevel: number;
  /** Human-readable label: "Sober", "Tipsy", etc. */
  drunkLabel: string;
  /** Whether drunk AI mode is active */
  enabled: boolean;
}

/** Maps drunk level 0-1 to a color from green -> yellow -> orange -> red */
function getDrunkColor(level: number): string {
  if (level < 0.25) return '#22c55e'; // green-500
  if (level < 0.45) return '#eab308'; // yellow-500
  if (level < 0.7) return '#f97316';  // orange-500
  return '#ef4444';                    // red-500
}

/** Returns an emoji for the drunk level */
function getDrunkEmoji(level: number): string {
  if (level < 0.15) return '\u{1F9CA}'; // ice cube (sober/cool)
  if (level < 0.3) return '\u{1F37A}';  // beer mug
  if (level < 0.5) return '\u{1F37B}';  // clinking beers
  if (level < 0.7) return '\u{1F943}';  // tumbler glass
  if (level < 0.9) return '\u{1F974}';  // woozy face
  return '\u{1F635}';                    // dizzy face
}

export function DrunkAIOverlay({ drunkLevel, drunkLabel, enabled }: DrunkAIOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [hiccup, setHiccup] = useState(false);

  // Fade in/out with enabled state
  useEffect(() => {
    if (enabled) {
      // Small delay for fade-in
      const timer = setTimeout(() => setVisible(true), 100);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [enabled]);

  // Hiccup animation: periodic scale pulse every 3-5 seconds when drunk > 0.5
  useEffect(() => {
    if (!enabled || drunkLevel <= 0.5) {
      setHiccup(false);
      return;
    }

    // Random interval between 3-5 seconds, more frequent when drunker
    const getInterval = () => {
      const base = 5000 - drunkLevel * 2000; // 5s at 0.5 -> 3s at 1.0
      return base + Math.random() * 1000;
    };

    let timeoutId: ReturnType<typeof setTimeout>;

    const triggerHiccup = () => {
      setHiccup(true);
      // Reset hiccup after animation duration
      setTimeout(() => setHiccup(false), 300);
      // Schedule next hiccup
      timeoutId = setTimeout(triggerHiccup, getInterval());
    };

    timeoutId = setTimeout(triggerHiccup, getInterval());

    return () => clearTimeout(timeoutId);
  }, [enabled, drunkLevel]);

  // Don't render at all if not enabled
  if (!enabled) return null;

  const color = getDrunkColor(drunkLevel);
  const emoji = getDrunkEmoji(drunkLevel);
  const shouldWobble = drunkLevel > 0.3;

  // Build inline styles for dynamic values that Tailwind can't handle
  const containerStyle: React.CSSProperties = {
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.5s ease-in-out',
    transform: hiccup ? 'scale(1.15)' : 'scale(1)',
  };

  const labelStyle: React.CSSProperties = {
    color,
    textShadow: `0 0 ${4 + drunkLevel * 8}px ${color}40`,
    animation: shouldWobble ? `drunkWobble ${2 - drunkLevel * 0.8}s ease-in-out infinite` : 'none',
  };

  const barWidth = `${Math.round(drunkLevel * 100)}%`;

  return (
    <>
      {/* CSS keyframes for wobble animation */}
      <style>{`
        @keyframes drunkWobble {
          0%, 100% { transform: rotate(0deg) translateX(0px); }
          20% { transform: rotate(${1 + drunkLevel * 3}deg) translateX(${drunkLevel * 2}px); }
          40% { transform: rotate(${-0.5 - drunkLevel * 2}deg) translateX(${-drunkLevel * 1.5}px); }
          60% { transform: rotate(${0.8 + drunkLevel * 2.5}deg) translateX(${drunkLevel * 1}px); }
          80% { transform: rotate(${-1 - drunkLevel * 1.5}deg) translateX(${-drunkLevel * 2}px); }
        }
      `}</style>

      <div
        className="absolute top-20 right-4 z-30 pointer-events-none select-none"
        style={containerStyle}
      >
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10 min-w-[120px]">
          {/* Header with emoji and label */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg" role="img" aria-label="drunk indicator">
              {emoji}
            </span>
            <span
              className="text-sm font-bold uppercase tracking-wider"
              style={labelStyle}
            >
              {drunkLabel}
            </span>
          </div>

          {/* Drunk level bar */}
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: barWidth,
                backgroundColor: color,
                boxShadow: `0 0 6px ${color}80`,
              }}
            />
          </div>

          {/* AI label */}
          <div className="text-[10px] text-white/40 mt-1 text-center uppercase tracking-widest">
            AI Sobriety
          </div>
        </div>
      </div>
    </>
  );
}

export default DrunkAIOverlay;
