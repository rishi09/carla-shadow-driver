/**
 * CargoMeter.tsx - Visual cargo integrity meter for Fragile Cargo mode
 *
 * Displays a horizontal bar showing cargo health:
 * - Color gradient: green (100%) -> yellow (60%) -> orange (30%) -> red (10%)
 * - Shake animation on damage
 * - Warning pulse below 30%
 * - "CARGO DESTROYED!" overlay at 0%
 */
import { useState, useEffect, useRef } from 'react';
import type { CargoDamageType } from '../hooks/useCargoMode.ts';

interface CargoMeterProps {
  integrity: number;
  isDamaged: boolean;
  lastDamageType: CargoDamageType;
  /** Whether the race has finished */
  raceFinished?: boolean;
}

// Color thresholds
function getIntegrityColor(pct: number): string {
  if (pct > 60) return '#4CAF50'; // green
  if (pct > 30) return '#FFC107'; // yellow/amber
  if (pct > 10) return '#FF9800'; // orange
  return '#f44336'; // red
}

function getIntegrityBorderColor(pct: number): string {
  if (pct > 60) return 'rgba(76,175,80,0.5)';
  if (pct > 30) return 'rgba(255,193,7,0.5)';
  if (pct > 10) return 'rgba(255,152,0,0.5)';
  return 'rgba(244,67,54,0.5)';
}

function getIntegrityBgColor(pct: number): string {
  if (pct > 60) return 'rgba(76,175,80,0.15)';
  if (pct > 30) return 'rgba(255,193,7,0.15)';
  if (pct > 10) return 'rgba(255,152,0,0.15)';
  return 'rgba(244,67,54,0.15)';
}

function getDamageLabel(type: CargoDamageType): string {
  switch (type) {
    case 'collision': return 'COLLISION!';
    case 'hard_brake': return 'HARD BRAKE!';
    case 'sharp_turn': return 'SHARP TURN!';
    case 'bump': return 'BUMP!';
    default: return '';
  }
}

