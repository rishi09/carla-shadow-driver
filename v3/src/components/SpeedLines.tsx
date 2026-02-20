import { useRef, useEffect } from 'react';

interface SpeedLinesProps {
  speedKmh: number;
  className?: string;
}

/** A single speed line with its animation state */
interface SpeedLine {
  angle: number;       // radial angle in radians
  progress: number;    // 0 = at inner ring, 1 = at outer ring
  speed: number;       // pixels per frame (normalized)
  length: number;      // line length factor
  opacity: number;     // base opacity
}

const MIN_SPEED = 80;   // speed lines start appearing
const MAX_SPEED = 150;  // fully visible
const MAX_LINES = 36;   // max number of active lines
const LINE_COLOR_R = 220;
const LINE_COLOR_G = 235;
const LINE_COLOR_B = 255;

/**
 * Anime/racing-game style speed lines radiating from center.
 * Uses a canvas overlay with requestAnimationFrame.
 * Lines are recycled from a fixed-size pool for consistent 60fps.
 */
export function SpeedLines({ speedKmh, className = '' }: SpeedLinesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const speedRef = useRef(speedKmh);
  const linesRef = useRef<SpeedLine[]>([]);
  const lastTimeRef = useRef(0);

  // Update speed ref every render (avoids effect teardown)
  speedRef.current = speedKmh;

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const c = cvs.getContext('2d');
    if (!c) return;

    // Capture non-null references for inner functions
    const canvas: HTMLCanvasElement = cvs;
    const ctx: CanvasRenderingContext2D = c;

    let running = true;

    /** Spawn a new line at a random angle near the center ring */
    function spawnLine(): SpeedLine {
      return {
        angle: Math.random() * Math.PI * 2,
        progress: 0,
        speed: 0.008 + Math.random() * 0.012, // varied speeds
        length: 0.06 + Math.random() * 0.10,   // varied lengths
        opacity: 0.3 + Math.random() * 0.7,
      };
    }

    function draw(now: number) {
      if (!running) return;

      const dt = lastTimeRef.current ? Math.min(now - lastTimeRef.current, 50) : 16;
      lastTimeRef.current = now;

      const w = canvas.width;
      const h = canvas.height;
      const speed = speedRef.current;

      ctx.clearRect(0, 0, w, h);

      if (speed < MIN_SPEED) {
        // Below threshold: clear lines pool so they restart fresh
        linesRef.current.length = 0;
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // Intensity: 0 at MIN_SPEED, 1 at MAX_SPEED+
      const intensity = Math.min(1.0, (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
      const targetLineCount = Math.floor(8 + intensity * (MAX_LINES - 8));
      const lines = linesRef.current;

      // Spawn new lines up to target count
      while (lines.length < targetLineCount) {
        const line = spawnLine();
        // Start at random progress so lines don't all appear at once
        line.progress = Math.random() * 0.5;
        lines.push(line);
      }

      const centerX = w / 2;
      const centerY = h * 0.4; // Vanishing point slightly above center (road perspective)
      const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
      // Inner ring: lines start from ~35% of the way out
      const innerRadius = maxRadius * 0.30;
      // Outer ring: lines extend to edge + beyond
      const outerRadius = maxRadius * 1.05;

      const dtFactor = dt / 16.67; // normalize to 60fps
      const speedMultiplier = 0.6 + intensity * 1.4; // faster lines at higher speed

      ctx.save();

      // Draw each line
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];

        // Advance progress
        line.progress += line.speed * dtFactor * speedMultiplier;

        // If line has gone past the outer ring, recycle it
        if (line.progress >= 1.0) {
          if (lines.length > targetLineCount) {
            // Remove excess lines
            lines.splice(i, 1);
            continue;
          }
          // Recycle: reset with new random properties
          line.angle = Math.random() * Math.PI * 2;
          line.progress = 0;
          line.speed = 0.008 + Math.random() * 0.012;
          line.length = 0.06 + Math.random() * 0.10;
          line.opacity = 0.3 + Math.random() * 0.7;
          continue;
        }

        // Calculate start and end positions along the radial
        const startDist = innerRadius + (outerRadius - innerRadius) * line.progress;
        const endDist = startDist + (outerRadius - innerRadius) * line.length * (0.5 + intensity * 0.5);

        const cos = Math.cos(line.angle);
        const sin = Math.sin(line.angle);

        const x1 = centerX + cos * startDist;
        const y1 = centerY + sin * startDist;
        const x2 = centerX + cos * Math.min(endDist, outerRadius * 1.1);
        const y2 = centerY + sin * Math.min(endDist, outerRadius * 1.1);

        // Fade in at start, fade out at end
        const fadeIn = Math.min(1, line.progress * 5);
        const fadeOut = Math.max(0, 1 - (line.progress - 0.7) / 0.3);
        const alpha = intensity * line.opacity * fadeIn * Math.min(1, fadeOut) * 0.45;

        if (alpha < 0.01) continue;

        // Create gradient along the line for a streak effect
        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, `rgba(${LINE_COLOR_R},${LINE_COLOR_G},${LINE_COLOR_B},0)`);
        gradient.addColorStop(0.3, `rgba(${LINE_COLOR_R},${LINE_COLOR_G},${LINE_COLOR_B},${alpha})`);
        gradient.addColorStop(1, `rgba(${LINE_COLOR_R},${LINE_COLOR_G},${LINE_COLOR_B},${alpha * 0.3})`);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1 + intensity * 1.0;
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
      className={`absolute inset-0 pointer-events-none z-[5] ${className}`}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
