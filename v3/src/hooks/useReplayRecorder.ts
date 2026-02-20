/**
 * useReplayRecorder.ts - Ring buffer replay clip recording system
 *
 * Continuously records the last 15 seconds of gameplay from the video canvas
 * using MediaRecorder API. Players can manually save clips or enable
 * auto-highlight detection for exciting moments.
 */
import { useRef, useCallback, useState, useEffect } from 'react';
import type { RefObject } from 'react';
import type { RaceState } from '../types/index.ts';

/** Maximum duration of the ring buffer in seconds */
const BUFFER_DURATION_S = 15;

/** MediaRecorder timeslice: produce a chunk every 1 second */
const TIMESLICE_MS = 1000;

/** Preferred MIME type for recording */
const MIME_TYPE = 'video/webm;codecs=vp9';
const FALLBACK_MIME = 'video/webm';

/** Auto-highlight thresholds */
const HIGH_SPEED_THRESHOLD_KMH = 180;
const COLLISION_SPEED_THRESHOLD_KMH = 100;
const CLOSE_FINISH_GAP_S = 0.5;

/** Cooldown between auto-highlight saves (ms) */
const AUTO_HIGHLIGHT_COOLDOWN_MS = 20000;

interface UseReplayRecorderReturn {
  isRecording: boolean;
  saveClip: () => Promise<string | null>;
  lastClipUrl: string | null;
  autoHighlightEnabled: boolean;
  toggleAutoHighlight: () => void;
}

