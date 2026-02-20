import { useRef, useEffect, useMemo, useState } from 'react';

interface SpeedEffectsProps {
  speedKmh: number;
  /** Current collision array - used to pulse vignette on impact */
  collisions?: Array<{ intensity: number }>;
  /** Current gear - used for gear shift flash */
  gear?: number;
  className?: string;
}

/**
 * Overlay that renders speed-dependent visual effects:
 * - CSS radial-gradient vignette that darkens edges with speed
 * - Red tint on vignette at 200+ km/h for danger feel
 * - Collision pulse: red edge flash on impact
 * - Warp speed streaks at 200+ km/h (screen-edge radial lines)
 * - Gear shift flash (brief white dimming overlay)
 *
 * Canvas speed lines are handled by SpeedLines.tsx (separate component).
 * All rapidly-changing values are stored in refs to avoid effect teardown (LEARNINGS.md pattern).
 */
export function SpeedEffects({ speedKmh, collisions, gear, className = '' }: SpeedEffectsProps) {
  const warpCanvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const speedRef = useRef(speedKmh);

  // Collision pulse state (managed via refs for RAF loop)
  const collisionPulseRef = useRef(0); // 0..1, decays over time
  const prevCollisionCountRef = useRef(0);

  // Gear shift flash state
  const gearFlashRef = useRef(0); // 0..1, decays
  const prevGearRef = useRef(gear);
  const [gearFlashOpacity, setGearFlashOpacity] = useState(0);
  const [collisionFlash, setCollisionFlash] = useState(0);

  // Update refs on every render (no effect teardown needed)
  speedRef.current = speedKmh;

  // Detect collision for pulse
  const currentCollisionCount = collisions?.length ?? 0;
  if (currentCollisionCount > 0 && currentCollisionCount !== prevCollisionCountRef.current) {
    const maxIntensity = Math.max(...(collisions ?? []).map(c => c.intensity));
    collisionPulseRef.current = Math.min(1, maxIntensity / 800);
  }
  prevCollisionCountRef.current = currentCollisionCount;

  // Detect gear change for flash
  if (gear !== undefined && prevGearRef.current !== undefined && gear !== prevGearRef.current && prevGearRef.current !== 0) {
    gearFlashRef.current = 0.6;
  }
  prevGearRef.current = gear;

  // --- CSS Vignette ---
  const vignetteStyle = useMemo(() => {
    const t = Math.min(1, speedKmh / 150);
    const baseOpacity = t * 0.7;

    if (baseOpacity < 0.03) return undefined;

    // Red tint factor: 0 below 150 km/h, ramps to 1 at 250 km/h
    const redFactor = Math.max(0, Math.min(1, (speedKmh - 150) / 100));

    // Blend between black vignette and red-tinted vignette
    const r = Math.floor(redFactor * 100);
    const opacity = Math.min(0.85, baseOpacity);

    return {
      background: `radial-gradient(ellipse 70% 60% at 50% 50%, transparent 0%, rgba(${r},0,0,${(opacity * 0.3).toFixed(3)}) 55%, rgba(${r},0,0,${opacity.toFixed(3)}) 100%)`,
      transition: 'background 0.3s ease-out',
    };
  }, [speedKmh]);

  // --- Warp speed streaks (canvas) + collision/gear flash decay ---
  useEffect(() => {
    const cvs = warpCanvasRef.current;
    if (!cvs) return;
    const c = cvs.getContext('2d');
    if (!c) return;

    // Capture non-null references for inner functions
    const canvas: HTMLCanvasElement = cvs;
    const ctx: CanvasRenderingContext2D = c;

    let running = true;
    let lastTime = 0;

    // Persistent warp line pool
    interface WarpLine {
      angle: number;
      radius: number;
      length: number;
      speed: number;
      opacity: number;
    }
    const warpLines: WarpLine[] = [];

    function draw(now: number) {
      if (!running) return;

      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0.016;
      lastTime = now;

      const w = canvas.width;
      const h = canvas.height;
      const speed = speedRef.current;

      ctx.clearRect(0, 0, w, h);

      // Decay collision pulse
      if (collisionPulseRef.current > 0) {
        collisionPulseRef.current = Math.max(0, collisionPulseRef.current - dt * 4);
        setCollisionFlash(collisionPulseRef.current);
      }

      // Decay gear flash
      if (gearFlashRef.current > 0) {
        gearFlashRef.current = Math.max(0, gearFlashRef.current - dt * 4);
        setGearFlashOpacity(gearFlashRef.current);
      }

      // Warp streaks only above 180 km/h
      if (speed < 180) {
        warpLines.length = 0;
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const warpIntensity = Math.min(1, (speed - 180) / 120); // 0 at 180, 1 at 300
      const centerX = w / 2;
      const centerY = h / 2;
      const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);

      // Target number of warp lines
      const targetCount = Math.floor(12 + warpIntensity * 28);

      // Spawn lines
      while (warpLines.length < targetCount) {
        warpLines.push({
          angle: Math.random() * Math.PI * 2,
          radius: maxRadius * (0.6 + Math.random() * 0.2),
          length: 30 + Math.random() * 80,
          speed: 200 + Math.random() * 400,
          opacity: 0.2 + Math.random() * 0.5,
        });
      }

      ctx.save();
      ctx.lineCap = 'round';

      for (let i = warpLines.length - 1; i >= 0; i--) {
        const line = warpLines[i];
        line.radius += line.speed * dt * (0.5 + warpIntensity);

        // If past edge, recycle
        if (line.radius > maxRadius * 1.2) {
          if (warpLines.length > targetCount) {
            warpLines.splice(i, 1);
            continue;
          }
          line.angle = Math.random() * Math.PI * 2;
          line.radius = maxRadius * (0.55 + Math.random() * 0.15);
          line.length = 30 + Math.random() * 80;
          line.speed = 200 + Math.random() * 400;
          line.opacity = 0.2 + Math.random() * 0.5;
          continue;
        }

        const cos = Math.cos(line.angle);
        const sin = Math.sin(line.angle);

        const x1 = centerX + cos * line.radius;
        const y1 = centerY + sin * line.radius;
        const trailLen = line.length * (0.5 + warpIntensity * 0.5);
        const x2 = centerX + cos * (line.radius + trailLen);
        const y2 = centerY + sin * (line.radius + trailLen);

        // Edge proximity boost: lines near screen edge are brighter
        const edgeProximity = line.radius / maxRadius;
        const alpha = line.opacity * warpIntensity * edgeProximity * 0.5;

        if (alpha < 0.01) continue;

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, `rgba(200,220,255,0)`);
        gradient.addColorStop(0.4, `rgba(200,220,255,${alpha.toFixed(3)})`);
        gradient.addColorStop(1, `rgba(255,255,255,${(alpha * 0.2).toFixed(3)})`);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.5 + warpIntensity;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Screen-edge glow at extreme speed
      if (warpIntensity > 0.5) {
        const glowAlpha = (warpIntensity - 0.5) * 0.3;
        const gradient = ctx.createRadialGradient(centerX, centerY, maxRadius * 0.7, centerX, centerY, maxRadius);
        gradient.addColorStop(0, 'rgba(100,150,255,0)');
        gradient.addColorStop(1, `rgba(100,150,255,${glowAlpha.toFixed(3)})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.restore();

      animRef.current = requestAnimationFrame(draw);
    }

    // Match canvas to container size
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
    <>
      {/* CSS vignette overlay (GPU-accelerated, smooth transitions) */}
      {vignetteStyle && (
        <div
          className={`absolute inset-0 pointer-events-none z-[4] ${className}`}
          style={vignetteStyle}
        />
      )}

      {/* Collision red flash overlay */}
      {collisionFlash > 0.05 && (
        <div
          className={`absolute inset-0 pointer-events-none z-[7]`}
          style={{
            background: `radial-gradient(ellipse 100% 100% at 50% 50%, transparent 30%, rgba(255,50,20,${(collisionFlash * 0.25).toFixed(3)}) 100%)`,
          }}
        />
      )}

      {/* Gear shift flash overlay */}
      {gearFlashOpacity > 0.01 && (
        <div
          className={`absolute inset-0 pointer-events-none z-[7]`}
          style={{
            backgroundColor: `rgba(255,255,255,${(gearFlashOpacity * 0.12).toFixed(3)})`,
          }}
        />
      )}

      {/* Warp speed streaks canvas (200+ km/h) */}
      <canvas
        ref={warpCanvasRef}
        className={`absolute inset-0 pointer-events-none z-[5] ${className}`}
        style={{ width: '100%', height: '100%' }}
      />
    </>
  );
}
