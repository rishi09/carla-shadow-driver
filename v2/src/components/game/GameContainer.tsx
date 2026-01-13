import { useRef, useEffect, useState, useCallback } from 'react';
import Phaser from 'phaser';
import { createPhaserGame, destroyPhaserGame } from '../../game/PhaserGame';
import { GameHUD } from './GameHUD';
import { CountdownOverlay } from './CountdownOverlay';
import { ControlsHint } from './ControlsHint';
import type { GameMode, Difficulty, RaceHUDState, InputState } from '../../types/game';
import type { RaceScene } from '../../game/scenes/RaceScene';
import type { AIPrediction, GameStatePayload } from '../../hooks/useGPUConnection';

// ============================================================================
// Event Contract: React <-> Phaser GPU Integration
// ============================================================================
//
// This module implements bidirectional communication between React and Phaser
// for GPU-based AI predictions.
//
// Events (using game.events, NOT scene.events):
//
// 1. Phaser -> React: 'aiGameState'
//    Payload: { position: number, speed: number, curvature: number }
//    Frequency: Emitted every frame when racing (Phaser will emit, React filters to 10Hz)
//    Purpose: Send AI car state to GPU for prediction
//
// 2. React -> Phaser: 'gpuPrediction'
//    Payload: { steering: number, throttle?: number, brake?: number }
//    Frequency: Whenever GPU returns a prediction
//    Purpose: Apply GPU prediction to AI car instead of local AIController
//
// 3. React -> Phaser: 'setGPUMode'
//    Payload: { enabled: boolean }
//    Frequency: Once when game starts, or when GPU connection changes
//    Purpose: Tell RaceScene whether to use GPU predictions or local AI
//
// ============================================================================

/**
 * GPU connection props passed from App.tsx
 */
export interface GPUConnectionProps {
  /** Whether to use real GPU for AI predictions */
  useRealGPU: boolean;
  /** Whether GPU WebSocket is connected */
  isConnected: boolean;
  /** Function to send game state to GPU, returns last prediction */
  sendGameState: (state: GameStatePayload) => AIPrediction | null;
  /** Latest prediction from GPU (updated asynchronously) */
  lastPrediction: AIPrediction | null;
}

interface GameContainerProps {
  width?: number;
  height?: number;
  trackId: string;
  mode: GameMode;
  difficulty?: Difficulty;
  isMobile?: boolean;
  /** GPU connection props for real AI predictions */
  gpuConnection?: GPUConnectionProps;
  onRaceComplete?: (result: {
    playerResult: {
      totalTime: number;
      lapTimes: number[];
      crashes: number;
      crashPenalty: number;
      perfectLaps: number;
      perfectBonus: number;
      playerName: string;
    };
    aiResult?: {
      totalTime: number;
      lapTimes: number[];
      crashes: number;
      crashPenalty: number;
      perfectLaps: number;
      perfectBonus: number;
      playerName: string;
    };
    winner: 'player' | 'ai';
  }) => void;
}

/**
 * Convert RaceScene checkpoints number to boolean array for GameHUD
 */
function createCheckpointsArray(hitCount: number, total: number): boolean[] {
  return Array.from({ length: total }, (_, i) => i < hitCount);
}

/**
 * GameContainer - React component that manages Phaser game lifecycle
 *
 * This component:
 * 1. Creates and manages the Phaser game instance
 * 2. Listens for Phaser events and updates React state
 * 3. Shows GameHUD overlay during racing
 * 4. Shows CountdownOverlay at race start
 * 5. Handles mobile input if isMobile is true
 *
 * Uses refs to avoid React re-render issues with Phaser.
 * The Phaser game is created on mount and destroyed on unmount.
 */
