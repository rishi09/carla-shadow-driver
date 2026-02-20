/**
 * useHeadTracking.ts - Head-tracking camera control
 *
 * Uses the browser's FaceDetector API (Chrome 94+) to track the player's
 * face position via webcam. The face center position relative to the frame
 * center is mapped to CSS transform offsets:
 *
 *   - Horizontal offset -> camera X shift (lean left/right to look around)
 *   - Vertical offset   -> camera Y shift (lean up/down)
 *   - Face bounding box area -> FOV adjustment (lean closer = narrower FOV)
 *
 * EMA smoothing (alpha=0.15) prevents jitter. Detection runs at 10fps
 * (every 100ms) to minimize CPU overhead.
 *
 * The FaceDetector API is only available in Chromium-based browsers.
 * When unavailable, the hook returns { isSupported: false } and does nothing.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

// --- Configuration ---
const DETECTION_INTERVAL_MS = 100; // 10fps detection
const EMA_ALPHA = 0.15;           // Smoothing factor (lower = smoother, slower)
const MAX_OFFSET_X = 10;          // Max horizontal shift in px
const MAX_OFFSET_Y = 5;           // Max vertical shift in px
const VIDEO_WIDTH = 320;
const VIDEO_HEIGHT = 240;

// FOV adjustment: face area relative to frame area
// When face fills ~15% of frame -> "close" -> narrower FOV (negative adjust)
// When face fills ~3% of frame -> "far" -> wider FOV (positive adjust)
const FOV_CLOSE_AREA_RATIO = 0.15;
const FOV_FAR_AREA_RATIO = 0.03;
const FOV_ADJUST_RANGE = 0.08;    // Max FOV scale adjustment (e.g. 0.08 = 8%)

/** Feature-detect the FaceDetector API (Chrome 94+, behind flag in some builds) */
function isFaceDetectorSupported(): boolean {
  return typeof window !== 'undefined' && 'FaceDetector' in window;
}

export interface HeadTrackingState {
  /** Whether the FaceDetector API is available in this browser */
  isSupported: boolean;
  /** Whether head tracking is currently active (webcam running + detecting) */
  enabled: boolean;
  /** Smoothed horizontal offset in px (-MAX_OFFSET_X to +MAX_OFFSET_X) */
  offsetX: number;
  /** Smoothed vertical offset in px (-MAX_OFFSET_Y to +MAX_OFFSET_Y) */
  offsetY: number;
  /** FOV scale adjustment (-FOV_ADJUST_RANGE to +FOV_ADJUST_RANGE) */
  fovAdjust: number;
  /** Whether detection loop is actively running */
  isTracking: boolean;
  /** Whether a face is currently detected */
  faceDetected: boolean;
  /** Reference to the hidden video element (for the indicator preview) */
  videoElement: HTMLVideoElement | null;
  /** Enable head tracking (requests webcam permission) */
  enable: () => Promise<void>;
  /** Disable head tracking (stops webcam) */
  disable: () => void;
}

