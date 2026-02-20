/**
 * useCursorTrail.ts - Mouse cursor leaves a racing line trail
 *
 * Creates an overlay canvas that draws a fading trail behind the cursor.
 * The trail color changes based on speed (green=slow, yellow=medium, red=fast).
 * Trail width narrows at higher speeds. Points fade out over ~2 seconds.
 *
 * Wild Idea #44 from TODO.md
 */
import { useRef, useEffect, useCallback, useState, type RefObject } from 'react';

// Trail configuration
const TRAIL_LIFETIME_MS = 2000;
const MAX_POINTS = 500;

// Speed-to-color mapping (HSL hue)
const HUE_AT_ZERO = 120;   // Green
const HUE_AT_100 = 60;     // Yellow
const HUE_AT_200 = 0;      // Red

// Line width mapping
const WIDTH_AT_ZERO = 4;
const WIDTH_AT_200 = 1.5;

interface TrailPoint {
  x: number;
  y: number;
  timestamp: number;
  speed: number;
}

interface UseCursorTrailOptions {
  enabled: boolean;
  speed: number;
  containerRef: RefObject<HTMLElement | null>;
}

interface UseCursorTrailReturn {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isDrawing: boolean;
  clearTrail: () => void;
}

/** Map speed (km/h) to HSL hue: 120 (green) at 0, 60 (yellow) at 100, 0 (red) at 200+ */
function speedToHue(speed: number): number {
  const clamped = Math.max(0, Math.min(200, speed));
  if (clamped <= 100) {
    // Green (120) -> Yellow (60)
    return HUE_AT_ZERO - ((HUE_AT_ZERO - HUE_AT_100) * clamped) / 100;
  }
  // Yellow (60) -> Red (0)
  return HUE_AT_100 - ((HUE_AT_100 - HUE_AT_200) * (clamped - 100)) / 100;
}

/** Map speed (km/h) to line width: 4px at 0, 1.5px at 200+ */
function speedToWidth(speed: number): number {
  const t = Math.max(0, Math.min(1, speed / 200));
  return WIDTH_AT_ZERO + (WIDTH_AT_200 - WIDTH_AT_ZERO) * t;
}

export function useCursorTrail(options: UseCursorTrailOptions): UseCursorTrailReturn {
  const { enabled, speed, containerRef } = options;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<TrailPoint[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const speedRef = useRef(speed);
  const [isDrawing, setIsDrawing] = useState(false);

  // Keep speed ref in sync without re-registering listeners
  speedRef.current = speed;

  // Clear all trail points
  const clearTrail = useCallback(() => {
    pointsRef.current = [];
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  // Animation loop: draws trail and prunes old points
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();

    // Prune expired points
    pointsRef.current = pointsRef.current.filter(
      (p) => now - p.timestamp < TRAIL_LIFETIME_MS,
    );

    // Clear and redraw
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const points = pointsRef.current;
    if (points.length < 2) {
      setIsDrawing(false);
      rafIdRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    setIsDrawing(true);

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      // Use the current point's speed for color/width
      const age = now - curr.timestamp;
      const alpha = Math.max(0, 1 - age / TRAIL_LIFETIME_MS);
      const hue = speedToHue(curr.speed);
      const width = speedToWidth(curr.speed);

      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.strokeStyle = `hsla(${hue}, 100%, 50%, ${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    rafIdRef.current = requestAnimationFrame(drawFrame);
  }, []);

  // Mouse move handler: adds points to the trail
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const points = pointsRef.current;
    points.push({ x, y, timestamp: performance.now(), speed: speedRef.current });

    // Cap the array size
    if (points.length > MAX_POINTS) {
      pointsRef.current = points.slice(points.length - MAX_POINTS);
    }
  }, [containerRef]);

  // Sync canvas size with container via ResizeObserver
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const syncSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    };

    syncSize();

    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [enabled, containerRef]);

  // Set up mousemove listener and animation loop
  useEffect(() => {
    if (!enabled) {
      // Cleanup when disabled
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      clearTrail();
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mousemove', handleMouseMove);
    rafIdRef.current = requestAnimationFrame(drawFrame);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [enabled, containerRef, handleMouseMove, drawFrame, clearTrail]);

  return { canvasRef, isDrawing, clearTrail };
}

export default useCursorTrail;
