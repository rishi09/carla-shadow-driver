import Phaser from 'phaser';
import type { InputState, CarState } from '../../types/game';
import type { Vector2 } from '../../types/track';

/**
 * Car - Arcade-style physics car for Shadow Driver v2
 *
 * Physics Model:
 * - Acceleration: Speed increases when throttle is pressed
 * - Braking: Speed decreases faster when brake is pressed
 * - Friction: Speed naturally decays each frame (drag)
 * - Steering: Turn rate is proportional to speed (can't turn when stopped)
 * - Damage: On collision, damaged state activates with speed reduction
 *
 * Inspired by classic arcade racers for responsive, fun handling.
 */

export type CarType = 'player' | 'ai';

export class Car {
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Rectangle;
  private carType: CarType;

  // Physics properties
  private speed: number = 0;
  private maxSpeed: number = 200;
  private acceleration: number = 100;
  private brakeForce: number = 200;
  private friction: number = 50; // Absolute friction per second
  private turnRate: number = 3;
  private angle: number = 0;

  // Velocity for position updates
  private velocity: Vector2 = { x: 0, y: 0 };

  // Damage state
  private damaged: boolean = false;
  private damageTimer: number = 0;
  private readonly damageDuration: number = 1000; // 1 second in ms
  private readonly damageSpeedReduction: number = 0.3; // 70% reduction = keep 30%

  // Visual feedback
  private flashTimer: number = 0;
  private originalAlpha: number = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, type: CarType = 'player') {
    this.scene = scene;
    this.carType = type;

    // Create a rectangle as placeholder for the car sprite
    // Player: green, AI: red
    const color = type === 'player' ? 0x00ff00 : 0xff0000;
    this.sprite = scene.add.rectangle(x, y, 40, 20, color);
    this.sprite.setStrokeStyle(2, 0xffffff);

    // Player cars are slightly faster
    if (type === 'player') {
      this.maxSpeed = 220;
      this.acceleration = 120;
    } else {
      this.maxSpeed = 200;
      this.acceleration = 100;
    }

    this.originalAlpha = this.sprite.alpha;
  }

  /**
   * Update car physics and state
   * @param input - Current input state (throttle, brake, steer)
   * @param delta - Time elapsed since last frame in ms
   */
  update(input: InputState, delta: number): void {
    const dt = delta / 1000; // Convert to seconds

    // Handle damage state
    if (this.damaged) {
      this.damageTimer -= delta;
      if (this.damageTimer <= 0) {
        this.damaged = false;
        this.sprite.setAlpha(this.originalAlpha);
      } else {
        // Flash effect while damaged
        this.flashTimer += delta;
        if (this.flashTimer > 100) {
          this.flashTimer = 0;
          this.sprite.setAlpha(this.sprite.alpha === 1 ? 0.5 : 1);
        }
      }
    }

    // Apply steering (proportional to speed for realistic feel)
    // At low speeds, turning is minimal; at high speeds, more responsive
    if (Math.abs(this.speed) > 10) {
      const speedFactor = Math.abs(this.speed) / this.maxSpeed;
      const turnDirection = this.speed >= 0 ? 1 : -1; // Reverse steering when going backwards
      const effectiveTurnRate = this.turnRate * speedFactor;
      this.angle += input.steer * effectiveTurnRate * turnDirection * dt;
    }

    // Apply acceleration/braking
    if (input.throttle && !this.damaged) {
      this.speed = Math.min(this.speed + this.acceleration * dt, this.maxSpeed);
    } else if (input.brake) {
      // Allow braking to reverse
      this.speed = Math.max(this.speed - this.brakeForce * dt, -this.maxSpeed * 0.3);
    } else {
      // Apply friction (natural speed decay)
      if (this.speed > 0) {
        this.speed = Math.max(this.speed - this.friction * dt, 0);
      } else if (this.speed < 0) {
        this.speed = Math.min(this.speed + this.friction * dt, 0);
      }
    }

    // Calculate velocity from speed and angle
    this.velocity.x = Math.cos(this.angle) * this.speed;
    this.velocity.y = Math.sin(this.angle) * this.speed;

    // Update position
    this.sprite.x += this.velocity.x * dt;
    this.sprite.y += this.velocity.y * dt;
    this.sprite.rotation = this.angle;
  }

  /**
   * Handle collision with boundaries or obstacles
   * @param type - Type of collision
   */
  onCollision(type: 'boundary' | 'obstacle' | 'wall' | 'car'): void {
    if (this.damaged) return; // Already damaged, ignore

    this.damaged = true;
    this.damageTimer = this.damageDuration;
    this.flashTimer = 0;

    // Reduce speed by 70%
    this.speed *= this.damageSpeedReduction;

    // Visual feedback with tween
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0.5,
      duration: 100,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        if (!this.damaged) {
          this.sprite.setAlpha(this.originalAlpha);
        }
      },
    });

    // Screen shake effect for impact feel
    if (type === 'obstacle' || type === 'car') {
      this.scene.cameras.main.shake(200, 0.01);
    } else {
      this.scene.cameras.main.shake(100, 0.005);
    }
  }

  /**
   * Get current car state for external systems
   */
  getState(): CarState {
    return {
      x: this.sprite.x,
      y: this.sprite.y,
      angle: this.angle,
      speed: this.speed,
      damaged: this.damaged,
    };
  }

  /**
   * Get current position
   */
  getPosition(): Vector2 {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  /**
   * Get the underlying Phaser game object
   */
  getGameObject(): Phaser.GameObjects.Rectangle {
    return this.sprite;
  }

  /**
   * Set car angle (for start line positioning)
   */
  setAngle(angle: number): void {
    this.angle = angle;
    this.sprite.rotation = angle;
  }

  /**
   * Get car type
   */
  getCarType(): CarType {
    return this.carType;
  }

  /**
   * Get current speed (for HUD display)
   */
  getSpeed(): number {
    return this.speed;
  }

  /**
   * Check if car is currently damaged
   */
  isDamaged(): boolean {
    return this.damaged;
  }

  /**
   * Reset car to initial state
   */
  reset(x: number, y: number, angle: number = 0): void {
    this.sprite.setPosition(x, y);
    this.angle = angle;
    this.sprite.rotation = angle;
    this.speed = 0;
    this.velocity = { x: 0, y: 0 };
    this.damaged = false;
    this.damageTimer = 0;
    this.sprite.setAlpha(this.originalAlpha);
  }

  /**
   * Set max speed (for power-ups or difficulty adjustments)
   */
  setMaxSpeed(maxSpeed: number): void {
    this.maxSpeed = maxSpeed;
  }

  /**
   * Destroy the car and clean up resources
   */
  destroy(): void {
    this.sprite.destroy();
  }

  /**
   * Get physics constants for debugging/tuning
   */
  getPhysicsConfig(): {
    maxSpeed: number;
    acceleration: number;
    brakeForce: number;
    friction: number;
    turnRate: number;
  } {
    return {
      maxSpeed: this.maxSpeed,
      acceleration: this.acceleration,
      brakeForce: this.brakeForce,
      friction: this.friction,
      turnRate: this.turnRate,
    };
  }
}
