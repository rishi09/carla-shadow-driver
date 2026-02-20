/**
 * useTimeZoneRacing.ts - Time-Zone-Aware Racing (Wild Idea #41)
 *
 * Maps the player's local time to CARLA weather parameters so the in-game
 * time of day matches real life. Play at 2 AM? Deep night. Noon? High sun.
 * Sunset? Golden hour racing.
 *
 * Converts local hours + minutes to:
 *   - sun_altitude_angle: CARLA's sun angle (-90 = nadir, 90 = zenith)
 *   - cloudiness: atmospheric haze (0-100), higher at dawn/dusk
 *   - timeOfDay: human-readable label ("Golden Hour", "Deep Night", etc.)
 *
 * Uses piecewise-linear interpolation across 8 keyframes spanning 24 hours.
 */
import { useState, useMemo, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Keyframes: [hour, sunAltitude, cloudiness]
// Smoothly interpolated between adjacent entries. The list wraps around
// (hour 24 === hour 0) so the interpolation is seamless across midnight.
// ---------------------------------------------------------------------------
const KEYFRAMES: [hour: number, sunAlt: number, cloud: number][] = [
  [0,  -90,  10],  // Midnight   - deep night, clear sky
  [6,   -5,  45],  // Dawn       - just before sunrise, atmospheric
  [9,   30,  25],  // Morning    - sun climbing, moderate sky
  [12,  70,  10],  // Noon       - high sun, clear
  [15,  45,  15],  // Afternoon  - descending sun, mostly clear
  [18,   5,  50],  // Sunset     - golden hour, atmospheric
  [20, -10,  40],  // Dusk       - just past sunset, moody
  [22, -50,  15],  // Night      - well below horizon, clear
];

// ---------------------------------------------------------------------------
// Time-of-day label keyframes: [startHour, label]
// Each label applies from its startHour until the next entry's startHour.
// ---------------------------------------------------------------------------
const TIME_LABELS: [hour: number, label: string][] = [
  [0,    'Deep Night'],
  [4,    'Pre-Dawn'],
  [5.5,  'Dawn'],
  [7,    'Early Morning'],
  [9,    'Morning'],
  [11,   'High Noon'],
  [13,   'Early Afternoon'],
  [15,   'Afternoon'],
  [17,   'Golden Hour'],
  [18.5, 'Sunset'],
  [19.5, 'Dusk'],
  [21,   'Night'],
  [23,   'Deep Night'],
];

// ---------------------------------------------------------------------------
// Interpolation helpers
// ---------------------------------------------------------------------------

/**
 * Linearly interpolate between two values.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Given a fractional hour (0-24), find the two surrounding keyframes and
 * linearly interpolate sun altitude and cloudiness.
 */
function interpolateKeyframes(fractionalHour: number): { sunAltitude: number; cloudiness: number } {
  // Normalize to [0, 24)
  const h = ((fractionalHour % 24) + 24) % 24;

  // Find the surrounding keyframe pair. We wrap around: after the last
  // keyframe comes the first keyframe at hour+24.
  const len = KEYFRAMES.length;
  let lo = len - 1;
  let hi = 0;

  for (let i = 0; i < len; i++) {
    if (KEYFRAMES[i][0] <= h) {
      lo = i;
    }
  }
  hi = (lo + 1) % len;

  const loHour = KEYFRAMES[lo][0];
  let hiHour = KEYFRAMES[hi][0];

  // If hi wraps around midnight, add 24 to its hour for interpolation
  if (hiHour <= loHour) {
    hiHour += 24;
  }

  const span = hiHour - loHour;
  // Adjust h if it wrapped past midnight relative to loHour
  const adjustedH = h < loHour ? h + 24 : h;
  const t = span === 0 ? 0 : (adjustedH - loHour) / span;

  return {
    sunAltitude: lerp(KEYFRAMES[lo][1], KEYFRAMES[hi][1], t),
    cloudiness: lerp(KEYFRAMES[lo][2], KEYFRAMES[hi][2], t),
  };
}

/**
 * Given a fractional hour, return a human-readable time-of-day label.
 */
function getTimeOfDayLabel(fractionalHour: number): string {
  const h = ((fractionalHour % 24) + 24) % 24;

  // Walk backwards through the label list to find the active label
  let label = TIME_LABELS[0][1]; // default fallback
  for (let i = TIME_LABELS.length - 1; i >= 0; i--) {
    if (h >= TIME_LABELS[i][0]) {
      label = TIME_LABELS[i][1];
      break;
    }
  }
  return label;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------
export interface UseTimeZoneRacingReturn {
  /** CARLA sun_altitude_angle (-90 to 90) mapped from local time */
  sunAltitude: number;
  /** CARLA cloudiness (0-100) -- more atmospheric at dawn/dusk */
  cloudiness: number;
  /** Human-readable time-of-day label (e.g. "Golden Hour", "Deep Night") */
  timeOfDay: string;
  /** The player's current local hour (0-23) */
  localHour: number;
  /** Whether time-zone-aware racing is enabled */
  enabled: boolean;
  /** Toggle the feature on or off */
  setEnabled: (enabled: boolean) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useTimeZoneRacing(): UseTimeZoneRacingReturn {
  const [enabled, setEnabledState] = useState(true);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
  }, []);

  const result = useMemo(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const fractionalHour = hours + minutes / 60;

    const { sunAltitude, cloudiness } = interpolateKeyframes(fractionalHour);

    return {
      sunAltitude: Math.round(sunAltitude * 10) / 10,
      cloudiness: Math.round(cloudiness * 10) / 10,
      timeOfDay: getTimeOfDayLabel(fractionalHour),
      localHour: hours,
    };
  }, []);

  return {
    ...result,
    enabled,
    setEnabled,
  };
}

export default useTimeZoneRacing;
