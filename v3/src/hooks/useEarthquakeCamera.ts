/**
 * useEarthquakeCamera.ts - "Earthquake Camera" effect (Wild Idea #36)
 *
 * When the player is within ~2 seconds of the AI, the screen starts shaking
 * with increasing intensity as the gap closes:
 *   - gap > 2.0s:   intensity 0   (no shake)
 *   - gap 1.0-2.0s: intensity 0-0.3 (subtle vibration)
 *   - gap 0.5-1.0s: intensity 0.3-0.7 (noticeable shake)
 *   - gap 0.1-0.5s: intensity 0.7-0.9 (strong shake)
 *   - gap < 0.1s:   intensity 1.0 (maximum chaos)
 *
 * Uses per-frame random offsets (noise-like pattern at 60fps) for a visceral
 * earthquake feel rather than smooth oscillation.
 */
import { useEffect, useRef, useState } from 'react';

// Maximum pixel offset at intensity 1.0
const MAX_OFFSET_PX = 8;
// Maximum rotation in degrees at intensity 1.0
const MAX_ROTATION_DEG = 0.5;

interface EarthquakeCameraState {
  /** Horizontal shake offset in pixels */
  shakeX: number;
  /** Vertical shake offset in pixels */
  shakeY: number;
  /** Rotational shake in degrees */
  shakeRotation: number;
  /** Current shake intensity (0-1) */
  intensity: number;
  /** Whether the earthquake effect is currently active (intensity > 0) */
  isActive: boolean;
}

/**
 * Compute shake intensity from the absolute gap in seconds.
 * Uses piecewise linear interpolation across the defined intensity bands.
 */
function computeIntensity(absGap: number): number {
  if (absGap >= 2.0) return 0;
  if (absGap >= 1.0) {
    // 2.0 -> 0, 1.0 -> 0.3 (linear)
    const t = (2.0 - absGap) / 1.0;
    return t * 0.3;
  }
  if (absGap >= 0.5) {
    // 1.0 -> 0.3, 0.5 -> 0.7 (linear)
    const t = (1.0 - absGap) / 0.5;
    return 0.3 + t * 0.4;
  }
  if (absGap >= 0.1) {
    // 0.5 -> 0.7, 0.1 -> 0.9 (linear)
    const t = (0.5 - absGap) / 0.4;
    return 0.7 + t * 0.2;
  }
  // < 0.1s: intensity 1.0 (maximum chaos)
  return 1.0;
}

export function useEarthquakeCamera(
  gapSeconds: number | null,
  enabled: boolean,
): EarthquakeCameraState {
  const [state, setState] = useState<EarthquakeCameraState>({
    shakeX: 0,
    shakeY: 0,
    shakeRotation: 0,
    intensity: 0,
    isActive: false,
  });

  const rafRef = useRef<number | null>(null);
  const gapRef = useRef<number | null>(gapSeconds);
  const enabledRef = useRef(enabled);

  // Keep refs in sync to avoid stale closures in the RAF loop
  useEffect(() => {
    gapRef.current = gapSeconds;
  }, [gapSeconds]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    const tick = () => {
      const gap = gapRef.current;
      const isEnabled = enabledRef.current;

      if (!isEnabled || gap === null) {
        setState({
          shakeX: 0,
          shakeY: 0,
          shakeRotation: 0,
          intensity: 0,
          isActive: false,
        });
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const absGap = Math.abs(gap);
      const intensity = computeIntensity(absGap);

      if (intensity <= 0) {
        setState({
          shakeX: 0,
          shakeY: 0,
          shakeRotation: 0,
          intensity: 0,
          isActive: false,
        });
      } else {
        // Generate random offsets every frame for noise-like shake
        // Math.random() * 2 - 1 gives uniform random in [-1, 1]
        const shakeX = intensity * MAX_OFFSET_PX * (Math.random() * 2 - 1);
        const shakeY = intensity * MAX_OFFSET_PX * (Math.random() * 2 - 1);
        const shakeRotation = intensity * MAX_ROTATION_DEG * (Math.random() * 2 - 1);

        setState({
          shakeX,
          shakeY,
          shakeRotation,
          intensity,
          isActive: true,
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []); // Empty deps: the loop runs for the lifetime of the hook

  return state;
}

export default useEarthquakeCamera;
