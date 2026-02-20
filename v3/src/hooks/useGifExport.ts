/**
 * useGifExport.ts - Capture canvas frames into a ring buffer and export as GIF
 *
 * Continuously captures the video canvas at ~10fps into a ring buffer holding
 * the last 5 seconds (50 frames). On export, downsamples frames to 320x180
 * and sends them to a Web Worker for off-main-thread GIF89a encoding.
 *
 * Usage:
 *   const gifExport = useGifExport(canvasRef, isRacing);
 *   // Later: gifExport.exportGif() returns a Promise<Blob | null>
 */
import { useRef, useCallback, useState, useEffect } from 'react';
import type { RefObject } from 'react';

/** Ring buffer capacity: 5 seconds at 10fps = 50 frames */
const BUFFER_SECONDS = 5;
const CAPTURE_FPS = 10;
const BUFFER_SIZE = BUFFER_SECONDS * CAPTURE_FPS;

/** Capture interval in ms */
const CAPTURE_INTERVAL_MS = 1000 / CAPTURE_FPS;

/** GIF output dimensions (16:9, small for social sharing) */
const GIF_WIDTH = 320;
const GIF_HEIGHT = 180;

/** GIF frame delay in centiseconds (100ms = 10 centiseconds) */
const GIF_FRAME_DELAY = 10;

export interface GifExportState {
  /** Whether GIF encoding is in progress */
  isEncoding: boolean;
  /** Encoding progress (0-100) */
  encodingProgress: number;
  /** URL of the last exported GIF (for preview/download) */
  lastGifUrl: string | null;
  /** Blob of the last exported GIF */
  lastGifBlob: Blob | null;
  /** Number of frames currently in the ring buffer */
  bufferFrameCount: number;
}

export interface GifExportActions {
  /** Export the ring buffer contents as an animated GIF */
  exportGif: () => Promise<Blob | null>;
  /** Download the last exported GIF */
  downloadGif: () => void;
  /** Clear the last exported GIF (free memory) */
  dismissGif: () => void;
}

