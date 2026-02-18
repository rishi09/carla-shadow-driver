import { useRef, useEffect } from 'react';

interface SpeedEffectsProps {
  speedKmh: number;
  className?: string;
}

/**
 * Canvas overlay that renders speed lines and vignette effect.
 * Intensity scales with player speed for immersive visual feedback.
 */
export function SpeedEffects({ speedKmh, className = '' }: SpeedEffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const speedRef = useRef(speedKmh);

  // Update ref on every render (no effect teardown needed)
  speedRef.current = speedKmh;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const draw = () => {
      if (!running) return;

      const w = canvas.width;
      const h = canvas.height;
      const speed = speedRef.current;
      ctx.clearRect(0, 0, w, h);

      // --- Vignette ---
      // Intensity: 0 at rest, 0.7 at 200+ km/h
      const vignetteIntensity = Math.min(0.7, speed / 300);
      if (vignetteIntensity > 0.05) {
        const gradient = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.7);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${vignetteIntensity})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      // --- Speed lines ---
      // Only show above 80 km/h, intensity increases with speed
      if (speed > 80) {
        const lineIntensity = Math.min(1.0, (speed - 80) / 200);
        const numLines = Math.floor(8 + lineIntensity * 24);
        const centerX = w / 2;
        const centerY = h / 2;

        ctx.save();
        ctx.globalAlpha = lineIntensity * 0.3;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;

        for (let i = 0; i < numLines; i++) {
          const angle = (i / numLines) * Math.PI * 2 + performance.now() * 0.001;
          const innerRadius = w * 0.3 + Math.sin(angle * 3 + performance.now() * 0.003) * 20;
          const outerRadius = w * 0.5 + lineIntensity * w * 0.15;

          const x1 = centerX + Math.cos(angle) * innerRadius;
          const y1 = centerY + Math.sin(angle) * innerRadius;
          const x2 = centerX + Math.cos(angle) * outerRadius;
          const y2 = centerY + Math.sin(angle) * outerRadius;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        ctx.restore();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    // Match canvas to container size
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        canvas.width = entry.contentRect.width;
        canvas.height = entry.contentRect.height;
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
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
