import Phaser from 'phaser';
import type { InputState } from '../../types/game';

/**
 * InputManager - Unified input handling for keyboard and touch
 *
 * Supports:
 * - Arrow keys (up/down/left/right)
 * - WASD keys
 * - Touch/swipe controls for mobile
 * - Virtual joystick integration (future)
 *
 * The InputManager maintains a single InputState that can be queried
 * each frame by the game logic.
 */
export class InputManager {
  private scene: Phaser.Scene;

  // Keyboard keys
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  // Current input state
  private inputState: InputState = {
    throttle: false,
    brake: false,
    steer: 0,
  };

  // Touch input state
  private touchState = {
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  };

  // Configuration
  private readonly TOUCH_DEAD_ZONE = 20; // Pixels before registering touch movement
  private readonly TOUCH_MAX_DISTANCE = 100; // Max distance for full input

  // External input (from React mobile controls)
  private externalInput: InputState | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.setupKeyboard();
    this.setupTouch();
  }

  /**
   * Setup keyboard input handlers
   */
  private setupKeyboard(): void {
    if (!this.scene.input.keyboard) {
      console.warn('Keyboard input not available');
      return;
    }

    // Arrow keys
    this.cursors = this.scene.input.keyboard.createCursorKeys();

    // WASD keys
    this.wasd = {
      W: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  /**
   * Setup touch/pointer input handlers
   */
  private setupTouch(): void {
    // Touch start
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.touchState.active = true;
      this.touchState.startX = pointer.x;
      this.touchState.startY = pointer.y;
      this.touchState.currentX = pointer.x;
      this.touchState.currentY = pointer.y;
    });

    // Touch move
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.touchState.active) {
        this.touchState.currentX = pointer.x;
        this.touchState.currentY = pointer.y;
      }
    });

    // Touch end
    this.scene.input.on('pointerup', () => {
      this.touchState.active = false;
    });

    // Touch cancel (e.g., finger moves out of game area)
    this.scene.input.on('pointerout', () => {
      this.touchState.active = false;
    });
  }

  /**
   * Update input state - call this each frame before reading input
   */
  update(): void {
    // Priority: External input > Keyboard > Touch
    if (this.externalInput) {
      this.inputState = { ...this.externalInput };
      return;
    }

    // Reset state
    let throttle = false;
    let brake = false;
    let steer = 0;

    // Read keyboard input
    const keyboardInput = this.readKeyboardInput();
    throttle = throttle || keyboardInput.throttle;
    brake = brake || keyboardInput.brake;
    steer = steer || keyboardInput.steer;

    // Read touch input (only if no keyboard input)
    if (!throttle && !brake && steer === 0) {
      const touchInput = this.readTouchInput();
      throttle = touchInput.throttle;
      brake = touchInput.brake;
      steer = touchInput.steer;
    }

    this.inputState = { throttle, brake, steer };
  }

  /**
   * Read keyboard input state
   */
  private readKeyboardInput(): InputState {
    const left =
      (this.cursors?.left.isDown ?? false) || (this.wasd?.A.isDown ?? false);
    const right =
      (this.cursors?.right.isDown ?? false) || (this.wasd?.D.isDown ?? false);
    const up =
      (this.cursors?.up.isDown ?? false) || (this.wasd?.W.isDown ?? false);
    const down =
      (this.cursors?.down.isDown ?? false) || (this.wasd?.S.isDown ?? false);

    return {
      throttle: up,
      brake: down,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
    };
  }

  /**
   * Read touch input state
   */
  private readTouchInput(): InputState {
    if (!this.touchState.active) {
      return { throttle: false, brake: false, steer: 0 };
    }

    const dx = this.touchState.currentX - this.touchState.startX;
    const dy = this.touchState.currentY - this.touchState.startY;

    // Calculate steering from horizontal movement
    let steer = 0;
    if (Math.abs(dx) > this.TOUCH_DEAD_ZONE) {
      steer = Math.max(-1, Math.min(1, dx / this.TOUCH_MAX_DISTANCE));
    }

    // Throttle/brake from vertical movement
    // Up (negative dy) = throttle, Down (positive dy) = brake
    const throttle = dy < -this.TOUCH_DEAD_ZONE;
    const brake = dy > this.TOUCH_DEAD_ZONE;

    return { throttle, brake, steer };
  }

  /**
   * Get current input state
   */
  getInputState(): InputState {
    return { ...this.inputState };
  }

  /**
   * Set external input (from React mobile controls or gamepad)
   */
  setExternalInput(input: InputState | null): void {
    this.externalInput = input;
  }

  /**
   * Check if any input is currently active
   */
  hasActiveInput(): boolean {
    return (
      this.inputState.throttle ||
      this.inputState.brake ||
      this.inputState.steer !== 0
    );
  }

  /**
   * Clean up input handlers
   */
  destroy(): void {
    this.scene.input.off('pointerdown');
    this.scene.input.off('pointermove');
    this.scene.input.off('pointerup');
    this.scene.input.off('pointerout');
  }
}
