import { useRef, useEffect, useState } from 'react';

interface SynthwaveOverlayProps {
  /** Whether synthwave mode is active */
  enabled: boolean;
  /** Current player speed in km/h, used to animate the grid horizon scroll */
  speedKmh: number;
}

/**
 * SynthwaveOverlay - Full-screen canvas + CSS overlay for Outrun/Retrowave aesthetics.
 *
 * Effects:
 * 1. Scanlines: horizontal black lines every 3px at 15% opacity (CRT monitor look)
 * 2. CRT curvature: subtle vignette + curved-edge illusion via CSS border-radius
 * 3. Neon glow borders: magenta/cyan gradient glow at screen edges
 * 4. VHS tracking lines: occasional horizontal noise band scrolling down (every 5-15s)
 * 5. Grid horizon: perspective ground grid at screen bottom, scrolling with speed (canvas)
 * 6. Magenta/cyan color cast: CSS blend-mode overlay for the retrowave color palette
 *
 * All effects are pure CSS/Canvas. No WebGL dependency.
 */
export function SynthwaveOverlay({ enabled, speedKmh }: SynthwaveOverlayProps) {
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const scanlineCanvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const speedRef = useRef(speedKmh);
  const gridOffsetRef = useRef(0);

  // VHS tracking line state
  const [vhsActive, setVhsActive] = useState(false);
  const [vhsY, setVhsY] = useState(0);
  const vhsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep speed ref in sync (avoid effect teardown on speed change)
  speedRef.current = speedKmh;

  // --- Scanline pattern (static, drawn once per resize) ---
  useEffect(() => {
    if (!enabled) return;
    const canvas = scanlineCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawScanlines = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';

      for (let y = 0; y < rect.height; y += 3) {
        ctx.fillRect(0, y, rect.width, 1);
      }
    };

    drawScanlines();

    const resizeObserver = new ResizeObserver(() => drawScanlines());
    resizeObserver.observe(canvas.parentElement || canvas);

    return () => {
      resizeObserver.disconnect();
    };
  }, [enabled]);

  // --- Grid horizon animation loop ---
  useEffect(() => {
    if (!enabled) return;
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const c = canvas.getContext('2d');
    if (!c) return;

    // Capture non-null references for the RAF loop
    const cvs: HTMLCanvasElement = canvas;
    const ctx: CanvasRenderingContext2D = c;

    let running = true;
    let lastTime = 0;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const dpr = window.devicePixelRatio || 1;
        const rect = entry.contentRect;
        cvs.width = rect.width * dpr;
        cvs.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    });
    resizeObserver.observe(cvs.parentElement || cvs);

    function draw(now: number) {
      if (!running) return;

      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0.016;
      lastTime = now;

      const dpr = window.devicePixelRatio || 1;
      const w = cvs.width / dpr;
      const h = cvs.height / dpr;

      ctx.clearRect(0, 0, w, h);

      // Grid occupies the bottom 35% of screen
      const gridTop = h * 0.65;
      const gridHeight = h - gridTop;
      const horizonY = gridTop;

      // Scroll speed proportional to player speed
      const scrollSpeed = speedRef.current * 0.008;
      gridOffsetRef.current = (gridOffsetRef.current + scrollSpeed * dt * 60) % 1;

      const centerX = w / 2;
      const vanishY = horizonY;

      ctx.save();

      // --- Vertical lines (converging to vanishing point) ---
      const numVertLines = 24;
      const halfSpread = w * 1.2;

      for (let i = -numVertLines / 2; i <= numVertLines / 2; i++) {
        const bottomX = centerX + (i / (numVertLines / 2)) * halfSpread;
        const t = Math.abs(i) / (numVertLines / 2);
        const alpha = 0.25 * (1 - t * 0.6);

        const gradient = ctx.createLinearGradient(centerX, vanishY, bottomX, h);
        gradient.addColorStop(0, 'rgba(255, 0, 255, 0)');
        gradient.addColorStop(0.3, `rgba(255, 0, 255, ${(alpha * 0.5).toFixed(3)})`);
        gradient.addColorStop(1, `rgba(0, 255, 255, ${alpha.toFixed(3)})`);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, vanishY);
        ctx.lineTo(bottomX, h);
        ctx.stroke();
      }

      // --- Horizontal lines (perspective-spaced, scrolling toward viewer) ---
      const numHorizLines = 20;
      for (let i = 0; i < numHorizLines; i++) {
        const rawT = (i + gridOffsetRef.current) / numHorizLines;
        // Power curve for perspective effect
        const perspT = Math.pow(rawT, 2.5);
        const lineY = vanishY + perspT * gridHeight;

        if (lineY < vanishY || lineY > h) continue;

        // Lines near horizon are dimmer, near bottom are brighter
        const alpha = 0.05 + perspT * 0.2;

        // Color: magenta near horizon, transitioning to cyan at bottom
        const r = Math.floor(255 * (1 - perspT));
        const g = Math.floor(255 * perspT);
        const b = 255;

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();

        // Lines widen with perspective
        const lineWidth = w * (0.05 + perspT * 1.4);
        ctx.moveTo(centerX - lineWidth / 2, lineY);
        ctx.lineTo(centerX + lineWidth / 2, lineY);
        ctx.stroke();
      }

      // --- Horizon glow line ---
      const horizGradient = ctx.createLinearGradient(0, vanishY - 2, 0, vanishY + 4);
      horizGradient.addColorStop(0, 'rgba(255, 0, 255, 0)');
      horizGradient.addColorStop(0.5, 'rgba(255, 0, 255, 0.3)');
      horizGradient.addColorStop(1, 'rgba(255, 0, 255, 0)');
      ctx.fillStyle = horizGradient;
      ctx.fillRect(0, vanishY - 2, w, 6);

      ctx.restore();

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, [enabled]);

  // --- VHS tracking line effect (periodic glitch band) ---
  useEffect(() => {
    if (!enabled) return;

    let running = true;
    let vhsRafId: number;

    const scheduleVHS = () => {
      if (!running) return;
      // Random interval: 5-15 seconds
      const delay = 5000 + Math.random() * 10000;
      vhsTimeoutRef.current = setTimeout(() => {
        if (!running) return;
        setVhsActive(true);
        setVhsY(0);

        // Animate band scrolling down over 200ms
        const startTime = performance.now();
        const duration = 200;

        const animateVHS = (now: number) => {
          const elapsed = now - startTime;
          const progress = Math.min(1, elapsed / duration);
          setVhsY(progress * 100);

          if (progress < 1 && running) {
            vhsRafId = requestAnimationFrame(animateVHS);
          } else {
            setVhsActive(false);
          }
        };
        vhsRafId = requestAnimationFrame(animateVHS);

        scheduleVHS();
      }, delay);
    };

    scheduleVHS();

    return () => {
      running = false;
      if (vhsTimeoutRef.current) {
        clearTimeout(vhsTimeoutRef.current);
        vhsTimeoutRef.current = null;
      }
      cancelAnimationFrame(vhsRafId);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      {/* Magenta/cyan color cast overlay via CSS mix-blend-mode */}
      <div
        className="absolute inset-0 pointer-events-none z-[8]"
        style={{
          background: 'linear-gradient(180deg, rgba(255,0,255,0.03) 0%, rgba(0,255,255,0.05) 100%)',
          mixBlendMode: 'screen',
        }}
      />

      {/* Grid horizon canvas (Outrun-style perspective ground grid) */}
      <canvas
        ref={gridCanvasRef}
        className="absolute inset-0 pointer-events-none z-[6]"
        style={{ width: '100%', height: '100%', opacity: 0.25 }}
      />

      {/* Scanline overlay canvas (CRT horizontal lines) */}
      <canvas
        ref={scanlineCanvasRef}
        className="absolute inset-0 pointer-events-none z-[9]"
        style={{ width: '100%', height: '100%' }}
      />

      {/* CRT curvature effect: dark vignette corners + subtle curve illusion */}
      <div
        className="absolute inset-0 pointer-events-none z-[10]"
        style={{
          borderRadius: '12px',
          boxShadow: 'inset 0 0 80px 40px rgba(0,0,0,0.4), inset 0 0 200px 80px rgba(0,0,0,0.15)',
        }}
      />

      {/* Neon glow borders: magenta top/bottom, cyan left/right */}
      <div
        className="absolute inset-0 pointer-events-none z-[10]"
        style={{
          boxShadow: [
            'inset 0 2px 30px -5px rgba(255,0,255,0.3)',
            'inset 0 -2px 30px -5px rgba(0,255,255,0.3)',
            'inset 2px 0 30px -5px rgba(0,255,255,0.2)',
            'inset -2px 0 30px -5px rgba(0,255,255,0.2)',
          ].join(', '),
        }}
      />

      {/* VHS tracking line band (occasional glitch) */}
      {vhsActive && (
        <div
          className="absolute left-0 right-0 pointer-events-none z-[11]"
          style={{
            top: `${vhsY}%`,
            height: '6px',
            background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.15) 30%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0.15) 70%, transparent 100%)',
            filter: 'blur(1px)',
            transform: 'translateX(2px)',
          }}
        />
      )}

      {/* CRT border outline with subtle glow */}
      <div
        className="absolute inset-0 pointer-events-none z-[10]"
        style={{
          border: '1px solid rgba(255,0,255,0.06)',
          borderRadius: '8px',
        }}
      />
    </>
  );
}
