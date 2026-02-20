/**
 * useAmbientLight.ts - Ambient Light Racing
 *
 * Uses the webcam to detect room brightness and maps it to weather/time-of-day.
 * Dark room = night race. Bright room = sunny day. Turn on a desk lamp and the sun comes out.
 *
 * How it works:
 *   1. Requests a tiny 64x48 camera feed (minimal CPU/bandwidth)
 *   2. Samples brightness every 2 seconds by rendering video to a hidden canvas
 *   3. Calculates average luminance: sum(0.299*R + 0.587*G + 0.114*B) / numPixels
 *   4. Maps brightness to weather zones with hysteresis (>20 unit shift, sustained 3s)
 *   5. Sends weather override to server when zone changes
 */
import { useState, useRef, useCallback, useEffect } from 'react';

// --- Weather zone definitions ---
export type WeatherZone = 'night' | 'dusk' | 'day' | 'bright' | 'vivid';

interface ZoneConfig {
  zone: WeatherZone;
  minBrightness: number;
  maxBrightness: number;
  label: string;
  sunAltitude: number;
  cloudiness: number;
  precipitation: number;
}

const ZONES: ZoneConfig[] = [
  { zone: 'night',  minBrightness: 0,   maxBrightness: 40,  label: 'Night Race',  sunAltitude: -20, cloudiness: 10,  precipitation: 0  },
  { zone: 'dusk',   minBrightness: 40,  maxBrightness: 80,  label: 'Dusk/Dawn',   sunAltitude: 5,   cloudiness: 55,  precipitation: 0  },
  { zone: 'day',    minBrightness: 80,  maxBrightness: 140, label: 'Partly Cloudy', sunAltitude: 40,  cloudiness: 35,  precipitation: 0  },
  { zone: 'bright', minBrightness: 140, maxBrightness: 200, label: 'Sunny Day',   sunAltitude: 60,  cloudiness: 10,  precipitation: 0  },
  { zone: 'vivid',  minBrightness: 200, maxBrightness: 255, label: 'Blazing Sun', sunAltitude: 80,  cloudiness: 5,   precipitation: 0  },
];

// Hysteresis: brightness must shift by >20 units AND sustain for 3 seconds
const HYSTERESIS_THRESHOLD = 20;
const HYSTERESIS_SUSTAIN_MS = 3000;

// Sample brightness every 2 seconds (saves CPU)
const SAMPLE_INTERVAL_MS = 2000;

function brightnessToZone(brightness: number): ZoneConfig {
  for (const zone of ZONES) {
    if (brightness < zone.maxBrightness) {
      return zone;
    }
  }
  return ZONES[ZONES.length - 1];
}

export interface AmbientLightState {
  isSupported: boolean;
  isActive: boolean;
  brightness: number;
  weatherZone: WeatherZone;
  zoneLabel: string;
  enable: () => Promise<void>;
  disable: () => void;
}

