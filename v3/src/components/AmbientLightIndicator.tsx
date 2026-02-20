/**
 * AmbientLightIndicator.tsx - HUD indicator for Ambient Light Racing
 *
 * Shows during racing when ambient light mode is active:
 *   - Sun/moon icon that changes with brightness zone
 *   - Small brightness bar (like a battery indicator)
 *   - Text hint: "Room: Dark -> Night Race" etc.
 *   - Smooth transitions between states
 *   - Positioned in the top-left area near weather info
 */
import type { WeatherZone } from '../hooks/useAmbientLight.ts';

interface AmbientLightIndicatorProps {
  brightness: number;       // 0-255
  weatherZone: WeatherZone;
  zoneLabel: string;
}

// Map zone to display properties
const ZONE_DISPLAY: Record<WeatherZone, { roomLabel: string; color: string; bgColor: string; borderColor: string }> = {
  night:  { roomLabel: 'Dark',       color: 'text-indigo-400',  bgColor: 'bg-indigo-500/20', borderColor: 'border-indigo-500/40' },
  dusk:   { roomLabel: 'Dim',        color: 'text-orange-400',  bgColor: 'bg-orange-500/20', borderColor: 'border-orange-500/40' },
  day:    { roomLabel: 'Normal',     color: 'text-sky-400',     bgColor: 'bg-sky-500/20',    borderColor: 'border-sky-500/40'    },
  bright: { roomLabel: 'Bright',     color: 'text-yellow-400',  bgColor: 'bg-yellow-500/20', borderColor: 'border-yellow-500/40' },
  vivid:  { roomLabel: 'Very Bright', color: 'text-amber-300',  bgColor: 'bg-amber-400/20',  borderColor: 'border-amber-400/40' },
};

function SunIcon({ zone }: { zone: WeatherZone }) {
  if (zone === 'night') {
    // Moon icon
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  if (zone === 'dusk') {
    // Sunset icon (half sun with horizon)
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400">
        <path d="M17 18a5 5 0 0 0-10 0" />
        <line x1="12" y1="9" x2="12" y2="2" />
        <line x1="4.22" y1="10.22" x2="5.64" y2="11.64" />
        <line x1="1" y1="18" x2="3" y2="18" />
        <line x1="21" y1="18" x2="23" y2="18" />
        <line x1="18.36" y1="11.64" x2="19.78" y2="10.22" />
      </svg>
    );
  }
  // Sun icon (day, bright, vivid)
  const sunColor = zone === 'vivid' ? 'text-amber-300' : zone === 'bright' ? 'text-yellow-400' : 'text-sky-400';
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={sunColor}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

export function AmbientLightIndicator({ brightness, weatherZone, zoneLabel }: AmbientLightIndicatorProps) {
  const display = ZONE_DISPLAY[weatherZone];
  const barWidth = Math.min(100, Math.max(0, (brightness / 255) * 100));

  // Determine bar color based on brightness level
  const barColor = brightness < 40 ? 'bg-indigo-500'
    : brightness < 80 ? 'bg-orange-500'
    : brightness < 140 ? 'bg-sky-500'
    : brightness < 200 ? 'bg-yellow-400'
    : 'bg-amber-300';

  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${display.bgColor} ${display.borderColor} backdrop-blur-sm`}
      style={{ transition: 'background-color 0.5s ease, border-color 0.5s ease' }}
    >
      {/* Sun/Moon icon */}
      <div style={{ transition: 'all 0.5s ease' }}>
        <SunIcon zone={weatherZone} />
      </div>

      {/* Brightness bar + text */}
      <div className="flex flex-col gap-0.5">
        {/* Brightness bar (battery-style) */}
        <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor}`}
            style={{
              width: `${barWidth}%`,
              transition: 'width 0.5s ease, background-color 0.5s ease',
            }}
          />
        </div>

        {/* Zone label */}
        <span
          className={`text-[9px] font-mono leading-none ${display.color}`}
          style={{ transition: 'color 0.5s ease' }}
        >
          {display.roomLabel} &rarr; {zoneLabel}
        </span>
      </div>
    </div>
  );
}
