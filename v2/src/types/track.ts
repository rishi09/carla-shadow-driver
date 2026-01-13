/**
 * Track types for Shadow Driver v2
 *
 * Defines the data structures for track geometry, boundaries,
 * checkpoints, obstacles, and race configuration.
 */

/**
 * 2D point/vector coordinate
 */
export interface Vector2 {
  x: number;
  y: number;
}

// Alias for compatibility
export type Point = Vector2;

/**
 * Line segment defined by two endpoints
 */
export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Checkpoint for lap validation
 */
export interface Checkpoint {
  id: number;
  position: Vector2;
  width: number;
  angle: number; // Rotation in radians
}

/**
 * Track boundary definition
 */
export interface TrackBoundary {
  outer: Vector2[]; // Outer edge points
  inner: Vector2[]; // Inner edge points (for closed tracks)
}

/**
 * Optional track segment with surface type
 */
export interface TrackSegment {
  start: Vector2;
  end: Vector2;
  width: number;
  surface: 'asphalt' | 'grass' | 'gravel' | 'curb';
}

/**
 * Obstacle placed on track
 */
export interface ObstacleData {
  type: 'cone' | 'barrier';
  x: number;
  y: number;
  rotation?: number; // Rotation in radians
}

/**
 * Complete track data structure
 */
export interface TrackData {
  id: string;
  name: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';

  // Track geometry
  centerLine: Vector2[]; // Center line points defining the track
  width: number; // Default track width
  boundaries: TrackBoundary;
  segments?: TrackSegment[]; // Optional detailed segments

  // Race configuration
  laps: number;
  startPosition: Vector2;
  startAngle: number; // Starting rotation in radians
  aiStartPosition: Vector2;
  aiStartAngle: number;

  // Checkpoints for lap validation
  checkpoints: Checkpoint[];
  finishLine: {
    position: Vector2;
    width: number;
    angle: number;
  };

  // Obstacles on track
  obstacles: ObstacleData[];

  // Timing configuration
  parTime: number;  // ms - target time for completion
  goldTime: number; // ms - excellent time for gold medal

  // Visual properties (optional)
  backgroundColor?: string;
  trackColor?: string;
  borderColor?: string;
}

/**
 * Track list item for selection UI
 */
export interface TrackMetadata {
  id: string;
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  parTime: number;
  goldTime: number;
  bestTime?: number; // Personal best in milliseconds
  thumbnail?: string;
}
