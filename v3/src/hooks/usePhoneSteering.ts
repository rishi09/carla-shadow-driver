/**
 * usePhoneSteering.ts - Phone gyroscope steering for Shadow Driver v3
 *
 * Turns the phone into a steering wheel using the DeviceOrientationEvent API.
 * Hold the phone in landscape orientation, tilted slightly toward you.
 *
 * Mapping:
 *   gamma (left/right tilt)      -> steering: -45..+45 deg maps to -1..+1
 *   beta  (forward/backward tilt) -> throttle/brake:
 *     beta < 30  (tilted toward screen)  -> throttle = (30 - beta) / 20, clamped 0-1
 *     beta > 50  (tilted away from screen) -> brake = (beta - 50) / 20, clamped 0-1
 *
 * Smoothing: exponential moving average (alpha = 0.3) to reduce gyroscope jitter.
 *
 * iOS 13+ requires explicit permission via DeviceOrientationEvent.requestPermission().
 */
import { useState, useCallback, useRef, useEffect } from 'react';

const EMA_ALPHA = 0.3;
const STEER_MAX_DEGREES = 45;

/** Check if DeviceOrientationEvent is available in this browser */
function isDeviceOrientationSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

export interface PhoneSteeringState {
  /** Whether DeviceOrientationEvent is available in this browser */
  isSupported: boolean;
  /** Whether phone steering is currently active (listening to orientation events) */
  isActive: boolean;
  /** Request permission (iOS 13+) and start listening to orientation events */
  enable: () => Promise<void>;
  /** Stop listening to orientation events */
  disable: () => void;
  /** Smoothed steering value: -1 (full left) to 1 (full right) */
  steer: number;
  /** Smoothed throttle value: 0 to 1 */
  throttle: number;
  /** Smoothed brake value: 0 to 1 */
  brake: number;
  /** Trigger phone vibration (e.g. on collision). No-op if Vibration API unavailable. */
  vibrate: (pattern?: number | number[]) => void;
}

export function usePhoneSteering(): PhoneSteeringState {
  const [isActive, setIsActive] = useState(false);
  const [steer, setSteer] = useState(0);
  const [throttle, setThrottle] = useState(0);
  const [brake, setBrake] = useState(0);

  // Smoothed values stored in refs for the EMA calculation (avoids stale closures)
  const smoothSteerRef = useRef(0);
  const smoothThrottleRef = useRef(0);
  const smoothBrakeRef = useRef(0);

  // Throttle React state updates to ~30Hz to avoid excessive re-renders
  const lastUpdateRef = useRef(0);
  const UPDATE_INTERVAL = 33; // ~30Hz

  // Event listener ref for cleanup
  const listenerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);

  const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
    const gamma = e.gamma ?? 0; // left/right tilt in degrees (-90..90)
    const beta = e.beta ?? 0;   // front/back tilt in degrees (-180..180)

    // --- Steering: gamma mapped to -1..1 ---
    const rawSteer = Math.max(-1, Math.min(1, gamma / STEER_MAX_DEGREES));

    // --- Throttle: beta < 30 means tilted forward (toward screen) ---
    let rawThrottle = 0;
    if (beta < 30) {
      rawThrottle = Math.max(0, Math.min(1, (30 - beta) / 20));
    }

    // --- Brake: beta > 50 means tilted backward (away from screen) ---
    let rawBrake = 0;
    if (beta > 50) {
      rawBrake = Math.max(0, Math.min(1, (beta - 50) / 20));
    }

    // --- Exponential moving average smoothing ---
    smoothSteerRef.current = smoothSteerRef.current * (1 - EMA_ALPHA) + rawSteer * EMA_ALPHA;
    smoothThrottleRef.current = smoothThrottleRef.current * (1 - EMA_ALPHA) + rawThrottle * EMA_ALPHA;
    smoothBrakeRef.current = smoothBrakeRef.current * (1 - EMA_ALPHA) + rawBrake * EMA_ALPHA;

    // Throttle React state updates
    const now = performance.now();
    if (now - lastUpdateRef.current >= UPDATE_INTERVAL) {
      lastUpdateRef.current = now;
      setSteer(smoothSteerRef.current);
      setThrottle(smoothThrottleRef.current);
      setBrake(smoothBrakeRef.current);
    }
  }, []);

  const enable = useCallback(async () => {
    if (!isDeviceOrientationSupported()) return;

    // iOS 13+ requires explicit permission request
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission === 'function') {
      try {
        const response = await DOE.requestPermission();
        if (response !== 'granted') {
          console.warn('[PhoneSteering] Permission denied');
          return;
        }
      } catch (err) {
        console.error('[PhoneSteering] Permission request failed:', err);
        return;
      }
    }

    // Reset smoothed values
    smoothSteerRef.current = 0;
    smoothThrottleRef.current = 0;
    smoothBrakeRef.current = 0;
    setSteer(0);
    setThrottle(0);
    setBrake(0);

    // Start listening
    const handler = (e: DeviceOrientationEvent) => handleOrientation(e);
    listenerRef.current = handler;
    window.addEventListener('deviceorientation', handler);
    setIsActive(true);
    console.log('[PhoneSteering] Enabled');
  }, [handleOrientation]);

  const disable = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener('deviceorientation', listenerRef.current);
      listenerRef.current = null;
    }
    smoothSteerRef.current = 0;
    smoothThrottleRef.current = 0;
    smoothBrakeRef.current = 0;
    setSteer(0);
    setThrottle(0);
    setBrake(0);
    setIsActive(false);
    console.log('[PhoneSteering] Disabled');
  }, []);

  const vibrate = useCallback((pattern: number | number[] = 100) => {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        window.removeEventListener('deviceorientation', listenerRef.current);
        listenerRef.current = null;
      }
    };
  }, []);

  return {
    isSupported: isDeviceOrientationSupported(),
    isActive,
    enable,
    disable,
    steer,
    throttle,
    brake,
    vibrate,
  };
}

export default usePhoneSteering;
