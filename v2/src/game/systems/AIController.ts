/**
 * AIController.ts - AI Driver Models for Shadow Driver v2
 *
 * Ported from the original demo_visual_car.html (lines 524-604)
 * Adapted for top-down track view instead of pseudo-3D forward view.
 *
 * Key adaptations:
 * - "position" = perpendicular distance from track centerline (-1 to 1)
 * - "curvature" = angle change in upcoming centerline segments
 * - Obstacle distances are in game units (not screen pixels)
 *
 * This implementation includes 5 AI personality models:
 * - PilotNet (NVIDIA): Smooth, centered driving
 * - Alpamayo Style: Anticipatory, smoother curves
 * - Aggressive Driver: Tight corners, late reactions
 * - Cautious Driver: Wide margins, early reactions
 * - Drunk Driver: Wobbly, unpredictable (for fun)
 */

import type { InputState, CarState } from '../../types/game';
import type { TrackData, Vector2 } from '../../types/track';
import { Car } from '../objects/Car';

// ============================================================================
// Types
// ============================================================================

/** AI model personality types */
export type AIModelType = 'pilotnet' | 'alpamayo' | 'aggressive' | 'cautious' | 'drunk';

/** Difficulty levels that map to AI behavior */
export type AIDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Internal input state for AI model computation
 * Note: This uses normalized 0-1 values for throttle/brake internally,
 * then converts to boolean for the actual InputState output
 */
export interface AIInputState {
  /** Track position: -1 (left edge) to 1 (right edge), 0 = centerline */
  position: number;
  /** Upcoming track curvature: negative = left curve, positive = right curve */
  curvature: number;
  /** Current speed (in game units/second) */
  speed: number;
  /** Visible obstacles ahead */
  obstacles: Array<{ distance: number; lane: number }>;
  /** Game time in seconds (used for time-based behaviors like wobble) */
  time: number;
}

/**
 * Internal output from AI model computation
 */
interface AIOutput {
  /** Steering: -1 (full left) to 1 (full right) */
  steer: number;
  /** Throttle: 0 (none) to 1 (full) */
  throttle: number;
  /** Brake: 0 (none) to 1 (full) */
  brake: number;
}

/**
 * AI Model definition
 */
