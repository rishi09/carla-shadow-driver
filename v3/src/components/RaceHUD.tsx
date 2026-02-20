import { useState, useEffect, useRef } from 'react';
import type { RaceState } from '../types/index.ts';
import { RaceProgressBar } from './RaceProgressBar.tsx';
import { ArcSpeedometer } from './ArcSpeedometer.tsx';

interface RaceHUDProps {
  raceState: RaceState | null;
  latencyMs?: number | null;
  className?: string;
}

export function RaceHUD({ raceState, latencyMs, className = '' }: RaceHUDProps) {
  // Track HUD visibility for fade-in on GO
  const [hudVisible, setHudVisible] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  useEffect(() => {
    const status = raceState?.race_status ?? null;
    // When transitioning from countdown to racing, fade in HUD
    if (status === 'racing' && prevStatusRef.current === 'countdown') {
      // Stagger the fade-in slightly
      const timer = setTimeout(() => setHudVisible(true), 100);
      return () => clearTimeout(timer);
    }
    // If already racing (e.g., reconnect), show immediately
    if (status === 'racing' && prevStatusRef.current !== 'countdown') {
      setHudVisible(true);
    }
    // Hide during countdown
    if (status === 'countdown') {
      setHudVisible(false);
    }
    prevStatusRef.current = status;
  }, [raceState?.race_status]);

  if (!raceState) return null;

  const { player, ai, model, race_status, fps, countdown } = raceState;
  const totalDriftScore = raceState.total_drift_score ?? 0;

  // During countdown, hide most HUD elements for a cinematic look
  const isCountdown = race_status === 'countdown';
  // HUD elements transition class: hidden during countdown, staggered fade-in on GO
  const hudOpacityClass = isCountdown
    ? 'opacity-0'
    : hudVisible
      ? 'opacity-100'
      : 'opacity-0';

  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {/* Cinematic countdown overlay */}
      {race_status === 'countdown' && countdown !== null && countdown !== undefined && (
        <CountdownOverlay countdown={countdown} />
      )}

      {/* Top bar: position + lap -- hidden during countdown, fades in on GO */}
      <div
        className={`absolute top-4 left-0 right-0 flex justify-center gap-8 z-10 transition-opacity duration-500 ease-out ${hudOpacityClass}`}
        style={{ transitionDelay: hudVisible ? '0ms' : '0ms' }}
      >
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

      {/* Race progress bar - shown during racing only, with fade-in */}
      {race_status === 'racing' && (
        <div
          className={`absolute top-[72px] left-1/2 -translate-x-1/2 z-10 w-[480px] max-w-[90vw] transition-opacity duration-500 ease-out ${hudOpacityClass}`}
          style={{ transitionDelay: hudVisible ? '100ms' : '0ms' }}
        >
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

      {/* Next checkpoint indicator -- hidden during countdown */}
      {race_status === 'racing' && player.next_checkpoint_x != null && player.x != null && (
        <div
          className={`transition-opacity duration-500 ease-out ${hudOpacityClass}`}
          style={{ transitionDelay: hudVisible ? '150ms' : '0ms' }}
        >
          <CheckpointArrow
            playerX={player.x}
            playerY={player.y ?? 0}
            playerYaw={player.yaw}
            targetX={player.next_checkpoint_x}
            targetY={player.next_checkpoint_y ?? 0}
            checkpoint={player.checkpoint}
            totalCheckpoints={player.total_checkpoints ?? raceState.checkpoints?.length ?? 10}
          />
        </div>
      )}

      {/* Bottom left: arc speedometer + gear + inputs -- hidden during countdown */}
      <div
        className={`absolute bottom-4 left-4 z-10 transition-opacity duration-500 ease-out ${hudOpacityClass}`}
        style={{ transitionDelay: hudVisible ? '200ms' : '0ms' }}
      >
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-3 border border-white/10 flex flex-col items-center">
          <ArcSpeedometer speedKmh={player.speed_kmh} />
          {player.gear !== undefined && (
            <div className="text-white/40 text-xs font-mono -mt-1">
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

      {/* Total drift score counter -- bottom left, only shows when > 0 */}
      {totalDriftScore > 0 && (
        <div
          className={`absolute bottom-14 left-4 z-10 transition-opacity duration-500 ease-out ${hudOpacityClass}`}
          style={{ transitionDelay: hudVisible ? '400ms' : '0ms' }}
        >
          <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-purple-500/30">
            <div className="text-purple-400/70 text-[10px] font-mono uppercase tracking-wider">Drift Score</div>
            <div className="text-purple-300 text-lg font-bold font-mono tabular-nums">
              {totalDriftScore.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Bottom center: lap timer -- hidden during countdown */}
      <div
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-10 transition-opacity duration-500 ease-out ${hudOpacityClass}`}
        style={{ transitionDelay: hudVisible ? '300ms' : '0ms' }}
      >
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

      {/* Bottom right: FPS + latency + connection quality + controls hint -- hidden during countdown */}
      <div
        className={`absolute bottom-4 right-4 z-10 transition-opacity duration-500 ease-out ${hudOpacityClass}`}
        style={{ transitionDelay: hudVisible ? '350ms' : '0ms' }}
      >
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

/** Enhanced cinematic 3-2-1-GO countdown with slam animations and screen effects */
function CountdownOverlay({ countdown }: { countdown: number }) {
  const [animPhase, setAnimPhase] = useState(0);
  const prevCountdownRef = useRef(countdown);

  useEffect(() => {
    // Reset animation on each new countdown value
    setAnimPhase(0);
    const timer = setTimeout(() => setAnimPhase(1), 30);
    prevCountdownRef.current = countdown;
    return () => clearTimeout(timer);
  }, [countdown]);

  const isGo = countdown === 0;
  const color = isGo ? '#4CAF50' : countdown === 1 ? '#FF9800' : '#f44336';
  const text = isGo ? 'GO!' : String(countdown);

  return (
    <div className="absolute inset-0 flex items-center justify-center z-30">
      {/* Keyframe animations */}
      <style>{`
        @keyframes countdown-slam {
          0% {
            transform: scale(2.5);
            opacity: 0;
          }
          30% {
            transform: scale(0.9);
            opacity: 1;
          }
          50% {
            transform: scale(1.05);
          }
          100% {
            transform: scale(1.0);
            opacity: 1;
          }
        }
        @keyframes go-explode {
          0% {
            transform: scale(0.8);
            opacity: 0;
          }
          20% {
            transform: scale(1.0);
            opacity: 1;
          }
          60% {
            transform: scale(1.3);
            opacity: 1;
          }
          100% {
            transform: scale(2.0);
            opacity: 0;
          }
        }
        @keyframes go-text {
          0% {
            transform: scale(0.5);
            opacity: 0;
          }
          30% {
            transform: scale(1.1);
            opacity: 1;
          }
          50% {
            transform: scale(1.0);
          }
          100% {
            transform: scale(1.0);
            opacity: 1;
          }
        }
        @keyframes flash-burst {
          0% {
            opacity: 0;
            transform: scale(0.5);
          }
          20% {
            opacity: 0.6;
            transform: scale(1.0);
          }
          100% {
            opacity: 0;
            transform: scale(1.5);
          }
        }
        @keyframes go-flash {
          0% {
            opacity: 0;
            transform: scale(0.3);
          }
          15% {
            opacity: 0.8;
            transform: scale(1.2);
          }
          100% {
            opacity: 0;
            transform: scale(2.5);
          }
        }
        @keyframes go-shake {
          0% { transform: translate(0, 0); }
          10% { transform: translate(-3px, 2px); }
          20% { transform: translate(3px, -2px); }
          30% { transform: translate(-2px, -1px); }
          40% { transform: translate(2px, 1px); }
          50% { transform: translate(-1px, 2px); }
          60% { transform: translate(1px, -1px); }
          70% { transform: translate(-2px, 0px); }
          80% { transform: translate(1px, 1px); }
          90% { transform: translate(-1px, -1px); }
          100% { transform: translate(0, 0); }
        }
        @keyframes traffic-light-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.3); }
          100% { transform: scale(1); }
        }
      `}</style>

      {/* Dim background during countdown -- slightly darker */}
      <div className="absolute inset-0 bg-black/40" />

      {/* GO shake wrapper */}
      <div
        className="relative flex flex-col items-center gap-4"
        style={isGo && animPhase === 1 ? { animation: 'go-shake 0.4s ease-out' } : undefined}
      >
        {/* Traffic light dots - larger and more prominent */}
        <div className="flex gap-4 mb-6">
          <div
            className={`w-7 h-7 rounded-full transition-all duration-300 ${countdown <= 3 ? 'bg-red-500 shadow-[0_0_20px_rgba(244,67,54,0.9)]' : 'bg-white/10'}`}
            style={countdown === 3 && animPhase === 1 ? { animation: 'traffic-light-pulse 0.4s ease-out' } : undefined}
          />
          <div
            className={`w-7 h-7 rounded-full transition-all duration-300 ${countdown <= 2 && countdown > 0 ? 'bg-amber-500 shadow-[0_0_20px_rgba(255,152,0,0.9)]' : 'bg-white/10'}`}
            style={countdown === 2 && animPhase === 1 ? { animation: 'traffic-light-pulse 0.4s ease-out' } : undefined}
          />
          <div
            className={`w-7 h-7 rounded-full transition-all duration-300 ${countdown <= 1 && countdown > 0 ? 'bg-amber-500 shadow-[0_0_20px_rgba(255,152,0,0.9)]' : isGo ? 'bg-green-500 shadow-[0_0_25px_rgba(76,175,80,0.9)]' : 'bg-white/10'}`}
            style={isGo && animPhase === 1 ? { animation: 'traffic-light-pulse 0.4s ease-out' } : undefined}
          />
        </div>

        {/* Radial gradient flash behind number */}
        {animPhase === 1 && !isGo && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${color}30 0%, ${color}10 40%, transparent 70%)`,
              animation: 'flash-burst 0.7s ease-out forwards',
            }}
          />
        )}

        {/* Bright flash on GO */}
        {isGo && animPhase === 1 && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(circle, rgba(76,175,80,0.5) 0%, rgba(76,175,80,0.2) 30%, transparent 60%)',
              animation: 'go-flash 0.6s ease-out forwards',
            }}
          />
        )}

        {/* Number / GO text */}
        {isGo ? (
          <div
            className="font-black leading-none select-none"
            style={{
              fontSize: 'clamp(8rem, 20vw, 14rem)',
              color,
              textShadow: `0 0 60px ${color}AA, 0 0 120px ${color}60, 0 4px 8px rgba(0,0,0,0.5)`,
              animation: animPhase === 1 ? 'go-text 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none',
              opacity: animPhase === 0 ? 0 : 1,
              letterSpacing: '0.05em',
            }}
          >
            {text}
          </div>
        ) : (
          <div
            className="font-black leading-none select-none"
            style={{
              fontSize: 'clamp(10rem, 25vw, 16rem)',
              color,
              textShadow: `0 0 60px ${color}AA, 0 0 120px ${color}60, 0 4px 8px rgba(0,0,0,0.5)`,
              animation: animPhase === 1 ? 'countdown-slam 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none',
              opacity: animPhase === 0 ? 0 : 1,
            }}
          >
            {text}
          </div>
        )}

        {/* "Rev your engine!" hint during countdown (not on GO) */}
        {!isGo && (
          <div className="mt-4 text-white/40 text-sm font-mono uppercase tracking-widest animate-pulse">
            Hold W to rev
          </div>
        )}
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
  checkpoint?: number; totalCheckpoints?: number;
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

  // Turn direction hint based on relative angle
  let hint: string;
  let hintColor: string;
  if (Math.abs(relativeAngle) < 20) {
    hint = 'STRAIGHT';
    hintColor = 'text-green-400';
  } else if (Math.abs(relativeAngle) < 60) {
    hint = relativeAngle > 0 ? 'SLIGHT RIGHT' : 'SLIGHT LEFT';
    hintColor = 'text-accent';
  } else if (Math.abs(relativeAngle) < 120) {
    hint = relativeAngle > 0 ? 'TURN RIGHT' : 'TURN LEFT';
    hintColor = 'text-amber-400';
  } else {
    hint = relativeAngle > 0 ? 'HARD RIGHT' : 'HARD LEFT';
    hintColor = 'text-red-400';
  }

  // Color: green when close, accent when far
  const isClose = dist < 30;

  // Format distance
  const distText = dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`;

  // Checkpoint counter
  const cpNum = (checkpoint ?? 0) + 1; // checkpoint is 0-indexed, display 1-indexed
  const cpTotal = totalCheckpoints ?? 10;

  return (
    <div className="absolute top-[108px] left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1">
      {/* Checkpoint counter */}
      <div className="bg-black/60 backdrop-blur-sm rounded-md px-2.5 py-0.5 border border-white/15 mb-0.5">
        <span className="text-cyan-400 text-xs font-mono font-bold">CP {cpNum}/{cpTotal}</span>
      </div>

      {/* Rotating compass arrow - larger and more prominent */}
      <div className={`rounded-full w-20 h-20 flex items-center justify-center ${isClose ? 'bg-green-500/30 border-2 border-green-400 shadow-[0_0_20px_rgba(34,197,94,0.5)]' : 'bg-black/70 border-2 border-cyan-500/50 shadow-[0_0_15px_rgba(0,210,255,0.3)]'}`}>
        <svg width="48" height="48" viewBox="0 0 32 32"
          className={isClose ? 'text-green-400' : 'text-cyan-400'}
          style={{ transform: `rotate(${relativeAngle}deg)`, transition: 'transform 0.15s ease-out', filter: `drop-shadow(0 0 6px currentColor)` }}>
          <path d="M16 2L24 16H19V28H13V16H8L16 2Z" fill="currentColor" />
        </svg>
      </div>

      {/* Distance */}
      <div className={`text-sm font-mono font-bold px-2.5 py-0.5 rounded ${isClose ? 'text-green-400 bg-green-500/20' : 'text-white bg-black/50'}`}>
        {isClose ? 'CHECKPOINT!' : distText}
      </div>

      {/* Turn direction hint */}
      {!isClose && (
        <div className={`${hintColor} text-xs font-mono font-bold px-2 py-0.5 rounded bg-black/40`}>
          {hint}
        </div>
      )}
    </div>
  );
}
