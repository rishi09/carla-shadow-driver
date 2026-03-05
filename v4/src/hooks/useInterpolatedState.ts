/**
 * useInterpolatedState - Smoothly interpolates a numeric value at 60fps
 * Takes a value that updates at a server-driven rate and returns a
 * smoothly interpolated value that updates at 60fps via requestAnimationFrame.
 *
 * The interpolation interval is auto-detected from the actual time between
 * value updates, so it adapts to any server rate (30Hz, 60Hz, etc.).
 *
 * Optimized: only triggers React re-renders when the interpolated value
 * changes by more than a small epsilon, avoiding unnecessary renders when
 * the value has stabilized.
 */
import { useState, useEffect, useRef } from 'react';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Fallback interval if we haven't received two updates yet (30fps = ~33ms) */
const DEFAULT_INTERVAL = 1000 / 30;

/** Smoothing factor for the interval estimate (EMA) to avoid jitter */
const INTERVAL_SMOOTHING = 0.3;

/** Minimum change in value to trigger a React state update */
const EPSILON = 0.01;

export function useInterpolatedState(serverValue: number): number {
  const [interpolated, setInterpolated] = useState(serverValue);

  const prevValueRef = useRef(serverValue);
  const currentValueRef = useRef(serverValue);
  const lastUpdateTimeRef = useRef(performance.now());
  const estimatedIntervalRef = useRef(DEFAULT_INTERVAL);
  const hasSecondUpdateRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastRenderedRef = useRef(serverValue);

  // When the server value changes, shift current -> prev and record timestamp
  useEffect(() => {
    const now = performance.now();
    const delta = now - lastUpdateTimeRef.current;

    // Auto-detect interval from actual update timing
    // Only update if delta is reasonable (between 1ms and 500ms to reject outliers)
    if (delta > 1 && delta < 500) {
      if (hasSecondUpdateRef.current) {
        // Exponential moving average to smooth out jitter
        estimatedIntervalRef.current =
          estimatedIntervalRef.current * (1 - INTERVAL_SMOOTHING) +
          delta * INTERVAL_SMOOTHING;
      } else {
        // First measured interval - use it directly
        estimatedIntervalRef.current = delta;
        hasSecondUpdateRef.current = true;
      }
    }

    prevValueRef.current = currentValueRef.current;
    currentValueRef.current = serverValue;
    lastUpdateTimeRef.current = now;
  }, [serverValue]);

  // Run a 60fps animation loop that interpolates between prev and current
  useEffect(() => {
    function tick() {
      const elapsed = performance.now() - lastUpdateTimeRef.current;
      const t = Math.min(1, elapsed / estimatedIntervalRef.current);
      const value = lerp(prevValueRef.current, currentValueRef.current, t);

      // Only trigger a React re-render if the value changed meaningfully
      if (Math.abs(value - lastRenderedRef.current) > EPSILON) {
        lastRenderedRef.current = value;
        setInterpolated(value);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return interpolated;
}

export default useInterpolatedState;
