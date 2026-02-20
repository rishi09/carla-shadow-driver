/**
 * useFrameExtrapolation.ts - Client-side camera motion extrapolation
 *
 * Applies very subtle CSS transforms to the video canvas between server
 * frames, based on the car's velocity and steering. This fills the ~33ms
 * gap between 30fps JPEG frames with smooth predicted motion, making the
 * video feed feel more fluid.
 *
 * When a new frame arrives (lastFrameTime changes), the extrapolation
 * smoothly interpolates back to identity over ~30ms to avoid a visible
 * snap when the real frame replaces the predicted position.
 *
 * The effect is intentionally very subtle (max +/-5px) to avoid any
 * jarring corrections when the real frame arrives.
 */
import { useRef, useEffect, useCallback, useState } from 'react';

// --- Tuning constants ---

/** Expected frame interval in seconds (30fps) */
const FRAME_INTERVAL = 0.033;

/** Max extrapolation beyond frame interval (seconds). Don't predict further than ~1.5 frames. */
const MAX_DT_EXCESS = 0.05;

/** Max lateral offset in pixels from steering extrapolation */
const MAX_TRANSLATE_X_PX = 5;

/** Max vertical offset in pixels from forward motion extrapolation */
const MAX_TRANSLATE_Y_PX = 5;

/**
 * Lateral pixels per unit of (steer * speed_factor * dt_excess).
 * steer is roughly -1..1, speed_factor 0..1, dt_excess 0..0.05.
 * We want max ~5px, so: 5 / (1 * 1 * 0.05) = 100
 */
const PX_PER_STEER_UNIT = 100;

/**
 * Vertical pixels per unit of (speed_factor * dt_excess).
 * speed_factor 0..1, dt_excess 0..0.05.
 * We want max ~5px, so: 5 / (1 * 0.05) = 100
 */
const PX_PER_SPEED_UNIT = 100;

/** Duration (ms) to interpolate back to identity when a new frame arrives */
const RESET_DURATION_MS = 30;

/** Speed (km/h) below which no extrapolation is applied */
const MIN_SPEED = 2;

export interface FrameExtrapolation {
  /** CSS transform string for the extrapolated motion offset */
  transform: string;
}

/**
 * Hook that applies subtle motion extrapolation between server frames.
 *
 * @param speedKmh - Current vehicle speed in km/h
 * @param steer - Current steering angle (approx -1..1)
 * @param lastFrameTime - Timestamp (performance.now()) of the last received frame
 * @param enabled - Whether extrapolation is active (e.g., only during racing)
 */
export function useFrameExtrapolation(
  speedKmh: number,
  steer: number,
  lastFrameTime: number,
  enabled: boolean,
): FrameExtrapolation {
  // Use refs for rapidly-changing values to avoid re-running effects
  const speedRef = useRef(speedKmh);
  const steerRef = useRef(steer);
  const lastFrameTimeRef = useRef(lastFrameTime);
  const enabledRef = useRef(enabled);

  // Keep refs in sync
  speedRef.current = speedKmh;
  steerRef.current = steer;
  enabledRef.current = enabled;

  // Track when a new frame arrives for the reset interpolation
  const prevLastFrameTimeRef = useRef(lastFrameTime);
  const resetStartRef = useRef<number | null>(null);
  const resetFromXRef = useRef(0);
  const resetFromYRef = useRef(0);

  // Current extrapolated offsets (mutable for rAF loop)
  const currentXRef = useRef(0);
  const currentYRef = useRef(0);

  const rafRef = useRef<number>(0);

  // The transform string exposed to React
  const [transform, setTransform] = useState<string>('none');

  // Detect new frame arrival and begin reset interpolation
  useEffect(() => {
    if (lastFrameTime !== prevLastFrameTimeRef.current) {
      prevLastFrameTimeRef.current = lastFrameTime;
      lastFrameTimeRef.current = lastFrameTime;

      // If we had non-zero offsets, start resetting smoothly
      if (Math.abs(currentXRef.current) > 0.01 || Math.abs(currentYRef.current) > 0.01) {
        resetStartRef.current = performance.now();
        resetFromXRef.current = currentXRef.current;
        resetFromYRef.current = currentYRef.current;
      }
    }
  }, [lastFrameTime]);

  // Build CSS transform from x/y offsets
  const buildTransform = useCallback((x: number, y: number): string => {
    if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05) {
      return 'none';
    }
    return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }, []);

  useEffect(() => {
    if (!enabled) {
      currentXRef.current = 0;
      currentYRef.current = 0;
      resetStartRef.current = null;
      setTransform('none');
      return;
    }

    const tick = () => {
      const now = performance.now();

      // --- Handle reset interpolation (new frame just arrived) ---
      if (resetStartRef.current !== null) {
        const resetElapsed = now - resetStartRef.current;
        if (resetElapsed >= RESET_DURATION_MS) {
          // Reset complete
          currentXRef.current = 0;
          currentYRef.current = 0;
          resetStartRef.current = null;
        } else {
          // Smooth interpolation back to zero
          const t = resetElapsed / RESET_DURATION_MS;
          currentXRef.current = resetFromXRef.current * (1 - t);
          currentYRef.current = resetFromYRef.current * (1 - t);
          setTransform(buildTransform(currentXRef.current, currentYRef.current));
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
      }

      // --- Compute extrapolation ---
      const speed = speedRef.current;
      const steering = steerRef.current;

      // Don't extrapolate at very low speeds or if disabled
      if (!enabledRef.current || speed < MIN_SPEED) {
        if (currentXRef.current !== 0 || currentYRef.current !== 0) {
          currentXRef.current = 0;
          currentYRef.current = 0;
          setTransform('none');
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const dt = (now - lastFrameTimeRef.current) / 1000;

      // Only extrapolate past the expected frame interval
      if (dt <= FRAME_INTERVAL) {
        // Within normal frame timing, keep at zero
        if (currentXRef.current !== 0 || currentYRef.current !== 0) {
          currentXRef.current = 0;
          currentYRef.current = 0;
          setTransform('none');
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // dt_excess is how far past the expected frame time we are
      const dtExcess = Math.min(dt - FRAME_INTERVAL, MAX_DT_EXCESS);

      // Speed factor: 0 at 0 km/h, 1 at 150+ km/h
      const speedFactor = Math.min(1.0, speed / 150);

      // Lateral offset: steering-based
      // steer is roughly -1..1, multiply by speed factor and time excess
      const rawX = steering * speedFactor * dtExcess * PX_PER_STEER_UNIT;
      const clampedX = Math.max(-MAX_TRANSLATE_X_PX, Math.min(MAX_TRANSLATE_X_PX, rawX));

      // Vertical offset: forward motion = slight upward shift (negative Y)
      const rawY = -speedFactor * dtExcess * PX_PER_SPEED_UNIT;
      const clampedY = Math.max(-MAX_TRANSLATE_Y_PX, Math.min(MAX_TRANSLATE_Y_PX, rawY));

      currentXRef.current = clampedX;
      currentYRef.current = clampedY;

      setTransform(buildTransform(clampedX, clampedY));
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, buildTransform]);

  return { transform };
}
