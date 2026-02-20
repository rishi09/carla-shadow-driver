/**
 * BlindfoldOverlay.tsx - Full-screen blackout overlay for Blindfold Mode
 *
 * Visual effects:
 *   - Opacity transition: 0 -> 1 over 200ms (fade to black, not instant cut)
 *   - When blind: subtle "DRIVING BLIND" text in dark gray (barely visible)
 *   - Countdown timer: "VISION IN X.Xs" in dim text
 *   - When transitioning TO visible: brief 50ms white flash ("eyes adjusting")
 *   - Pulsing red border glow while blind (heartbeat-style)
 */
import { useRef, useEffect, useState } from 'react';

interface BlindfoldOverlayProps {
  /** Whether the screen should currently be blacked out */
  isBlind: boolean;
  /** Seconds remaining until vision returns */
  blindTimeLeft: number;
  /** Seconds remaining in current visible phase */
  visibleTimeLeft: number;
}

export function BlindfoldOverlay({ isBlind, blindTimeLeft, visibleTimeLeft }: BlindfoldOverlayProps) {
  // Track transitions for the white flash effect when emerging from blindness
  const wasBlindRef = useRef(false);
  const [showFlash, setShowFlash] = useState(false);

  useEffect(() => {
    // Detect transition from blind -> visible
    if (wasBlindRef.current && !isBlind) {
      setShowFlash(true);
      const timer = setTimeout(() => setShowFlash(false), 50);
      return () => clearTimeout(timer);
    }
    wasBlindRef.current = isBlind;
  }, [isBlind]);

  return (
    <>
      {/* CSS keyframes for the heartbeat border glow */}
      <style>{`
        @keyframes blindfold-heartbeat {
          0%, 100% {
            box-shadow: inset 0 0 60px 8px rgba(220, 38, 38, 0.08);
          }
          25% {
            box-shadow: inset 0 0 80px 15px rgba(220, 38, 38, 0.18);
          }
          35% {
            box-shadow: inset 0 0 60px 8px rgba(220, 38, 38, 0.06);
          }
          50% {
            box-shadow: inset 0 0 70px 12px rgba(220, 38, 38, 0.14);
          }
          65% {
            box-shadow: inset 0 0 60px 8px rgba(220, 38, 38, 0.08);
          }
        }
        @keyframes blindfold-text-pulse {
          0%, 100% { opacity: 0.12; }
          50% { opacity: 0.2; }
        }
        @keyframes blindfold-timer-pulse {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 0.45; }
        }
      `}</style>

      {/* Main blackout overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-[45]"
        style={{
          backgroundColor: 'black',
          opacity: isBlind ? 1 : 0,
          transition: 'opacity 200ms ease-in-out',
        }}
      >
        {/* Content only visible when blind (rendered always, but parent opacity controls visibility) */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            opacity: isBlind ? 1 : 0,
            transition: 'opacity 150ms ease-in',
          }}
        >
          {/* "DRIVING BLIND" text - barely visible */}
          <div
            className="text-2xl sm:text-3xl font-black tracking-[0.3em] uppercase select-none"
            style={{
              color: 'rgba(255, 255, 255, 0.15)',
              animation: 'blindfold-text-pulse 2s ease-in-out infinite',
              textShadow: '0 0 20px rgba(220, 38, 38, 0.1)',
            }}
          >
            DRIVING BLIND
          </div>

          {/* Countdown timer */}
          <div
            className="mt-4 text-lg sm:text-xl font-mono font-bold tracking-wider select-none"
            style={{
              color: 'rgba(255, 255, 255, 0.3)',
              animation: 'blindfold-timer-pulse 1s ease-in-out infinite',
            }}
          >
            VISION IN {blindTimeLeft.toFixed(1)}s
          </div>
        </div>
      </div>

      {/* Heartbeat pulsing border glow (red, dim) - rendered separately so it shows over the black */}
      {isBlind && (
        <div
          className="fixed inset-0 pointer-events-none z-[46]"
          style={{
            animation: 'blindfold-heartbeat 1.2s ease-in-out infinite',
          }}
        />
      )}

      {/* White flash when transitioning to visible ("eyes adjusting") */}
      {showFlash && (
        <div
          className="fixed inset-0 pointer-events-none z-[47]"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
          }}
        />
      )}

      {/* Visible phase countdown - small indicator showing time until next blackout */}
      {!isBlind && visibleTimeLeft > 0 && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[44] pointer-events-none">
          <div
            className="flex items-center gap-2 rounded-full px-4 py-1.5 border bg-black/60 backdrop-blur-sm"
            style={{
              borderColor: visibleTimeLeft < 1.0
                ? 'rgba(239, 68, 68, 0.5)'
                : 'rgba(255, 255, 255, 0.15)',
              transition: 'border-color 300ms ease',
            }}
          >
            {/* Eye icon */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={visibleTimeLeft < 1.0 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(255, 255, 255, 0.5)'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transition: 'stroke 300ms ease' }}
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span
              className="text-xs font-mono font-bold tracking-wider"
              style={{
                color: visibleTimeLeft < 1.0 ? 'rgba(239, 68, 68, 0.8)' : 'rgba(255, 255, 255, 0.5)',
                transition: 'color 300ms ease',
              }}
            >
              BLACKOUT IN {visibleTimeLeft.toFixed(1)}s
            </span>
          </div>
        </div>
      )}
    </>
  );
}
