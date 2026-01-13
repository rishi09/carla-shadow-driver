import Phaser from 'phaser';
import { Car } from '../objects/Car';
import { TrackRenderer } from '../objects/TrackRenderer';
import { CollisionSystem } from '../systems/CollisionSystem';
import { ScoringSystem } from '../systems/ScoringSystem';
import { AIController } from '../systems/AIController';
import { InputManager } from '../systems/InputManager';
import type { TrackData } from '../../types/track';
import type {
  GameMode,
  Difficulty,
  RaceSceneData,
  RaceHUDState,
  InputState,
} from '../../types/game';

type RaceState = 'loading' | 'countdown' | 'racing' | 'finished';

// ============================================================================
// Event Contract: React <-> Phaser GPU Integration
// ============================================================================
//
// This scene implements the Phaser side of the GPU AI integration.
//
// Events this scene LISTENS to (via game.events):
//
// 1. 'gpuPrediction'
//    Payload: { steering: number, throttle?: number, brake?: number }
//    Action: Store prediction for use in next AI car update
//
// 2. 'setGPUMode'
//    Payload: { enabled: boolean }
//    Action: Toggle between GPU predictions and local AIController
//
// Events this scene EMITS (via game.events):
//
// 1. 'aiGameState'
//    Payload: { position: number, speed: number, curvature: number }
//    Frequency: Every frame when racing with AI car
//    Purpose: React will forward to GPU at 10Hz
//
// ============================================================================

/** GPU prediction data from React */
interface GPUPrediction {
  steering: number;
  throttle?: number;
  brake?: number;
}

/**
 * RaceScene - The main gameplay scene
 *
 * This scene is the core of the game, integrating all game systems:
 * - Track rendering
 * - Car physics and rendering
 * - Input handling
 * - Collision detection
 * - Scoring and lap tracking
 * - AI opponent control
 * - Communication with React HUD
 */
export class RaceScene extends Phaser.Scene {
  // Configuration
  private trackId: string = 'track1';
  private gameMode: GameMode = 'time-trial';
  private difficulty: Difficulty = 'medium';

  // Game objects
  private player!: Car;
  private aiCar?: Car;
  private trackRenderer!: TrackRenderer;

  // Systems
  private collisionSystem!: CollisionSystem;
  private playerScoring!: ScoringSystem;
  private aiScoring?: ScoringSystem;
  private aiController?: AIController;
  private inputManager!: InputManager;

  // State
  private trackData!: TrackData;
  private raceState: RaceState = 'loading';
  private countdownValue: number = 3;
  private penaltyFlashTimer: number = 0;

  // UI elements (Phaser-based countdown, can be replaced with React overlay)
  private countdownText?: Phaser.GameObjects.Text;

  // Track last checkpoint to avoid double-counting
  private lastPlayerCheckpoint: number = -1;
  private lastAICheckpoint: number = -1;

  // Track finish line crossing (simple debounce)
  private playerCrossedFinish: boolean = false;
  private aiCrossedFinish: boolean = false;

  // GPU AI Integration state
  private useGPUMode: boolean = false;
  private lastGPUPrediction: GPUPrediction | null = null;
  private gpuPredictionAge: number = 0; // ms since last prediction
  private readonly GPU_PREDICTION_TIMEOUT = 500; // Fallback to local AI if no prediction in 500ms

  constructor() {
    super({ key: 'RaceScene' });
  }

  /**
   * Scene initialization - receives data from scene.start()
   */
  init(data: RaceSceneData): void {
    this.trackId = data.trackId || 'track1';
    this.gameMode = data.mode || 'time-trial';
    this.difficulty = data.difficulty || 'medium';
    this.raceState = 'loading';

    // Reset state for scene restart
    this.lastPlayerCheckpoint = -1;
    this.lastAICheckpoint = -1;
    this.playerCrossedFinish = false;
    this.aiCrossedFinish = false;
  }

  /**
   * Asset loading
   */
  preload(): void {
    // Load track JSON from public assets
    this.load.json('track', `/assets/tracks/${this.trackId}.json`);
  }

