/**
 * DriftOverlay.tsx - Animated drift score display
 *
 * Shows a growing, pulsing "DRIFT!" text with score counter
 * when the player is drifting. Chain multiplier shown for combos.
 */
import { useState, useEffect, useRef } from 'react';

interface DriftOverlayProps {
  drift?: {
    active: boolean;
    score: number;
    angle: number;
    chain: number;
  } | null;
  totalDriftScore?: number;
}

export function DriftOverlay({ drift, totalDriftScore }: DriftOverlayProps) {
  const [displayScore, setDisplayScore] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevActiveRef = useRef(false);

  useEffect(() => {
    const isActive = drift?.active ?? false;

    if (isActive) {
      setIsVisible(true);
      setFadeOut(false);
      setDisplayScore(drift?.score ?? 0);
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
    } else if (prevActiveRef.current && !isActive) {
      // Drift just ended: show final score briefly then fade
      setFadeOut(true);
      fadeTimeoutRef.current = setTimeout(() => {
        setIsVisible(false);
        setFadeOut(false);
        setDisplayScore(0);
      }, 1500);
    }

    prevActiveRef.current = isActive;

    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, [drift?.active, drift?.score]);

  if (!isVisible) return null;

  const chain = drift?.chain ?? 1;
  const angle = drift?.angle ?? 0;
  const score = displayScore;

  // Scale text size based on score (bigger = more impressive)
  const scoreScale = Math.min(1.5, 1.0 + score / 1000);
  // Pulse intensity based on angle
  const pulseIntensity = Math.min(1.0, angle / 45);

  // Chain multiplier color
  const chainColor = chain >= 4 ? '#FF4444' : chain >= 3 ? '#FF8800' : chain >= 2 ? '#FFD700' : '#00D2FF';

  return (
    <div
      className={`absolute right-8 top-1/3 z-20 pointer-events-none flex flex-col items-end transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* DRIFT! text */}
      <div
        className="font-black italic tracking-wider"
        style={{
          fontSize: `${2.5 * scoreScale}rem`,
          color: '#FF6B00',
          textShadow: `0 0 ${20 + pulseIntensity * 30}px rgba(255, 107, 0, 0.8), 0 0 ${40 + pulseIntensity * 60}px rgba(255, 107, 0, 0.4)`,
          animation: drift?.active ? 'drift-pulse 0.3s ease-in-out infinite alternate' : 'none',
          transform: `scale(${scoreScale})`,
          transformOrigin: 'right center',
        }}
      >
        DRIFT!
      </div>

      {/* Score counter */}
      <div
        className="font-bold font-mono tabular-nums mt-1"
        style={{
          fontSize: `${1.8 * scoreScale}rem`,
          color: '#FFD700',
          textShadow: '0 0 15px rgba(255, 215, 0, 0.6), 0 2px 4px rgba(0, 0, 0, 0.8)',
        }}
      >
        +{score.toLocaleString()}
      </div>

      {/* Chain multiplier */}
      {chain > 1 && (
        <div
          className="font-bold font-mono text-lg mt-1 px-3 py-0.5 rounded-full border-2"
          style={{
            color: chainColor,
            borderColor: chainColor,
            backgroundColor: `${chainColor}20`,
            textShadow: `0 0 10px ${chainColor}80`,
            animation: 'drift-chain-pop 0.3s ease-out',
          }}
        >
          x{chain} CHAIN
        </div>
      )}

      {/* Angle indicator bar */}
      {drift?.active && (
        <div className="mt-2 w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-100"
            style={{
              width: `${Math.min(100, (angle / 60) * 100)}%`,
              background: `linear-gradient(90deg, #FF6B00, #FF4444)`,
              boxShadow: '0 0 8px rgba(255, 107, 0, 0.6)',
            }}
          />
        </div>
      )}

      {/* CSS Keyframes */}
      <style>{`
        @keyframes drift-pulse {
          from { opacity: 0.8; transform: scale(${scoreScale * 0.97}); }
          to { opacity: 1; transform: scale(${scoreScale * 1.03}); }
        }
        @keyframes drift-chain-pop {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
