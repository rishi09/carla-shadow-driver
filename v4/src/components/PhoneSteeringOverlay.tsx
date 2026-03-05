/**
 * PhoneSteeringOverlay.tsx - Visual feedback for phone gyroscope steering
 *
 * Shows a small steering wheel icon that rotates with the steer angle,
 * throttle/brake bar indicators, and a hint when first enabled.
 */
import { useState, useEffect } from 'react';

interface PhoneSteeringOverlayProps {
  /** Whether phone steering is active */
  isActive: boolean;
  /** Current steer value: -1 (full left) to 1 (full right) */
  steer: number;
  /** Current throttle value: 0 to 1 */
  throttle: number;
  /** Current brake value: 0 to 1 */
  brake: number;
}

export function PhoneSteeringOverlay({ isActive, steer, throttle, brake }: PhoneSteeringOverlayProps) {
  const [showHint, setShowHint] = useState(true);

  // Hide the hint after 4 seconds
  useEffect(() => {
    if (!isActive) {
      setShowHint(true);
      return;
    }
    const timer = setTimeout(() => setShowHint(false), 4000);
    return () => clearTimeout(timer);
  }, [isActive]);

  if (!isActive) return null;

  const rotationDeg = steer * 90; // -90 to +90 degrees visual rotation

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2">
      {/* Hint text */}
      {showHint && (
        <div className="text-white/60 text-xs font-medium animate-pulse bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
          Tilt to steer
        </div>
      )}

      {/* Steering wheel + pedal bars container */}
      <div className="flex items-end gap-3">
        {/* Throttle bar (left) */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[9px] text-white/40 font-mono uppercase">Gas</span>
          <div className="w-3 h-14 rounded-full bg-white/10 border border-white/10 overflow-hidden flex flex-col-reverse">
            <div
              className="w-full rounded-full transition-all duration-100"
              style={{
                height: `${throttle * 100}%`,
                backgroundColor: `rgb(${Math.round(34 + (1 - throttle) * 0)}, ${Math.round(197 * throttle + 80 * (1 - throttle))}, ${Math.round(94 * throttle)})`,
                opacity: Math.max(0.3, throttle),
              }}
            />
          </div>
        </div>

        {/* Steering wheel icon */}
        <div
          className="relative w-16 h-16 flex items-center justify-center"
          style={{
            filter: `drop-shadow(0 0 8px rgba(99, 102, 241, ${isActive ? 0.5 : 0}))`,
          }}
        >
          {/* Pulsing glow ring */}
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{
              boxShadow: `0 0 12px 2px rgba(99, 102, 241, 0.3)`,
            }}
          />

          {/* Wheel SVG */}
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            style={{
              transform: `rotate(${rotationDeg}deg)`,
              transition: 'transform 50ms linear',
            }}
          >
            {/* Outer ring */}
            <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,0.6)" strokeWidth="3" fill="none" />
            {/* Inner hub */}
            <circle cx="24" cy="24" r="5" stroke="rgba(255,255,255,0.4)" strokeWidth="2" fill="rgba(255,255,255,0.1)" />
            {/* Spokes */}
            <line x1="24" y1="19" x2="24" y2="4" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="19" y1="24" x2="4" y2="24" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="29" y1="24" x2="44" y2="24" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" strokeLinecap="round" />
            {/* Center dot indicator (shows center position) */}
            <circle cx="24" cy="4" r="2.5" fill="rgba(99, 102, 241, 0.8)" />
          </svg>
        </div>

        {/* Brake bar (right) */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[9px] text-white/40 font-mono uppercase">Brk</span>
          <div className="w-3 h-14 rounded-full bg-white/10 border border-white/10 overflow-hidden flex flex-col-reverse">
            <div
              className="w-full rounded-full transition-all duration-100"
              style={{
                height: `${brake * 100}%`,
                backgroundColor: `rgb(${Math.round(239 * brake + 80 * (1 - brake))}, ${Math.round(68 * brake)}, ${Math.round(68 * brake)})`,
                opacity: Math.max(0.3, brake),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default PhoneSteeringOverlay;
