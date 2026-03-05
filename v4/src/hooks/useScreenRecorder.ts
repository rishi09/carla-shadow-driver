/**
 * useScreenRecorder.ts - Full-featured screen recorder for gameplay clips
 *
 * Records the game canvas using Canvas.captureStream() + MediaRecorder API.
 * Supports manual start/stop recording, duration tracking, and produces
 * downloadable WebM video files.
 *
 * Features:
 * - Manual recording with start/stop controls
 * - Real-time duration counter
 * - Auto-record option: records entire race, saves on finish
 * - WebM output at 2.5 Mbps with VP9 codec
 * - Web Share API integration for mobile sharing
 */
import { useRef, useCallback, useState, useEffect } from 'react';
import type { RefObject } from 'react';

/** Preferred MIME type for recording */
const MIME_TYPE = 'video/webm;codecs=vp9';
const FALLBACK_MIME = 'video/webm';

/** Recording bitrate */
const VIDEO_BITRATE = 2_500_000; // 2.5 Mbps

/** Canvas capture framerate */
const CAPTURE_FPS = 30;

/** Duration update interval (ms) */
const DURATION_TICK_MS = 100;

export interface ScreenRecorderState {
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Current recording duration in seconds */
  recordingDuration: number;
  /** URL of the last recorded clip (for preview) */
  lastRecordingUrl: string | null;
  /** Blob of the last recorded clip (for download/share) */
  lastRecordingBlob: Blob | null;
  /** Whether auto-record is enabled (records entire race) */
  autoRecordEnabled: boolean;
  /** Whether the browser supports MediaRecorder */
  isSupported: boolean;
}

export interface ScreenRecorderActions {
  /** Begin recording the game canvas */
  startRecording: () => void;
  /** Stop recording and produce a WebM blob */
  stopRecording: () => void;
  /** Toggle recording on/off */
  toggleRecording: () => void;
  /** Download the last recorded clip */
  downloadRecording: () => void;
  /** Share the last recorded clip via Web Share API (falls back to download) */
  shareRecording: () => Promise<void>;
  /** Toggle auto-record mode */
  toggleAutoRecord: () => void;
  /** Dismiss/clear the last recording preview */
  dismissRecording: () => void;
}

