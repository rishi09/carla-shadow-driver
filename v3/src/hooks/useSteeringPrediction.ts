/**
 * useSteeringPrediction.ts - Client-side steering prediction
 *
 * Applies immediate CSS transforms to the video canvas when the player
 * presses steering/throttle/brake keys, masking the ~80-200ms network
 * latency before the server frame reflects the input.
 *
 * Uses GPU-accelerated CSS transforms (perspective + rotateY + translateX
 * for steering, rotateX for throttle/brake) with smooth interpolation
 * via requestAnimationFrame.
 *
 * Speed-dependent: mirrors the server's steer limits so the visual
 * prediction matches the actual steering authority at each speed range.
 * At low speed (more lock), the rotation is larger; at high speed (less
 * lock), it's barely perceptible -- matching driver expectations.
 *
 * The effect is intentionally subtle: just enough to give instant visual
 * feedback without causing a jarring snap when the real server frame arrives.
 *
 * Optimized: only triggers React re-renders when the computed transform
 * string actually changes, avoiding unnecessary setState at 60fps.
 */
import { useRef, useEffect, useCallback, useState } from 'react';
import type { KeyState } from '../types/index.ts';

export interface SteeringPrediction {
  /** CSS transform string to apply to the video wrapper */
  transform: string;
  /** CSS transition string (used for minor smoothing) */
  transition: string;
}

// --- Tuning constants ---

// Maximum rotation/shift at full steer authority (low speed, steer_limit=0.5)
// These are scaled down proportionally at higher speeds.
const BASE_ROTATE_Y_DEG = 2.8;       // Max yaw rotation in degrees at full authority
const BASE_TRANSLATE_X_PX = 18;      // Max lateral shift in pixels at full authority
const STEER_ATTACK_RATE = 0.08;      // Per-frame interpolation toward target (0-1), ~80ms to full
const STEER_RELEASE_RATE = 0.055;    // Per-frame interpolation back to neutral, ~120ms

// Throttle/Brake (W/S): rotateX (pitch)
const MAX_PITCH_THROTTLE_DEG = -0.8; // Forward tilt on acceleration (negative = tilt forward)
const MAX_PITCH_BRAKE_DEG = 0.8;     // Backward tilt on braking
const PITCH_ATTACK_RATE = 0.05;      // Slower pitch attack
const PITCH_RELEASE_RATE = 0.04;     // Slower pitch release

// Perspective for 3D transform
const PERSPECTIVE_PX = 800;

/**
 * Compute the steer limit factor (0-1) based on speed, mirroring the server's
 * speed-dependent steering limits from carla_manager.py.
 *
 * Server formula (exponential curve):
 *   steer_limit = 0.08 + 0.42 * exp(-speed / 70)
 *
 * At 0 km/h:   0.50 (factor = 1.0)
 * At 30 km/h:  0.35 (factor = 0.70)
 * At 70 km/h:  0.23 (factor = 0.46)
 * At 120 km/h: 0.16 (factor = 0.31)
 * At 200 km/h: 0.10 (factor = 0.20)
 *
 * We normalize against the maximum (0.5) to get a 0-1 factor.
 */
function getSteerFactor(speedKmh: number): number {
  const steerLimit = 0.08 + 0.42 * Math.exp(-speedKmh / 70.0);
  // Normalize to 0-1 range (max steer_limit is 0.50 at speed=0)
  return steerLimit / 0.50;
}

/**
 * Hook that reads from a KeyState ref and produces a smoothly-interpolated
 * CSS transform for client-side steering prediction.
 *
 * @param keysRef - React ref to the current keyboard state
 * @param enabled - Whether prediction is active (e.g., only during racing)
 * @param speedKmh - Current vehicle speed in km/h (for speed-dependent prediction)
 */
export function useSteeringPrediction(
  keysRef: React.RefObject<KeyState>,
  enabled: boolean,
  speedKmh: number = 0,
): SteeringPrediction {
  // Current interpolated values (mutable for rAF loop)
  const currentYawRef = useRef(0);    // -1 to 1
  const currentPitchRef = useRef(0);  // -1 to 1
  const rafRef = useRef<number>(0);
  const speedRef = useRef(speedKmh);

  // Keep speed ref in sync without causing effect re-runs
  speedRef.current = speedKmh;

  // The transform string exposed to React
  const [transform, setTransform] = useState('none');
  // Track last emitted transform to avoid redundant setState
  const lastTransformRef = useRef('none');

  // Build the CSS transform string from current interpolated values
  const buildTransform = useCallback((yaw: number, pitch: number, speed: number): string => {
    // Dead-zone: if both values are essentially zero, return 'none' to avoid
    // unnecessary compositing layers
    if (Math.abs(yaw) < 0.001 && Math.abs(pitch) < 0.001) {
      return 'none';
    }

    // Scale the steering prediction by speed-dependent steer factor
    const steerFactor = getSteerFactor(speed);

    const rotateY = yaw * BASE_ROTATE_Y_DEG * steerFactor;
    const translateX = yaw * BASE_TRANSLATE_X_PX * steerFactor;
    const rotateX = pitch > 0
      ? pitch * MAX_PITCH_BRAKE_DEG
      : pitch * -MAX_PITCH_THROTTLE_DEG;

    return `perspective(${PERSPECTIVE_PX}px) rotateY(${rotateY.toFixed(2)}deg) rotateX(${rotateX.toFixed(2)}deg) translateX(${translateX.toFixed(1)}px)`;
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Reset when disabled
      currentYawRef.current = 0;
      currentPitchRef.current = 0;
      if (lastTransformRef.current !== 'none') {
        lastTransformRef.current = 'none';
        setTransform('none');
      }
      return;
    }

    const tick = () => {
      const keys = keysRef.current;

      // --- Compute target yaw ---
      let targetYaw = 0;
      if (keys) {
        if (keys.a && !keys.d) targetYaw = -1;
        else if (keys.d && !keys.a) targetYaw = 1;
      }

      // --- Compute target pitch ---
      let targetPitch = 0;
      if (keys) {
        if (keys.w && !keys.s) targetPitch = -1;  // throttle = tilt forward
        else if (keys.s && !keys.w) targetPitch = 1;  // brake = tilt back
      }

      // --- Interpolate yaw ---
      const yawDiff = targetYaw - currentYawRef.current;
      if (Math.abs(yawDiff) > 0.001) {
        const rate = Math.abs(targetYaw) > Math.abs(currentYawRef.current)
          ? STEER_ATTACK_RATE
          : STEER_RELEASE_RATE;
        currentYawRef.current += yawDiff * rate;
      } else {
        currentYawRef.current = targetYaw;
      }

      // --- Interpolate pitch ---
      const pitchDiff = targetPitch - currentPitchRef.current;
      if (Math.abs(pitchDiff) > 0.001) {
        const rate = Math.abs(targetPitch) > Math.abs(currentPitchRef.current)
          ? PITCH_ATTACK_RATE
          : PITCH_RELEASE_RATE;
        currentPitchRef.current += pitchDiff * rate;
      } else {
        currentPitchRef.current = targetPitch;
      }

      // --- Update CSS transform only if it changed ---
      const newTransform = buildTransform(currentYawRef.current, currentPitchRef.current, speedRef.current);
      if (newTransform !== lastTransformRef.current) {
        lastTransformRef.current = newTransform;
        setTransform(newTransform);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, keysRef, buildTransform]);

  return {
    transform,
    transition: 'transform 0.05s ease-out',
  };
}
