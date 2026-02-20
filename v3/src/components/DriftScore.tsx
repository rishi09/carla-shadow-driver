/**
 * DriftScore.tsx - Drift scoring HUD component
 *
 * Shows:
 * 1. Active drift: angle gauge + live score counter (bottom-center)
 *    - Live tier label escalates as score climbs during the drift
 * 2. Score popup: floats up and fades when drift ends (shows combo/multiplier)
 *    - Tiered celebrations: DRIFT! / GREAT DRIFT! / AMAZING DRIFT! / INSANE DRIFT!
 *    - Escalating text size, glow, and color per tier
 *    - INSANE tier (1000+) triggers an orange screen-edge flash
 * 3. Total drift score: persistent counter in top-right area
 *
 * Uses refs for animation values per LEARNINGS.md patterns.
 * CSS animations only, no external libraries.
 */
import { useState, useEffect, useRef } from 'react';
import type { DriftEndEvent } from '../types/index.ts';

interface DriftScoreProps {
  /** Active drift state from race_state telemetry */
  drift?: {
    active: boolean;
    score: number;
    angle: number;
    chain: number;
  } | null;
  /** Total accumulated drift score */
  totalDriftScore?: number;
  /** Drift end event from server (triggers popup) */
  driftEndEvent?: DriftEndEvent | null;
}

/** A single popup entry that floats up and fades out */
interface ScorePopup {
  id: number;
  score: number;
  combo: number;
  multiplier: string;
  timestamp: number;
}

/** Drift tier thresholds and visual config */
interface DriftTier {
  label: string;
  /** Font size for the tier label in the popup (rem) */
  fontSize: number;
  /** Font size for the score number in the popup (rem) */
  scoreFontSize: number;
  /** Primary color for the tier label */
  color: string;
  /** Glow color (rgba) */
  glowColor: string;
  /** Glow intensity (spread radius multiplier) */
  glowIntensity: number;
}

/** Determine the drift tier based on score */
function getDriftTier(score: number): DriftTier {
  if (score > 1000) {
    return {
      label: 'INSANE DRIFT!',
      fontSize: 3.0,
      scoreFontSize: 2.8,
      color: '#FF2222',
      glowColor: 'rgba(255, 34, 34,',
      glowIntensity: 3.0,
    };
  }
  if (score > 500) {
    return {
      label: 'AMAZING DRIFT!',
      fontSize: 2.4,
      scoreFontSize: 2.4,
      color: '#FF4400',
      glowColor: 'rgba(255, 68, 0,',
      glowIntensity: 2.0,
    };
  }
  if (score >= 200) {
    return {
      label: 'GREAT DRIFT!',
      fontSize: 2.0,
      scoreFontSize: 2.2,
      color: '#FF8800',
      glowColor: 'rgba(255, 136, 0,',
      glowIntensity: 1.4,
    };
  }
  return {
    label: 'DRIFT!',
    fontSize: 1.6,
    scoreFontSize: 2.0,
    color: '#FFD700',
    glowColor: 'rgba(255, 215, 0,',
    glowIntensity: 1.0,
  };
}

/** Get the live tier label for the active drift display */
function getLiveTierLabel(score: number): string {
  if (score > 1000) return 'INSANE DRIFT!';
  if (score > 500) return 'AMAZING DRIFT!';
  if (score >= 200) return 'GREAT DRIFT!';
  return 'DRIFT!';
}

/** Get the live tier color for the active drift display */
function getLiveTierColor(score: number): string {
  if (score > 1000) return '#FF2222';
  if (score > 500) return '#FF4400';
  if (score >= 200) return '#FF8800';
  return '#FF6B00';
}

