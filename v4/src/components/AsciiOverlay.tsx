import { useRef, useEffect, useCallback, type RefObject } from 'react';

// ASCII characters from dark to bright (10 levels)
const ASCII_CHARS = ' .:-=+*#%@';

// Resolution: 160 columns x 50 rows gives a good balance of detail vs performance
const COLS = 160;
const ROWS = 50;

// Update rate: ~15fps
const FRAME_INTERVAL_MS = 67;

interface AsciiOverlayProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  enabled: boolean;
}

export function AsciiOverlay({ canvasRef, enabled }: AsciiOverlayProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);

  // Lazily create offscreen canvas for downsampling
  const getOffscreen = useCallback(() => {
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
      offscreenCanvasRef.current.width = COLS;
      offscreenCanvasRef.current.height = ROWS;
      offscreenCtxRef.current = offscreenCanvasRef.current.getContext('2d', {
        willReadFrequently: true,
      });
    }
    return { canvas: offscreenCanvasRef.current, ctx: offscreenCtxRef.current };
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Clean up RAF when disabled
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      return;
    }

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);

      // Throttle to ~15fps
      if (now - lastUpdateRef.current < FRAME_INTERVAL_MS) return;
      lastUpdateRef.current = now;

      const sourceCanvas = canvasRef.current;
      const pre = preRef.current;
      if (!sourceCanvas || !pre || sourceCanvas.width === 0 || sourceCanvas.height === 0) return;

      const { canvas: offscreen, ctx } = getOffscreen();
      if (!ctx) return;

      // Downsample: draw source canvas into small offscreen canvas
      ctx.drawImage(sourceCanvas, 0, 0, COLS, ROWS);
      const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
      const pixels = imageData.data;

      // Build colored ASCII art using spans
      // For performance, build the entire HTML string at once
      const parts: string[] = [];
      parts.push('<span>');

      let prevR = -1, prevG = -1, prevB = -1;

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const i = (y * COLS + x) * 4;
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];

          // Brightness (luminance formula)
          const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          const charIndex = Math.min(Math.floor(brightness * ASCII_CHARS.length), ASCII_CHARS.length - 1);
          const char = ASCII_CHARS[charIndex];

          // Only emit a new span when color changes
          if (r !== prevR || g !== prevG || b !== prevB) {
            if (prevR !== -1) parts.push('</span>');
            parts.push(`<span style="color:rgb(${r},${g},${b})">`);
            prevR = r;
            prevG = g;
            prevB = b;
          }

          // Escape HTML special chars
          if (char === '<') parts.push('&lt;');
          else if (char === '>') parts.push('&gt;');
          else if (char === '&') parts.push('&amp;');
          else parts.push(char);
        }
        parts.push('\n');
      }
      parts.push('</span>');

      pre.innerHTML = parts.join('');
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [enabled, canvasRef, getOffscreen]);

  if (!enabled) return null;

  return (
    <div
      className="absolute inset-0 z-15 pointer-events-none"
      style={{ background: 'rgba(0, 0, 0, 0.95)' }}
    >
      <pre
        ref={preRef}
        style={{
          margin: 0,
          padding: 0,
          width: '100%',
          height: '100%',
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: '0.85vw',
          lineHeight: '1.15',
          letterSpacing: '0.05em',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          whiteSpace: 'pre',
        }}
      />
      {/* ASCII MODE badge */}
      <div
        className="absolute top-4 right-4 z-20"
        style={{
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#00ff00',
          textShadow: '0 0 10px rgba(0, 255, 0, 0.5), 0 0 20px rgba(0, 255, 0, 0.3)',
          letterSpacing: '0.2em',
          opacity: 0.8,
        }}
      >
        ASCII MODE [~]
      </div>
    </div>
  );
}
