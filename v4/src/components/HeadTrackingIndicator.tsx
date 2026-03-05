/**
 * HeadTrackingIndicator.tsx - HUD indicator for head-tracking camera control
 *
 * Shows during racing when head tracking is active:
 *   - Status dot: green when face detected, red when lost
 *   - Small webcam preview (80x60) with crosshair showing face position
 *   - "HEAD TRACKING" label
 *   - Can be toggled visible/hidden by clicking
 */
import { useRef, useEffect, useState } from 'react';

interface HeadTrackingIndicatorProps {
  /** Whether a face is currently detected */
  faceDetected: boolean;
  /** Normalized offset X (-10 to 10) */
  offsetX: number;
  /** Normalized offset Y (-5 to 5) */
  offsetY: number;
  /** Reference to the webcam video element for preview */
  videoElement: HTMLVideoElement | null;
}

export function HeadTrackingIndicator({ faceDetected, offsetX, offsetY, videoElement }: HeadTrackingIndicatorProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [showPreview, setShowPreview] = useState(true);
  const rafRef = useRef(0);

  // Draw webcam preview with crosshair overlay
  useEffect(() => {
    if (!showPreview || !videoElement) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const drawFrame = () => {
      if (!running) return;

      // Draw mirrored video frame
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(videoElement, -80, 0, 80, 60);
      ctx.restore();

      // Draw crosshair at detected face position
      // Map offsetX/Y back to canvas coordinates
      // offsetX: -10..10 -> 0..80 (mirrored)
      const crossX = 40 + (offsetX / 10) * 35;
      const crossY = 30 + (offsetY / 5) * 25;

      ctx.strokeStyle = faceDetected ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.5)';
      ctx.lineWidth = 1;

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(crossX - 8, crossY);
      ctx.lineTo(crossX + 8, crossY);
      ctx.stroke();

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(crossX, crossY - 8);
      ctx.lineTo(crossX, crossY + 8);
      ctx.stroke();

      // Small circle at center
      ctx.beginPath();
      ctx.arc(crossX, crossY, 3, 0, Math.PI * 2);
      ctx.stroke();

      rafRef.current = requestAnimationFrame(drawFrame);
    };

    rafRef.current = requestAnimationFrame(drawFrame);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [showPreview, videoElement, offsetX, offsetY, faceDetected]);

  const dotColor = faceDetected ? 'bg-green-400' : 'bg-red-400';
  const dotGlow = faceDetected
    ? '0 0 6px rgba(34, 197, 94, 0.6)'
    : '0 0 6px rgba(239, 68, 68, 0.6)';

  return (
    <div
      className="flex flex-col items-end gap-1 cursor-pointer select-none"
      onClick={() => setShowPreview(prev => !prev)}
    >
      {/* Status bar */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 backdrop-blur-sm">
        {/* Status dot */}
        <div
          className={`w-2 h-2 rounded-full ${dotColor}`}
          style={{ boxShadow: dotGlow, transition: 'background-color 0.3s, box-shadow 0.3s' }}
        />
        <span className="text-[9px] font-mono text-cyan-400/80 uppercase tracking-wider leading-none">
          Head Tracking
        </span>
      </div>

      {/* Webcam preview */}
      {showPreview && videoElement && (
        <div className="relative rounded overflow-hidden border border-white/10" style={{ width: 80, height: 60 }}>
          <canvas
            ref={previewCanvasRef}
            width={80}
            height={60}
            className="block"
            style={{ imageRendering: 'auto' }}
          />
          {/* Semi-transparent overlay for less distraction */}
          <div className="absolute inset-0 bg-black/20 pointer-events-none" />
        </div>
      )}
    </div>
  );
}
