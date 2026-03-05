import { useState, useEffect, useRef } from 'react';

interface SplitTimeDeltaProps {
  /** The delta in seconds (positive = slower than PB, negative = faster). null = show raw time (no PB). */
  delta: number | null;
  /** Raw split time in seconds (shown when no PB exists). */
  rawTime?: number;
  /** Unique trigger key - changes when a new split should be shown. */
  trigger: number;
}

/**
 * SplitTimeDelta - Floating split time popup at checkpoints.
 *
 * Shows "+0.2s" (red) when slower than PB, "-0.1s" (green) when faster,
 * or the raw time in white when no PB exists.
 * Animates: fade in, float up 30px over 1.5s, fade out.
 * Positioned center of screen, slightly above middle.
 */
export function SplitTimeDelta({ delta, rawTime, trigger }: SplitTimeDeltaProps) {
  const [visible, setVisible] = useState(false);
  const [displayDelta, setDisplayDelta] = useState<number | null>(null);
  const [displayRawTime, setDisplayRawTime] = useState<number | undefined>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTriggerRef = useRef(trigger);

  useEffect(() => {
    // Only show on trigger change (not on initial mount)
    if (trigger === prevTriggerRef.current) return;
    prevTriggerRef.current = trigger;

    // Capture values at trigger time
    setDisplayDelta(delta);
    setDisplayRawTime(rawTime);
    setVisible(true);

    // Clear previous timeout
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // Hide after animation completes (1.5s)
    timeoutRef.current = setTimeout(() => {
      setVisible(false);
    }, 1500);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [trigger, delta, rawTime]);

  if (!visible) return null;

  // Determine display text and color
  let text: string;
  let colorClass: string;
  let glowColor: string;

  if (displayDelta !== null) {
    const sign = displayDelta >= 0 ? '+' : '-';
    const abs = Math.abs(displayDelta);
    text = `${sign}${abs.toFixed(1)}s`;
    if (displayDelta < 0) {
      // Faster than PB - green
      colorClass = 'text-green-400';
      glowColor = 'rgba(74, 222, 128, 0.6)';
    } else {
      // Slower than PB - red
      colorClass = 'text-red-400';
      glowColor = 'rgba(248, 113, 113, 0.6)';
    }
  } else {
    // No PB - show raw time in white
    const mins = Math.floor((displayRawTime ?? 0) / 60);
    const secs = (displayRawTime ?? 0) % 60;
    text = mins > 0
      ? `${mins}:${secs.toFixed(1).padStart(4, '0')}`
      : `${secs.toFixed(1)}s`;
    colorClass = 'text-white';
    glowColor = 'rgba(255, 255, 255, 0.4)';
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-25"
      style={{ marginTop: '-60px' }}
    >
      <div
        className={`${colorClass} text-2xl sm:text-3xl font-bold font-mono`}
        style={{
          textShadow: `0 0 12px ${glowColor}, 0 2px 6px rgba(0,0,0,0.8)`,
          animation: 'splitTimeDelta 1.5s ease-out forwards',
        }}
      >
        {text}
      </div>

      <style>{`
        @keyframes splitTimeDelta {
          0% {
            opacity: 0;
            transform: translateY(10px) scale(0.8);
          }
          15% {
            opacity: 1;
            transform: translateY(0px) scale(1.05);
          }
          25% {
            transform: translateY(-2px) scale(1.0);
          }
          70% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translateY(-30px) scale(1.0);
          }
        }
      `}</style>
    </div>
  );
}
