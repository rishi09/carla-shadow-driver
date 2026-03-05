/**
 * RecordingControls.tsx - Recording indicator and controls overlay
 *
 * Shows a pulsing red "REC" indicator with duration counter when recording.
 * After stopping, shows a preview card with download/share buttons.
 * Integrates with useScreenRecorder hook.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

interface RecordingControlsProps {
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Recording duration in seconds */
  recordingDuration: number;
  /** URL of the last recorded clip */
  lastRecordingUrl: string | null;
  /** Whether auto-record is enabled */
  autoRecordEnabled: boolean;
  /** Whether MediaRecorder is supported */
  isSupported: boolean;
  /** Toggle recording on/off */
  onToggleRecording: () => void;
  /** Download the last recording */
  onDownload: () => void;
  /** Share the last recording */
  onShare: () => void;
  /** Toggle auto-record mode */
  onToggleAutoRecord: () => void;
  /** Dismiss the recording preview */
  onDismiss: () => void;
}

export function RecordingControls({
  isRecording,
  recordingDuration,
  lastRecordingUrl,
  autoRecordEnabled,
  isSupported,
  onToggleRecording,
  onDownload,
  onShare,
  onToggleAutoRecord,
  onDismiss,
}: RecordingControlsProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [previewSlideIn, setPreviewSlideIn] = useState(false);
  const prevRecordingRef = useRef(false);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect when recording stops and show preview
  useEffect(() => {
    if (prevRecordingRef.current && !isRecording && lastRecordingUrl) {
      setShowPreview(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setPreviewSlideIn(true));
      });

      // Auto-dismiss preview after 8 seconds
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
      autoDismissRef.current = setTimeout(() => {
        handleDismissPreview();
      }, 8000);
    }
    prevRecordingRef.current = isRecording;

    return () => {
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
    };
  }, [isRecording, lastRecordingUrl]);

  const handleDismissPreview = useCallback(() => {
    setPreviewSlideIn(false);
    setTimeout(() => {
      setShowPreview(false);
      onDismiss();
    }, 300);
  }, [onDismiss]);

  const handleDownload = useCallback(() => {
    onDownload();
    handleDismissPreview();
  }, [onDownload, handleDismissPreview]);

  const handleShare = useCallback(() => {
    onShare();
  }, [onShare]);

  if (!isSupported) return null;

  return (
    <>
      <style>{`
        @keyframes rec-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes rec-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2); opacity: 0; }
        }
        @keyframes preview-slide-in {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {/* Recording indicator - top right area, below connection info */}
      {isRecording && (
        <div className="absolute top-4 right-4 z-20 pointer-events-auto">
          <button
            onClick={onToggleRecording}
            className="flex items-center gap-2.5 bg-black/70 backdrop-blur-md rounded-lg px-3 py-2 border border-red-500/40 hover:border-red-500/70 transition-colors group cursor-pointer"
            title="Stop recording (G)"
          >
            {/* Pulsing red dot with ring animation */}
            <div className="relative flex items-center justify-center w-4 h-4">
              <div
                className="absolute w-4 h-4 rounded-full bg-red-500/30"
                style={{ animation: 'rec-ring 1.5s ease-out infinite' }}
              />
              <div
                className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
                style={{ animation: 'rec-pulse 1s ease-in-out infinite' }}
              />
            </div>

            {/* REC label */}
            <span
              className="text-red-400 text-xs font-mono font-bold uppercase tracking-wider"
              style={{ animation: 'rec-pulse 1s ease-in-out infinite' }}
            >
              REC
            </span>

            {/* Duration */}
            <span className="text-white/70 text-xs font-mono tabular-nums">
              {formatDuration(recordingDuration)}
            </span>

            {/* Stop icon (visible on hover) */}
            <div className="w-3 h-3 rounded-sm bg-red-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </div>
      )}

      {/* Record button when not recording (small, unobtrusive) */}
      {!isRecording && !showPreview && (
        <div className="absolute top-4 right-4 z-20 pointer-events-auto flex items-center gap-2">
          {/* Auto-record toggle */}
          <button
            onClick={onToggleAutoRecord}
            className={`bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-2 border transition-colors text-xs font-mono ${
              autoRecordEnabled
                ? 'border-red-500/40 text-red-400 hover:border-red-500/60'
                : 'border-white/10 text-white/30 hover:text-white/60 hover:border-white/20'
            }`}
            title={autoRecordEnabled ? 'Auto-record: ON' : 'Auto-record: OFF'}
          >
            AUTO
          </button>

          {/* Manual record button */}
          <button
            onClick={onToggleRecording}
            className="bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-2 border border-white/10 hover:border-red-500/40 text-white/40 hover:text-red-400 transition-colors flex items-center gap-1.5"
            title="Start recording (G)"
          >
            <div className="w-2.5 h-2.5 rounded-full border-2 border-current" />
            <span className="text-xs font-mono">REC</span>
          </button>
        </div>
      )}

      {/* Recording preview card - appears after stopping */}
      {showPreview && lastRecordingUrl && (
        <div
          className="absolute top-4 right-4 z-40 pointer-events-auto"
          style={{
            transform: previewSlideIn ? 'translateY(0)' : 'translateY(20px)',
            opacity: previewSlideIn ? 1 : 0,
            transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out',
          }}
        >
          <div className="bg-black/85 backdrop-blur-md rounded-xl border border-white/15 overflow-hidden shadow-2xl" style={{ width: '240px' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                <span className="text-green-400 text-xs font-bold font-mono uppercase tracking-wider">
                  Recording Saved
                </span>
              </div>
              <button
                onClick={handleDismissPreview}
                className="text-white/40 hover:text-white/80 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Video preview */}
            <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
              <video
                src={lastRecordingUrl}
                muted
                playsInline
                className="w-full h-full object-cover"
                onLoadedData={(e) => {
                  e.currentTarget.currentTime = 0;
                }}
              />
              {/* Play icon overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-black/50 rounded-full p-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white" className="opacity-70">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
              </div>
              {/* Duration badge */}
              <div className="absolute bottom-1 right-1 bg-black/70 rounded px-1.5 py-0.5 text-white/70 text-[10px] font-mono">
                {formatDuration(recordingDuration)}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 p-2">
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 text-white text-xs font-mono transition-colors border border-white/10"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Save
              </button>
              <button
                onClick={handleShare}
                className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 rounded-lg px-3 py-1.5 text-green-400 text-xs font-mono transition-colors border border-green-500/20"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                Share
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Format seconds as MM:SS */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
