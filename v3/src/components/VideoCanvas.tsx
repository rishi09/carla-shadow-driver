import { useRef, useEffect, useCallback } from 'react';

interface VideoCanvasProps {
  onBinaryFrame: (handler: ((data: Blob) => void) | null) => void;
  className?: string;
}

export function VideoCanvas({ onBinaryFrame, className = '' }: VideoCanvasProps) {
  const frontCanvasRef = useRef<HTMLCanvasElement>(null);
  const backCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const pendingFrameRef = useRef<boolean>(false);
  const rafIdRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Lazily initialize the off-screen back buffer canvas
  const getBackBuffer = useCallback(() => {
    if (!backCanvasRef.current) {
      backCanvasRef.current = document.createElement('canvas');
      backCanvasRef.current.width = 1280;
      backCanvasRef.current.height = 720;
      backCtxRef.current = backCanvasRef.current.getContext('2d');
    }
    return { canvas: backCanvasRef.current, ctx: backCtxRef.current };
  }, []);

  useEffect(() => {
    const frontCanvas = frontCanvasRef.current;
    if (!frontCanvas) return;
    const frontCtx = frontCanvas.getContext('2d');
    if (!frontCtx) return;

    // Draw initial "waiting" state on the front buffer
    frontCtx.fillStyle = '#0f0f1f';
    frontCtx.fillRect(0, 0, frontCanvas.width, frontCanvas.height);
    frontCtx.fillStyle = '#ffffff44';
    frontCtx.font = '24px sans-serif';
    frontCtx.textAlign = 'center';
    frontCtx.fillText('Waiting for video feed...', frontCanvas.width / 2, frontCanvas.height / 2);

    // Start FPS logging: count frames presented per second
    frameCountRef.current = 0;
    fpsIntervalRef.current = setInterval(() => {
      if (frameCountRef.current > 0) {
        console.log(`[VideoCanvas] FPS: ${frameCountRef.current}`);
      }
      frameCountRef.current = 0;
    }, 1000);

    // rAF loop: when a new frame has been decoded into the back buffer,
    // blit it to the front buffer on the next animation frame.
    const presentLoop = () => {
      if (pendingFrameRef.current) {
        const { canvas: backCanvas } = getBackBuffer();
        const front = frontCanvasRef.current;
        if (front) {
          // Resize front buffer to match back buffer dimensions if needed
          if (front.width !== backCanvas.width || front.height !== backCanvas.height) {
            front.width = backCanvas.width;
            front.height = backCanvas.height;
          }
          const ctx = front.getContext('2d');
          if (ctx) {
            ctx.drawImage(backCanvas, 0, 0);
            frameCountRef.current++;
          }
        }
        pendingFrameRef.current = false;
      }
      rafIdRef.current = requestAnimationFrame(presentLoop);
    };
    rafIdRef.current = requestAnimationFrame(presentLoop);

    // Handler called by the WebSocket layer for each incoming JPEG blob.
    // Decodes asynchronously into the back buffer; the rAF loop will
    // pick it up and present it on the next vsync.
    let decoding = false;

    const handler = (blob: Blob) => {
      // Drop frame if we are still decoding the previous one to avoid
      // unbounded decode queue buildup.
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

          // Resize back buffer to match the incoming frame dimensions
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
          // Failed to decode JPEG - skip frame
          decoding = false;
        });
    };

    onBinaryFrame(handler);

    return () => {
      onBinaryFrame(null);
      cancelAnimationFrame(rafIdRef.current);
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current);
        fpsIntervalRef.current = null;
      }
    };
  }, [onBinaryFrame, getBackBuffer]);

  return (
    <canvas
      ref={frontCanvasRef}
      width={1280}
      height={720}
      className={`bg-dark-500 rounded-lg ${className}`}
      style={{ width: '100%', height: 'auto', maxHeight: '80vh', objectFit: 'contain' }}
    />
  );
}
