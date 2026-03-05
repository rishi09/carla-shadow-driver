/**
 * useEyeTracking.ts - Steer by looking left/right via webcam
 *
 * Uses the browser's getUserMedia API to access the webcam,
 * then does simple face position tracking (no TensorFlow needed)
 * by detecting the face's horizontal position in the frame using
 * skin-tone pixel detection and centroid calculation.
 *
 * Looking left = steer left, looking right = steer right.
 *
 * Wild Idea #2 from TODO.md
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// Capture resolution (low for performance)
const CAPTURE_WIDTH = 320;
const CAPTURE_HEIGHT = 240;

// Tracking interval (10 fps = 100ms)
const TRACK_INTERVAL_MS = 100;

// Exponential moving average smoothing factor (0 = no update, 1 = instant)
const EMA_ALPHA = 0.3;

// Minimum skin pixels to consider a face detected
const MIN_SKIN_PIXELS = 200;

/**
 * Simple skin-tone detection.
 * Returns true if the pixel (R, G, B) falls within a broad skin-tone range.
 * Works across a variety of skin tones under typical webcam lighting.
 */
function isSkinTone(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    r > g &&
    r > b &&
    (max - min) > 15 &&
    Math.abs(r - g) > 15
  );
}

interface UseEyeTrackingOptions {
  enabled: boolean;
  sensitivity?: number;  // 0.5-2.0, default 1.0
  deadzone?: number;     // 0-0.3, default 0.1 -- center zone with no steering
}

interface UseEyeTrackingReturn {
  steeringValue: number;           // -1 to 1, based on face position
  isTracking: boolean;
  hasPermission: boolean | null;   // null = not asked yet
  faceDetected: boolean;
  calibrationCenter: number;       // 0-1, the "center" x position
  requestPermission: () => Promise<boolean>;
  calibrate: () => void;           // sets current face position as center
  cleanup: () => void;
}

export function useEyeTracking(options: UseEyeTrackingOptions): UseEyeTrackingReturn {
  const { enabled, sensitivity = 1.0, deadzone = 0.1 } = options;

  // -- State --
  const [steeringValue, setSteeringValue] = useState(0);
  const [isTracking, setIsTracking] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [calibrationCenter, setCalibrationCenter] = useState(0.5);

  // -- Refs --
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const smoothedXRef = useRef(0.5);        // EMA-smoothed normalized x (0-1)
  const rawCentroidXRef = useRef(0.5);     // last raw centroid x for calibrate()
  const calibrationCenterRef = useRef(0.5);
  const sensitivityRef = useRef(sensitivity);
  const deadzoneRef = useRef(deadzone);

  // Keep refs in sync with props
  sensitivityRef.current = sensitivity;
  deadzoneRef.current = deadzone;

  /** Create offscreen video and canvas elements */
  const initElements = useCallback(() => {
    if (!videoRef.current) {
      const video = document.createElement('video');
      video.width = CAPTURE_WIDTH;
      video.height = CAPTURE_HEIGHT;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      videoRef.current = video;
    }
    if (!canvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = CAPTURE_WIDTH;
      canvas.height = CAPTURE_HEIGHT;
      canvasRef.current = canvas;
      ctxRef.current = canvas.getContext('2d', { willReadFrequently: true });
    }
  }, []);

  /** Process a single frame: detect skin-tone centroid, compute steering */
  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const ctx = ctxRef.current;
    if (!video || !ctx || video.readyState < video.HAVE_CURRENT_DATA) return;

    // Draw current video frame to offscreen canvas
    ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    const imageData = ctx.getImageData(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    const data = imageData.data;

    // Scan for skin-tone pixels and compute centroid
    let sumX = 0;
    let skinCount = 0;

    for (let y = 0; y < CAPTURE_HEIGHT; y++) {
      for (let x = 0; x < CAPTURE_WIDTH; x++) {
        const i = (y * CAPTURE_WIDTH + x) * 4;
        if (isSkinTone(data[i], data[i + 1], data[i + 2])) {
          sumX += x;
          skinCount++;
        }
      }
    }

    const detected = skinCount >= MIN_SKIN_PIXELS;
    setFaceDetected(detected);

    if (!detected) {
      // No face: decay steering toward 0
      smoothedXRef.current += (0.5 - smoothedXRef.current) * 0.1;
      setSteeringValue(0);
      return;
    }

    // Compute centroid x, normalize to 0-1
    const centroidX = sumX / skinCount;
    const normalizedX = centroidX / CAPTURE_WIDTH;
    rawCentroidXRef.current = normalizedX;

    // Apply EMA smoothing
    smoothedXRef.current += (normalizedX - smoothedXRef.current) * EMA_ALPHA;
    const smoothed = smoothedXRef.current;

    // Compute offset from calibration center
    // Note: webcam is mirrored, so face moving right in frame = person looking left
    // We invert so looking right steers right
    const offset = -(smoothed - calibrationCenterRef.current);

    // Apply deadzone
    const dz = deadzoneRef.current;
    let steering: number;
    if (Math.abs(offset) < dz) {
      steering = 0;
    } else {
      // Remap so that just outside deadzone starts at 0
      const sign = offset > 0 ? 1 : -1;
      const remapped = (Math.abs(offset) - dz) / (1 - dz);
      steering = sign * remapped;
    }

    // Apply sensitivity
    steering *= sensitivityRef.current;

    // Clamp to [-1, 1]
    steering = Math.max(-1, Math.min(1, steering));

    setSteeringValue(steering);
  }, []);

  /** Stop the media stream and tracking interval */
  const cleanup = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsTracking(false);
    setFaceDetected(false);
    setSteeringValue(0);
    smoothedXRef.current = 0.5;
  }, []);

  /** Start tracking: attach stream to video, begin processing frames */
  const startTracking = useCallback(() => {
    if (!streamRef.current || !videoRef.current) return;

    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play();

    // Start frame processing interval
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(processFrame, TRACK_INTERVAL_MS);
    setIsTracking(true);
  }, [processFrame]);

  /** Request webcam permission and start tracking */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      initElements();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: CAPTURE_WIDTH },
          height: { ideal: CAPTURE_HEIGHT },
          facingMode: 'user',
        },
      });
      streamRef.current = stream;
      setHasPermission(true);
      startTracking();
      return true;
    } catch {
      setHasPermission(false);
      return false;
    }
  }, [initElements, startTracking]);

  /** Set current face position as the new "center" for steering */
  const calibrate = useCallback(() => {
    const newCenter = rawCentroidXRef.current;
    calibrationCenterRef.current = newCenter;
    smoothedXRef.current = newCenter;
    setCalibrationCenter(newCenter);
    setSteeringValue(0);
  }, []);

  // Auto-start or stop tracking when enabled changes
  useEffect(() => {
    if (enabled && hasPermission && !isTracking) {
      if (streamRef.current) {
        startTracking();
      } else {
        void requestPermission();
      }
    } else if (!enabled && isTracking) {
      cleanup();
    }
  }, [enabled, hasPermission, isTracking, startTracking, requestPermission, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    steeringValue,
    isTracking,
    hasPermission,
    faceDetected,
    calibrationCenter,
    requestPermission,
    calibrate,
    cleanup,
  };
}

export default useEyeTracking;
