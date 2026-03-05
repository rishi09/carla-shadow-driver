/**
 * CursorTrail.tsx - Wild Idea #44: Cursor Trail Racing Line
 *
 * Post-race interactive component that draws a glowing, speed-colored trail
 * behind the mouse cursor. Trail segments are color-coded from blue (slow)
 * through green, yellow, to red (very fast) based on cursor movement speed.
 * Points fade out after ~3 seconds. The trail has a bloom/glow effect achieved
 * by drawing twice: once thick + blurred, once thin + sharp.
 *
 * Usage:
 *   <CursorTrail enabled={raceFinished} speedHistory={speedHistory} />
 */

import { useRef, useEffect, useCallback } from 'react';

/** A single point in the cursor trail */
interface TrailPoint {
  x: number;
  y: number;
  /** When this point was recorded (Date.now()) */
  timestamp: number;
  /** Cursor movement speed in pixels per second */
  speed: number;
}

interface CursorTrailProps {
  /** Whether the trail effect is active */
  enabled: boolean;
  /** Optional array of race speed values; the last value is shown as a label near the cursor */
  speedHistory?: number[];
}

/** Duration in milliseconds before a trail point fully fades out */
const FADE_DURATION_MS = 3000;

/** Minimum speed (px/s) for color mapping (maps to blue / hue 240) */
const MIN_SPEED = 0;

/** Maximum speed (px/s) for color mapping (maps to red / hue 0) */
const MAX_SPEED = 1500;

/** Minimum trail width in pixels (at low speed) */
const MIN_WIDTH = 2;

/** Maximum trail width in pixels (at high speed) */
const MAX_WIDTH = 10;

/**
 * Map a cursor speed (px/s) to an HSL color string.
 * Blue (240) at rest -> Green (120) -> Yellow (60) -> Red (0) at max speed.
 */
function speedToHSL(speed: number, alpha: number): string {
  const t = Math.min(Math.max((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0), 1);
  // Hue goes from 240 (blue) down to 0 (red)
  const hue = 240 * (1 - t);
  return `hsla(${hue}, 100%, 55%, ${alpha})`;
}

/**
 * Get just the hue-based color (no alpha) for use in shadowColor.
 */
function speedToGlowColor(speed: number): string {
  const t = Math.min(Math.max((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0), 1);
  const hue = 240 * (1 - t);
  return `hsl(${hue}, 100%, 55%)`;
}

/**
 * Calculate the trail width based on cursor speed.
 */
function speedToWidth(speed: number): number {
  const t = Math.min(Math.max((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0), 1);
  return MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * t;
}

/**
 * CursorTrail renders a full-screen canvas overlay that tracks mouse movement
 * and draws a glowing, color-coded trail behind the cursor. Intended for
 * post-race interactive fun.
 */
export function CursorTrail({ enabled, speedHistory }: CursorTrailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<TrailPoint[]>([]);
  const rafRef = useRef<number>(0);
  const lastMouseRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const currentPosRef = useRef<{ x: number; y: number } | null>(null);

  /** Handle mouse movement: compute speed and push a new trail point */
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const now = Date.now();
    const x = e.clientX;
    const y = e.clientY;

    let speed = 0;
    if (lastMouseRef.current) {
      const dx = x - lastMouseRef.current.x;
      const dy = y - lastMouseRef.current.y;
      const dt = (now - lastMouseRef.current.time) / 1000; // seconds
      if (dt > 0) {
        speed = Math.sqrt(dx * dx + dy * dy) / dt;
      }
    }

    lastMouseRef.current = { x, y, time: now };
    currentPosRef.current = { x, y };

    trailRef.current.push({ x, y, timestamp: now, speed });
  }, []);

  /** Animation loop: prune old points and redraw the trail */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = Date.now();

    // Resize canvas to match viewport (handle window resizing)
    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    // Prune points older than FADE_DURATION_MS
    trailRef.current = trailRef.current.filter(
      (p) => now - p.timestamp < FADE_DURATION_MS
    );

    const points = trailRef.current;

    // Clear the entire canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (points.length < 2) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

    // --- Pass 1: Glow layer (thick + blurred) ---
    ctx.save();
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const age = now - p1.timestamp;
      const alpha = Math.max(0, 1 - age / FADE_DURATION_MS) * 0.4;
      const width = speedToWidth(p1.speed) * 3;

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = speedToHSL(p1.speed, alpha);
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 20;
      ctx.shadowColor = speedToGlowColor(p1.speed);
      ctx.stroke();
    }
    ctx.restore();

    // --- Pass 2: Sharp core layer (thin + no blur) ---
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const age = now - p1.timestamp;
      const alpha = Math.max(0, 1 - age / FADE_DURATION_MS) * 0.9;
      const width = speedToWidth(p1.speed);

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = speedToHSL(p1.speed, alpha);
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();

    // --- Speed label near cursor ---
    if (speedHistory && speedHistory.length > 0 && currentPosRef.current) {
      const lastSpeed = speedHistory[speedHistory.length - 1];
      const pos = currentPosRef.current;
      const label = `${Math.round(lastSpeed)} km/h`;

      ctx.save();
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      // Text shadow for readability
      ctx.shadowBlur = 4;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText(label, pos.x + 16, pos.y + 16);
      ctx.restore();
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [speedHistory]);

  useEffect(() => {
    if (!enabled) {
      // Clean up when disabled
      trailRef.current = [];
      lastMouseRef.current = null;
      currentPosRef.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      // Clear canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    // Set initial canvas size
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    // Start listening for mouse moves
    window.addEventListener('mousemove', handleMouseMove);

    // Start the animation loop
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      trailRef.current = [];
      lastMouseRef.current = null;
      currentPosRef.current = null;
    };
  }, [enabled, handleMouseMove, draw]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}

export default CursorTrail;
