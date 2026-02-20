import { useRef, useEffect, useCallback } from 'react';

interface RearMirrorProps {
  onRearFrame: (handler: ((data: Blob) => void) | null) => void;
  visible: boolean;
}

/**
 * Rear-view mirror inset -- renders the rear camera JPEG stream
 * onto a small canvas styled to look like a car mirror.
 */
export function RearMirror({ onRearFrame, visible }: RearMirrorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const pendingFrameRef = useRef<boolean>(false);
  const rafIdRef = useRef<number>(0);

  // Lazily create the off-screen back buffer
  const getBackBuffer = useCallback(() => {
    if (!backCanvasRef.current) {
      backCanvasRef.current = document.createElement('canvas');
      backCanvasRef.current.width = 320;
      backCanvasRef.current.height = 120;
      backCtxRef.current = backCanvasRef.current.getContext('2d');
    }
    return { canvas: backCanvasRef.current, ctx: backCtxRef.current };
  }, []);

  useEffect(() => {
    if (!visible) {
      onRearFrame(null);
      return;
    }

    const frontCanvas = canvasRef.current;
    if (!frontCanvas) return;

    const frontCtx = frontCanvas.getContext('2d');
    if (!frontCtx) return;

    // Fill with dark background initially
    frontCtx.fillStyle = '#111';
    frontCtx.fillRect(0, 0, frontCanvas.width, frontCanvas.height);

    // rAF presentation loop: blit back buffer to front buffer
    const presentLoop = () => {
      if (pendingFrameRef.current) {
        const { canvas: backCanvas } = getBackBuffer();
        const front = canvasRef.current;
        if (front) {
          if (front.width !== backCanvas.width || front.height !== backCanvas.height) {
            front.width = backCanvas.width;
            front.height = backCanvas.height;
          }
          const ctx = front.getContext('2d');
          if (ctx) {
            ctx.drawImage(backCanvas, 0, 0);
          }
        }
        pendingFrameRef.current = false;
      }
      rafIdRef.current = requestAnimationFrame(presentLoop);
    };
    rafIdRef.current = requestAnimationFrame(presentLoop);

    // Decode incoming JPEG blobs into the back buffer
    let decoding = false;
    const handler = (blob: Blob) => {
      if (decoding) return;
      decoding = true;

      createImageBitmap(blob)
        .then((bitmap) => {
          const { canvas: backCanvas, ctx: backCtx } = getBackBuffer();
          if (!backCtx) {
            bitmap.close();
            decoding = false;
            return;
          }
          if (backCanvas.width !== bitmap.width || backCanvas.height !== bitmap.height) {
            backCanvas.width = bitmap.width;
            backCanvas.height = bitmap.height;
          }
          backCtx.drawImage(bitmap, 0, 0);
          bitmap.close();
          pendingFrameRef.current = true;
          decoding = false;
        })
        .catch(() => {
          decoding = false;
        });
    };

    onRearFrame(handler);

    return () => {
      onRearFrame(null);
      cancelAnimationFrame(rafIdRef.current);
    };
  }, [visible, onRearFrame, getBackBuffer]);

  if (!visible) return null;

  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
      style={{
        width: 320,
        // Container slightly taller than canvas to fit the text
      }}
    >
      {/* Mirror frame */}
      <div
        style={{
          borderRadius: 10,
          border: '2px solid rgba(60, 60, 70, 0.9)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.5), inset 0 0 8px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          position: 'relative',
          background: '#111',
        }}
      >
        {/* Canvas with slight blue tint overlay (anti-glare mirror effect) */}
        <canvas
          ref={canvasRef}
          width={320}
          height={120}
          style={{
            display: 'block',
            width: 320,
            height: 120,
          }}
        />
        {/* Blue anti-glare tint overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(100, 140, 200, 0.08) 0%, rgba(80, 120, 180, 0.12) 100%)',
            pointerEvents: 'none',
          }}
        />
        {/* Mirror text at bottom */}
        <div
          style={{
            position: 'absolute',
            bottom: 2,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 6,
            fontFamily: 'monospace',
            color: 'rgba(255, 255, 255, 0.35)',
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          Objects in mirror are closer than they appear
        </div>
      </div>
    </div>
  );
}
