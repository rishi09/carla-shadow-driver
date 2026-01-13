import { useState, useCallback } from 'react';
import { Layout } from './components/layout';
import { MainMenu } from './components/menu';
import { TrackSelect } from './components/menu/TrackSelect';
import { GameContainer } from './components/game/GameContainer';
import { ResultsScreen, type RaceResult } from './components/results/ResultsScreen';
import { useMobileDetect } from './hooks';
import type { GameMode, Difficulty } from './types/game';
import './index.css';

/**
 * Navigation view states for the application
 */
type View = 'menu' | 'track-select' | 'game' | 'results';

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
   * Navigates to game view
   */
  const handleTrackSelect = useCallback((trackId: string) => {
    setState(s => ({
      ...s,
      selectedTrack: trackId,
      currentView: 'game',
      // Clear previous results when starting new race
      raceResult: null,
      aiResult: null,
      winner: null,
    }));
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

  return (
    <Layout
      gpuStatus="disconnected"
      showHeader={state.currentView !== 'game'}
      showFooter={state.currentView !== 'game'}
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