export function useHeadTracking(): HeadTrackingState {
  const [enabled, setEnabled] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [fovAdjust, setFovAdjust] = useState(0);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<InstanceType<typeof FaceDetector> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // EMA state (kept in refs to avoid re-render churn)
  const smoothXRef = useRef(0);
  const smoothYRef = useRef(0);
  const smoothFovRef = useRef(0);

  // Track last emitted values to only re-render when meaningful change occurs
  const lastEmittedRef = useRef({ x: 0, y: 0, fov: 0, face: false });

  const isSupported = isFaceDetectorSupported();

  // Declare FaceDetector type for TypeScript
  // (The FaceDetector API is not in standard lib types)
  type FaceDetectorType = {
    new(options?: { fastMode?: boolean; maxDetectedFaces?: number }): {
      detect(image: HTMLVideoElement | HTMLCanvasElement | ImageBitmap): Promise<Array<{
        boundingBox: DOMRectReadOnly;
        landmarks?: Array<{ type: string; locations: Array<{ x: number; y: number }> }>;
      }>>;
    };
  };

  const detect = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || video.readyState < 2) return;

    try {
      const faces = await detector.detect(video);

      if (!isMountedRef.current) return;

      if (faces.length === 0) {
        // No face: decay offsets toward zero
        smoothXRef.current *= (1 - EMA_ALPHA);
        smoothYRef.current *= (1 - EMA_ALPHA);
        smoothFovRef.current *= (1 - EMA_ALPHA);

        // Only update state if meaningfully changed
        const x = Math.round(smoothXRef.current * 10) / 10;
        const y = Math.round(smoothYRef.current * 10) / 10;
        const fov = Math.round(smoothFovRef.current * 1000) / 1000;
        const prev = lastEmittedRef.current;

        if (prev.face !== false || Math.abs(x - prev.x) > 0.3 || Math.abs(y - prev.y) > 0.2) {
          setFaceDetected(false);
          setOffsetX(x);
          setOffsetY(y);
          setFovAdjust(fov);
          lastEmittedRef.current = { x, y, fov, face: false };
        }
        return;
      }

      // Use the first (largest / most confident) detected face
      const face = faces[0];
      const box = face.boundingBox;

      // Face center relative to frame center, normalized to -1..1
      const faceCenterX = (box.x + box.width / 2) / VIDEO_WIDTH;
      const faceCenterY = (box.y + box.height / 2) / VIDEO_HEIGHT;
      const relativeX = (faceCenterX - 0.5) * 2; // -1 (left) to 1 (right)
      const relativeY = (faceCenterY - 0.5) * 2; // -1 (top) to 1 (bottom)

      // Mirror horizontal: webcam is mirrored, so lean left = face moves right in frame
      const rawOffsetX = -relativeX * MAX_OFFSET_X;
      const rawOffsetY = relativeY * MAX_OFFSET_Y;

      // Face area relative to frame area -> FOV adjustment
      const faceAreaRatio = (box.width * box.height) / (VIDEO_WIDTH * VIDEO_HEIGHT);
      // Map area ratio to FOV adjustment: closer = negative (zoom in), farther = positive
      const normalizedArea = Math.max(0, Math.min(1,
        (faceAreaRatio - FOV_FAR_AREA_RATIO) / (FOV_CLOSE_AREA_RATIO - FOV_FAR_AREA_RATIO)
      ));
      const rawFovAdjust = (0.5 - normalizedArea) * FOV_ADJUST_RANGE * 2;

      // Apply EMA smoothing
      smoothXRef.current = smoothXRef.current * (1 - EMA_ALPHA) + rawOffsetX * EMA_ALPHA;
      smoothYRef.current = smoothYRef.current * (1 - EMA_ALPHA) + rawOffsetY * EMA_ALPHA;
      smoothFovRef.current = smoothFovRef.current * (1 - EMA_ALPHA) + rawFovAdjust * EMA_ALPHA;

      // Clamp
      smoothXRef.current = Math.max(-MAX_OFFSET_X, Math.min(MAX_OFFSET_X, smoothXRef.current));
      smoothYRef.current = Math.max(-MAX_OFFSET_Y, Math.min(MAX_OFFSET_Y, smoothYRef.current));
      smoothFovRef.current = Math.max(-FOV_ADJUST_RANGE, Math.min(FOV_ADJUST_RANGE, smoothFovRef.current));

      // Round for display and to reduce re-renders
      const x = Math.round(smoothXRef.current * 10) / 10;
      const y = Math.round(smoothYRef.current * 10) / 10;
      const fov = Math.round(smoothFovRef.current * 1000) / 1000;
      const prev = lastEmittedRef.current;

      if (prev.face !== true || Math.abs(x - prev.x) > 0.3 || Math.abs(y - prev.y) > 0.2 || Math.abs(fov - prev.fov) > 0.002) {
        setFaceDetected(true);
        setOffsetX(x);
        setOffsetY(y);
        setFovAdjust(fov);
        lastEmittedRef.current = { x, y, fov, face: true };
      }
    } catch (err) {
      // Detection failed (e.g. video not ready) - silently ignore
      console.warn('[head-tracking] Detection error:', err);
    }
  }, []);

  const enable = useCallback(async () => {
    if (!isSupported) return;
    if (enabled) return;

    try {
      // Request webcam
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, facingMode: 'user' },
      });
      streamRef.current = stream;

      // Create hidden video element
      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('muted', 'true');
      video.muted = true;
      video.style.position = 'absolute';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.style.overflow = 'hidden';
      document.body.appendChild(video);
      await video.play();
      videoRef.current = video;

      // Create FaceDetector instance
      const FD = (window as unknown as Record<string, FaceDetectorType>).FaceDetector;
      detectorRef.current = new FD({ fastMode: true, maxDetectedFaces: 1 });

      // Start detection loop
      intervalRef.current = setInterval(detect, DETECTION_INTERVAL_MS);

      if (isMountedRef.current) {
        setEnabled(true);
        setIsTracking(true);
        setVideoElement(video);
      }
    } catch (err) {
      console.warn('[head-tracking] Failed to start:', err);
    }
  }, [isSupported, enabled, detect]);

  const disable = useCallback(() => {
    // Stop detection loop
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Stop camera stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Remove video element
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      if (videoRef.current.parentNode) {
        videoRef.current.parentNode.removeChild(videoRef.current);
      }
      videoRef.current = null;
    }

    detectorRef.current = null;

    // Reset state
    smoothXRef.current = 0;
    smoothYRef.current = 0;
    smoothFovRef.current = 0;
    lastEmittedRef.current = { x: 0, y: 0, fov: 0, face: false };

    if (isMountedRef.current) {
      setEnabled(false);
      setIsTracking(false);
      setFaceDetected(false);
      setOffsetX(0);
      setOffsetY(0);
      setFovAdjust(0);
      setVideoElement(null);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
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
    enabled,
    offsetX,
    offsetY,
    fovAdjust,
    isTracking,
    faceDetected,
    videoElement,
    enable,
    disable,
  };
}

// Ambient type declaration for FaceDetector API (Chrome 94+)
declare global {
  class FaceDetector {
    constructor(options?: { fastMode?: boolean; maxDetectedFaces?: number });
    detect(image: HTMLVideoElement | HTMLCanvasElement | ImageBitmap): Promise<Array<{
      boundingBox: DOMRectReadOnly;
      landmarks?: Array<{ type: string; locations: Array<{ x: number; y: number }> }>;
    }>>;
  }
}