export function GameContainer({
  width = 900,
  height = 600,
  trackId,
  mode,
  difficulty = 'medium',
  isMobile = false,
  gpuConnection,
  onRaceComplete,
}: GameContainerProps) {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const raceSceneRef = useRef<RaceScene | null>(null);

  // GPU state sending throttle (10Hz = every 100ms)
  const lastGPUSendTimeRef = useRef<number>(0);
  const GPU_SEND_INTERVAL = 100; // ms

  // UI State
  const [showCountdown, setShowCountdown] = useState(true);
  const [hudState, setHudState] = useState<RaceHUDState>({
    speed: 0,
    lapNumber: 1,
    totalLaps: 3,
    currentLapTime: 0,
    bestLapTime: null,
    position: 1,
    checkpoints: 0,
    totalCheckpoints: 3,
    penaltyFlash: false,
    gameMode: mode,
    raceState: 'countdown',
  });

  // Track if race has started (for countdown)
  const [raceStarted, setRaceStarted] = useState(false);

  // Track if controls hint has been dismissed
  const [showControlsHint, setShowControlsHint] = useState(true);

  // Check if this is the user's first race (stored in localStorage)
  const isFirstRace = useCallback(() => {
    try {
      return !localStorage.getItem('shadow-driver-has-played');
    } catch {
      return true;
    }
  }, []);

  // Mark that user has played before
  const markAsPlayed = useCallback(() => {
    try {
      localStorage.setItem('shadow-driver-has-played', 'true');
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  /**
   * Handle countdown completion
   */
  const handleCountdownComplete = useCallback(() => {
    setShowCountdown(false);
  }, []);

  /**
   * Handle countdown tick (for sound integration later)
   */
  const handleCountdownTick = useCallback((count: number) => {
    // TODO: Play countdown sound based on count
    console.log('Countdown tick:', count);
  }, []);

  /**
   * Handle mobile control input
   */
  const handleMobileInput = useCallback((input: InputState) => {
    if (raceSceneRef.current) {
      raceSceneRef.current.setExternalInput(input);
    }
  }, []);

  useEffect(() => {
    // Only create game if container exists and game hasn't been created
    if (!containerRef.current || gameRef.current) return;

    // Create the Phaser game instance
    gameRef.current = createPhaserGame({
      parent: containerRef.current,
      width,
      height,
    });

    // Wait for game to be ready, then send start event
    const game = gameRef.current;

    // Listen for scene ready
    const checkSceneReady = () => {
      const raceScene = game.scene.getScene('RaceScene') as RaceScene | null;
      if (raceScene) {
        raceSceneRef.current = raceScene;

        // Listen for game state updates (HUD)
        raceScene.events.on('gameState', (state: RaceHUDState) => {
          setHudState(state);
        });

        // Listen for race start
        raceScene.events.on('raceStart', () => {
          setRaceStarted(true);
          setShowCountdown(false);
        });

        // ================================================================
        // GPU Integration: Listen for AI game state from Phaser
        // ================================================================
        // This event is emitted by RaceScene when racing with an AI car.
        // We throttle sending to GPU at 10Hz (every 100ms).
        game.events.on('aiGameState', (state: { position: number; speed: number; curvature: number }) => {
          // Only send if GPU is connected and enabled
          if (!gpuConnection?.useRealGPU || !gpuConnection?.isConnected) {
            return;
          }

          // Throttle to 10Hz
          const now = performance.now();
          if (now - lastGPUSendTimeRef.current < GPU_SEND_INTERVAL) {
            return;
          }
          lastGPUSendTimeRef.current = now;

          // Send to GPU via WebSocket
          gpuConnection.sendGameState({
            position: state.position,
            speed: state.speed,
            curvature: state.curvature,
          });
        });

        // Tell RaceScene whether to use GPU mode
        game.events.emit('setGPUMode', {
          enabled: gpuConnection?.useRealGPU && gpuConnection?.isConnected,
        });

        // Listen for race complete
        raceScene.events.on('raceComplete', (result: {
          playerResult: {
            finalTime: number;
            bestLapTime: number | null;
            lapTimes: number[];
            crashCount: number;
            offTrackTime: number;
            position: 1 | 2;
          };
          aiResult?: {
            finalTime: number;
            bestLapTime: number | null;
            lapTimes: number[];
            crashCount: number;
            offTrackTime: number;
            position: 1 | 2;
          };
          winner: 'player' | 'ai';
        }) => {
          // Transform the result to match ResultsScreen expected format
          const transformedResult = {
            playerResult: {
              totalTime: result.playerResult.finalTime,
              lapTimes: result.playerResult.lapTimes,
              crashes: result.playerResult.crashCount,
              crashPenalty: result.playerResult.crashCount * 3000, // 3s per crash
              perfectLaps: 0, // Will be calculated from ScoringSystem if available
              perfectBonus: 0,
              playerName: 'Player',
            },
            aiResult: result.aiResult ? {
              totalTime: result.aiResult.finalTime,
              lapTimes: result.aiResult.lapTimes,
              crashes: result.aiResult.crashCount,
              crashPenalty: result.aiResult.crashCount * 3000,
              perfectLaps: 0,
              perfectBonus: 0,
              playerName: 'AI',
            } : undefined,
            winner: result.winner,
          };

          onRaceComplete?.(transformedResult);
        });

        return true;
      }
      return false;
    };

    // Track intervals/timeouts for cleanup
    let checkInterval: ReturnType<typeof setInterval> | null = null;
    let safetyTimeout: ReturnType<typeof setTimeout> | null = null;
    let delayTimeout: ReturnType<typeof setTimeout> | null = null;

    // Start the race after boot scene completes
    game.events.once('bootComplete', () => {
      // Wait a short delay for scene to be fully ready
      delayTimeout = setTimeout(() => {
        game.events.emit('startRace', {
          trackId,
          mode,
          difficulty,
        });

        // Try to get reference to race scene
        checkInterval = setInterval(() => {
          if (checkSceneReady()) {
            if (checkInterval) clearInterval(checkInterval);
            checkInterval = null;
          }
        }, 100);

        // Clear interval after 5 seconds as safety
        safetyTimeout = setTimeout(() => {
          if (checkInterval) clearInterval(checkInterval);
          checkInterval = null;
        }, 5000);
      }, 100);
    });

    // Cleanup on unmount
    return () => {
      // Clean up all timers
      if (checkInterval) clearInterval(checkInterval);
      if (safetyTimeout) clearTimeout(safetyTimeout);
      if (delayTimeout) clearTimeout(delayTimeout);

      if (raceSceneRef.current) {
        raceSceneRef.current.events.off('gameState');
        raceSceneRef.current.events.off('raceStart');
        raceSceneRef.current.events.off('raceComplete');
      }
      // Clean up GPU event listeners from game.events
      if (gameRef.current) {
        gameRef.current.events.off('aiGameState');
      }
      destroyPhaserGame(gameRef.current);
      gameRef.current = null;
      raceSceneRef.current = null;
    };
  }, [width, height, trackId, mode, difficulty, onRaceComplete, gpuConnection]);

  // ================================================================
  // GPU Integration: Forward predictions to Phaser
  // ================================================================
  // When GPU prediction changes, emit it to Phaser via game.events
  useEffect(() => {
    if (!gpuConnection?.lastPrediction || !gameRef.current) {
      return;
    }

    // Only forward if GPU mode is enabled
    if (!gpuConnection.useRealGPU || !gpuConnection.isConnected) {
      return;
    }

    // Emit prediction to Phaser (RaceScene will listen for this)
    gameRef.current.events.emit('gpuPrediction', {
      steering: gpuConnection.lastPrediction.steering,
      throttle: gpuConnection.lastPrediction.throttle,
      brake: gpuConnection.lastPrediction.brake,
    });
  }, [gpuConnection?.lastPrediction, gpuConnection?.useRealGPU, gpuConnection?.isConnected]);

  // ================================================================
  // GPU Integration: Update GPU mode when connection state changes
  // ================================================================
  useEffect(() => {
    if (!gameRef.current) return;

    gameRef.current.events.emit('setGPUMode', {
      enabled: gpuConnection?.useRealGPU && gpuConnection?.isConnected,
    });
  }, [gpuConnection?.useRealGPU, gpuConnection?.isConnected]);

  return (
    <div className="relative" style={{ width: `${width}px`, height: `${height}px` }}>
      {/* Phaser canvas container */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />

      {/* Countdown overlay */}
      {showCountdown && !raceStarted && (
        <CountdownOverlay
          onComplete={handleCountdownComplete}
          onTick={handleCountdownTick}
        />
      )}

      {/* Game HUD overlay - show during racing */}
      {!showCountdown && hudState.raceState === 'racing' && (
        <GameHUD
          speed={hudState.speed}
          lapNumber={hudState.lapNumber}
          totalLaps={hudState.totalLaps}
          currentLapTime={hudState.currentLapTime}
          bestLapTime={hudState.bestLapTime}
          position={mode === 'head-to-head' ? hudState.position : null}
          checkpoints={createCheckpointsArray(hudState.checkpoints, hudState.totalCheckpoints)}
          penaltyFlash={hudState.penaltyFlash}
          gameMode={hudState.gameMode}
        />
      )}

      {/* Controls Hint overlay - show during first race or after countdown */}
      {!showCountdown && hudState.raceState === 'racing' && showControlsHint && !isMobile && (
        <ControlsHint
          visible={showControlsHint}
          onDismiss={() => {
            setShowControlsHint(false);
            markAsPlayed();
          }}
          autoHideSeconds={12}
          isFirstRace={isFirstRace()}
        />
      )}

      {/* Mobile controls placeholder - to be implemented by MobileControls.tsx */}
      {isMobile && !showCountdown && hudState.raceState === 'racing' && (
        <MobileControlsPlaceholder onInput={handleMobileInput} />
      )}
    </div>
  );
}

/**
 * Placeholder for mobile controls until MobileControls.tsx is implemented
 * Provides touch-based steering and pedal controls
 */
function MobileControlsPlaceholder({
  onInput,
}: {
  onInput: (input: InputState) => void;
}) {
  const [input, setInput] = useState<InputState>({
    throttle: false,
    brake: false,
    steer: 0,
  });

  useEffect(() => {
    onInput(input);
  }, [input, onInput]);

  const handleThrottleStart = () => setInput(prev => ({ ...prev, throttle: true }));
  const handleThrottleEnd = () => setInput(prev => ({ ...prev, throttle: false }));
  const handleBrakeStart = () => setInput(prev => ({ ...prev, brake: true }));
  const handleBrakeEnd = () => setInput(prev => ({ ...prev, brake: false }));
  const handleSteerLeft = () => setInput(prev => ({ ...prev, steer: -1 }));
  const handleSteerRight = () => setInput(prev => ({ ...prev, steer: 1 }));
  const handleSteerRelease = () => setInput(prev => ({ ...prev, steer: 0 }));

  return (
    <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-between items-end pointer-events-auto">
      {/* Left side - Steering */}
      <div className="flex gap-2">
        <button
          className="w-16 h-16 bg-white/20 rounded-lg active:bg-white/40 flex items-center justify-center text-white text-2xl"
          onTouchStart={handleSteerLeft}
          onTouchEnd={handleSteerRelease}
          onMouseDown={handleSteerLeft}
          onMouseUp={handleSteerRelease}
          onMouseLeave={handleSteerRelease}
        >
          &#8592;
        </button>
        <button
          className="w-16 h-16 bg-white/20 rounded-lg active:bg-white/40 flex items-center justify-center text-white text-2xl"
          onTouchStart={handleSteerRight}
          onTouchEnd={handleSteerRelease}
          onMouseDown={handleSteerRight}
          onMouseUp={handleSteerRelease}
          onMouseLeave={handleSteerRelease}
        >
          &#8594;
        </button>
      </div>

      {/* Right side - Pedals */}
      <div className="flex gap-2">
        <button
          className="w-16 h-16 bg-red-500/40 rounded-lg active:bg-red-500/60 flex items-center justify-center text-white text-sm font-bold"
          onTouchStart={handleBrakeStart}
          onTouchEnd={handleBrakeEnd}
          onMouseDown={handleBrakeStart}
          onMouseUp={handleBrakeEnd}
          onMouseLeave={handleBrakeEnd}
        >
          BRAKE
        </button>
        <button
          className="w-16 h-16 bg-green-500/40 rounded-lg active:bg-green-500/60 flex items-center justify-center text-white text-sm font-bold"
          onTouchStart={handleThrottleStart}
          onTouchEnd={handleThrottleEnd}
          onMouseDown={handleThrottleStart}
          onMouseUp={handleThrottleEnd}
          onMouseLeave={handleThrottleEnd}
        >
          GAS
        </button>
      </div>
    </div>
  );
}