  /**
   * Scene creation - set up all game objects and systems
   */
  create(): void {
    // 1. Get track data from cache
    this.trackData = this.cache.json.get('track') as TrackData;

    // If no track data loaded, create a default track for testing
    if (!this.trackData) {
      this.trackData = this.createDefaultTrack();
    }

    // 2. Render track
    this.trackRenderer = new TrackRenderer(this, this.trackData);
    this.trackRenderer.render();

    // 3. Create collision system
    this.collisionSystem = new CollisionSystem(this, this.trackData);

    // 4. Create player car
    this.player = new Car(
      this,
      this.trackData.startPosition.x,
      this.trackData.startPosition.y,
      'player'
    );
    this.player.setAngle(this.trackData.startAngle);

    // 5. Create scoring system
    this.playerScoring = new ScoringSystem(
      this.trackData.checkpoints.length,
      this.trackData.laps
    );

    // 6. Create AI car and controller if head-to-head mode
    if (this.gameMode === 'head-to-head') {
      this.aiCar = new Car(
        this,
        this.trackData.aiStartPosition.x,
        this.trackData.aiStartPosition.y,
        'ai'
      );
      this.aiCar.setAngle(this.trackData.aiStartAngle);

      this.aiController = new AIController(
        this.aiCar,
        this.trackData,
        this.difficulty
      );

      this.aiScoring = new ScoringSystem(
        this.trackData.checkpoints.length,
        this.trackData.laps
      );
    }

    // 7. Set up input manager
    this.inputManager = new InputManager(this);

    // 8. Create countdown text
    this.createCountdownUI();

    // 9. Start countdown
    this.startCountdown();

    // 10. Signal React that scene is ready
    this.emitSceneReady();

    // 11. Set up GPU event listeners (via game.events, not scene.events)
    this.setupGPUEventListeners();
  }

  /**
   * Set up event listeners for GPU AI integration
   * Uses game.events for cross-boundary communication with React
   */
  private setupGPUEventListeners(): void {
    // Listen for GPU mode toggle from React
    this.game.events.on('setGPUMode', (data: { enabled: boolean }) => {
      this.useGPUMode = data.enabled;
      console.log(`[RaceScene] GPU mode ${data.enabled ? 'enabled' : 'disabled'}`);

      // Reset prediction state when mode changes
      if (!data.enabled) {
        this.lastGPUPrediction = null;
        this.gpuPredictionAge = 0;
      }
    });

    // Listen for GPU predictions from React
    this.game.events.on('gpuPrediction', (prediction: GPUPrediction) => {
      this.lastGPUPrediction = prediction;
      this.gpuPredictionAge = 0; // Reset age on new prediction
    });
  }

  /**
   * Create a default track for testing when no JSON is loaded
   */
  private createDefaultTrack(): TrackData {
    return {
      id: 'default',
      name: 'Test Track',
      description: 'A default test track for development',
      difficulty: 'easy',
      centerLine: [
        { x: 100, y: 300 },
        { x: 200, y: 200 },
        { x: 400, y: 150 },
        { x: 600, y: 200 },
        { x: 700, y: 300 },
        { x: 700, y: 400 },
        { x: 600, y: 500 },
        { x: 400, y: 520 },
        { x: 200, y: 480 },
        { x: 100, y: 400 },
      ],
      width: 80,
      boundaries: {
        outer: [
          { x: 50, y: 250 },
          { x: 150, y: 150 },
          { x: 400, y: 100 },
          { x: 650, y: 150 },
          { x: 750, y: 250 },
          { x: 750, y: 450 },
          { x: 650, y: 550 },
          { x: 400, y: 570 },
          { x: 150, y: 530 },
          { x: 50, y: 430 },
        ],
        inner: [
          { x: 150, y: 300 },
          { x: 230, y: 230 },
          { x: 400, y: 200 },
          { x: 570, y: 230 },
          { x: 630, y: 300 },
          { x: 630, y: 380 },
          { x: 570, y: 450 },
          { x: 400, y: 470 },
          { x: 230, y: 440 },
          { x: 150, y: 370 },
        ],
      },
      laps: 3,
      startPosition: { x: 100, y: 350 },
      startAngle: 0,
      aiStartPosition: { x: 100, y: 320 },
      aiStartAngle: 0,
      checkpoints: [
        { id: 0, position: { x: 400, y: 150 }, width: 80, angle: Math.PI / 2 },
        { id: 1, position: { x: 700, y: 350 }, width: 80, angle: 0 },
        { id: 2, position: { x: 400, y: 520 }, width: 80, angle: Math.PI / 2 },
      ],
      finishLine: {
        position: { x: 100, y: 350 },
        width: 80,
        angle: 0,
      },
      obstacles: [],
      parTime: 90000, // 90 seconds
      goldTime: 75000, // 75 seconds
      backgroundColor: '#2d5016',
      trackColor: '#444444',
      borderColor: '#ffffff',
    };
  }

