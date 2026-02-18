import { useState, useCallback, useMemo } from 'react';
import { Layout, type NavigationPage } from './components/layout';
import { MainMenu } from './components/menu';
import { TrackSelect } from './components/menu/TrackSelect';
import { HowToPlay } from './components/menu/HowToPlay';
import { GameContainer, GPUConnectionModal } from './components/game';
import { ResultsScreen, type RaceResult } from './components/results/ResultsScreen';
import { useMobileDetect, useGPUConnection } from './hooks';
import type { GameMode, Difficulty } from './types/game';
import './index.css';

/**
 * Navigation view states for the application
 */
type View = 'menu' | 'track-select' | 'gpu-select' | 'game' | 'results' | 'leaderboard' | 'how-to-play';

/**
 * Track timing data for medal calculations
 * These values match the JSON track files
 */
interface TrackTiming {
  parTime: number;
  goldTime: number;
}

const TRACK_TIMINGS: Record<string, TrackTiming> = {
  'sunset-speedway': { parTime: 55000, goldTime: 42000 },
  'mountain-pass': { parTime: 70000, goldTime: 55000 },
  'nightmare-circuit': { parTime: 90000, goldTime: 72000 },
};

/**
 * Get track timing data, with fallback defaults
 */
function getTrackTiming(trackId: string): TrackTiming {
  return TRACK_TIMINGS[trackId] || { parTime: 60000, goldTime: 45000 };
}

/**
 * Complete application state
 */
interface AppState {
  currentView: View;
  selectedMode: GameMode | null;
  selectedTrack: string | null;
  raceResult: RaceResult | null;
  aiResult: RaceResult | null;
  winner: 'player' | 'ai' | null;
  useRealGPU: boolean; // Whether to use real GPU for AI
}

/**
 * Initial application state
 */
const initialState: AppState = {
  currentView: 'menu',
  selectedMode: null,
  selectedTrack: null,
  raceResult: null,
  aiResult: null,
  winner: null,
  useRealGPU: false,
};

/**
 * Main Application Component
 *
 * Implements the full user flow:
 * MainMenu -> TrackSelect -> Game -> Results -> (Play Again or Main Menu)
 *
 * Key responsibilities:
 * 1. Navigation state management between views
 * 2. Props passing between components
 * 3. Mobile controls integration
 * 4. Race result handling and transformation
 */