interface AIModel {
  name: string;
  description: string;
  compute: (state: AIInputState) => AIOutput;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Clamps a value between -1 and 1
 */
function clampSteer(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Clamps a value between 0 and 1
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ============================================================================
// AI Models
// ============================================================================

/**
 * All available AI models
 *
 * Each model computes steering based on:
 * - position: correction to stay centered
 * - curvature: anticipation of upcoming curves
 * - obstacles: avoidance maneuvers
 * - time: model-specific temporal behaviors
 */
export const AI_MODELS: Record<AIModelType, AIModel> = {
  /**
   * PilotNet (NVIDIA) - End-to-end CNN simulation
   * Characteristics: Smooth, centered driving with moderate reactions
   */
  pilotnet: {
    name: 'PilotNet (NVIDIA)',
    description: 'End-to-end CNN, smooth steering',
    compute: (state: AIInputState): AIOutput => {
      // Position correction: strong pull toward centerline
      let steer = -state.position * 0.9;

      // Curve anticipation: moderate response to upcoming curvature
      steer += state.curvature * 0.7;

      // Subtle temporal variation (simulates sensor noise)
      steer += Math.sin(state.time * 0.1) * 0.03;

      // Obstacle avoidance: moderate reaction distance
      for (const obs of state.obstacles) {
        if (obs.distance < 150 && obs.distance > 50) {
          // Check if obstacle is in our path
          if (Math.abs(obs.lane * 0.3 - state.position) < 0.2) {
            steer += obs.lane > 0 ? -0.4 : 0.4;
          }
        }
      }

      // Speed-based throttle/brake (maintain moderate speed)
      const targetSpeed = 210; // ~70% of max speed (300)
      const throttle = state.speed < targetSpeed ? 0.8 : 0.3;
      const brake = state.speed > targetSpeed + 60 ? 0.3 : 0;

      return {
        steer: clampSteer(steer),
        throttle: clamp01(throttle),
        brake: clamp01(brake),
      };
    },
  },

  /**
   * Alpamayo Style - VLA model with trajectory planning
   * Characteristics: Smoother, more anticipatory, predicts curves ahead
   */
  alpamayo: {
    name: 'Alpamayo Style',
    description: 'VLA model with trajectory planning',
    compute: (state: AIInputState): AIOutput => {
      // Softer position correction for smoother driving
      let steer = -state.position * 0.7;

      // Strong curve following - anticipates curves earlier
      steer += state.curvature * 1.2;

      // Minimal temporal noise for stability
      steer += Math.sin(state.time * 0.05) * 0.01;

      // Early obstacle avoidance with gradual response
      for (const obs of state.obstacles) {
        if (obs.distance < 250 && obs.distance > 30) {
          const urgency = 1 - obs.distance / 250;
          steer += (obs.lane > 0 ? -0.5 : 0.5) * urgency;
        }
      }

      // Smoother output scaling
      steer *= 0.85;

      // Conservative speed management
      const targetSpeed = 195; // ~65% of max speed
      const throttle = state.speed < targetSpeed ? 0.7 : 0.4;
      const brake = state.speed > targetSpeed + 45 ? 0.25 : 0;

      return {
        steer: clampSteer(steer),
        throttle: clamp01(throttle),
        brake: clamp01(brake),
      };
    },
  },

  /**
   * Aggressive Driver - Tight corners, late braking
   * Characteristics: Sharp reactions, close obstacle avoidance
   */
  aggressive: {
    name: 'Aggressive Driver',
    description: 'Tight corners, late braking',
    compute: (state: AIInputState): AIOutput => {
      // Strong position correction - snappy steering
      let steer = -state.position * 1.3;

      // Moderate curve response
      steer += state.curvature * 0.9;

      // Late obstacle avoidance - waits until close
      for (const obs of state.obstacles) {
        if (obs.distance < 100 && obs.distance > 30) {
          steer += obs.lane > 0 ? -0.7 : 0.7;
        }
      }

      // High speed preference
      const targetSpeed = 270; // ~90% of max speed
      const throttle = state.speed < targetSpeed ? 1.0 : 0.5;
      const brake = state.speed > targetSpeed + 30 ? 0.6 : 0;

      return {
        steer: clampSteer(steer),
        throttle: clamp01(throttle),
        brake: clamp01(brake),
      };
    },
  },

  /**
   * Cautious Driver - Wide margins, early reactions
   * Characteristics: Gentle steering, early obstacle detection
   */
  cautious: {
    name: 'Cautious Driver',
    description: 'Wide margins, early reactions',
    compute: (state: AIInputState): AIOutput => {
      // Gentle position correction
      let steer = -state.position * 0.5;

      // Mild curve response
      steer += state.curvature * 0.4;

      // Very early obstacle avoidance
      for (const obs of state.obstacles) {
        if (obs.distance < 300 && obs.distance > 50) {
          steer += obs.lane > 0 ? -0.3 : 0.3;
        }
      }

      // Conservative speed
      const targetSpeed = 150; // ~50% of max speed
      const throttle = state.speed < targetSpeed ? 0.5 : 0.2;
      const brake = state.speed > targetSpeed + 30 ? 0.4 : 0;

      return {
        steer: clampSteer(steer),
        throttle: clamp01(throttle),
        brake: clamp01(brake),
      };
    },
  },

  /**
   * Drunk Driver - Unpredictable, wobbly steering
   * Characteristics: Random wobble, delayed reactions (for fun!)
   */
  drunk: {
    name: 'Drunk Driver',
    description: 'Unpredictable, wobbly steering',
    compute: (state: AIInputState): AIOutput => {
      // Weak position correction
      let steer = -state.position * 0.4;

      // Weak curve response
      steer += state.curvature * 0.3;

      // Random wobble using multiple sine waves at different frequencies
      steer += Math.sin(state.time * 0.3) * 0.4;
      steer += Math.sin(state.time * 0.17) * 0.3;

      // Very delayed obstacle reaction
      for (const obs of state.obstacles) {
        if (obs.distance < 80 && obs.distance > 20) {
          steer += obs.lane > 0 ? -0.6 : 0.6;
        }
      }

      // Erratic speed control
      const wobbleThrottle = 0.5 + Math.sin(state.time * 0.23) * 0.3;
      const throttle = wobbleThrottle;
      const brake = Math.random() < 0.02 ? 0.5 : 0; // Random braking moments

      return {
        steer: clampSteer(steer),
        throttle: clamp01(throttle),
        brake: clamp01(brake),
      };
    },
  },
};

// ============================================================================
// Difficulty to Model Mapping
// ============================================================================

/**
 * Maps difficulty levels to AI model types
 */
const DIFFICULTY_TO_MODEL: Record<AIDifficulty, AIModelType> = {
  easy: 'cautious',
  medium: 'pilotnet',
  hard: 'aggressive',
};

/**
 * Speed modifiers per difficulty
 */
const DIFFICULTY_SPEED_MODIFIERS: Record<AIDifficulty, number> = {
  easy: 0.7,
  medium: 0.85,
  hard: 1.0,
};

/**
 * Precision modifiers per difficulty (higher = more accurate steering)
 */
const DIFFICULTY_PRECISION: Record<AIDifficulty, number> = {
  easy: 0.8,
  medium: 0.9,
  hard: 0.98,
};

// ============================================================================
// AIController Class
// ============================================================================

/**
 * AIController manages AI-driven car behavior
 *
 * This controller adapts the original pseudo-3D AI models for a top-down view:
 * - Position is calculated as perpendicular distance from track centerline
 * - Curvature is calculated from the angle change in upcoming segments
 * - Obstacle distances are in game world units
 */
export class AIController {
  private car: Car;
  private trackData: TrackData;
  private difficulty: AIDifficulty;
  private modelType: AIModelType;
  private time: number = 0;

  /** Number of segments ahead to check for curvature */
  private curvatureSamples: number = 5;

  constructor(car: Car, trackData: TrackData, difficulty: AIDifficulty = 'medium') {
    this.car = car;
    this.trackData = trackData;
    this.difficulty = difficulty;
    this.modelType = DIFFICULTY_TO_MODEL[difficulty];
  }

  /**
   * Set the AI difficulty (affects model selection and behavior)
   */
  setDifficulty(difficulty: AIDifficulty): void {
    this.difficulty = difficulty;
    this.modelType = DIFFICULTY_TO_MODEL[difficulty];
  }

  /**
   * Get current difficulty
   */
  getDifficulty(): AIDifficulty {
    return this.difficulty;
  }

  /**
   * Set the AI model type directly (overrides difficulty-based selection)
   */
  setModel(type: AIModelType): void {
    this.modelType = type;
  }

  /**
   * Get the current model type
   */
  getModel(): AIModelType {
    return this.modelType;
  }

  /**
   * Get the current AI model definition
   */
  getModelInfo(): AIModel {
    return AI_MODELS[this.modelType];
  }

  /**
   * Reset the AI to the start of the track
   */
  reset(): void {
    this.time = 0;
  }

  /**
   * Compute the AI's desired input state
   * Call this each frame to get steering/throttle/brake values
   *
   * Note: The internal AI models use continuous throttle/brake values (0-1),
   * but we convert to boolean for compatibility with InputState interface.
   */
  compute(): InputState {
    const carState = this.car.getState();
    const delta = 1 / 60; // Assume 60fps, in practice use actual delta
    this.time += delta;

    // Build AI input state from current game state
    const aiState: AIInputState = {
      position: this.calculateTrackPosition(carState),
      curvature: this.calculateUpcomingCurvature(carState),
      speed: carState.speed,
      obstacles: this.getVisibleObstacles(carState),
      time: this.time,
    };

    // Get raw AI output
    const output = AI_MODELS[this.modelType].compute(aiState);

    // Apply difficulty modifiers
    const speedMod = DIFFICULTY_SPEED_MODIFIERS[this.difficulty];
    const precision = DIFFICULTY_PRECISION[this.difficulty];

    // Apply precision modifier (occasionally miss turns on lower difficulties)
    let steer = output.steer;
    if (Math.random() > precision) {
      steer *= 0.3; // Reduce steering accuracy
    }

    // Adjust throttle based on difficulty
    const adjustedThrottle = output.throttle * speedMod;

    // Convert to boolean throttle/brake (threshold-based)
    // NOTE: Threshold lowered to 0.25 to ensure throttle works with
    // difficulty speed modifiers (e.g., easy = 0.7, medium = 0.85)
    return {
      steer: clampSteer(steer),
      throttle: adjustedThrottle > 0.25,
      brake: output.brake > 0.3,
    };
  }

  // ==========================================================================
  // Track Position Calculation
  // ==========================================================================

  /**
   * Calculate the car's position relative to the track centerline
   *
   * @returns -1 (left edge) to 1 (right edge), 0 = on centerline
   */
  private calculateTrackPosition(carState: CarState): number {
    const centerLine = this.trackData.centerLine;
    if (centerLine.length < 2) {
      return 0;
    }

    // Find the closest segment on the centerline
    const { signedDistance } = this.findClosestSegment(carState);

    // Normalize to -1 to 1 based on track half-width
    const halfWidth = this.trackData.width / 2;
    const normalizedPosition = signedDistance / halfWidth;

    // Clamp to valid range
    return Math.max(-1, Math.min(1, normalizedPosition));
  }

  /**
   * Find the closest segment on the track centerline to the car
   */
  private findClosestSegment(carState: CarState): {
    segmentIndex: number;
    projectionPoint: Vector2;
    signedDistance: number;
  } {
    const centerLine = this.trackData.centerLine;
    let closestDist = Infinity;
    let closestSegment = 0;
    let closestProj: Vector2 = { x: 0, y: 0 };
    let signedDist = 0;

    for (let i = 0; i < centerLine.length - 1; i++) {
      const p1 = centerLine[i];
      const p2 = centerLine[i + 1];

      const { point, distance, signed } = this.projectPointOnSegment(
        { x: carState.x, y: carState.y },
        p1,
        p2
      );

      if (distance < closestDist) {
        closestDist = distance;
        closestSegment = i;
        closestProj = point;
        signedDist = signed;
      }
    }

    return {
      segmentIndex: closestSegment,
      projectionPoint: closestProj,
      signedDistance: signedDist,
    };
  }

  /**
   * Project a point onto a line segment and return projection info
   */
  private projectPointOnSegment(
    point: Vector2,
    segStart: Vector2,
    segEnd: Vector2
  ): { point: Vector2; distance: number; signed: number } {
    const dx = segEnd.x - segStart.x;
    const dy = segEnd.y - segStart.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
      // Degenerate segment
      const dist = Math.sqrt(
        Math.pow(point.x - segStart.x, 2) + Math.pow(point.y - segStart.y, 2)
      );
      return { point: { x: segStart.x, y: segStart.y }, distance: dist, signed: 0 };
    }

    // Project point onto line (0 to 1 = on segment)
    let t =
      ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const projX = segStart.x + t * dx;
    const projY = segStart.y + t * dy;

    const distance = Math.sqrt(
      Math.pow(point.x - projX, 2) + Math.pow(point.y - projY, 2)
    );

    // Signed distance: positive = right of segment, negative = left
    // Using cross product to determine side
    const cross = dx * (point.y - segStart.y) - dy * (point.x - segStart.x);
    const signed = cross >= 0 ? distance : -distance;

    return { point: { x: projX, y: projY }, distance, signed };
  }

  // ==========================================================================
  // Curvature Calculation
  // ==========================================================================

  /**
   * Calculate the upcoming track curvature
   *
   * @returns Negative = left curve, positive = right curve, 0 = straight
   */
  private calculateUpcomingCurvature(carState: CarState): number {
    const centerLine = this.trackData.centerLine;
    if (centerLine.length < 3) {
      return 0;
    }

    const { segmentIndex } = this.findClosestSegment(carState);

    // Look at upcoming segments to calculate curvature
    let totalAngleChange = 0;
    let sampleCount = 0;

    for (
      let i = segmentIndex;
      i < Math.min(segmentIndex + this.curvatureSamples, centerLine.length - 2);
      i++
    ) {
      const p1 = centerLine[i];
      const p2 = centerLine[i + 1];
      const p3 = centerLine[Math.min(i + 2, centerLine.length - 1)];

      // Calculate angle of each segment
      const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const angle2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);

      // Angle change (normalized to -PI to PI)
      let angleChange = angle2 - angle1;
      while (angleChange > Math.PI) angleChange -= 2 * Math.PI;
      while (angleChange < -Math.PI) angleChange += 2 * Math.PI;

      totalAngleChange += angleChange;
      sampleCount++;
    }

    if (sampleCount === 0) {
      return 0;
    }

    // Return average curvature, scaled to a reasonable range (-1 to 1)
    // A full 90-degree turn over the look-ahead would be ~1.57 radians
    const avgCurvature = totalAngleChange / sampleCount;
    return Math.max(-1, Math.min(1, avgCurvature * 2));
  }

  // ==========================================================================
  // Obstacle Detection
  // ==========================================================================

  /**
   * Get obstacles visible to the AI (within detection range)
   */
  private getVisibleObstacles(carState: CarState): Array<{ distance: number; lane: number }> {
    const obstacles = this.trackData.obstacles;
    if (!obstacles || obstacles.length === 0) {
      return [];
    }

    const visible: Array<{ distance: number; lane: number }> = [];

    for (const obs of obstacles) {
      // Calculate distance from car to obstacle
      const dx = obs.x - carState.x;
      const dy = obs.y - carState.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Only include obstacles ahead (within a 180-degree arc in front)
      const angleToObstacle = Math.atan2(dy, dx);
      let angleDiff = angleToObstacle - carState.angle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      // Only consider obstacles roughly ahead (within ~90 degrees)
      if (Math.abs(angleDiff) < Math.PI / 2 && distance < 400) {
        // Determine lane based on angle difference
        // -1 = left, 0 = center, 1 = right
        const lane = angleDiff > 0.1 ? 1 : angleDiff < -0.1 ? -1 : 0;

        visible.push({
          distance,
          lane,
        });
      }
    }

    // Sort by distance (closest first)
    visible.sort((a, b) => a.distance - b.distance);

    return visible;
  }
}