export function CargoMeter({ integrity, isDamaged, lastDamageType, raceFinished }: CargoMeterProps) {
  const [showDestroyed, setShowDestroyed] = useState(false);
  const destroyedTriggeredRef = useRef(false);

  // Track when cargo hits 0%
  useEffect(() => {
    if (integrity <= 0 && !destroyedTriggeredRef.current) {
      destroyedTriggeredRef.current = true;
      setShowDestroyed(true);
      // Auto-dismiss after 3s
      const timer = setTimeout(() => setShowDestroyed(false), 3000);
      return () => clearTimeout(timer);
    }
    // Reset if integrity goes back up (new race)
    if (integrity > 0) {
      destroyedTriggeredRef.current = false;
      setShowDestroyed(false);
    }
  }, [integrity]);

  const pct = Math.max(0, Math.min(100, integrity));
  const color = getIntegrityColor(pct);
  const borderColor = getIntegrityBorderColor(pct);
  const bgColor = getIntegrityBgColor(pct);
  const isWarning = pct <= 30 && pct > 0;

  return (
    <>
      {/* Main meter bar - positioned at top center */}
      <div
        className="absolute top-[100px] left-1/2 -translate-x-1/2 z-20 pointer-events-none"
        style={{
          animation: isDamaged ? 'cargoShake 0.3s ease-out' : 'none',
        }}
      >
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 backdrop-blur-sm"
          style={{
            backgroundColor: 'rgba(0,0,0,0.6)',
            border: `1px solid ${borderColor}`,
            boxShadow: isWarning
              ? `0 0 12px ${borderColor}`
              : 'none',
            animation: isWarning ? 'cargoPulse 1.5s ease-in-out infinite' : 'none',
          }}
        >
          {/* Crate icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>

          {/* Bar container */}
          <div className="relative w-28 h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <div
              className="absolute top-0 left-0 h-full rounded-full"
              style={{
                width: `${pct}%`,
                backgroundColor: color,
                transition: 'width 200ms ease-out, background-color 300ms ease-out',
                boxShadow: `0 0 6px ${color}80`,
              }}
            />
          </div>

          {/* Percentage text */}
          <span
            className="text-xs font-mono font-bold min-w-[3ch] text-right"
            style={{ color, textShadow: `0 0 6px ${color}60` }}
          >
            {Math.round(pct)}%
          </span>
        </div>

        {/* Damage type label (appears below bar on damage) */}
        {isDamaged && lastDamageType && (
          <div className="flex justify-center mt-1">
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded"
              style={{
                color,
                backgroundColor: bgColor,
                animation: 'cargoDamageLabel 0.5s ease-out forwards',
              }}
            >
              {getDamageLabel(lastDamageType)}
            </span>
          </div>
        )}
      </div>

      {/* CARGO DESTROYED! full-screen overlay */}
      {showDestroyed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
          <div
            className="text-center"
            style={{ animation: 'cargoDestroyedIn 3s ease-out forwards' }}
          >
            <div
              className="text-4xl sm:text-6xl font-black tracking-wider uppercase"
              style={{
                color: '#f44336',
                textShadow: '0 0 40px rgba(244,67,54,0.6), 0 0 80px rgba(244,67,54,0.3), 0 4px 12px rgba(0,0,0,0.9)',
              }}
            >
              CARGO DESTROYED!
            </div>
            <div
              className="mt-2 text-sm sm:text-base font-bold tracking-[0.3em] uppercase"
              style={{
                color: 'rgba(244,67,54,0.6)',
                textShadow: '0 0 10px rgba(244,67,54,0.3), 0 2px 6px rgba(0,0,0,0.8)',
              }}
            >
              0% INTEGRITY
            </div>
          </div>
          {/* Red edge vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              boxShadow: 'inset 0 0 100px 30px rgba(244,67,54,0.25)',
              animation: 'cargoDestroyedGlow 3s ease-out forwards',
            }}
          />
        </div>
      )}

      {/* Bonus overlay at race finish with high integrity */}
      {raceFinished && integrity > 80 && (
        <div className="absolute top-[135px] left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <span
            className="text-xs font-bold tracking-wider uppercase"
            style={{
              color: '#4CAF50',
              textShadow: '0 0 10px rgba(76,175,80,0.5)',
              animation: 'cargoBonusFade 3s ease-out forwards',
            }}
          >
            +{Math.round(integrity)}% CARGO BONUS!
          </span>
        </div>
      )}

      {/* CSS Keyframes */}
      <style>{`
        @keyframes cargoShake {
          0% { transform: translateX(-50%) translateX(-3px); }
          15% { transform: translateX(-50%) translateX(3px); }
          30% { transform: translateX(-50%) translateX(-2px); }
          45% { transform: translateX(-50%) translateX(2px); }
          60% { transform: translateX(-50%) translateX(-1px); }
          75% { transform: translateX(-50%) translateX(1px); }
          100% { transform: translateX(-50%) translateX(0); }
        }
        @keyframes cargoPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes cargoDamageLabel {
          0% { opacity: 0; transform: translateY(-4px); }
          20% { opacity: 1; transform: translateY(0); }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes cargoDestroyedIn {
          0% { opacity: 0; transform: scale(0.3); }
          15% { opacity: 1; transform: scale(1.1); }
          25% { transform: scale(1.0); }
          70% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.05) translateY(-20px); }
        }
        @keyframes cargoDestroyedGlow {
          0% { opacity: 0; }
          15% { opacity: 1; }
          70% { opacity: 0.7; }
          100% { opacity: 0; }
        }
        @keyframes cargoBonusFade {
          0% { opacity: 0; transform: translateY(8px); }
          15% { opacity: 1; transform: translateY(0); }
          70% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-10px); }
        }
      `}</style>
    </>
  );
}
