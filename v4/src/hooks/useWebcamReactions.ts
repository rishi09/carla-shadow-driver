/**
 * useWebcamReactions.ts - AI comments on player's facial expressions
 *
 * Uses webcam to detect basic facial expressions (smile, frown, neutral)
 * by analyzing brightness/movement patterns in the face region.
 * Simple heuristic-based approach, no TensorFlow required.
 *
 * Wild Idea #23 from TODO.md
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// --- Types ---

type Expression = 'neutral' | 'smiling' | 'frowning' | 'surprised' | 'bored';

interface ExpressionHistoryEntry {
  expression: string;
  timestamp: number;
}

interface UseWebcamReactionsOptions {
  enabled: boolean;
}

interface UseWebcamReactionsReturn {
  currentExpression: Expression | null;
  aiComment: string | null;
  isTracking: boolean;
  hasPermission: boolean | null;
  requestPermission: () => Promise<boolean>;
  expressionHistory: ExpressionHistoryEntry[];
}

// --- Constants ---

const ANALYSIS_INTERVAL_MS = 500;
const DEBOUNCE_DURATION_MS = 1000;
const COMMENT_DISPLAY_MS = 4000;
const COMMENT_COOLDOWN_MS = 15000;
const MAX_HISTORY_SIZE = 10;

const VIDEO_WIDTH = 320;
const VIDEO_HEIGHT = 240;

// Motion threshold: fraction of pixels that changed significantly
const MOTION_HIGH_THRESHOLD = 0.12;
const MOTION_LOW_THRESHOLD = 0.02;

// Brightness thresholds for smile detection (teeth = bright pixels in lower face)
const SMILE_BRIGHTNESS_THRESHOLD = 160;
const SMILE_BRIGHT_RATIO = 0.25;

// Frown detection: darker eyebrow region relative to forehead
const FROWN_DARKNESS_DIFF = 15;

// Surprise detection: vertical spread of bright pixels (open mouth widens face)
const SURPRISE_VERTICAL_SPREAD = 0.65;

// --- Comment pools ---

const COMMENTS: Record<Exclude<Expression, 'neutral'>, string[]> = {
  smiling: [
    "Was that MY driving that made you smile?",
    "Enjoying the race? Don't get cocky.",
    "Keep smiling -- I'm about to wipe that grin off your face.",
    "Glad you're having fun. For now.",
    "That smile won't last past the next hairpin.",
  ],
  frowning: [
    "You look stressed. Good.",
    "That face when you realize the AI is faster.",
    "Frustration is just motivation with a bad attitude.",
    "I can practically taste your concentration.",
    "Don't blame the controller. Blame the driver.",
  ],
  surprised: [
    "Didn't expect that, did you?",
    "The face of someone who just missed their braking point.",
    "Surprise! I'm still faster.",
    "Eyes wide open -- that's the look of respect.",
    "Plot twist: the AI can drive.",
  ],
  bored: [
    "Am I boring you? I'll go faster.",
    "You look bored. Let me make this interesting.",
    "Yawning? Fine, I'll turn up the heat.",
    "If you're bored, try keeping up with me.",
    "That's the face of overconfidence. I like it.",
  ],
};

// --- Helper: pick a random element ---

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Helper: compute average brightness of a region in ImageData ---

function regionBrightness(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      // Luminance approximation: 0.299R + 0.587G + 0.114B
      sum += data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

// --- Helper: count bright pixels in a region ---

function brightPixelRatio(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  threshold: number,
): number {
  let bright = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      if (lum > threshold) bright++;
      count++;
    }
  }
  return count > 0 ? bright / count : 0;
}

// --- Helper: compute motion between two frames ---

function computeMotion(
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const threshold = 30; // per-pixel luminance change threshold
  let changed = 0;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const lumCur = current[idx] * 0.299 + current[idx + 1] * 0.587 + current[idx + 2] * 0.114;
    const lumPrev = previous[idx] * 0.299 + previous[idx + 1] * 0.587 + previous[idx + 2] * 0.114;
    if (Math.abs(lumCur - lumPrev) > threshold) changed++;
  }
  return changed / total;
}

// --- Helper: find vertical spread of bright pixels (for surprise detection) ---

function verticalBrightSpread(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  threshold: number,
): number {
  let minY = y1;
  let maxY = y0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      if (lum > threshold) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const regionHeight = y1 - y0;
  return regionHeight > 0 ? (maxY - minY) / regionHeight : 0;
}

// --- Hook ---

export function useWebcamReactions(options: UseWebcamReactionsOptions): UseWebcamReactionsReturn {
  const { enabled } = options;

  const [currentExpression, setCurrentExpression] = useState<Expression | null>(null);
  const [aiComment, setAiComment] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [expressionHistory, setExpressionHistory] = useState<ExpressionHistoryEntry[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);

  // Debounce: candidate expression must persist for DEBOUNCE_DURATION_MS
  const candidateRef = useRef<Expression | null>(null);
  const candidateSinceRef = useRef<number>(0);

  // Comment cooldown
  const lastCommentTimeRef = useRef<number>(0);
  const commentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Stop tracking and clean up media ---

  const stopTracking = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (commentTimerRef.current) {
      clearTimeout(commentTimerRef.current);
      commentTimerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    canvasRef.current = null;
    prevFrameRef.current = null;
    candidateRef.current = null;
    candidateSinceRef.current = 0;
    setIsTracking(false);
  }, []);

  // --- Analyze a single frame and return detected expression ---

  const analyzeFrame = useCallback((): Expression => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return 'neutral';

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'neutral';

    ctx.drawImage(video, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
    const imageData = ctx.getImageData(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
    const { data } = imageData;

    // Define approximate face region (center 60% of frame)
    const faceX0 = Math.floor(VIDEO_WIDTH * 0.2);
    const faceX1 = Math.floor(VIDEO_WIDTH * 0.8);
    const faceY0 = Math.floor(VIDEO_HEIGHT * 0.1);
    const faceY1 = Math.floor(VIDEO_HEIGHT * 0.9);

    const faceHeight = faceY1 - faceY0;

    // Sub-regions
    const eyebrowY0 = faceY0 + Math.floor(faceHeight * 0.15);
    const eyebrowY1 = faceY0 + Math.floor(faceHeight * 0.3);
    const foreheadY0 = faceY0;
    const foreheadY1 = faceY0 + Math.floor(faceHeight * 0.15);
    const mouthY0 = faceY0 + Math.floor(faceHeight * 0.65);
    const mouthY1 = faceY1;

    // 1. Check motion (for surprised / bored detection)
    let motion = 0;
    if (prevFrameRef.current) {
      motion = computeMotion(data, prevFrameRef.current, VIDEO_WIDTH, VIDEO_HEIGHT);
    }
    prevFrameRef.current = new Uint8ClampedArray(data);

    // High motion = surprised
    if (motion > MOTION_HIGH_THRESHOLD) {
      return 'surprised';
    }

    // Very low motion over time = bored
    if (motion < MOTION_LOW_THRESHOLD && prevFrameRef.current) {
      return 'bored';
    }

    // 2. Smile detection: lots of bright pixels in mouth region (teeth showing)
    const mouthBrightRatio = brightPixelRatio(
      data, VIDEO_WIDTH, faceX0, mouthY0, faceX1, mouthY1, SMILE_BRIGHTNESS_THRESHOLD,
    );
    if (mouthBrightRatio > SMILE_BRIGHT_RATIO) {
      return 'smiling';
    }

    // 3. Frown detection: eyebrow region significantly darker than forehead
    const eyebrowBrightness = regionBrightness(data, VIDEO_WIDTH, faceX0, eyebrowY0, faceX1, eyebrowY1);
    const foreheadBrightness = regionBrightness(data, VIDEO_WIDTH, faceX0, foreheadY0, faceX1, foreheadY1);
    if (foreheadBrightness - eyebrowBrightness > FROWN_DARKNESS_DIFF) {
      return 'frowning';
    }

    // 4. Surprise detection (secondary): mouth region has large vertical bright spread
    const spread = verticalBrightSpread(
      data, VIDEO_WIDTH, faceX0, mouthY0, faceX1, mouthY1, SMILE_BRIGHTNESS_THRESHOLD,
    );
    if (spread > SURPRISE_VERTICAL_SPREAD) {
      return 'surprised';
    }

    return 'neutral';
  }, []);

  // --- Start tracking ---

  const startTracking = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, facingMode: 'user' },
      });
      streamRef.current = stream;
      setHasPermission(true);

      // Create hidden video element
      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      video.width = VIDEO_WIDTH;
      video.height = VIDEO_HEIGHT;
      await video.play();
      videoRef.current = video;

      // Create offscreen canvas for frame analysis
      const canvas = document.createElement('canvas');
      canvas.width = VIDEO_WIDTH;
      canvas.height = VIDEO_HEIGHT;
      canvasRef.current = canvas;

      setIsTracking(true);

      // Start periodic analysis
      intervalRef.current = setInterval(() => {
        const detected = analyzeFrame();
        const now = Date.now();

        // Debounce: expression must persist for DEBOUNCE_DURATION_MS
        if (detected !== candidateRef.current) {
          candidateRef.current = detected;
          candidateSinceRef.current = now;
          return;
        }

        if (now - candidateSinceRef.current < DEBOUNCE_DURATION_MS) {
          return;
        }

        // Expression confirmed -- update state
        setCurrentExpression(detected);

        // Add to history
        setExpressionHistory(prev => {
          const next = [...prev, { expression: detected, timestamp: now }];
          return next.length > MAX_HISTORY_SIZE ? next.slice(-MAX_HISTORY_SIZE) : next;
        });

        // Generate AI comment (skip neutral, respect cooldown)
        if (detected !== 'neutral' && now - lastCommentTimeRef.current > COMMENT_COOLDOWN_MS) {
          const comment = pickRandom(COMMENTS[detected]);
          setAiComment(comment);
          lastCommentTimeRef.current = now;

          // Clear comment after display duration
          if (commentTimerRef.current) clearTimeout(commentTimerRef.current);
          commentTimerRef.current = setTimeout(() => {
            setAiComment(null);
            commentTimerRef.current = null;
          }, COMMENT_DISPLAY_MS);
        }
      }, ANALYSIS_INTERVAL_MS);

      return true;
    } catch (err) {
      console.warn('[useWebcamReactions] Failed to access webcam:', err);
      setHasPermission(false);
      return false;
    }
  }, [analyzeFrame]);

  // --- Public permission request ---

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (isTracking) return true;
    return startTracking();
  }, [isTracking, startTracking]);

  // --- React to enabled flag changes ---

  useEffect(() => {
    if (enabled && !isTracking) {
      void startTracking();
    } else if (!enabled && isTracking) {
      stopTracking();
      setCurrentExpression(null);
      setAiComment(null);
    }
  }, [enabled, isTracking, startTracking, stopTracking]);

  // --- Cleanup on unmount ---

  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

  return {
    currentExpression,
    aiComment,
    isTracking,
    hasPermission,
    requestPermission,
    expressionHistory,
  };
}

export default useWebcamReactions;