export function useReplayRecorder(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  raceState: RaceState | null,
): UseReplayRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [lastClipUrl, setLastClipUrl] = useState<string | null>(null);
  const [autoHighlightEnabled, setAutoHighlightEnabled] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const lastAutoSaveRef = useRef<number>(0);

  // Track previous state for edge detection (overtakes, checkpoint events)
  const prevGapSignRef = useRef<number>(0);
  const prevCheckpointRef = useRef<number>(0);

  /**
   * Get supported MIME type for MediaRecorder
   */
  const getSupportedMime = useCallback((): string => {
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported(MIME_TYPE)) return MIME_TYPE;
      if (MediaRecorder.isTypeSupported(FALLBACK_MIME)) return FALLBACK_MIME;
    }
    return '';
  }, []);

  /**
   * Start recording from the canvas
   */
  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mime = getSupportedMime();
    if (!mime) {
      console.warn('[ReplayRecorder] MediaRecorder not supported or no suitable MIME type');
      return;
    }

    try {
      const stream = canvas.captureStream(30);
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 2_500_000, // 2.5 Mbps for decent quality
      });

      chunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          // Keep only the last BUFFER_DURATION_S seconds of chunks
          // Each chunk is ~TIMESLICE_MS, so max chunks = BUFFER_DURATION_S * 1000 / TIMESLICE_MS
          const maxChunks = Math.ceil((BUFFER_DURATION_S * 1000) / TIMESLICE_MS);
          if (chunksRef.current.length > maxChunks) {
            chunksRef.current = chunksRef.current.slice(-maxChunks);
          }
        }
      };

      recorder.onerror = () => {
        console.warn('[ReplayRecorder] MediaRecorder error');
        setIsRecording(false);
      };

      recorder.start(TIMESLICE_MS);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      console.log('[ReplayRecorder] Recording started');
    } catch (err) {
      console.warn('[ReplayRecorder] Failed to start recording:', err);
    }
  }, [canvasRef, getSupportedMime]);

  /**
   * Stop recording and clean up
   */
  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;

    // Stop all tracks on the captured stream
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;

    setIsRecording(false);
    console.log('[ReplayRecorder] Recording stopped');
  }, []);

  /**
   * Save the current ring buffer as a downloadable clip.
   * Returns a blob URL for preview, or null if no data.
   */
  const saveClip = useCallback(async (): Promise<string | null> => {
    if (chunksRef.current.length === 0) {
      console.warn('[ReplayRecorder] No recorded data to save');
      return null;
    }

    // Create a blob from all buffered chunks
    const mime = getSupportedMime() || 'video/webm';
    const blob = new Blob(chunksRef.current, { type: mime });

    if (blob.size === 0) {
      console.warn('[ReplayRecorder] Empty blob, nothing to save');
      return null;
    }

    // Revoke previous URL to avoid memory leaks
    if (lastClipUrl) {
      URL.revokeObjectURL(lastClipUrl);
    }

    const url = URL.createObjectURL(blob);
    setLastClipUrl(url);

    // Try Web Share API on mobile, otherwise trigger download
    const canShare = typeof navigator.share === 'function' && navigator.canShare?.({ files: [new File([blob], 'clip.webm', { type: mime })] });

    if (canShare) {
      try {
        const file = new File([blob], `shadow-driver-clip-${Date.now()}.webm`, { type: mime });
        await navigator.share({
          title: 'Shadow Driver Replay',
          files: [file],
        });
      } catch {
        // User cancelled share or share failed -- fall through to download
        triggerDownload(blob, mime);
      }
    }

    console.log(`[ReplayRecorder] Clip saved: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    return url;
  }, [lastClipUrl, getSupportedMime]);

  /**
   * Trigger a file download for the clip
   */
  const triggerDownload = useCallback((blob: Blob, mime: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shadow-driver-clip-${Date.now()}.webm`;
    a.type = mime;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Don't revoke immediately -- let the browser finish the download
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, []);

  /**
   * Download the last saved clip
   */
  const downloadLastClip = useCallback(() => {
    if (chunksRef.current.length === 0) return;
    const mime = getSupportedMime() || 'video/webm';
    const blob = new Blob(chunksRef.current, { type: mime });
    triggerDownload(blob, mime);
  }, [getSupportedMime, triggerDownload]);

  // Keep downloadLastClip accessible to avoid unused warning
  void downloadLastClip;

  const toggleAutoHighlight = useCallback(() => {
    setAutoHighlightEnabled(prev => !prev);
  }, []);

  /**
   * Start/stop recording based on race status
   */
  useEffect(() => {
    const status = raceState?.race_status;
    const canvas = canvasRef.current;

    if (status === 'racing' && canvas && !isRecording) {
      // Small delay to ensure the canvas has content
      const timer = setTimeout(() => startRecording(), 500);
      return () => clearTimeout(timer);
    }

    if (status !== 'racing' && status !== 'countdown' && isRecording) {
      stopRecording();
    }

    return undefined;
  }, [raceState?.race_status, canvasRef, isRecording, startRecording, stopRecording]);

  /**
   * Auto-highlight detection: watch race state for exciting moments
   */
  useEffect(() => {
    if (!autoHighlightEnabled || !isRecording || !raceState) return;

    const now = Date.now();
    if (now - lastAutoSaveRef.current < AUTO_HIGHLIGHT_COOLDOWN_MS) return;

    const player = raceState.player;
    let shouldSave = false;

    // 1. Overtake detection: gap sign changes from positive (behind) to negative (ahead)
    const gap = player.gap_seconds;
    if (gap != null) {
      const currentSign = gap > 0 ? 1 : gap < 0 ? -1 : 0;
      if (prevGapSignRef.current > 0 && currentSign < 0) {
        shouldSave = true;
        console.log('[ReplayRecorder] Auto-highlight: Overtake detected!');
      }
      prevGapSignRef.current = currentSign;
    }

    // 2. Close finish at checkpoints: gap < threshold when passing a checkpoint
    const currentCheckpoint = player.checkpoint;
    if (currentCheckpoint !== prevCheckpointRef.current) {
      if (gap != null && Math.abs(gap) < CLOSE_FINISH_GAP_S) {
        shouldSave = true;
        console.log('[ReplayRecorder] Auto-highlight: Close finish at checkpoint!');
      }
      prevCheckpointRef.current = currentCheckpoint;
    }

    // 3. High speed moment
    if (player.speed_kmh > HIGH_SPEED_THRESHOLD_KMH) {
      shouldSave = true;
      console.log('[ReplayRecorder] Auto-highlight: High speed moment!');
    }

    // 4. Collision at speed
    if (
      raceState.collisions &&
      raceState.collisions.length > 0 &&
      player.speed_kmh > COLLISION_SPEED_THRESHOLD_KMH
    ) {
      shouldSave = true;
      console.log('[ReplayRecorder] Auto-highlight: High-speed collision!');
    }

    if (shouldSave) {
      lastAutoSaveRef.current = now;
      saveClip();
    }
  }, [
    autoHighlightEnabled,
    isRecording,
    raceState,
    raceState?.player?.gap_seconds,
    raceState?.player?.checkpoint,
    raceState?.player?.speed_kmh,
    raceState?.collisions,
    saveClip,
  ]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopRecording();
      if (lastClipUrl) {
        URL.revokeObjectURL(lastClipUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isRecording,
    saveClip,
    lastClipUrl,
    autoHighlightEnabled,
    toggleAutoHighlight,
  };
}
