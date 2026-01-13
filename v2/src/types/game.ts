/**
 * Game types for Shadow Driver v2
 */

export type GameMode = 'head-to-head' | 'time-trial';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface GameState {
  mode: GameMode;
  trackId: string;
  isRunning: boolean;
  isPaused: boolean;
}

export interface GameConfig {
  width: number;
  height: number;
  mode: GameMode;
  difficulty: Difficulty;
}

export interface PhaserGameInstance {
  game: Phaser.Game | null;
  destroy: () => void;
}

/**
 * Input state for car control
 */
export interface InputState {
  throttle: boolean;
  brake: boolean;
  steer: number; // -1 (left) to 1 (right)
}

/**
 * Car state for physics and rendering
 */
export interface CarState {
  x: number;
  y: number;
  angle: number;
  speed: number;
  damaged: boolean;
}

/**
 * Race state emitted to React HUD each frame
 */
export interface RaceHUDState {
  speed: number;
  lapNumber: number;
  totalLaps: number;
  currentLapTime: number;
  bestLapTime: number | null;
  position: 1 | 2; // Player position (1st or 2nd)
  checkpoints: number;
  totalCheckpoints: number;
  penaltyFlash: boolean;
  gameMode: GameMode;
  raceState: 'countdown' | 'racing' | 'finished';
}

/**
 * Race result data emitted when race completes
 */
export interface RaceResult {
  finalTime: number;
  bestLapTime: number | null;
  lapTimes: number[];
  crashCount: number;
  offTrackTime: number;
  position: 1 | 2;
}

/**
 * Scene initialization data for RaceScene
 */
export interface RaceSceneData {
  trackId: string;
  mode: GameMode;
  difficulty?: Difficulty;
}
