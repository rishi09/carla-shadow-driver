import type { RaceState } from '../types/index.ts';

interface RaceHUDProps {
  raceState: RaceState | null;
  className?: string;
}

export function RaceHUD({ raceState, className = '' }: RaceHUDProps) {
  if (!raceState) return null;

  const { player, ai, model, race_status, fps, countdown } = raceState;

  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {/* Countdown overlay */}
      {race_status === 'countdown' && countdown !== null && countdown !== undefined && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="text-9xl font-bold text-white drop-shadow-[0_0_30px_rgba(255,215,0,0.8)] animate-pulse">
            {countdown === 0 ? 'GO!' : countdown}
          </div>
        </div>
      )}

      {/* Top bar: position + lap */}
      <div className="absolute top-4 left-0 right-0 flex justify-center gap-8 z-10">
        {/* Player info */}
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2 border border-player/40">
          <div className="text-player text-xs font-mono uppercase tracking-wider">You</div>
          <div className="flex items-baseline gap-3">
            <span className="text-white text-2xl font-bold font-mono">
              P{player.position}
            </span>
            <span className="text-white/70 text-sm font-mono">
              Lap {Math.min(player.lap, player.total_laps)}/{player.total_laps}
            </span>
          </div>
        </div>

        {/* AI info */}
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2 border border-ai/40">
          <div className="text-ai text-xs font-mono uppercase tracking-wider">AI ({model})</div>
          <div className="flex items-baseline gap-3">
            <span className="text-white text-2xl font-bold font-mono">
              P{ai.position}
            </span>
            <span className="text-white/70 text-sm font-mono">
              Lap {Math.min(ai.lap, ai.total_laps)}/{ai.total_laps}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom left: speedometer */}
      <div className="absolute bottom-4 left-4 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-3 border border-white/10">
          <div className="text-white/50 text-xs font-mono uppercase">Speed</div>
          <div className="flex items-baseline gap-1">
            <span className="text-white text-3xl font-bold font-mono">
              {Math.round(player.speed_kmh)}
            </span>
            <span className="text-white/50 text-sm font-mono">km/h</span>
          </div>
        </div>
      </div>

      {/* Bottom center: lap timer */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-6 py-3 border border-white/10">
          <div className="flex gap-6">
            <div>
              <div className="text-white/50 text-xs font-mono uppercase">Current</div>
              <div className="text-white text-xl font-bold font-mono">
                {formatTime(player.lap_time)}
              </div>
            </div>
            <div className="border-l border-white/10" />
            <div>
              <div className="text-accent text-xs font-mono uppercase">Best</div>
              <div className="text-accent text-xl font-bold font-mono">
                {player.best_lap ? formatTime(player.best_lap) : '--:--.--'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom right: FPS + controls hint */}
      <div className="absolute bottom-4 right-4 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
          <div className="text-white/30 text-xs font-mono">{fps} FPS</div>
          <div className="text-white/20 text-xs font-mono mt-1">WASD to drive</div>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}
