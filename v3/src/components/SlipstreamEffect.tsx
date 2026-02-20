import { useRef, useEffect } from 'react';

interface SlipstreamEffectProps {
  playerX: number;
  playerY: number;
  aiX: number;
  aiY: number;
  speedKmh: number;
  className?: string;
}

/** A single slipstream line converging toward center */
interface SlipLine {
  angle: number;       // radial angle in radians
  progress: number;    // 1 = at outer ring, 0 = at center (flows inward)
  speed: number;       // inward travel speed (normalized per frame)
  length: number;      // line length factor
  opacity: number;     // base opacity
}

const DRAFT_DISTANCE = 15;     // meters — max distance for drafting effect
const MIN_DRAFT_SPEED = 60;    // km/h — minimum speed for effect to appear
const MAX_LINES = 28;          // max active lines
const LINE_COLOR_R = 176;      // #B0C4FF blue-white
const LINE_COLOR_G = 196;
const LINE_COLOR_B = 255;

/**
 * Slipstream / drafting visual effect.
 * Shows blue-white converging speed streaks when the player is drafting
 * behind the AI car (within 15m and above 60 km/h).
 *
 * Lines flow INWARD toward screen center — the opposite of SpeedLines
 * which radiate outward. Intensity scales with proximity to the AI.
 */
export function SlipstreamEffect({
  playerX,
  playerY,
  aiX,
  aiY,
  speedKmh,
  className = '',
}: SlipstreamEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const speedRef = useRef(speedKmh);
  const distanceRef = useRef(Infinity);
  const linesRef = useRef<SlipLine[]>([]);
  const lastTimeRef = useRef(0);

  // Update refs every render to avoid effect teardown
  speedRef.current = speedKmh;
  distanceRef.current = Math.sqrt(
    (playerX - aiX) ** 2 + (playerY - aiY) ** 2,
  );

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const c = cvs.getContext('2d');
    if (!c) return;

    const canvas: HTMLCanvasElement = cvs;
    const ctx: CanvasRenderingContext2D = c;

    let running = true;

    /** Spawn a new line at the outer ring, ready to converge inward */
    function spawnLine(): SlipLine {
      return {
        angle: Math.random() * Math.PI * 2,
        progress: 1.0,  // start at outer edge
        speed: 0.006 + Math.random() * 0.010,
        length: 0.05 + Math.random() * 0.08,
        opacity: 0.2 + Math.random() * 0.6,
      };
    }

    function draw(now: number) {
      if (!running) return;

      const dt = lastTimeRef.current ? Math.min(now - lastTimeRef.current, 50) : 16;
      lastTimeRef.current = now;

      const w = canvas.width;
      const h = canvas.height;
      const speed = speedRef.current;
      const distance = distanceRef.current;

      ctx.clearRect(0, 0, w, h);

      // Only show effect when drafting: close enough and fast enough
      const isDrafting = distance < DRAFT_DISTANCE && speed >= MIN_DRAFT_SPEED;

      if (!isDrafting) {
        // Clear lines pool so they restart fresh next time
        linesRef.current.length = 0;
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // Proximity intensity: 1.0 when right behind AI (0m), 0.0 at DRAFT_DISTANCE
      const proximityIntensity = Math.max(0, 1.0 - distance / DRAFT_DISTANCE);
      // Speed intensity: 0.0 at MIN_DRAFT_SPEED, 1.0 at 150+ km/h
      const speedIntensity = Math.min(1.0, (speed - MIN_DRAFT_SPEED) / 90);
      // Combined intensity
      const intensity = proximityIntensity * (0.4 + speedIntensity * 0.6);

      const targetLineCount = Math.floor(6 + intensity * (MAX_LINES - 6));
      const lines = linesRef.current;

      // Spawn new lines up to target count
      while (lines.length < targetLineCount) {
        const line = spawnLine();
        // Randomize initial progress so lines don't all appear at once
        line.progress = 0.3 + Math.random() * 0.7;
        lines.push(line);
      }

      const centerX = w / 2;
      const centerY = h * 0.4; // Same vanishing point as SpeedLines
      const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
      const innerRadius = maxRadius * 0.05;  // Lines converge close to center
      const outerRadius = maxRadius * 0.85;  // Start from ~85% out (less extreme than speed lines)

      const dtFactor = dt / 16.67; // normalize to 60fps
      const speedMultiplier = 0.5 + intensity * 1.2;

      ctx.save();

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];

        // Move INWARD: decrease progress
        line.progress -= line.speed * dtFactor * speedMultiplier;

        // If line has reached the center, recycle or remove
        if (line.progress <= 0) {
          if (lines.length > targetLineCount) {
            lines.splice(i, 1);
            continue;
          }
          // Recycle at outer edge with new random properties
          line.angle = Math.random() * Math.PI * 2;
          line.progress = 1.0;
          line.speed = 0.006 + Math.random() * 0.010;
          line.length = 0.05 + Math.random() * 0.08;
          line.opacity = 0.2 + Math.random() * 0.6;
          continue;
        }

        // Calculate positions: line segment along the radial, moving inward
        const headDist = innerRadius + (outerRadius - innerRadius) * line.progress;
        const tailDist = headDist + (outerRadius - innerRadius) * line.length * (0.4 + intensity * 0.4);

        const cos = Math.cos(line.angle);
        const sin = Math.sin(line.angle);

        // Head is closer to center (inner), tail is further out (outer)
        const x1 = centerX + cos * headDist;
        const y1 = centerY + sin * headDist;
        const x2 = centerX + cos * Math.min(tailDist, outerRadius);
        const y2 = centerY + sin * Math.min(tailDist, outerRadius);

        // Fade: transparent near edges, brightest in the mid-travel zone
        const fadeIn = Math.min(1, (1.0 - line.progress) * 4);  // fade in as line enters from edge
        const fadeOut = Math.max(0, line.progress * 3);          // fade out as line nears center
        const alpha = intensity * line.opacity * fadeIn * Math.min(1, fadeOut) * 0.35;

        if (alpha < 0.01) continue;

        // Gradient along the line: bright head (inner end), fading tail (outer end)
        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, `rgba(${LINE_COLOR_R},${LINE_COLOR_G},${LINE_COLOR_B},${alpha})`);
        gradient.addColorStop(0.4, `rgba(${LINE_COLOR_R},${LINE_COLOR_G},${LINE_COLOR_B},${alpha * 0.6})`);
        gradient.addColorStop(1, `rgba(${LINE_COLOR_R},${LINE_COLOR_G},${LINE_COLOR_B},0)`);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 0.8 + intensity * 0.8;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      ctx.restore();

      animRef.current = requestAnimationFrame(draw);
    }

    // Size canvas to match container
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const dpr = window.devicePixelRatio || 1;
        const rect = entry.contentRect;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    });
    resizeObserver.observe(canvas.parentElement || canvas);

    animRef.current = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none z-[6] ${className}`}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
