/**
 * useInterpolatedState - Smoothly interpolates a numeric value at 60fps
 * Takes a value that updates at ~30fps (from server) and returns a
 * smoothly interpolated value that updates at 60fps via requestAnimationFrame.
 */
import { useState, useEffect, useRef } from 'react';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Expected interval between server updates (30fps = ~33ms) */
const EXPECTED_INTERVAL = 1000 / 30;

export function useInterpolatedState(serverValue: number): number {
  const [interpolated, setInterpolated] = useState(serverValue);

  const prevValueRef = useRef(serverValue);
  const currentValueRef = useRef(serverValue);
  const lastUpdateTimeRef = useRef(performance.now());
  const rafRef = useRef<number | null>(null);

  // When the server value changes, shift current -> prev and record timestamp
  useEffect(() => {
    prevValueRef.current = currentValueRef.current;
    currentValueRef.current = serverValue;
    lastUpdateTimeRef.current = performance.now();
  }, [serverValue]);

  // Run a 60fps animation loop that interpolates between prev and current
  useEffect(() => {
    function tick() {
      const elapsed = performance.now() - lastUpdateTimeRef.current;
      const t = Math.min(1, elapsed / EXPECTED_INTERVAL);
      const value = lerp(prevValueRef.current, currentValueRef.current, t);
      setInterpolated(value);
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