  /**
   * Create countdown UI elements
   */
  private createCountdownUI(): void {
    this.countdownText = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      '',
      {
        font: 'bold 72px Arial',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      }
    );
    this.countdownText.setOrigin(0.5, 0.5);
    this.countdownText.setDepth(100);
  }

  /**
   * Start the countdown sequence
   */
  private startCountdown(): void {
    this.raceState = 'countdown';
    this.countdownValue = 3;
    this.updateCountdownDisplay();

    // Countdown timer
    this.time.addEvent({
      delay: 1000,
      repeat: 3,
      callback: () => {
        this.countdownValue--;
        if (this.countdownValue > 0) {
          this.updateCountdownDisplay();
        } else if (this.countdownValue === 0) {
          this.countdownText?.setText('GO!');
          this.events.emit('countdownUpdate', 'GO!');
        } else {
          // Countdown complete, start race
          this.countdownText?.setVisible(false);
          this.startRace();
        }
      },
    });
  }

  /**
   * Update countdown display
   */
  private updateCountdownDisplay(): void {
    this.countdownText?.setText(this.countdownValue.toString());
    this.events.emit('countdownUpdate', this.countdownValue.toString());

    // Pulse animation
    this.tweens.add({
      targets: this.countdownText,
      scale: { from: 1.5, to: 1 },
      duration: 300,
      ease: 'Power2',
    });
  }

  /**
   * Start the race
   */
  private startRace(): void {
    this.raceState = 'racing';
    const now = this.time.now;

    this.playerScoring.startRace(now);
    if (this.aiScoring) {
      this.aiScoring.startRace(now);
    }

    this.events.emit('raceStart');
  }

  /**
   * Main game loop update
   */
  update(time: number, delta: number): void {
    // Update input manager first
    this.inputManager.update();

    // Only run game logic during racing
    if (this.raceState !== 'racing') {
      this.emitGameState(time);
      return;
    }

    // 1. Get input state
    const inputState = this.inputManager.getInputState();

    // 2. Update player car
    this.player.update(inputState, delta);

    // 3. Update AI car
    if (this.aiCar && this.aiController) {
      // Update GPU prediction age
      this.gpuPredictionAge += delta;

      // Emit AI game state for GPU (React will throttle to 10Hz)
      this.emitAIGameState();

      // Determine input source: GPU prediction or local AI
      let aiInput: InputState;

      if (this.useGPUMode && this.lastGPUPrediction && this.gpuPredictionAge < this.GPU_PREDICTION_TIMEOUT) {
        // Use GPU prediction - convert to InputState format
        aiInput = {
          steer: this.lastGPUPrediction.steering,
          throttle: this.lastGPUPrediction.throttle !== undefined
            ? this.lastGPUPrediction.throttle > 0.3
            : true, // Default to throttle if not provided
          brake: this.lastGPUPrediction.brake !== undefined
            ? this.lastGPUPrediction.brake > 0.3
            : false,
        };
      } else {
        // Use local AIController as fallback
        aiInput = this.aiController.compute();
      }

      this.aiCar.update(aiInput, delta);
    }

    // 4. Check collisions
    this.checkCollisions();

    // 5. Check race progress
    this.checkProgress(time);

    // 6. Update penalty flash timer
    if (this.penaltyFlashTimer > 0) {
      this.penaltyFlashTimer -= delta;
    }

    // 7. Emit game state to React
    this.emitGameState(time);

    // 8. Check for race completion
    this.checkRaceCompletion();
  }

  /**
   * Check and handle collisions
   */
  private checkCollisions(): void {
    // Check player collision with track boundaries
    const playerCollision = this.collisionSystem.checkCollision(this.player);
    if (playerCollision.collided && playerCollision.type !== 'none') {
      this.player.onCollision(playerCollision.type);
      this.playerScoring.addCrashPenalty();
      this.triggerPenaltyFlash();
    }

    // Check if player is off track
    if (!this.collisionSystem.isOnTrack(this.player.getPosition())) {
      this.playerScoring.addOffTrackTime(this.game.loop.delta);
    }

    // Check AI car collisions
    if (this.aiCar && this.aiScoring) {
      const aiCollision = this.collisionSystem.checkCollision(this.aiCar);
      if (aiCollision.collided && aiCollision.type !== 'none') {
        this.aiCar.onCollision(aiCollision.type);
        this.aiScoring.addCrashPenalty();
      }

      // Check car-to-car collision
      const carCollision = this.collisionSystem.checkCarCollision(
        this.player,
        this.aiCar
      );
      if (carCollision.collided) {
        this.player.onCollision('car');
        this.aiCar.onCollision('car');
        this.triggerPenaltyFlash();
      }
    }
  }

  /**
   * Check checkpoint and lap progress
   */
  private checkProgress(time: number): void {
    // Check player checkpoints
    for (const checkpoint of this.trackData.checkpoints) {
      if (
        checkpoint.id === this.lastPlayerCheckpoint + 1 &&
        this.collisionSystem.checkCheckpointCrossing(this.player, checkpoint.id)
      ) {
        if (this.playerScoring.hitCheckpoint(checkpoint.id)) {
          this.lastPlayerCheckpoint = checkpoint.id;
          this.events.emit('checkpointHit', {
            player: true,
            checkpointId: checkpoint.id,
          });
        }
      }
    }

    // Check player finish line
    if (
      !this.playerCrossedFinish &&
      this.lastPlayerCheckpoint === this.trackData.checkpoints.length - 1 &&
      this.collisionSystem.checkFinishLineCrossing(this.player)
    ) {
      this.playerCrossedFinish = true;
      const lapComplete = this.playerScoring.completeLap(time);
      if (lapComplete) {
        this.lastPlayerCheckpoint = -1;
        this.events.emit('lapComplete', {
          player: true,
          lap: this.playerScoring.getCurrentLap() - 1,
        });

        // Reset crossing flag after brief delay
        this.time.delayedCall(500, () => {
          this.playerCrossedFinish = false;
        });
      }
    }

    // Check AI progress
    if (this.aiCar && this.aiScoring) {
      for (const checkpoint of this.trackData.checkpoints) {
        if (
          checkpoint.id === this.lastAICheckpoint + 1 &&
          this.collisionSystem.checkCheckpointCrossing(this.aiCar, checkpoint.id)
        ) {
          if (this.aiScoring.hitCheckpoint(checkpoint.id)) {
            this.lastAICheckpoint = checkpoint.id;
          }
        }
      }

      // Check AI finish line
      if (
        !this.aiCrossedFinish &&
        this.lastAICheckpoint === this.trackData.checkpoints.length - 1 &&
        this.collisionSystem.checkFinishLineCrossing(this.aiCar)
      ) {
        this.aiCrossedFinish = true;
        this.aiScoring.completeLap(time);
        this.lastAICheckpoint = -1;

        this.time.delayedCall(500, () => {
          this.aiCrossedFinish = false;
        });
      }
    }
  }

  /**
   * Check if race is complete
   */
  private checkRaceCompletion(): void {
    const playerFinished = this.playerScoring.isRaceFinished();
    const aiFinished = this.aiScoring?.isRaceFinished() ?? true;

    if (playerFinished && aiFinished) {
      this.finishRace();
    }
  }

  /**
   * Finish the race
   */
  private finishRace(): void {
    this.raceState = 'finished';

    // Calculate positions
    const playerResult = this.playerScoring.getRaceResult();
    const aiResult = this.aiScoring?.getRaceResult();

    if (aiResult) {
      if (playerResult.finalTime < aiResult.finalTime) {
        playerResult.position = 1;
        aiResult.position = 2;
      } else {
        playerResult.position = 2;
        aiResult.position = 1;
      }
    } else {
      playerResult.position = 1;
    }

    // Emit race complete event
    this.events.emit('raceComplete', {
      playerResult,
      aiResult,
      winner: playerResult.position === 1 ? 'player' : 'ai',
    });
  }

  /**
   * Trigger a penalty flash effect
   */
  private triggerPenaltyFlash(): void {
    this.penaltyFlashTimer = 300; // 300ms flash
  }

  /**
   * Calculate player's current position (1st or 2nd)
   */
  private calculatePosition(): 1 | 2 {
    if (!this.aiScoring) return 1;

    const playerProgress =
      this.playerScoring.getCurrentLap() * 1000 +
      this.playerScoring.getCheckpointsHit();
    const aiProgress =
      this.aiScoring.getCurrentLap() * 1000 + this.aiScoring.getCheckpointsHit();

    return playerProgress >= aiProgress ? 1 : 2;
  }

  /**
   * Emit current game state to React HUD
   */
  private emitGameState(time: number): void {
    const hudState: RaceHUDState = {
      speed: Math.abs(this.player?.getState().speed ?? 0),
      lapNumber: this.playerScoring?.getCurrentLap() ?? 1,
      totalLaps: this.trackData?.laps ?? 3,
      currentLapTime: this.playerScoring?.getCurrentLapTime(time) ?? 0,
      bestLapTime: this.playerScoring?.getBestLapTime() ?? null,
      position: this.calculatePosition(),
      checkpoints: this.playerScoring?.getCheckpointsHit() ?? 0,
      totalCheckpoints: this.trackData?.checkpoints.length ?? 0,
      penaltyFlash: this.penaltyFlashTimer > 0,
      gameMode: this.gameMode,
      raceState: this.raceState === 'loading' ? 'countdown' : this.raceState,
    };

    this.events.emit('gameState', hudState);
  }

  /**
   * Emit scene ready event
   */
  private emitSceneReady(): void {
    this.events.emit('sceneReady', {
      trackName: this.trackData.name,
      gameMode: this.gameMode,
      laps: this.trackData.laps,
    });
  }

  /**
   * Emit AI car game state for GPU processing
   *
   * This is called every frame when racing with an AI car.
   * React will throttle the actual GPU sends to 10Hz.
   *
   * Uses game.events (not scene.events) for cross-boundary communication.
   */
  private emitAIGameState(): void {
    if (!this.aiCar || !this.aiController) {
      return;
    }

    const aiCarState = this.aiCar.getState();

    // Calculate position and curvature using AIController's internal methods
    // We need to access the track-relative position for the GPU model
    // Since AIController.calculateTrackPosition is private, we'll compute it here
    const position = this.calculateAITrackPosition(aiCarState);
    const curvature = this.calculateAICurvature(aiCarState);

    // Emit via game.events for React to receive
    this.game.events.emit('aiGameState', {
      position,
      speed: aiCarState.speed,
      curvature,
    });
  }

  /**
   * Calculate AI car's position relative to track centerline
   * @returns -1 (left edge) to 1 (right edge), 0 = on centerline
   */
  private calculateAITrackPosition(carState: { x: number; y: number }): number {
    const centerLine = this.trackData.centerLine;
    if (centerLine.length < 2) {
      return 0;
    }

    // Find closest segment and signed distance
    let closestDist = Infinity;
    let signedDist = 0;

    for (let i = 0; i < centerLine.length - 1; i++) {
      const p1 = centerLine[i];
      const p2 = centerLine[i + 1];

      const { distance, signed } = this.projectPointOnSegment(
        { x: carState.x, y: carState.y },
        p1,
        p2
      );

      if (distance < closestDist) {
        closestDist = distance;
        signedDist = signed;
      }
    }

    // Normalize to -1 to 1 based on track half-width
    const halfWidth = this.trackData.width / 2;
    const normalizedPosition = signedDist / halfWidth;
    return Math.max(-1, Math.min(1, normalizedPosition));
  }

  /**
   * Calculate upcoming track curvature for AI car
   * @returns Negative = left curve, positive = right curve, 0 = straight
   */
  private calculateAICurvature(carState: { x: number; y: number }): number {
    const centerLine = this.trackData.centerLine;
    if (centerLine.length < 3) {
      return 0;
    }

    // Find closest segment
    let closestDist = Infinity;
    let closestSegment = 0;

    for (let i = 0; i < centerLine.length - 1; i++) {
      const p1 = centerLine[i];
      const p2 = centerLine[i + 1];
      const { distance } = this.projectPointOnSegment(
        { x: carState.x, y: carState.y },
        p1,
        p2
      );
      if (distance < closestDist) {
        closestDist = distance;
        closestSegment = i;
      }
    }

    // Look at upcoming segments
    let totalAngleChange = 0;
    let sampleCount = 0;
    const curvatureSamples = 5;

    for (
      let i = closestSegment;
      i < Math.min(closestSegment + curvatureSamples, centerLine.length - 2);
      i++
    ) {
      const p1 = centerLine[i];
      const p2 = centerLine[i + 1];
      const p3 = centerLine[Math.min(i + 2, centerLine.length - 1)];

      const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const angle2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);

      let angleChange = angle2 - angle1;
      while (angleChange > Math.PI) angleChange -= 2 * Math.PI;
      while (angleChange < -Math.PI) angleChange += 2 * Math.PI;

      totalAngleChange += angleChange;
      sampleCount++;
    }

    if (sampleCount === 0) {
      return 0;
    }

    const avgCurvature = totalAngleChange / sampleCount;
    return Math.max(-1, Math.min(1, avgCurvature * 2));
  }

  /**
   * Project a point onto a line segment
   */
  private projectPointOnSegment(
    point: { x: number; y: number },
    segStart: { x: number; y: number },
    segEnd: { x: number; y: number }
  ): { point: { x: number; y: number }; distance: number; signed: number } {
    const dx = segEnd.x - segStart.x;
    const dy = segEnd.y - segStart.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
      const dist = Math.sqrt(
        Math.pow(point.x - segStart.x, 2) + Math.pow(point.y - segStart.y, 2)
      );
      return { point: { x: segStart.x, y: segStart.y }, distance: dist, signed: 0 };
    }

    let t =
      ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const projX = segStart.x + t * dx;
    const projY = segStart.y + t * dy;

    const distance = Math.sqrt(
      Math.pow(point.x - projX, 2) + Math.pow(point.y - projY, 2)
    );

    // Signed distance: positive = right of segment, negative = left
    const cross = dx * (point.y - segStart.y) - dy * (point.x - segStart.x);
    const signed = cross >= 0 ? distance : -distance;

    return { point: { x: projX, y: projY }, distance, signed };
  }

  /**
   * Set external input from React mobile controls
   */
  setExternalInput(input: InputState | null): void {
    this.inputManager?.setExternalInput(input);
  }

  /**
   * Pause the race
   */
  pause(): void {
    this.scene.pause();
    this.events.emit('gamePaused');
  }

  /**
   * Resume the race
   */
  resume(): void {
    this.scene.resume();
    this.events.emit('gameResumed');
  }

  /**
   * Restart the race
   */
  restart(): void {
    this.scene.restart({
      trackId: this.trackId,
      mode: this.gameMode,
      difficulty: this.difficulty,
    });
  }

  /**
   * Clean up when scene shuts down
   */
  shutdown(): void {
    // Clean up GPU event listeners
    this.game.events.off('setGPUMode');
    this.game.events.off('gpuPrediction');

    this.inputManager?.destroy();
    this.player?.destroy();
    this.aiCar?.destroy();
    this.trackRenderer?.destroy();
    this.countdownText?.destroy();
  }
}
