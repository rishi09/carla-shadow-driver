import { useState, useEffect } from 'react';
import type { RaceState } from '../types/index.ts';
import { RaceProgressBar } from './RaceProgressBar.tsx';
import { useInterpolatedState } from '../hooks/useInterpolatedState.ts';

interface RaceHUDProps {
  raceState: RaceState | null;
  latencyMs?: number | null;
  className?: string;
}

export function RaceHUD({ raceState, latencyMs, className = '' }: RaceHUDProps) {
  if (!raceState) return null;

  const { player, ai, model, race_status, fps, countdown } = raceState;

  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {/* Cinematic countdown overlay */}
      {race_status === 'countdown' && countdown !== null && countdown !== undefined && (
        <CountdownOverlay countdown={countdown} />
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

        {/* Gap timer */}
        {race_status === 'racing' && player.gap_seconds != null && (
          <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/20 flex items-center">
            <GapTimer gap={player.gap_seconds} />
          </div>
        )}

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

      {/* Race progress bar - shown during racing only */}
      {race_status === 'racing' && (
        <div className="absolute top-[72px] left-1/2 -translate-x-1/2 z-10 w-[480px] max-w-[90vw]">
          <RaceProgressBar
            playerLap={player.lap}
            playerCheckpoint={player.checkpoint}
            aiLap={ai.lap}
            aiCheckpoint={ai.checkpoint}
            totalLaps={player.total_laps}
            totalCheckpoints={player.total_checkpoints ?? raceState.checkpoints?.length ?? 10}
          />
        </div>
      )}

      {/* Next checkpoint indicator */}
      {race_status === 'racing' && player.next_checkpoint_x != null && player.x != null && (
        <CheckpointArrow
          playerX={player.x}
          playerY={player.y ?? 0}
          playerYaw={player.yaw}
          targetX={player.next_checkpoint_x}
          targetY={player.next_checkpoint_y ?? 0}
          checkpoint={player.checkpoint}
          totalCheckpoints={player.total_checkpoints ?? raceState.checkpoints?.length ?? 10}
        />
      )}

      {/* Bottom left: speedometer + gear */}
      <div className="absolute bottom-4 left-4 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-3 border border-white/10">
          <div className="text-white/50 text-xs font-mono uppercase">Speed</div>
          <Speedometer speedKmh={player.speed_kmh} />
          {player.gear !== undefined && (
            <div className="text-white/40 text-xs font-mono mt-1">
              Gear {player.gear}
            </div>
          )}
          {/* Input visualization bars */}
          {player.throttle !== undefined && (
            <div className="mt-2 space-y-1">
              <InputBar label="THR" value={player.throttle} color="#4CAF50" />
              <InputBar label="BRK" value={player.brake ?? 0} color="#f44336" />
              <InputBar label="STR" value={(player.steer ?? 0) * 0.5 + 0.5} color="#2196F3" centered />
            </div>
          )}
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

      {/* Bottom right: FPS + latency + connection quality + controls hint */}
      <div className="absolute bottom-4 right-4 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
          <div className="text-white/30 text-xs font-mono">{fps} FPS</div>
          {latencyMs != null && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <ConnectionDot latencyMs={latencyMs} />
              <span className={`text-xs font-mono ${latencyMs < 80 ? 'text-player/50' : latencyMs <= 150 ? 'text-accent/50' : 'text-warning/50'}`}>
                {latencyMs}ms
              </span>
            </div>
          )}
          <div className="text-white/20 text-xs font-mono mt-1">WASD + Space | R=Reset | C=Camera</div>
        </div>
      </div>
    </div>
  );
}

