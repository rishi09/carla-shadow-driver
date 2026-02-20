/**
 * VoiceBoostOverlay.tsx - Visual effects for Voice-Powered Turbo Boost
 *
 * Renders:
 * - Blue/purple screen-edge glow that intensifies with boost level
 * - "TURBO!" / "MAX BOOST!" text popups
 * - Volume bar indicator showing current microphone level
 * - Extra speed lines effect via CSS (complements SpeedLines.tsx)
 *
 * All effects are pointer-events-none overlays.
 */
import { useState, useEffect, useRef } from 'react';

interface VoiceBoostOverlayProps {
  /** Boost level from 0.0 to 1.0 */
  boostLevel: number;
  /** Whether boost is above the active threshold */
  isActive: boolean;
  /** Whether the microphone is currently listening */
  isListening: boolean;
  /** Current raw volume (0-1) for the indicator bar */
  rawVolume: number;
  /** Toggle callback for the mic button */
  onToggle: () => void;
}

export function VoiceBoostOverlay({ boostLevel, isActive, isListening, rawVolume, onToggle }: VoiceBoostOverlayProps) {
  // Track max boost flash for "MAX BOOST!" text
  const [showMaxBoost, setShowMaxBoost] = useState(false);
  const maxBoostCooldownRef = useRef(false);
  const prevIsActiveRef = useRef(false);
  const [showTurbo, setShowTurbo] = useState(false);
  const turboCooldownRef = useRef(false);

  // Detect boost crossing 0.8 threshold for MAX BOOST flash
  useEffect(() => {
    if (boostLevel > 0.8 && !maxBoostCooldownRef.current) {
      maxBoostCooldownRef.current = true;
      setShowMaxBoost(true);
      const timer = setTimeout(() => {
        setShowMaxBoost(false);
        // Cooldown: don't re-trigger for 2 seconds
        setTimeout(() => { maxBoostCooldownRef.current = false; }, 2000);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [boostLevel]);

  // Detect boost becoming active for TURBO text
  useEffect(() => {
    if (isActive && !prevIsActiveRef.current && !turboCooldownRef.current) {
      turboCooldownRef.current = true;
      setShowTurbo(true);
      const timer = setTimeout(() => {
        setShowTurbo(false);
        setTimeout(() => { turboCooldownRef.current = false; }, 1500);
      }, 1000);
      return () => clearTimeout(timer);
    }
    prevIsActiveRef.current = isActive;
  }, [isActive]);

  // Edge glow color: blue at low boost, shifting to purple/magenta at high boost
  const glowR = Math.floor(80 + boostLevel * 120);  // 80 -> 200
  const glowG = Math.floor(100 + boostLevel * (-40)); // 100 -> 60
  const glowB = Math.floor(255);                       // stays 255
  const glowAlpha = isActive ? 0.08 + boostLevel * 0.22 : 0;

  // Inner glow for high boost (more intense, tighter)
  const innerGlowAlpha = boostLevel > 0.5 ? (boostLevel - 0.5) * 0.4 : 0;

  return (
    <>
      {/* Screen-edge glow overlay */}
      {isListening && (
        <div
          className="absolute inset-0 pointer-events-none z-[22]"
          style={{
            boxShadow: isActive
              ? `inset 0 0 100px 30px rgba(${glowR},${glowG},${glowB},${glowAlpha.toFixed(3)})`
              : 'inset 0 0 100px 30px rgba(100,100,255,0)',
            transition: 'box-shadow 0.15s ease-out',
          }}
        />
      )}

      {/* Inner intense glow at high boost */}
      {innerGlowAlpha > 0.01 && (
        <div
          className="absolute inset-0 pointer-events-none z-[22]"
          style={{
            boxShadow: `inset 0 0 60px 15px rgba(${glowR},${glowG},${glowB},${innerGlowAlpha.toFixed(3)})`,
            transition: 'box-shadow 0.1s ease-out',
          }}
        />
      )}

      {/* TURBO! text popup */}
      {showTurbo && !showMaxBoost && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[32]">
          <div style={{ animation: 'voiceBoostTurbo 1s ease-out forwards' }}>
            <div
              className="text-4xl sm:text-6xl font-black tracking-wider"
              style={{
                color: '#8b5cf6',
                textShadow: '0 0 30px rgba(139,92,246,0.6), 0 0 60px rgba(139,92,246,0.3), 0 2px 8px rgba(0,0,0,0.8)',
              }}
            >
              TURBO!
            </div>
          </div>
        </div>
      )}

      {/* MAX BOOST! text popup (overrides TURBO) */}
      {showMaxBoost && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[32]">
          <div style={{ animation: 'voiceBoostMax 1.2s ease-out forwards' }}>
            <div
              className="text-5xl sm:text-7xl font-black tracking-widest"
              style={{
                color: '#a855f7',
                textShadow: '0 0 40px rgba(168,85,247,0.7), 0 0 80px rgba(168,85,247,0.4), 0 0 120px rgba(139,92,246,0.2), 0 4px 12px rgba(0,0,0,0.9)',
                WebkitTextStroke: '1px rgba(255,255,255,0.2)',
              }}
            >
              MAX BOOST!
            </div>
          </div>
        </div>
      )}

      {/* Voice boost indicator: small vertical bar + mic icon near bottom-right */}
      {isListening && (
        <div className="absolute bottom-24 right-5 z-[25] flex flex-col items-center gap-1 pointer-events-none">
          {/* Boost level label */}
          {isActive && (
            <div
              className="text-[10px] font-mono font-bold tracking-wider"
              style={{
                color: boostLevel > 0.8 ? '#a855f7' : boostLevel > 0.5 ? '#8b5cf6' : '#6366f1',
                textShadow: '0 0 8px currentColor',
                animation: boostLevel > 0.8 ? 'voiceBoostPulse 0.5s ease-in-out infinite' : 'none',
              }}
            >
              {boostLevel > 0.8 ? 'MAX' : 'BOOST'}
            </div>
          )}

          {/* Volume bar: vertical bar that fills up with voice volume */}
          <div className="w-3 h-16 bg-white/10 rounded-full overflow-hidden border border-white/10 relative">
            {/* Fill bar */}
            <div
              className="absolute bottom-0 left-0 right-0 rounded-full"
              style={{
                height: `${Math.min(100, rawVolume * 200)}%`,
                background: boostLevel > 0.8
                  ? 'linear-gradient(to top, #6366f1, #a855f7, #ec4899)'
                  : boostLevel > 0.5
                    ? 'linear-gradient(to top, #6366f1, #8b5cf6)'
                    : 'linear-gradient(to top, #4f46e5, #6366f1)',
                transition: 'height 50ms ease-out',
                boxShadow: isActive ? '0 0 8px rgba(139,92,246,0.5)' : 'none',
              }}
            />
            {/* Active threshold line */}
            <div
              className="absolute left-0 right-0 h-px"
              style={{
                bottom: '30%',
                backgroundColor: 'rgba(255,255,255,0.2)',
              }}
            />
          </div>
        </div>
      )}

      {/* Microphone toggle button */}
      <button
        onClick={onToggle}
        className={`absolute bottom-24 right-16 z-10 pointer-events-auto backdrop-blur-sm rounded-lg px-3 py-2 text-sm border transition-all duration-200 ${
          isListening
            ? 'bg-purple-500/30 border-purple-400/40 text-purple-300 hover:text-purple-200 shadow-[0_0_12px_rgba(139,92,246,0.3)]'
            : 'bg-black/60 border-white/10 text-white/60 hover:text-white'
        }`}
        title={isListening ? 'Disable Voice Boost' : 'Enable Voice Boost (Scream for turbo!)'}
      >
        {isListening ? (
          // Mic on icon (with glow ring when active)
          <div className="relative">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            {/* Pulsing ring when active */}
            {isActive && (
              <div
                className="absolute -inset-1 rounded-full border-2 border-purple-400"
                style={{ animation: 'voiceBoostPulse 0.8s ease-in-out infinite' }}
              />
            )}
          </div>
        ) : (
          // Mic off icon
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>

      {/* Keyframe animations */}
      <style>{`
        @keyframes voiceBoostTurbo {
          0% { opacity: 0; transform: scale(0.5); }
          15% { opacity: 1; transform: scale(1.15); }
          25% { transform: scale(1.0); }
          70% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.0) translateY(-20px); }
        }
        @keyframes voiceBoostMax {
          0% { opacity: 0; transform: scale(0.3) rotate(-3deg); }
          12% { opacity: 1; transform: scale(1.2) rotate(1deg); }
          20% { transform: scale(1.0) rotate(0deg); }
          65% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.1) translateY(-25px); }
        }
        @keyframes voiceBoostPulse {
          0%, 100% { opacity: 0.6; transform: scale(1.0); }
          50% { opacity: 1.0; transform: scale(1.1); }
        }
      `}</style>
    </>
  );
}