export function useGifExport(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  isActive: boolean,
): GifExportState & GifExportActions {
  const [isEncoding, setIsEncoding] = useState(false);
  const [encodingProgress, setEncodingProgress] = useState(0);
  const [lastGifUrl, setLastGifUrl] = useState<string | null>(null);
  const [lastGifBlob, setLastGifBlob] = useState<Blob | null>(null);
  const [bufferFrameCount, setBufferFrameCount] = useState(0);

  // Ring buffer: stores downsampled RGBA pixel data as ArrayBuffers
  const ringBufferRef = useRef<ArrayBuffer[]>([]);
  const ringIndexRef = useRef(0);

  // Off-screen canvas for downsampling
  const downsampleCanvasRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);
  const downsampleCtxRef = useRef<CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null>(null);

  // Capture timer
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Worker ref
  const workerRef = useRef<Worker | null>(null);

  /**
   * Get or create the downsampling canvas
   */
  const getDownsampleCanvas = useCallback(() => {
    if (!downsampleCanvasRef.current) {
      if (typeof OffscreenCanvas !== 'undefined') {
        downsampleCanvasRef.current = new OffscreenCanvas(GIF_WIDTH, GIF_HEIGHT);
        downsampleCtxRef.current = downsampleCanvasRef.current.getContext('2d');
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = GIF_WIDTH;
        canvas.height = GIF_HEIGHT;
        downsampleCanvasRef.current = canvas;
        downsampleCtxRef.current = canvas.getContext('2d');
      }
    }
    return { canvas: downsampleCanvasRef.current, ctx: downsampleCtxRef.current };
  }, []);

  /**
   * Capture a single frame from the source canvas into the ring buffer
   */
  const captureFrame = useCallback(() => {
    const sourceCanvas = canvasRef.current;
    if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return;

    const { ctx } = getDownsampleCanvas();
    if (!ctx) return;

    // Draw source canvas scaled down to GIF dimensions
    ctx.drawImage(sourceCanvas, 0, 0, GIF_WIDTH, GIF_HEIGHT);

    // Get pixel data
    const imageData = ctx.getImageData(0, 0, GIF_WIDTH, GIF_HEIGHT);
    const buffer = imageData.data.buffer.slice(0); // Copy the buffer

    // Write to ring buffer
    const ring = ringBufferRef.current;
    if (ring.length < BUFFER_SIZE) {
      ring.push(buffer);
    } else {
      ring[ringIndexRef.current % BUFFER_SIZE] = buffer;
    }
    ringIndexRef.current++;
    setBufferFrameCount(Math.min(ring.length, BUFFER_SIZE));
  }, [canvasRef, getDownsampleCanvas]);

  /**
   * Start/stop capture based on isActive flag
   */
  useEffect(() => {
    if (isActive) {
      // Start capturing
      captureIntervalRef.current = setInterval(captureFrame, CAPTURE_INTERVAL_MS);

      return () => {
        if (captureIntervalRef.current) {
          clearInterval(captureIntervalRef.current);
          captureIntervalRef.current = null;
        }
      };
    } else {
      // Stop capturing and clear buffer
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
      ringBufferRef.current = [];
      ringIndexRef.current = 0;
      setBufferFrameCount(0);
    }
  }, [isActive, captureFrame]);

  /**
   * Export the ring buffer as a GIF using the Web Worker
   */
  const exportGif = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const ring = ringBufferRef.current;
      if (ring.length === 0) {
        console.warn('[GifExport] No frames captured');
        resolve(null);
        return;
      }

      // Collect frames in chronological order from ring buffer
      const frameCount = Math.min(ring.length, BUFFER_SIZE);
      const frames: ArrayBuffer[] = [];

      if (ring.length < BUFFER_SIZE) {
        // Buffer not yet full, frames are in order
        for (let i = 0; i < ring.length; i++) {
          frames.push(ring[i]);
        }
      } else {
        // Buffer is full, read from oldest to newest
        const startIdx = ringIndexRef.current % BUFFER_SIZE;
        for (let i = 0; i < BUFFER_SIZE; i++) {
          frames.push(ring[(startIdx + i) % BUFFER_SIZE]);
        }
      }

      setIsEncoding(true);
      setEncodingProgress(0);

      // Create Web Worker
      const worker = new Worker(
        new URL('../workers/gifEncoder.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === 'progress') {
          setEncodingProgress(msg.percent);
        } else if (msg.type === 'done') {
          const blob = msg.blob as Blob;

          // Revoke previous URL
          if (lastGifUrl) {
            URL.revokeObjectURL(lastGifUrl);
          }

          const url = URL.createObjectURL(blob);
          setLastGifUrl(url);
          setLastGifBlob(blob);
          setIsEncoding(false);
          setEncodingProgress(100);

          console.log(
            `[GifExport] GIF exported: ${frameCount} frames, ` +
            `${(blob.size / 1024).toFixed(1)} KB, ` +
            `${GIF_WIDTH}x${GIF_HEIGHT}`,
          );

          worker.terminate();
          workerRef.current = null;
          resolve(blob);
        } else if (msg.type === 'error') {
          console.error('[GifExport] Encoding error:', msg.message);
          setIsEncoding(false);
          worker.terminate();
          workerRef.current = null;
          resolve(null);
        }
      };

      worker.onerror = (err) => {
        console.error('[GifExport] Worker error:', err);
        setIsEncoding(false);
        worker.terminate();
        workerRef.current = null;
        resolve(null);
      };

      // Send frames to worker (transferable for zero-copy)
      worker.postMessage(
        {
          type: 'encode',
          frames,
          width: GIF_WIDTH,
          height: GIF_HEIGHT,
          frameDelay: GIF_FRAME_DELAY,
        },
        frames, // Transfer ownership of ArrayBuffers
      );

      // Clear ring buffer since we transferred the ArrayBuffers
      ringBufferRef.current = [];
      ringIndexRef.current = 0;
      setBufferFrameCount(0);
    });
  }, [lastGifUrl]);

  /**
   * Download the last exported GIF
   */
  const downloadGif = useCallback(() => {
    if (!lastGifBlob) {
      console.warn('[GifExport] No GIF to download');
      return;
    }

    const url = URL.createObjectURL(lastGifBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shadow-driver-${Date.now()}.gif`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, [lastGifBlob]);

  /**
   * Clear the last exported GIF
   */
  const dismissGif = useCallback(() => {
    if (lastGifUrl) {
      URL.revokeObjectURL(lastGifUrl);
    }
    setLastGifUrl(null);
    setLastGifBlob(null);
  }, [lastGifUrl]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  return {
    isEncoding,
    encodingProgress,
    lastGifUrl,
    lastGifBlob,
    bufferFrameCount,
    exportGif,
    downloadGif,
    dismissGif,
  };
}