function App() {
  const [state, setState] = useState<AppState>(initialState);
  const isMobile = useMobileDetect();

  // GPU connection hook for real AI racing
  const gpu = useGPUConnection();

  // Memoize gpuConnection to prevent GameContainer's useEffect from re-running
  // on every render (which would destroy and recreate the Phaser game)
  const gpuConnectionProps = useMemo(() => {
    if (!state.useRealGPU) return undefined;
    return {
      useRealGPU: state.useRealGPU,
      isConnected: gpu.isConnected,
      sendGameState: gpu.sendGameState,
      lastPrediction: gpu.lastPrediction,
    };
  }, [state.useRealGPU, gpu.isConnected, gpu.sendGameState, gpu.lastPrediction]);

  /**
   * Handle mode selection from MainMenu
   * Navigates to track selection screen
   */
  const handleModeSelect = useCallback((mode: GameMode) => {
    setState(s => ({
      ...s,
      selectedMode: mode,
      currentView: 'track-select',
    }));
  }, []);

  /**
   * Handle track selection from TrackSelect
   * For head-to-head, shows GPU selection modal first
   * For time-trial, goes directly to game
   */
  const handleTrackSelect = useCallback((trackId: string) => {
    setState(s => {
      // For head-to-head mode, show GPU selection first
      if (s.selectedMode === 'head-to-head') {
        return {
          ...s,
          selectedTrack: trackId,
          currentView: 'gpu-select' as View,
          raceResult: null,
          aiResult: null,
          winner: null,
        };
      }
      // For time-trial, go directly to game
      return {
        ...s,
        selectedTrack: trackId,
        currentView: 'game' as View,
        raceResult: null,
        aiResult: null,
        winner: null,
        useRealGPU: false,
      };
    });
  }, []);

  /**
   * Handle going back from track selection to main menu
   */
  const handleBackToMenu = useCallback(() => {
    setState(s => ({
      ...s,
      currentView: 'menu',
      selectedMode: null,
      selectedTrack: null,
    }));
  }, []);

  /**
   * Handle race completion from GameContainer
   * Transforms race data and navigates to results screen
   */
  const handleRaceComplete = useCallback((result: {
    playerResult: RaceResult;
    aiResult?: RaceResult;
    winner: 'player' | 'ai';
  }) => {
    setState(s => ({
      ...s,
      raceResult: result.playerResult,
      aiResult: result.aiResult || null,
      winner: result.winner,
      currentView: 'results',
    }));
  }, []);

  /**
   * Handle "Play Again" from results screen
   * Resets race state and returns to game view
   */
  const handlePlayAgain = useCallback(() => {
    setState(s => ({
      ...s,
      currentView: 'game',
      raceResult: null,
      aiResult: null,
      winner: null,
    }));
  }, []);

  /**
   * Handle "Main Menu" from results screen
   * Resets all state
   */
  const handleMainMenu = useCallback(() => {
    setState(initialState);
  }, []);

  /**
   * Handle starting GPU from GPU modal
   */
  const handleStartGPU = useCallback(async () => {
    await gpu.startGPU();
  }, [gpu]);

  /**
   * Handle stopping GPU from GPU modal
   */
  const handleStopGPU = useCallback(async () => {
    await gpu.stopGPU();
  }, [gpu]);

  /**
   * Handle proceeding with real GPU after connection
   */
  const handleProceedWithGPU = useCallback(() => {
    setState(s => ({
      ...s,
      currentView: 'game' as View,
      useRealGPU: true,
    }));
  }, []);

  /**
   * Handle proceeding with local AI (no GPU)
   */
  const handleProceedWithLocalAI = useCallback(() => {
    setState(s => ({
      ...s,
      currentView: 'game' as View,
      useRealGPU: false,
    }));
  }, []);

  /**
   * Handle closing GPU modal (back to track select)
   */
  const handleCloseGPUModal = useCallback(() => {
    // If GPU was started but user cancels, stop it
    if (gpu.provisioningState !== 'idle') {
      gpu.stopGPU();
    }
    setState(s => ({
      ...s,
      currentView: 'track-select' as View,
    }));
  }, [gpu]);

  /**
   * Handle header navigation
   */
  const handleHeaderNavigate = useCallback((page: NavigationPage) => {
    if (page === 'home') {
      setState(initialState);
    } else if (page === 'leaderboard') {
      setState(s => ({ ...s, currentView: 'leaderboard' }));
    } else if (page === 'how-to-play') {
      setState(s => ({ ...s, currentView: 'how-to-play' }));
    }
  }, []);

  /**
   * Get current page for header navigation highlighting
   */
  const getCurrentPage = (): NavigationPage => {
    if (state.currentView === 'leaderboard') return 'leaderboard';
    if (state.currentView === 'how-to-play') return 'how-to-play';
    return 'home';
  };

  /**
   * Get difficulty based on selected track
   * Maps track difficulty to AI difficulty setting
   */
  const getDifficulty = (): Difficulty => {
    switch (state.selectedTrack) {
      case 'sunset-speedway':
        return 'easy';
      case 'mountain-pass':
        return 'medium';
      case 'nightmare-circuit':
        return 'hard';
      default:
        return 'medium';
    }
  };

  /**
   * Get track timing for results screen
   */
  const trackTiming = state.selectedTrack
    ? getTrackTiming(state.selectedTrack)
    : { parTime: 60000, goldTime: 45000 };

  /**
   * Get GPU status for footer display
   */
  const getGPUStatus = (): 'connected' | 'disconnected' | 'connecting' => {
    if (gpu.isConnected) return 'connected';
    if (gpu.provisioningState === 'starting' || gpu.connectionState === 'connecting') return 'connecting';
    return 'disconnected';
  };

  return (
    <Layout
      gpuStatus={getGPUStatus()}
      showHeader={state.currentView !== 'game'}
      showFooter={state.currentView !== 'game'}
      onNavigate={handleHeaderNavigate}
      currentPage={getCurrentPage()}
    >
      {/* Main Menu View */}
      {state.currentView === 'menu' && (
        <MainMenu onSelectMode={handleModeSelect} />
      )}

      {/* Track Selection View */}
      {state.currentView === 'track-select' && state.selectedMode && (
        <TrackSelect
          mode={state.selectedMode}
          onSelectTrack={handleTrackSelect}
          onBack={handleBackToMenu}
        />
      )}

      {/* GPU Selection View (for head-to-head mode) */}
      {state.currentView === 'gpu-select' && (
        <GPUConnectionModal
          isOpen={true}
          onClose={handleCloseGPUModal}
          gpuStatus={gpu.provisioningState}
          wsStatus={gpu.connectionState}
          gpuInfo={gpu.instanceData.gpu_name || gpu.instanceData.setup_status ? {
            gpu_name: gpu.instanceData.gpu_name || '',
            price_per_hour: gpu.instanceData.price_per_hour || 0,
            cost_so_far: gpu.instanceData.cost_so_far,
            uptime_seconds: gpu.instanceData.uptime_seconds,
            tunnel_url: gpu.instanceData.tunnel_url || undefined,
            setup_status: gpu.instanceData.setup_status,
            setup_message: gpu.instanceData.setup_message,
          } : null}
          error={gpu.error?.message || null}
          retryCount={gpu.retryCount}
          maxRetries={gpu.maxRetries}
          onStartGPU={handleStartGPU}
          onStopGPU={handleStopGPU}
          onProceedWithLocalAI={handleProceedWithLocalAI}
          onProceedWithGPU={handleProceedWithGPU}
        />
      )}

      {/* Game View */}
      {state.currentView === 'game' && state.selectedMode && state.selectedTrack && (
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          {/* Back button for game view */}
          <div className="w-full max-w-[900px] mb-4">
            <button
              onClick={handleBackToMenu}
              className="flex items-center gap-2 text-white/60 hover:text-white transition-colors text-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Exit Race
            </button>
          </div>

          {/* Game mode indicator */}
          <div className="mb-4 text-center">
            <span className="text-sm text-white/40">
              Mode: <span className="text-accent">
                {state.selectedMode === 'head-to-head' ? 'Head to Head' : 'Time Trial'}
              </span>
              {' | '}
              Track: <span className="text-accent">{getTrackDisplayName(state.selectedTrack)}</span>
            </span>
          </div>

          {/* Game Container */}
          <GameContainer
            width={900}
            height={600}
            trackId={mapTrackIdToFile(state.selectedTrack)}
            mode={state.selectedMode}
            difficulty={getDifficulty()}
            isMobile={isMobile}
            onRaceComplete={handleRaceComplete}
            gpuConnection={gpuConnectionProps}
          />
        </div>
      )}

      {/* Results View */}
      {state.currentView === 'results' && state.selectedMode && state.selectedTrack && state.raceResult && (
        <ResultsScreen
          mode={state.selectedMode}
          trackId={state.selectedTrack}
          playerResult={state.raceResult}
          aiResult={state.aiResult || undefined}
          parTime={trackTiming.parTime}
          goldTime={trackTiming.goldTime}
          onPlayAgain={handlePlayAgain}
          onMainMenu={handleMainMenu}
        />
      )}

      {/* Leaderboard View */}
      {state.currentView === 'leaderboard' && (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="max-w-2xl w-full">
            <h2 className="text-3xl font-bold text-white mb-6 text-center">Leaderboard</h2>
            <div className="bg-dark-300/50 rounded-xl p-6 border border-white/10">
              <p className="text-white/60 text-center mb-4">Top Times - Coming Soon</p>
              <p className="text-white/40 text-sm text-center">
                Complete races in Time Trial mode to record your best times.
              </p>
            </div>
            <button
              onClick={handleMainMenu}
              className="mt-6 w-full py-3 px-6 bg-gradient-to-r from-human to-ai rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
            >
              Back to Menu
            </button>
          </div>
        </div>
      )}

      {/* How to Play View */}
      {state.currentView === 'how-to-play' && (
        <HowToPlay isOpen={true} onClose={handleMainMenu} onStartPlaying={handleMainMenu} />
      )}
    </Layout>
  );
}

/**
 * Map track selection ID to track file ID
 * TrackSelect uses display IDs, GameContainer uses file IDs
 */
function mapTrackIdToFile(trackId: string): string {
  const trackMap: Record<string, string> = {
    'sunset-speedway': 'easy',
    'mountain-pass': 'medium',
    'nightmare-circuit': 'hard',
  };
  return trackMap[trackId] || trackId;
}

/**
 * Get display name for track ID
 */
function getTrackDisplayName(trackId: string): string {
  const nameMap: Record<string, string> = {
    'sunset-speedway': 'Sunset Speedway',
    'mountain-pass': 'Mountain Pass',
    'nightmare-circuit': 'Nightmare Circuit',
  };
  return nameMap[trackId] || trackId;
}

export default App;
