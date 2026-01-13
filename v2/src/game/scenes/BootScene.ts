import Phaser from 'phaser';
import type { RaceSceneData } from '../../types/game';

/**
 * BootScene - Initial scene for loading game assets
 *
 * This scene handles:
 * - Loading all game assets (sprites, audio, tracks)
 * - Displaying loading progress
 * - Transitioning to the RaceScene or MainMenu after loading
 */
export class BootScene extends Phaser.Scene {
  // Scene data passed from React/GameContainer
  private sceneData?: RaceSceneData;

  constructor() {
    super({ key: 'BootScene' });
  }

  init(data?: RaceSceneData): void {
    this.sceneData = data;
  }

  preload(): void {
    // Create loading progress bar
    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(
      this.cameras.main.width / 2 - 160,
      this.cameras.main.height / 2 - 25,
      320,
      50
    );

    // Loading text
    const loadingText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2 - 50,
      'Loading...',
      {
        font: '20px monospace',
        color: '#ffffff',
      }
    );
    loadingText.setOrigin(0.5, 0.5);

    // Percentage text
    const percentText = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      '0%',
      {
        font: '18px monospace',
        color: '#ffffff',
      }
    );
    percentText.setOrigin(0.5, 0.5);

    // Update progress bar as assets load
    this.load.on('progress', (value: number) => {
      percentText.setText(`${Math.round(value * 100)}%`);
      progressBar.clear();
      progressBar.fillStyle(0x00ff00, 1);
      progressBar.fillRect(
        this.cameras.main.width / 2 - 150,
        this.cameras.main.height / 2 - 15,
        300 * value,
        30
      );
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
      percentText.destroy();
    });

    // Load common game assets
    // Car sprites (placeholder - to be replaced with actual sprites)
    // this.load.image('car-player', 'assets/sprites/car-player.png');
    // this.load.image('car-ai', 'assets/sprites/car-ai.png');

    // Audio assets
    // this.load.audio('engine', 'assets/audio/engine.mp3');
    // this.load.audio('crash', 'assets/audio/crash.mp3');
    // this.load.audio('countdown', 'assets/audio/countdown.mp3');

    // Note: Track data is loaded by RaceScene since it depends on track selection
  }

  create(): void {
    // Emit event to notify React that boot is complete
    // IMPORTANT: Use game.events (not this.events) so React can receive it
    this.game.events.emit('bootComplete');

    // If scene data was provided, go directly to RaceScene
    if (this.sceneData?.trackId) {
      this.transitionToRace(this.sceneData);
      return;
    }

    // Otherwise, show boot message and wait for React to trigger navigation
    const text = this.add.text(
      this.cameras.main.width / 2,
      this.cameras.main.height / 2,
      'Shadow Driver v2\nReady to Race!\n\nSelect a track to begin.',
      {
        font: '24px monospace',
        color: '#00ff00',
        align: 'center',
      }
    );
    text.setOrigin(0.5, 0.5);

    // Listen for startRace event from React
    this.game.events.on('startRace', (data: RaceSceneData) => {
      this.transitionToRace(data);
    });
  }

  /**
   * Transition to RaceScene with the given configuration
   */
  private transitionToRace(data: RaceSceneData): void {
    this.scene.start('RaceScene', data);
  }

  /**
   * Clean up event listeners when scene shuts down
   */
  shutdown(): void {
    this.game.events.off('startRace');
  }
}