export function useAmbientLight(): AmbientLightState {
  const [isActive, setIsActive] = useState(false);
  const [brightness, setBrightness] = useState(128);
  const [weatherZone, setWeatherZone] = useState<WeatherZone>('day');
  const [zoneLabel, setZoneLabel] = useState('Partly Cloudy');

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // Hysteresis state
  const lastConfirmedBrightnessRef = useRef(128);
  const pendingZoneRef = useRef<WeatherZone | null>(null);
  const pendingZoneStartRef = useRef<number>(0);

  // Zone change callback ref (set from Race.tsx)
  const onZoneChangeRef = useRef<((zone: WeatherZone, config: ZoneConfig) => void) | null>(null);

  // Check for camera support
  const isSupported = typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  const sampleBrightness = useCallback(() => {
    const video = videoRef.current;
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!video || !ctx || !canvas || video.readyState < 2) return;

    // Draw video frame to tiny canvas
    ctx.drawImage(video, 0, 0, 64, 48);
    const imageData = ctx.getImageData(0, 0, 64, 48);
    const data = imageData.data;

    // Calculate average luminance
    let totalLuminance = 0;
    const numPixels = 64 * 48;
    for (let i = 0; i < data.length; i += 4) {
      totalLuminance += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const avgBrightness = totalLuminance / numPixels;

    if (!isMountedRef.current) return;
    setBrightness(Math.round(avgBrightness));

    // Determine target zone from brightness
    const targetZoneConfig = brightnessToZone(avgBrightness);
    const currentZone = brightnessToZone(lastConfirmedBrightnessRef.current);

    // Check hysteresis: has brightness shifted enough?
    const brightnessDelta = Math.abs(avgBrightness - lastConfirmedBrightnessRef.current);

    if (targetZoneConfig.zone !== currentZone.zone && brightnessDelta > HYSTERESIS_THRESHOLD) {
      // New zone candidate detected
      if (pendingZoneRef.current !== targetZoneConfig.zone) {
        // Start sustain timer for new candidate
        pendingZoneRef.current = targetZoneConfig.zone;
        pendingZoneStartRef.current = Date.now();
      } else {
        // Same candidate -- check if sustained long enough
        const elapsed = Date.now() - pendingZoneStartRef.current;
        if (elapsed >= HYSTERESIS_SUSTAIN_MS) {
          // Confirmed zone change
          lastConfirmedBrightnessRef.current = avgBrightness;
          pendingZoneRef.current = null;
          pendingZoneStartRef.current = 0;

          if (isMountedRef.current) {
            setWeatherZone(targetZoneConfig.zone);
            setZoneLabel(targetZoneConfig.label);
            // Notify callback
            if (onZoneChangeRef.current) {
              onZoneChangeRef.current(targetZoneConfig.zone, targetZoneConfig);
            }
          }
        }
      }
    } else if (targetZoneConfig.zone === currentZone.zone) {
      // Back to original zone -- cancel pending change
      pendingZoneRef.current = null;
      pendingZoneStartRef.current = 0;
    }
  }, []);

  const enable = useCallback(async () => {
    if (!isSupported) return;
    if (isActive) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 64, height: 48 },
      });
      streamRef.current = stream;

      // Create hidden video element
      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('muted', 'true');
      video.style.position = 'absolute';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.style.overflow = 'hidden';
      document.body.appendChild(video);
      await video.play();
      videoRef.current = video;

      // Create hidden canvas for brightness sampling
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 48;
      canvasRef.current = canvas;
      ctxRef.current = canvas.getContext('2d', { willReadFrequently: true });

      // Start sampling interval
      intervalRef.current = setInterval(sampleBrightness, SAMPLE_INTERVAL_MS);

      if (isMountedRef.current) {
        setIsActive(true);
      }
    } catch (err) {
      console.warn('[ambient-light] Camera access denied or failed:', err);
    }
  }, [isSupported, isActive, sampleBrightness]);

  const disable = useCallback(() => {
    // Stop sampling
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Stop camera stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Remove hidden video element
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      if (videoRef.current.parentNode) {
        videoRef.current.parentNode.removeChild(videoRef.current);
      }
      videoRef.current = null;
    }

    canvasRef.current = null;
    ctxRef.current = null;

    // Reset hysteresis state
    lastConfirmedBrightnessRef.current = 128;
    pendingZoneRef.current = null;
    pendingZoneStartRef.current = 0;

    if (isMountedRef.current) {
      setIsActive(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Stop everything on unmount
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
        if (videoRef.current.parentNode) {
          videoRef.current.parentNode.removeChild(videoRef.current);
        }
        videoRef.current = null;
      }
    };
  }, []);

  return {
    isSupported,
    isActive,
    brightness,
    weatherZone,
    zoneLabel,
    enable,
    disable,
  };
}

// Export zone config for use by other components
export { ZONES };
export type { ZoneConfig };

/**
 * Maps a weather zone to the server-side weather parameters.
 * Used by Race.tsx to send ambient_weather messages.
 */
export function zoneToWeatherParams(zone: WeatherZone): { sun_altitude: number; cloudiness: number; precipitation: number } {
  const config = ZONES.find(z => z.zone === zone);
  if (!config) {
    return { sun_altitude: 40, cloudiness: 35, precipitation: 0 };
  }
  return {
    sun_altitude: config.sunAltitude,
    cloudiness: config.cloudiness,
    precipitation: config.precipitation,
  };
}