/** Cinematic 3-2-1-GO countdown with traffic light colors */
function CountdownOverlay({ countdown }: { countdown: number }) {
  const [animPhase, setAnimPhase] = useState(0);

  useEffect(() => {
    setAnimPhase(0);
    const timer = setTimeout(() => setAnimPhase(1), 50);
    return () => clearTimeout(timer);
  }, [countdown]);

  const isGo = countdown === 0;
  const color = isGo ? '#4CAF50' : countdown === 1 ? '#FF9800' : '#f44336';
  const text = isGo ? 'GO!' : String(countdown);
  const scale = animPhase === 0 ? 'scale-150 opacity-0' : 'scale-100 opacity-100';

  return (
    <div className="absolute inset-0 flex items-center justify-center z-30">
      {/* Dim background during countdown */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Traffic light dots */}
      <div className="relative flex flex-col items-center gap-4">
        <div className="flex gap-3 mb-4">
          <div className={`w-5 h-5 rounded-full transition-all duration-300 ${countdown <= 3 ? 'bg-red-500 shadow-[0_0_15px_rgba(244,67,54,0.8)]' : 'bg-white/10'}`} />
          <div className={`w-5 h-5 rounded-full transition-all duration-300 ${countdown <= 2 && countdown > 0 ? 'bg-amber-500 shadow-[0_0_15px_rgba(255,152,0,0.8)]' : 'bg-white/10'}`} />
          <div className={`w-5 h-5 rounded-full transition-all duration-300 ${isGo ? 'bg-green-500 shadow-[0_0_15px_rgba(76,175,80,0.8)]' : 'bg-white/10'}`} />
        </div>

        {/* Number / GO */}
        <div
          className={`text-9xl font-bold transition-all duration-300 ease-out ${scale}`}
          style={{
            color,
            textShadow: `0 0 40px ${color}80, 0 0 80px ${color}40`,
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

/** Gap timer: shows +/- seconds vs opponent */
function GapTimer({ gap }: { gap: number }) {
  const isAhead = gap > 0;
  const absGap = Math.abs(gap);
  const color = isAhead ? 'text-player' : 'text-warning';
  const sign = isAhead ? '+' : '-';

  return (
    <div className={`${color} font-mono font-bold text-lg`}>
      {sign}{absGap.toFixed(1)}s
    </div>
  );
}

/** Thin horizontal bar for throttle/brake/steer visualization */
function InputBar({ label, value, color, centered }: { label: string; value: number; color: string; centered?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white/30 text-[10px] font-mono w-6">{label}</span>
      <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden relative">
        {centered ? (
          <div
            className="absolute top-0 h-full rounded-full"
            style={{
              backgroundColor: color,
              left: pct < 50 ? `${pct}%` : '50%',
              width: `${Math.abs(pct - 50)}%`,
              opacity: 0.7,
            }}
          />
        ) : (
          <div
            className="h-full rounded-full"
            style={{ backgroundColor: color, width: `${pct}%`, opacity: 0.7 }}
          />
        )}
      </div>
    </div>
  );
}

/** Speedometer with 60fps interpolation for smooth display */
function Speedometer({ speedKmh }: { speedKmh: number }) {
  const smoothSpeed = useInterpolatedState(speedKmh);
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-white text-3xl font-bold font-mono">
        {Math.round(smoothSpeed)}
      </span>
      <span className="text-white/50 text-sm font-mono">km/h</span>
    </div>
  );
}

/** Pulsing connection quality dot: green < 80ms, yellow 80-150ms, red > 150ms */
function ConnectionDot({ latencyMs }: { latencyMs: number }) {
  const color = latencyMs < 80 ? 'bg-green-500' : latencyMs <= 150 ? 'bg-yellow-500' : 'bg-red-500';
  const shadow = latencyMs < 80
    ? 'shadow-[0_0_6px_rgba(34,197,94,0.8)]'
    : latencyMs <= 150
      ? 'shadow-[0_0_6px_rgba(234,179,8,0.8)]'
      : 'shadow-[0_0_6px_rgba(239,68,68,0.8)]';

  return (
    <span className={`inline-block w-2 h-2 rounded-full animate-pulse ${color} ${shadow}`} />
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

/** Large directional arrow pointing toward the next checkpoint */
function CheckpointArrow({ playerX, playerY, playerYaw, targetX, targetY, checkpoint, totalCheckpoints }: {
  playerX: number; playerY: number; playerYaw?: number; targetX: number; targetY: number;
  checkpoint: number; totalCheckpoints: number;
}) {
  const dx = targetX - playerX;
  const dy = targetY - playerY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Calculate relative angle from player heading to checkpoint
  const angleToTarget = Math.atan2(dy, dx) * (180 / Math.PI);
  const yaw = playerYaw ?? 0;
  let relativeAngle = angleToTarget - yaw;
  while (relativeAngle > 180) relativeAngle -= 360;
  while (relativeAngle < -180) relativeAngle += 360;

  let direction: string;
  let arrowRotation: number;
  if (Math.abs(relativeAngle) < 25) {
    direction = 'STRAIGHT';
    arrowRotation = 0;
  } else if (Math.abs(relativeAngle) > 155) {
    direction = 'U-TURN';
    arrowRotation = 180;
  } else if (relativeAngle > 0) {
    direction = relativeAngle > 70 ? 'HARD RIGHT' : 'RIGHT';
    arrowRotation = relativeAngle > 70 ? 90 : 45;
  } else {
    direction = relativeAngle < -70 ? 'HARD LEFT' : 'LEFT';
    arrowRotation = relativeAngle < -70 ? -90 : -45;
  }

  return (
    <div className="absolute top-[110px] left-1/2 -translate-x-1/2 z-10">
      <div className="bg-black/70 backdrop-blur-sm rounded-xl px-5 py-3 border border-accent/40 flex items-center gap-4">
        <svg width="36" height="36" viewBox="0 0 36 36" className="text-accent flex-shrink-0"
          style={{ transform: `rotate(${arrowRotation}deg)`, transition: 'transform 0.3s ease' }}>
          <path d="M18 4L26 16H22V30H14V16H10L18 4Z" fill="currentColor" />
        </svg>
        <div>
          <div className="text-accent text-lg font-bold font-mono">
            {direction}
          </div>
          <div className="text-white/60 text-xs font-mono">
            CP {checkpoint + 1}/{totalCheckpoints} — {Math.round(dist)}m
          </div>
        </div>
      </div>
    </div>
  );
}
