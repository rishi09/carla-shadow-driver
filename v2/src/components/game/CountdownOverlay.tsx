import { useEffect, useState, useCallback } from 'react';

interface CountdownOverlayProps {
  onComplete: () => void;
  onTick?: (count: number) => void;
}

type CountdownState = 3 | 2 | 1 | 'GO' | 'done';

const countColors: Record<Exclude<CountdownState, 'done'>, string> = {
  3: 'text-red-500',
  2: 'text-yellow-400',
  1: 'text-green-500',
  GO: 'text-accent',
};

const countGlows: Record<Exclude<CountdownState, 'done'>, string> = {
  3: 'drop-shadow-[0_0_30px_rgba(239,68,68,0.8)]',
  2: 'drop-shadow-[0_0_30px_rgba(250,204,21,0.8)]',
  1: 'drop-shadow-[0_0_30px_rgba(34,197,94,0.8)]',
  GO: 'drop-shadow-[0_0_50px_rgba(255,215,0,1)]',
};

export function CountdownOverlay({ onComplete, onTick }: CountdownOverlayProps) {
  const [count, setCount] = useState<CountdownState>(3);
  const [isAnimating, setIsAnimating] = useState(true);
  const [showExplosion, setShowExplosion] = useState(false);

  const triggerTick = useCallback((currentCount: number) => {
    if (onTick) {
      onTick(currentCount);
    }
  }, [onTick]);

  useEffect(() => {
    // Trigger initial tick for 3
    triggerTick(3);

    const sequence: CountdownState[] = [3, 2, 1, 'GO', 'done'];
    let currentIndex = 0;

    const interval = setInterval(() => {
      currentIndex++;

      if (currentIndex >= sequence.length) {
        clearInterval(interval);
        onComplete();
        return;
      }

      const nextState = sequence[currentIndex];
      setCount(nextState);

      // Reset animation
      setIsAnimating(false);
      requestAnimationFrame(() => {
        setIsAnimating(true);
      });

      // Trigger tick for numbers
      if (typeof nextState === 'number') {
        triggerTick(nextState);
      } else if (nextState === 'GO') {
        triggerTick(0); // 0 represents GO
        setShowExplosion(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [onComplete, triggerTick]);

  if (count === 'done') {
    return null;
  }

  const displayValue = count === 'GO' ? 'GO!' : count;
  const colorClass = countColors[count];
  const glowClass = countGlows[count];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-dark-500/90 backdrop-blur-sm"
      role="alert"
      aria-live="assertive"
      aria-label={`Countdown: ${displayValue}`}
    >
      {/* Explosion effect for GO */}
      {showExplosion && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Radial burst lines */}
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="absolute left-1/2 top-1/2 h-1 bg-gradient-to-r from-accent via-accent-light to-transparent animate-[explosion-line_0.8s_ease-out_forwards]"
              style={{
                width: '200vw',
                transformOrigin: 'left center',
                transform: `rotate(${i * 30}deg) translateX(0)`,
                animationDelay: `${i * 20}ms`,
              }}
            />
          ))}
          {/* Ring pulse */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-4 border-accent rounded-full animate-[explosion-ring_0.8s_ease-out_forwards]" />
        </div>
      )}

      {/* Main countdown number */}
      <div
        className={`
          font-bold select-none
          ${colorClass}
          ${glowClass}
          ${isAnimating ? 'animate-[countdown-pulse_0.9s_ease-out_forwards]' : 'opacity-0 scale-50'}
          ${count === 'GO' ? 'text-[12rem] sm:text-[16rem] md:text-[20rem]' : 'text-[14rem] sm:text-[18rem] md:text-[24rem]'}
          transition-all duration-100
        `}
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {displayValue}
      </div>

      {/* Subtitle text */}
      <div
        className={`
          mt-4 text-2xl sm:text-3xl md:text-4xl font-semibold tracking-widest uppercase
          ${count === 'GO' ? 'text-accent animate-pulse' : 'text-white/60'}
          transition-colors duration-300
        `}
      >
        {count === 'GO' ? '' : count === 3 ? 'GET READY' : count === 2 ? 'SET' : 'ALMOST...'}
      </div>

      {/* Inline keyframe styles */}
      <style>{`
        @keyframes countdown-pulse {
          0% {
            opacity: 0;
            transform: scale(2.5);
          }
          15% {
            opacity: 1;
            transform: scale(0.9);
          }
          30% {
            transform: scale(1.05);
          }
          45% {
            transform: scale(1);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes explosion-line {
          0% {
            opacity: 1;
            transform: rotate(var(--rotation)) scaleX(0);
          }
          50% {
            opacity: 0.8;
          }
          100% {
            opacity: 0;
            transform: rotate(var(--rotation)) scaleX(1);
          }
        }

        @keyframes explosion-ring {
          0% {
            width: 0;
            height: 0;
            opacity: 1;
            border-width: 8px;
          }
          100% {
            width: 150vmax;
            height: 150vmax;
            opacity: 0;
            border-width: 2px;
          }
        }
      `}</style>
    </div>
  );
}
