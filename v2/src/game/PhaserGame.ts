import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { RaceScene } from './scenes/RaceScene';

/**
 * PhaserGame - Factory function to create and configure the Phaser game instance
 *
 * This module encapsulates the Phaser game configuration and creation,
 * keeping it separate from React's lifecycle management.
 */

export interface PhaserGameConfig {
  parent: HTMLElement;
  width?: number;
  height?: number;
}

export function createPhaserGame(config: PhaserGameConfig): Phaser.Game {
  const gameConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: config.parent,
    width: config.width ?? 900,
    height: config.height ?? 600,
    backgroundColor: '#1a1a2e',
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, RaceScene],
  };

  return new Phaser.Game(gameConfig);
}

export function destroyPhaserGame(game: Phaser.Game | null): void {
  if (game) {
    game.destroy(true);
  }
}
