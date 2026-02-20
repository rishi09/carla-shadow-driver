/**
 * FirstTimeOverlay - Full-screen controls overlay shown to first-time players.
 * Displays all control keys with large visual key icons.
 * Dismissed by pressing any key.
 */

import { useEffect } from 'react';

interface FirstTimeOverlayProps {
  visible: boolean;
  onDismiss: () => void;
}

export function FirstTimeOverlay({ visible, onDismiss }: FirstTimeOverlayProps) {
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = () => {
      onDismiss();
    };

    // Small delay so the key that triggered countdown end doesn't immediately dismiss
    const timer = setTimeout(() => {
      window.addEventListener('keydown', handleKeyDown);
    }, 200);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/75 backdrop-blur-sm">
      <style>{`
        @keyframes firsttime-fade-in {
          0%   { opacity: 0; transform: scale(0.95); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes firsttime-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
      <div
        className="bg-dark-300/95 rounded-2xl border border-white/15 p-8 max-w-md w-full mx-4 shadow-2xl"
        style={{ animation: 'firsttime-fade-in 0.3s ease-out forwards' }}
      >
        <h2 className="text-white text-2xl font-black text-center mb-6 tracking-tight">Controls</h2>

        {/* WASD cluster */}
        <div className="flex justify-center mb-6">
          <div className="flex flex-col items-center gap-2">
            <BigKey label="W" subtext="Gas" />
            <div className="flex gap-2">
              <BigKey label="A" subtext="Left" />
              <BigKey label="S" subtext="Brake" />
              <BigKey label="D" subtext="Right" />
            </div>
          </div>
        </div>

        {/* Other controls */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <ControlRow keyLabel="Space" description="Handbrake" />
          <ControlRow keyLabel="R" description="Respawn" />
          <ControlRow keyLabel="C" description="Camera" />
          <ControlRow keyLabel="Bksp" description="Restart Race" />
          <ControlRow keyLabel="F" description="Fullscreen" />
          <ControlRow keyLabel="P" description="Photo Mode" />
        </div>

        {/* Dismiss hint */}
        <div
          className="text-center text-white/40 text-sm font-mono"
          style={{ animation: 'firsttime-pulse 2s ease-in-out infinite' }}
        >
          Press any key to start racing
        </div>
      </div>
    </div>
  );
}

function BigKey({ label, subtext }: { label: string; subtext: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-14 h-14 bg-white/10 border-2 border-white/30 rounded-lg flex items-center justify-center text-white font-black font-mono text-xl shadow-[0_3px_0_rgba(255,255,255,0.15)]">
        {label}
      </div>
      <span className="text-white/50 text-xs font-mono mt-1">{subtext}</span>
    </div>
  );
}

function ControlRow({ keyLabel, description }: { keyLabel: string; description: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="bg-white/10 border border-white/20 rounded-md px-3 py-1.5 text-white/80 text-sm font-mono font-bold min-w-[52px] text-center shadow-[0_2px_0_rgba(255,255,255,0.1)]">
        {keyLabel}
      </span>
      <span className="text-white/50 text-sm">{description}</span>
    </div>
  );
}
