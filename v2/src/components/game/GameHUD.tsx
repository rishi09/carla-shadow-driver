import { useEffect, useState, useRef } from 'react';
import type { GameMode } from '../../types/game';

/**
 * Props for the GameHUD component
 */
export interface GameHUDProps {
  speed: number;
  lapNumber: number;
  totalLaps: number;
  currentLapTime: number; // in milliseconds
  bestLapTime: number | null; // in milliseconds, null if no best yet
  position: 1 | 2 | null; // null for time trial
  checkpoints: boolean[]; // which checkpoints have been hit
  penaltyFlash: boolean;
  gameMode: GameMode;
}

/**
 * Formats time in milliseconds to mm:ss.ms format
 */
function formatTime(ms: number): string {
  if (ms < 0 || !isFinite(ms)) return '--:--.---';

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.floor(ms % 1000);

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

/**
 * Hook for smooth number animation
 */
function useAnimatedNumber(value: number, duration: number = 150): number {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const startValue = previousValue.current;
    const endValue = value;
    const startTime = performance.now();

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + (endValue - startValue) * easeProgress;

      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        previousValue.current = endValue;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  return displayValue;
}

/**
 * Speed display with animated bar gauge
 */
function SpeedGauge({ speed }: { speed: number }) {
  const animatedSpeed = useAnimatedNumber(speed);
  const maxSpeed = 200;
  const percentage = Math.min((animatedSpeed / maxSpeed) * 100, 100);

  // Color transitions based on speed
  const getSpeedColor = (pct: number): string => {
    if (pct < 40) return 'from-human to-human-light';
    if (pct < 70) return 'from-accent-dark to-accent';
    return 'from-warning-dark to-warning';
  };

  return (
    <div className="flex items-center gap-3">
      {/* Car icon */}
      <div className="text-human">
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="9" width="20" height="6" rx="2" />
          <circle cx="6" cy="16" r="2" />
          <circle cx="18" cy="16" r="2" />
          <path d="M5 9V7a2 2 0 012-2h10a2 2 0 012 2v2" />
        </svg>
      </div>

      {/* Speed value */}
      <div className="flex flex-col">
        <div className="flex items-baseline gap-1">
          <span
            className="text-3xl font-bold text-white tabular-nums"
            style={{ minWidth: '3ch' }}
            aria-label={`Speed: ${Math.round(animatedSpeed)} kilometers per hour`}
          >
            {Math.round(animatedSpeed)}
          </span>
          <span className="text-sm text-white/60 uppercase">km/h</span>
        </div>

        {/* Speed bar */}
        <div className="w-36 h-2 bg-dark-400 rounded-full overflow-hidden mt-1">
          <div
            className={`h-full bg-gradient-to-r ${getSpeedColor(percentage)} rounded-full transition-all duration-100`}
            style={{ width: `${percentage}%` }}
            role="progressbar"
            aria-valuenow={Math.round(animatedSpeed)}
            aria-valuemin={0}
            aria-valuemax={maxSpeed}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Lap counter display
 */
function LapCounter({ lapNumber, totalLaps }: { lapNumber: number; totalLaps: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Lap ${lapNumber} of ${totalLaps}`}>
      <span className="text-white/60 text-base uppercase tracking-wider">Lap</span>
      <div className="flex items-baseline">
        <span className="text-3xl font-bold text-white tabular-nums">{lapNumber}</span>
        <span className="text-xl text-white/40 mx-0.5">/</span>
        <span className="text-xl text-white/60 tabular-nums">{totalLaps}</span>
      </div>
    </div>
  );
}

/**
 * Time display component
 */
function TimeDisplay({
  label,
  time,
  variant = 'default'
}: {
  label: string;
  time: number | null;
  variant?: 'default' | 'best';
}) {
  const formattedTime = time !== null ? formatTime(time) : '--:--.---';

  return (
    <div className="flex flex-col items-center">
      <span className={`text-sm uppercase tracking-wider ${
        variant === 'best' ? 'text-accent/70' : 'text-white/50'
      }`}>
        {label === 'Current' ? 'Time' : label}
      </span>
      <span className={`text-xl font-mono font-semibold tabular-nums ${
        variant === 'best' ? 'text-accent' : 'text-white'
      }`}>
        {formattedTime}
      </span>
    </div>
  );
}

/**
 * Checkpoint progress indicator
 */
function CheckpointProgress({ checkpoints }: { checkpoints: boolean[] }) {
  const hitCount = checkpoints.filter(Boolean).length;
  const total = checkpoints.length;

  if (total === 0) {
    return (
      <div className="text-xs text-white/40">
        No checkpoints
      </div>
    );
  }

  return (
    <div
      role="progressbar"
      aria-label={`Checkpoints: ${hitCount} of ${total}`}
      aria-valuenow={hitCount}
      aria-valuemin={0}
      aria-valuemax={total}
      className="flex items-center gap-1.5"
    >
      {checkpoints.map((hit, index) => (
        <div
          key={index}
          className={`
            w-2.5 h-2.5 rounded-full transition-all duration-300
            ${hit
              ? 'bg-human scale-100 shadow-[0_0_6px_rgba(76,175,80,0.6)]'
              : 'bg-white/20 scale-90'
            }
          `}
        />
      ))}
    </div>
  );
}

/**
 * Position indicator for head-to-head mode
 */
function PositionIndicator({
  position,
  animate
}: {
  position: 1 | 2;
  animate: boolean;
}) {
  const isFirst = position === 1;
  const positionText = isFirst ? '1ST' : '2ND';

  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-lg
        transition-all duration-300
        ${animate ? 'scale-110' : 'scale-100'}
        ${isFirst
          ? 'bg-accent/20 border border-accent/30'
          : 'bg-ai/20 border border-ai/30'
        }
      `}
    >
      {/* Trophy/Medal icon */}
      <div className={isFirst ? 'text-accent' : 'text-ai'}>
        {isFirst ? (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="8" r="6" />
            <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
          </svg>
        )}
      </div>

      <span className={`text-lg font-bold ${isFirst ? 'text-accent' : 'text-ai'}`}>
        {positionText}
      </span>
    </div>
  );
}

/**
 * Penalty flash overlay
 */
function PenaltyIndicator({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 500);
      return () => clearTimeout(timer);
    }
  }, [show]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Flash overlay */}
      <div
        className="absolute inset-0 bg-warning/10 animate-[flash_0.5s_ease-out]"
        style={{
          animation: 'flash 0.5s ease-out forwards',
        }}
      />

      {/* Penalty text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="px-6 py-2 bg-warning/90 rounded-lg text-white font-bold text-xl uppercase tracking-wider animate-[penaltyPulse_0.5s_ease-out]"
          style={{
            animation: 'penaltyPulse 0.5s ease-out forwards',
          }}
        >
          PENALTY
        </div>
      </div>
    </div>
  );
}

/**
 * Props for TopHUD component
 */
export interface TopHUDProps {
  lapNumber: number;
  totalLaps: number;
  currentLapTime: number;
  bestLapTime: number | null;
}

/**
 * TopHUD - Displays lap info and times above the game canvas
 * This is a flow-layout component (not absolutely positioned)
 */
export function TopHUD({
  lapNumber,
  totalLaps,
  currentLapTime,
  bestLapTime,
}: TopHUDProps) {
  return (
    <div className="w-full py-2 px-3 pointer-events-none select-none">
      <div
        className="
          mx-auto max-w-3xl
          bg-dark-200/80 backdrop-blur-md
          border border-white/10 rounded-lg
          shadow-card
          px-6 py-3
        "
      >
        <div className="flex items-center justify-between">
          {/* Lap counter */}
          <LapCounter lapNumber={lapNumber} totalLaps={totalLaps} />

          {/* Divider */}
          <div className="h-8 w-px bg-white/10" />

          {/* Current lap time */}
          <TimeDisplay label="Current" time={currentLapTime} />

          {/* Divider */}
          <div className="h-8 w-px bg-white/10" />

          {/* Best lap time */}
          <TimeDisplay label="Best" time={bestLapTime} variant="best" />
        </div>
      </div>
    </div>
  );
}

/**
 * Props for BottomHUD component
 */
export interface BottomHUDProps {
  speed: number;
  checkpoints: boolean[];
  position: 1 | 2 | null;
  gameMode: GameMode;
}

/**
 * BottomHUD - Displays speed, checkpoints, and position below the game canvas
 * This is a flow-layout component (not absolutely positioned)
 */
export function BottomHUD({
  speed,
  checkpoints,
  position,
  gameMode,
}: BottomHUDProps) {
  const [positionAnimate, setPositionAnimate] = useState(false);
  const prevPosition = useRef(position);

  // Animate position changes
  useEffect(() => {
    if (prevPosition.current !== position && position !== null) {
      setPositionAnimate(true);
      const timer = setTimeout(() => setPositionAnimate(false), 300);
      prevPosition.current = position;
      return () => clearTimeout(timer);
    }
  }, [position]);

  const isHeadToHead = gameMode === 'head-to-head';

  return (
    <div className="w-full py-2 px-3 pointer-events-none select-none">
      <div
        className="
          mx-auto max-w-3xl
          bg-dark-200/80 backdrop-blur-md
          border border-white/10 rounded-lg
          shadow-card
          px-6 py-3
        "
      >
        <div className="flex items-center justify-between">
          {/* Speed gauge */}
          <SpeedGauge speed={speed} />

          {/* Checkpoint progress */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm text-white/50 uppercase tracking-wider">
              Checkpoints
            </span>
            <CheckpointProgress checkpoints={checkpoints} />
          </div>

          {/* Position (head-to-head) or empty space (time trial) */}
          <div className="min-w-[120px] flex justify-end">
            {isHeadToHead && position !== null ? (
              <PositionIndicator position={position} animate={positionAnimate} />
            ) : (
              <div className="flex items-center gap-2 text-white/50">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="13" r="8" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="13" x2="15" y2="13" />
                  <line x1="12" y1="5" x2="12" y2="3" />
                  <line x1="9" y1="3" x2="15" y2="3" />
                </svg>
                <span className="text-base">Practice</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * GameHUD - Displays real-time game information overlaid on the Phaser canvas
 *
 * DEPRECATED: For new implementations, use TopHUD and BottomHUD separately
 * to position HUD elements outside the game canvas.
 *
 * Features:
 * - Speed gauge with animated bar
 * - Lap counter
 * - Current and best lap times
 * - Position indicator (head-to-head mode)
 * - Checkpoint progress dots
 * - Penalty flash indicator
 *
 * Uses glass-morphism styling consistent with MainMenu.
 * Positioned at top and bottom edges to not block gameplay.
 */
export function GameHUD({
  speed,
  lapNumber,
  totalLaps,
  currentLapTime,
  bestLapTime,
  position,
  checkpoints,
  penaltyFlash,
  gameMode,
}: GameHUDProps) {
  const [positionAnimate, setPositionAnimate] = useState(false);
  const prevPosition = useRef(position);

  // Animate position changes
  useEffect(() => {
    if (prevPosition.current !== position && position !== null) {
      setPositionAnimate(true);
      const timer = setTimeout(() => setPositionAnimate(false), 300);
      prevPosition.current = position;
      return () => clearTimeout(timer);
    }
  }, [position]);

  const isHeadToHead = gameMode === 'head-to-head';

  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {/* Custom animations */}
      <style>{`
        @keyframes flash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes penaltyPulse {
          0% { transform: scale(1.2); opacity: 1; }
          50% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0; }
        }
      `}</style>

      {/* Top Bar - Lap info and times */}
      <div className="absolute top-0 left-0 right-0 p-3">
        <div
          className="
            mx-auto max-w-3xl
            bg-dark-200/60 backdrop-blur-md
            border border-white/10 rounded-lg
            shadow-card
            px-6 py-3
          "
        >
          <div className="flex items-center justify-between">
            {/* Lap counter */}
            <LapCounter lapNumber={lapNumber} totalLaps={totalLaps} />

            {/* Divider */}
            <div className="h-8 w-px bg-white/10" />

            {/* Current lap time */}
            <TimeDisplay label="Current" time={currentLapTime} />

            {/* Divider */}
            <div className="h-8 w-px bg-white/10" />

            {/* Best lap time */}
            <TimeDisplay label="Best" time={bestLapTime} variant="best" />
          </div>
        </div>
      </div>

      {/* Bottom Bar - Speed, checkpoints, position */}
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <div
          className="
            mx-auto max-w-3xl
            bg-dark-200/60 backdrop-blur-md
            border border-white/10 rounded-lg
            shadow-card
            px-6 py-3
          "
        >
          <div className="flex items-center justify-between">
            {/* Speed gauge */}
            <SpeedGauge speed={speed} />

            {/* Checkpoint progress */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm text-white/50 uppercase tracking-wider">
                Checkpoints
              </span>
              <CheckpointProgress checkpoints={checkpoints} />
            </div>

            {/* Position (head-to-head) or empty space (time trial) */}
            <div className="min-w-[120px] flex justify-end">
              {isHeadToHead && position !== null ? (
                <PositionIndicator position={position} animate={positionAnimate} />
              ) : (
                <div className="flex items-center gap-2 text-white/50">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="13" r="8" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="13" x2="15" y2="13" />
                    <line x1="12" y1="5" x2="12" y2="3" />
                    <line x1="9" y1="3" x2="15" y2="3" />
                  </svg>
                  <span className="text-base">Practice</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Penalty flash overlay */}
      <PenaltyIndicator show={penaltyFlash} />
    </div>
  );
}

/**
 * Default export for convenience
 */
export default GameHUD;
