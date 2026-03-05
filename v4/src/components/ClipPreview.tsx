/**
 * ClipPreview.tsx - Overlay that appears when a replay clip is saved.
 *
 * Shows a video preview thumbnail with Save and Share buttons.
 * Auto-dismisses after 5 seconds. Slides in from the bottom-right.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

interface ClipPreviewProps {
  clipUrl: string | null;
  onDismiss: () => void;
  onDownload: () => void;
}

export function ClipPreview({ clipUrl, onDismiss, onDownload }: ClipPreviewProps) {
  const [visible, setVisible] = useState(false);
  const [slideIn, setSlideIn] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animate in when clipUrl changes
  useEffect(() => {
    if (clipUrl) {
      setVisible(true);
      // Trigger slide-in on next frame for CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setSlideIn(true));
      });

      // Auto-dismiss after 5 seconds
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        handleDismiss();
      }, 5000);
    } else {
      setVisible(false);
      setSlideIn(false);
    }

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [clipUrl]);

  const handleDismiss = useCallback(() => {
    setSlideIn(false);
    // Wait for slide-out animation before hiding
    setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, 300);
  }, [onDismiss]);

  const handleShare = useCallback(async () => {
    if (!clipUrl) return;

    try {
      const response = await fetch(clipUrl);
      const blob = await response.blob();
      const file = new File([blob], `shadow-driver-clip-${Date.now()}.webm`, { type: 'video/webm' });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: 'Shadow Driver Replay',
          text: 'Check out this racing moment!',
          files: [file],
        });
      } else {
        // Fallback: copy URL or trigger download
        onDownload();
      }
    } catch {
      // User cancelled or share failed
      onDownload();
    }
  }, [clipUrl, onDownload]);

  const handleSave = useCallback(() => {
    onDownload();
    handleDismiss();
  }, [onDownload, handleDismiss]);

  if (!visible || !clipUrl) return null;

  return (
    <div
      className="absolute bottom-20 right-4 z-40 pointer-events-auto"
      style={{
        transform: slideIn ? 'translateX(0)' : 'translateX(120%)',
        opacity: slideIn ? 1 : 0,
        transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes clip-saved-pulse {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5); }
          70% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
      `}</style>

      <div
        className="bg-black/80 backdrop-blur-md rounded-xl border border-white/15 overflow-hidden shadow-2xl"
        style={{ animation: 'clip-saved-pulse 1s ease-out', width: '220px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            {/* Film icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
              <line x1="7" y1="2" x2="7" y2="22" />
              <line x1="17" y1="2" x2="17" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="2" y1="7" x2="7" y2="7" />
              <line x1="2" y1="17" x2="7" y2="17" />
              <line x1="17" y1="17" x2="22" y2="17" />
              <line x1="17" y1="7" x2="22" y2="7" />
            </svg>
            <span className="text-green-400 text-xs font-bold font-mono uppercase tracking-wider">
              Clip Saved!
            </span>
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/40 hover:text-white/80 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Video preview thumbnail */}
        <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
          <video
            src={clipUrl}
            muted
            playsInline
            className="w-full h-full object-cover"
            onLoadedData={(e) => {
              // Show first frame
              const video = e.currentTarget;
              video.currentTime = 0;
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
            15s
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 p-2">
          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 text-white text-xs font-mono transition-colors border border-white/10"
          >
            {/* Download icon */}
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
            {/* Share icon */}
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
  );
}