export function DriftScore({ drift, totalDriftScore = 0, driftEndEvent }: DriftScoreProps) {
  const [popups, setPopups] = useState<ScorePopup[]>([]);
  const [insaneFlash, setInsaneFlash] = useState(false);
  const popupIdRef = useRef(0);
  const lastDriftEndRef = useRef<DriftEndEvent | null>(null);

  // Track when a new drift_end event arrives and create a popup
  useEffect(() => {
    if (!driftEndEvent) return;
    // Avoid duplicate popups for the same event
    if (lastDriftEndRef.current === driftEndEvent) return;
    lastDriftEndRef.current = driftEndEvent;

    if (driftEndEvent.score <= 0) return;

    const id = ++popupIdRef.current;
    const popup: ScorePopup = {
      id,
      score: driftEndEvent.score,
      combo: driftEndEvent.combo,
      multiplier: driftEndEvent.multiplier,
      timestamp: Date.now(),
    };

    setPopups(prev => [...prev, popup]);

    // Trigger INSANE flash for 1000+ scores
    if (driftEndEvent.score > 1000) {
      setInsaneFlash(true);
      setTimeout(() => setInsaneFlash(false), 400);
    }

    // Remove popup after animation completes (2.5s for higher tiers)
    const duration = driftEndEvent.score > 500 ? 2500 : 2000;
    setTimeout(() => {
      setPopups(prev => prev.filter(p => p.id !== id));
    }, duration);
  }, [driftEndEvent]);

  const isActive = drift?.active ?? false;
  const liveScore = drift?.score ?? 0;
  const angle = drift?.angle ?? 0;
  const chain = drift?.chain ?? 1;

  // Angle fill percentage (0-100), capped at 90 degrees
  const anglePct = Math.min(100, (angle / 90) * 100);

  // Scale effect: grows slightly with higher scores
  const scoreScale = Math.min(1.4, 1.0 + liveScore / 2000);

  // Live tier label and color that escalates as score grows during the active drift
  const liveTierLabel = getLiveTierLabel(liveScore);
  const liveTierColor = getLiveTierColor(liveScore);

  return (
    <>
      {/* CSS Keyframes for animations */}
      <style>{`
        @keyframes drift-score-pulse {
          0% { opacity: 0.85; }
          100% { opacity: 1; }
        }
        @keyframes drift-popup-rise {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          20% {
            opacity: 1;
            transform: translateY(-20px) scale(1.15);
          }
          100% {
            opacity: 0;
            transform: translateY(-140px) scale(0.8);
          }
        }
        @keyframes drift-popup-rise-epic {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          15% {
            opacity: 1;
            transform: translateY(-10px) scale(1.25);
          }
          25% {
            opacity: 1;
            transform: translateY(-25px) scale(1.15);
          }
          100% {
            opacity: 0;
            transform: translateY(-160px) scale(0.85);
          }
        }
        @keyframes drift-total-bump {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
        @keyframes drift-tier-entrance {
          0% { transform: scale(0.6); opacity: 0; }
          40% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1.0); opacity: 1; }
        }
        @keyframes insane-drift-flash {
          0% { opacity: 0.6; }
          100% { opacity: 0; }
        }
      `}</style>

      {/* Active drift display: bottom-center */}
      {isActive && (
        <div
          className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex flex-col items-center gap-1"
          style={{
            animation: 'drift-score-pulse 0.25s ease-in-out infinite alternate',
          }}
        >
          {/* Tier label (escalates live) */}
          <div
            className="font-black italic tracking-wider"
            style={{
              fontSize: `${1.6 * scoreScale}rem`,
              color: liveTierColor,
              textShadow: `0 0 20px ${liveTierColor}B3, 0 0 40px ${liveTierColor}4D, 0 2px 4px rgba(0,0,0,0.8)`,
            }}
          >
            {liveTierLabel}
          </div>

          {/* Live score */}
          <div
            className="font-bold font-mono tabular-nums"
            style={{
              fontSize: `${1.4 * scoreScale}rem`,
              color: '#FFD700',
              textShadow: '0 0 12px rgba(255, 215, 0, 0.5), 0 2px 4px rgba(0,0,0,0.8)',
            }}
          >
            +{liveScore.toLocaleString()}
          </div>

          {/* Angle bar */}
          <div className="w-40 h-2 bg-white/10 rounded-full overflow-hidden mt-1">
            <div
              className="h-full rounded-full transition-all duration-75"
              style={{
                width: `${anglePct}%`,
                background: anglePct > 66
                  ? 'linear-gradient(90deg, #FF6B00, #FF2222)'
                  : anglePct > 33
                    ? 'linear-gradient(90deg, #FF6B00, #FF8800)'
                    : 'linear-gradient(90deg, #FFD700, #FF6B00)',
                boxShadow: `0 0 8px rgba(255, 107, 0, ${0.3 + anglePct / 200})`,
              }}
            />
          </div>

          {/* Angle text */}
          <div className="text-white/50 text-xs font-mono">
            {angle.toFixed(0)}&deg;
          </div>

          {/* Chain indicator */}
          {chain > 1 && (
            <div
              className="font-bold font-mono text-sm px-3 py-0.5 rounded-full border"
              style={{
                color: chain >= 4 ? '#FF4444' : chain >= 3 ? '#FF8800' : '#FFD700',
                borderColor: chain >= 4 ? '#FF444480' : chain >= 3 ? '#FF880080' : '#FFD70080',
                backgroundColor: chain >= 4 ? '#FF444415' : chain >= 3 ? '#FF880015' : '#FFD70015',
                textShadow: `0 0 8px ${chain >= 4 ? '#FF4444' : chain >= 3 ? '#FF8800' : '#FFD700'}60`,
              }}
            >
              x{chain} CHAIN
            </div>
          )}
        </div>
      )}

      {/* Score popups: float up from bottom-center when drift ends */}
      {popups.map(popup => {
        const tier = getDriftTier(popup.score);
        const isEpic = popup.score > 500;
        const animDuration = isEpic ? '2.5s' : '2s';
        const animName = isEpic ? 'drift-popup-rise-epic' : 'drift-popup-rise';

        return (
          <div
            key={popup.id}
            className="absolute bottom-32 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex flex-col items-center"
            style={{
              animation: `${animName} ${animDuration} ease-out forwards`,
            }}
          >
            {/* Tier label */}
            <div
              className="font-black italic tracking-wider"
              style={{
                fontSize: `${tier.fontSize}rem`,
                color: tier.color,
                textShadow: `0 0 ${20 * tier.glowIntensity}px ${tier.glowColor} 0.8), 0 0 ${40 * tier.glowIntensity}px ${tier.glowColor} 0.4), 0 0 ${60 * tier.glowIntensity}px ${tier.glowColor} 0.2), 0 2px 6px rgba(0,0,0,0.9)`,
                animation: 'drift-tier-entrance 0.3s ease-out',
              }}
            >
              {tier.label}
            </div>

            {/* Score */}
            <div
              className="font-black font-mono tabular-nums"
              style={{
                fontSize: `${tier.scoreFontSize}rem`,
                color: '#FFD700',
                textShadow: `0 0 ${20 * tier.glowIntensity}px rgba(255, 215, 0, 0.6), 0 0 ${40 * tier.glowIntensity}px rgba(255, 215, 0, 0.3), 0 2px 6px rgba(0,0,0,0.9)`,
              }}
            >
              +{popup.score.toLocaleString()}
            </div>

            {/* Multiplier labels */}
            {popup.multiplier && (
              <div
                className="font-bold text-sm mt-0.5 px-3 py-0.5 rounded-full bg-black/60 border border-cyan-400/40"
                style={{
                  color: '#00D2FF',
                  textShadow: '0 0 8px rgba(0, 210, 255, 0.5)',
                }}
              >
                {popup.multiplier}
              </div>
            )}

            {/* Combo indicator */}
            {popup.combo > 1 && (
              <div
                className="text-amber-400 font-bold font-mono text-xs mt-0.5"
                style={{
                  textShadow: '0 0 6px rgba(255, 191, 0, 0.5)',
                }}
              >
                COMBO x{popup.combo}
              </div>
            )}
          </div>
        );
      })}

      {/* INSANE DRIFT screen-edge flash (orange, similar to checkpoint flash pattern) */}
      {insaneFlash && (
        <div
          className="absolute inset-0 pointer-events-none z-20"
          style={{
            boxShadow: 'inset 0 0 80px 25px rgba(255, 100, 0, 0.45), inset 0 0 160px 40px rgba(255, 60, 0, 0.2)',
            animation: 'insane-drift-flash 400ms ease-out forwards',
          }}
        />
      )}

      {/* Total drift score: top-right area */}
      {totalDriftScore > 0 && (
        <div className="absolute top-16 right-4 z-10 pointer-events-none">
          <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-amber-500/30">
            <div className="text-amber-400/70 text-[10px] font-mono uppercase tracking-wider">Drift Score</div>
            <div
              className="text-amber-400 text-lg font-bold font-mono tabular-nums"
              style={{
                textShadow: '0 0 8px rgba(255, 191, 0, 0.3)',
              }}
            >
              {totalDriftScore.toLocaleString()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
