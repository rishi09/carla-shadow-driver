import { useRef, useEffect } from 'react';

interface VideoCanvasProps {
  onBinaryFrame: (handler: ((data: Blob) => void) | null) => void;
  className?: string;
}

export function VideoCanvas({ onBinaryFrame, className = '' }: VideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw initial black frame with "Waiting for video..." text
    ctx.fillStyle = '#0f0f1f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff44';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for video feed...', canvas.width / 2, canvas.height / 2);

    const handler = (blob: Blob) => {
      createImageBitmap(blob).then(bitmap => {
        if (!canvasRef.current) return;
        const c = canvasRef.current;
        // Match canvas internal resolution to frame
        if (c.width !== bitmap.width || c.height !== bitmap.height) {
          c.width = bitmap.width;
          c.height = bitmap.height;
        }
        const drawCtx = c.getContext('2d');
        if (drawCtx) {
          drawCtx.drawImage(bitmap, 0, 0);
        }
        bitmap.close();
      }).catch(() => {
        // Failed to decode JPEG - skip frame
      });
    };

    onBinaryFrame(handler);

    return () => {
      onBinaryFrame(null);
    };
  }, [onBinaryFrame]);

  return (
    <canvas
      ref={canvasRef}
      width={1280}
      height={720}
      className={`bg-dark-500 rounded-lg ${className}`}
      style={{ width: '100%', height: 'auto', maxHeight: '80vh', objectFit: 'contain' }}
    />
  );
}