export function useScreenRecorder(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  raceStatus?: string | null,
): ScreenRecorderState & ScreenRecorderActions {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [lastRecordingUrl, setLastRecordingUrl] = useState<string | null>(null);
  const [lastRecordingBlob, setLastRecordingBlob] = useState<Blob | null>(null);
  const [autoRecordEnabled, setAutoRecordEnabled] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRecordActiveRef = useRef(false);

  /**
   * Check browser support for MediaRecorder
   */
  const isSupported = typeof MediaRecorder !== 'undefined' && (
    MediaRecorder.isTypeSupported(MIME_TYPE) ||
    MediaRecorder.isTypeSupported(FALLBACK_MIME)
  );

  /**
   * Get the best supported MIME type
   */
  const getSupportedMime = useCallback((): string => {
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported(MIME_TYPE)) return MIME_TYPE;
      if (MediaRecorder.isTypeSupported(FALLBACK_MIME)) return FALLBACK_MIME;
    }
    return '';
  }, []);

  /**
   * Clean up duration timer
   */
  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  /**
   * Start duration timer
   */
  const startDurationTimer = useCallback(() => {
    stopDurationTimer();
    startTimeRef.current = performance.now();
    setRecordingDuration(0);
    durationIntervalRef.current = setInterval(() => {
      const elapsed = (performance.now() - startTimeRef.current) / 1000;
      setRecordingDuration(elapsed);
    }, DURATION_TICK_MS);
  }, [stopDurationTimer]);

  /**
   * Finalize recording: create blob, generate URL
   */
  const finalizeRecording = useCallback((chunks: Blob[]) => {
    const mime = getSupportedMime() || 'video/webm';
    const blob = new Blob(chunks, { type: mime });

    if (blob.size === 0) {
      console.warn('[ScreenRecorder] Empty recording, discarding');
      return;
    }

    // Revoke previous URL to prevent memory leaks
    if (lastRecordingUrl) {
      URL.revokeObjectURL(lastRecordingUrl);
    }

    const url = URL.createObjectURL(blob);
    setLastRecordingUrl(url);
    setLastRecordingBlob(blob);

    console.log(
      `[ScreenRecorder] Recording saved: ${(blob.size / 1024 / 1024).toFixed(2)} MB, ` +
      `${recordingDuration.toFixed(1)}s`
    );
  }, [getSupportedMime, lastRecordingUrl, recordingDuration]);

  /**
   * Start recording from the canvas
   */
  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.warn('[ScreenRecorder] No canvas element available');
      return;
    }

    if (isRecording) {
      console.warn('[ScreenRecorder] Already recording');
      return;
    }

    const mime = getSupportedMime();
    if (!mime) {
      console.warn('[ScreenRecorder] MediaRecorder not supported');
      return;
    }

    try {
      const stream = canvas.captureStream(CAPTURE_FPS);
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: VIDEO_BITRATE,
      });

      chunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        finalizeRecording([...chunksRef.current]);
        chunksRef.current = [];
      };

      recorder.onerror = () => {
        console.warn('[ScreenRecorder] MediaRecorder error');
        setIsRecording(false);
        stopDurationTimer();
      };

      // Request data every second for smoother chunk collection
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      startDurationTimer();

      console.log('[ScreenRecorder] Recording started');
    } catch (err) {
      console.warn('[ScreenRecorder] Failed to start recording:', err);
    }
  }, [canvasRef, isRecording, getSupportedMime, finalizeRecording, stopDurationTimer, startDurationTimer]);

  /**
   * Stop recording
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
    stopDurationTimer();

    console.log('[ScreenRecorder] Recording stopped');
  }, [stopDurationTimer]);

  /**
   * Toggle recording on/off
   */
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  /**
   * Download the last recorded clip
   */
  const downloadRecording = useCallback(() => {
    if (!lastRecordingBlob) {
      console.warn('[ScreenRecorder] No recording to download');
      return;
    }

    const url = URL.createObjectURL(lastRecordingBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shadow-driver-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, [lastRecordingBlob]);

  /**
   * Share the last recorded clip via Web Share API
   */
  const shareRecording = useCallback(async () => {
    if (!lastRecordingBlob) {
      console.warn('[ScreenRecorder] No recording to share');
      return;
    }

    const file = new File(
      [lastRecordingBlob],
      `shadow-driver-${Date.now()}.webm`,
      { type: lastRecordingBlob.type },
    );

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: 'Shadow Driver Gameplay',
          text: 'Check out my Shadow Driver race!',
          files: [file],
        });
        return;
      } catch {
        // User cancelled or share failed -- fall through to download
      }
    }

    // Fallback: download
    downloadRecording();
  }, [lastRecordingBlob, downloadRecording]);

  /**
   * Toggle auto-record mode
   */
  const toggleAutoRecord = useCallback(() => {
    setAutoRecordEnabled(prev => !prev);
  }, []);

  /**
   * Dismiss/clear the last recording preview
   */
  const dismissRecording = useCallback(() => {
    if (lastRecordingUrl) {
      URL.revokeObjectURL(lastRecordingUrl);
    }
    setLastRecordingUrl(null);
    setLastRecordingBlob(null);
  }, [lastRecordingUrl]);

  /**
   * Auto-record: start recording when race begins, stop when it ends
   */
  useEffect(() => {
    if (!autoRecordEnabled) return;

    const canvas = canvasRef.current;

    if (raceStatus === 'racing' && canvas && !autoRecordActiveRef.current) {
      autoRecordActiveRef.current = true;
      // Small delay to ensure canvas has content
      const timer = setTimeout(() => {
        if (!isRecording) {
          startRecording();
        }
      }, 500);
      return () => clearTimeout(timer);
    }

    if (raceStatus === 'finished' && autoRecordActiveRef.current) {
      autoRecordActiveRef.current = false;
      if (isRecording) {
        stopRecording();
      }
    }

    return undefined;
  }, [autoRecordEnabled, raceStatus, canvasRef, isRecording, startRecording, stopRecording]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach(track => track.stop());
      stopDurationTimer();
      // Note: we don't revoke lastRecordingUrl here because the state
      // won't be accessible. The URL will be garbage collected eventually.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isRecording,
    recordingDuration,
    lastRecordingUrl,
    lastRecordingBlob,
    autoRecordEnabled,
    isSupported,
    startRecording,
    stopRecording,
    toggleRecording,
    downloadRecording,
    shareRecording,
    toggleAutoRecord,
    dismissRecording,
  };
}
