/**
 * ControlsHint - Brief overlay showing controls when race starts after countdown.
 * Fades in, stays for a moment, then fades out.
 */

interface ControlsHintProps {
  visible: boolean;
}

export function ControlsHint({ visible }: ControlsHintProps) {
  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 flex items-end justify-center pb-28 z-20 pointer-events-none"
      style={{ animation: 'controls-hint 4s ease-out forwards' }}
    >
      <style>{`
        @keyframes controls-hint {
          0%   { opacity: 0; transform: translateY(10px); }
          10%  { opacity: 1; transform: translateY(0); }
          70%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-10px); }
        }
      `}</style>
      <div className="bg-black/70 backdrop-blur-sm rounded-xl px-6 py-4 border border-accent/30">
        <div className="flex items-center gap-6">
          {/* WASD keys visual */}
          <div className="flex flex-col items-center gap-1">
            <Key label="W" subtext="Gas" />
            <div className="flex gap-1">
              <Key label="A" subtext="Left" />
              <Key label="S" subtext="Brake" />
              <Key label="D" subtext="Right" />
            </div>
          </div>
          {/* Divider */}
          <div className="w-px h-12 bg-white/20" />
          {/* Extra controls */}
          <div className="flex flex-col gap-1.5 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="bg-white/10 border border-white/20 rounded px-2 py-0.5 text-white/80 text-[11px]">Space</span>
              <span className="text-white/50">Handbrake</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-white/10 border border-white/20 rounded px-2 py-0.5 text-white/80 text-[11px]">R</span>
              <span className="text-white/50">Respawn</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-white/10 border border-white/20 rounded px-2 py-0.5 text-white/80 text-[11px]">C</span>
              <span className="text-white/50">Camera</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Key({ label, subtext }: { label: string; subtext: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-9 h-9 bg-white/10 border border-white/30 rounded-md flex items-center justify-center text-white font-bold font-mono text-sm shadow-[0_2px_0_rgba(255,255,255,0.1)]">
        {label}
      </div>
      <span className="text-white/40 text-[9px] font-mono mt-0.5">{subtext}</span>
    </div>
  );
}
