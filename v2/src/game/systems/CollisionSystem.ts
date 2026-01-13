import Phaser from 'phaser';
import type { TrackData, Vector2, ObstacleData } from '../../types/track';
import type { Car } from '../objects/Car';

export interface CollisionResult {
  collided: boolean;
  type: 'wall' | 'car' | 'obstacle' | 'none';
  normal?: Vector2; // Collision normal for bounce calculation
  obstacle?: ObstacleData; // The obstacle that was hit (if type is 'obstacle')
}

/**
 * Represents a line segment for boundary calculations
 */
interface LineSegment {
  p1: Vector2;
  p2: Vector2;
}

/**
 * CollisionSystem - Handles collision detection for the race
 *
 * This system implements:
 * 1. Point-in-polygon for boundary detection (ray casting algorithm)
 * 2. Circle-rectangle intersection for obstacle collision
 * 3. Car-to-car collision (circle-circle)
 * 4. Checkpoint and finish line crossing detection
 * 5. Debug visualization for development
 *
 * Performance optimizations:
 * - Spatial filtering: Only check obstacles within proximity radius
 * - Cached boundary segments for faster calculations
 * - Early-out checks for boundary detection
 */
export class CollisionSystem {
  private scene: Phaser.Scene;
  private trackData: TrackData;

  // Cached line segments for faster calculations
  private innerSegments: LineSegment[];
  private outerSegments: LineSegment[];

  // Configuration constants
  private readonly CAR_COLLISION_RADIUS = 25; // Treat car as circle with this radius
  private readonly OBSTACLE_PROXIMITY_RADIUS = 100; // Only check obstacles within this distance

  // Default obstacle dimensions for collision (if not specified)
  private readonly DEFAULT_OBSTACLE_WIDTH = 20;
  private readonly DEFAULT_OBSTACLE_HEIGHT = 20;

  // Debug graphics reference
  private debugGraphics: Phaser.GameObjects.Graphics | null = null;

  constructor(scene: Phaser.Scene, trackData: TrackData) {
    this.scene = scene;
    this.trackData = trackData;

    // Pre-compute boundary segments for performance
    this.innerSegments = this.computeSegments(trackData.boundaries.inner);
    this.outerSegments = this.computeSegments(trackData.boundaries.outer);
  }

  /**
   * Convert polygon points to line segments for efficient calculations
   */
  private computeSegments(polygon: Vector2[]): LineSegment[] {
    const segments: LineSegment[] = [];
    const n = polygon.length;

    for (let i = 0; i < n; i++) {
      segments.push({
        p1: polygon[i],
        p2: polygon[(i + 1) % n],
      });
    }

    return segments;
  }

  // ==========================================================================
  // Public API - Collision Detection
  // ==========================================================================

  /**
   * Check if a car is colliding with track boundaries or obstacles
   */
  checkCollision(car: Car): CollisionResult {
    const position = car.getPosition();

    // First check boundary collision (most common)
    if (!this.isOnTrack(position)) {
      return {
        collided: true,
        type: 'wall',
        normal: this.calculateBoundaryNormal(position),
      };
    }

    // Then check obstacle collision
    const obstacleResult = this.checkObstacleCollision(car);
    if (obstacleResult) {
      return {
        collided: true,
        type: 'obstacle',
        obstacle: obstacleResult.obstacle,
        normal: obstacleResult.normal,
      };
    }

    return { collided: false, type: 'none' };
  }

  /**
   * Check if a position is on the track surface (between inner and outer boundary)
   */
  isOnTrack(position: Vector2): boolean {
    const insideOuter = this.isInsideOuterBoundary(position);
    const insideInner = this.isInsideInnerBoundary(position);

    // On track = inside outer AND outside inner
    return insideOuter && !insideInner;
  }

  /**
   * Check car-to-car collision (circle-circle)
   */
  checkCarCollision(car1: Car, car2: Car): CollisionResult {
    const pos1 = car1.getPosition();
    const pos2 = car2.getPosition();

    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Circle collision with car radius
    if (distance < this.CAR_COLLISION_RADIUS * 2 && distance > 0) {
      return {
        collided: true,
        type: 'car',
        normal: { x: dx / distance, y: dy / distance },
      };
    }

    return { collided: false, type: 'none' };
  }

  /**
   * Check if car overlaps any obstacle
   * Returns collision result with obstacle data or null if no collision
   */
  checkObstacleCollision(car: Car): { obstacle: ObstacleData; normal: Vector2 } | null {
    const position = car.getPosition();

    // Performance optimization: only check nearby obstacles
    const nearbyObstacles = this.trackData.obstacles.filter((obstacle) => {
      const obstacleCenter: Vector2 = {
        x: obstacle.x + this.DEFAULT_OBSTACLE_WIDTH / 2,
        y: obstacle.y + this.DEFAULT_OBSTACLE_HEIGHT / 2,
      };
      const distance = this.distanceBetweenPoints(position, obstacleCenter);
      return distance < this.OBSTACLE_PROXIMITY_RADIUS;
    });

    // Check each nearby obstacle
    for (const obstacle of nearbyObstacles) {
      const collisionResult = this.circleRectangleCollision(
        position,
        this.CAR_COLLISION_RADIUS,
        obstacle.x,
        obstacle.y,
        this.DEFAULT_OBSTACLE_WIDTH,
        this.DEFAULT_OBSTACLE_HEIGHT
      );

      if (collisionResult.collided) {
        return {
          obstacle,
          normal: collisionResult.normal,
        };
      }
    }

    return null;
  }

  // ==========================================================================
  // Public API - Checkpoint Detection
  // ==========================================================================

  /**
   * Check if car crossed a checkpoint
   */
  checkCheckpointCrossing(car: Car, checkpointId: number): boolean {
    const position = car.getPosition();
    const checkpoint = this.trackData.checkpoints.find((cp) => cp.id === checkpointId);

    if (!checkpoint) return false;

    // Simple distance-based check
    const dx = position.x - checkpoint.position.x;
    const dy = position.y - checkpoint.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance < checkpoint.width / 2;
  }

  /**
   * Check if car crossed finish line
   */
  checkFinishLineCrossing(car: Car): boolean {
    const position = car.getPosition();
    const finish = this.trackData.finishLine;

    const dx = position.x - finish.position.x;
    const dy = position.y - finish.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance < finish.width / 2;
  }

  // ==========================================================================
  // Public API - Distance Calculations
  // ==========================================================================

  /**
   * Get the minimum distance from a point to the nearest boundary
   */
  getDistanceToBoundary(point: Vector2): { inner: number; outer: number } {
    let minInnerDistance = Infinity;
    let minOuterDistance = Infinity;

    for (const segment of this.innerSegments) {
      const distance = this.getDistanceToSegment(point, segment);
      minInnerDistance = Math.min(minInnerDistance, distance);
    }

    for (const segment of this.outerSegments) {
      const distance = this.getDistanceToSegment(point, segment);
      minOuterDistance = Math.min(minOuterDistance, distance);
    }

    return {
      inner: minInnerDistance,
      outer: minOuterDistance,
    };
  }

  /**
   * Get the minimum distance from a point to a line segment
   */
  getDistanceToSegment(point: Vector2, segment: LineSegment): number {
    const { p1, p2 } = segment;
    const lengthSquared =
      (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);

    if (lengthSquared === 0) {
      return this.distanceBetweenPoints(point, p1);
    }

    // Project point onto line segment
    let t = ((point.x - p1.x) * (p2.x - p1.x) + (point.y - p1.y) * (p2.y - p1.y)) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    const projection: Vector2 = {
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
    };

    return this.distanceBetweenPoints(point, projection);
  }

  // ==========================================================================
  // Public API - Debug Visualization
  // ==========================================================================

  /**
   * Enable or disable debug visualization
   */
  setDebugEnabled(enabled: boolean): void {
    if (enabled) {
      this.drawDebug();
    } else {
      this.clearDebug();
    }
  }

  /**
   * Draw debug visualization for boundaries, obstacles, and hitboxes
   */
  drawDebug(): void {
    // Clean up existing graphics
    if (this.debugGraphics) {
      this.debugGraphics.destroy();
    }

    this.debugGraphics = this.scene.add.graphics();
    this.debugGraphics.setDepth(1000); // Draw on top of everything

    // Draw outer boundary (green)
    this.debugGraphics.lineStyle(2, 0x00ff00, 0.8);
    this.drawPolygon(this.trackData.boundaries.outer);

    // Draw inner boundary (red)
    this.debugGraphics.lineStyle(2, 0xff0000, 0.8);
    this.drawPolygon(this.trackData.boundaries.inner);

    // Draw obstacles (yellow)
    this.debugGraphics.lineStyle(2, 0xffff00, 0.8);
    for (const obstacle of this.trackData.obstacles) {
      this.debugGraphics.strokeRect(
        obstacle.x,
        obstacle.y,
        this.DEFAULT_OBSTACLE_WIDTH,
        this.DEFAULT_OBSTACLE_HEIGHT
      );
    }

    // Draw checkpoints (cyan)
    this.debugGraphics.lineStyle(2, 0x00ffff, 0.6);
    for (const checkpoint of this.trackData.checkpoints) {
      this.debugGraphics.strokeCircle(
        checkpoint.position.x,
        checkpoint.position.y,
        checkpoint.width / 2
      );
    }

    // Draw finish line (white)
    this.debugGraphics.lineStyle(3, 0xffffff, 1.0);
    this.debugGraphics.strokeCircle(
      this.trackData.finishLine.position.x,
      this.trackData.finishLine.position.y,
      this.trackData.finishLine.width / 2
    );
  }

  /**
   * Clear debug visualization
   */
  clearDebug(): void {
    if (this.debugGraphics) {
      this.debugGraphics.destroy();
      this.debugGraphics = null;
    }
  }

  /**
   * Draw a polygon outline using debug graphics
   */
  private drawPolygon(points: Vector2[]): void {
    if (!this.debugGraphics || points.length < 2) return;

    this.debugGraphics.beginPath();
    this.debugGraphics.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      this.debugGraphics.lineTo(points[i].x, points[i].y);
    }

    // Close the polygon
    this.debugGraphics.lineTo(points[0].x, points[0].y);
    this.debugGraphics.strokePath();
  }

  // ==========================================================================
  // Collision Detection Algorithms
  // ==========================================================================

  /**
   * Ray Casting Algorithm for Point-in-Polygon detection
   *
   * Algorithm:
   * 1. Cast a ray from the point horizontally to the right
   * 2. Count how many times the ray crosses polygon edges
   * 3. If odd number of crossings, point is inside; if even, outside
   *
   * This handles complex polygons including concave shapes.
   */
  private pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
    const n = polygon.length;
    if (n < 3) return false;

    let inside = false;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      // Check if ray crosses this edge
      const intersects =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  private isInsideOuterBoundary(position: Vector2): boolean {
    const polygon = this.trackData.boundaries.outer;
    if (polygon.length < 3) return true; // No boundary defined, allow all

    return this.pointInPolygon(position, polygon);
  }

  private isInsideInnerBoundary(position: Vector2): boolean {
    const polygon = this.trackData.boundaries.inner;
    if (polygon.length < 3) return false; // No inner boundary

    return this.pointInPolygon(position, polygon);
  }

  /**
   * Circle-Rectangle Collision Detection
   *
   * Algorithm:
   * 1. Find the closest point on the rectangle to the circle center
   * 2. Calculate distance from circle center to that point
   * 3. If distance < radius, collision detected
   * 4. Calculate collision normal for physics response
   */
  private circleRectangleCollision(
    circleCenter: Vector2,
    circleRadius: number,
    rectX: number,
    rectY: number,
    rectWidth: number,
    rectHeight: number
  ): { collided: boolean; normal: Vector2 } {
    // Find the closest point on the rectangle to the circle center
    const closestX = Math.max(rectX, Math.min(circleCenter.x, rectX + rectWidth));
    const closestY = Math.max(rectY, Math.min(circleCenter.y, rectY + rectHeight));

    // Calculate distance from circle center to closest point
    const distanceX = circleCenter.x - closestX;
    const distanceY = circleCenter.y - closestY;
    const distanceSquared = distanceX * distanceX + distanceY * distanceY;

    // Check for collision
    if (distanceSquared < circleRadius * circleRadius) {
      // Calculate collision normal
      const distance = Math.sqrt(distanceSquared);
      const normal: Vector2 =
        distance > 0
          ? { x: distanceX / distance, y: distanceY / distance }
          : { x: 0, y: -1 }; // Default normal if at exact center

      return { collided: true, normal };
    }

    return { collided: false, normal: { x: 0, y: 0 } };
  }

  /**
   * Calculate collision normal for boundary collision
   * Uses nearest boundary segment to determine push direction
   */
  private calculateBoundaryNormal(position: Vector2): Vector2 {
    // Find the closest segment on both boundaries
    let closestNormal: Vector2 = { x: 0, y: 0 };
    let minDistance = Infinity;

    // Check if outside outer boundary
    if (!this.isInsideOuterBoundary(position)) {
      for (const segment of this.outerSegments) {
        const distance = this.getDistanceToSegment(position, segment);
        if (distance < minDistance) {
          minDistance = distance;
          closestNormal = this.getSegmentNormal(segment, position, true); // Inward normal
        }
      }
    }
    // Check if inside inner boundary
    else if (this.isInsideInnerBoundary(position)) {
      for (const segment of this.innerSegments) {
        const distance = this.getDistanceToSegment(position, segment);
        if (distance < minDistance) {
          minDistance = distance;
          closestNormal = this.getSegmentNormal(segment, position, false); // Outward normal
        }
      }
    }

    return closestNormal;
  }

  /**
   * Get the normal vector of a line segment pointing toward or away from a point
   */
  private getSegmentNormal(segment: LineSegment, point: Vector2, inward: boolean): Vector2 {
    const { p1, p2 } = segment;

    // Calculate segment direction
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) return { x: 0, y: 0 };

    // Calculate perpendicular (normal)
    let nx = -dy / length;
    let ny = dx / length;

    // Determine which side the point is on
    const cross = dx * (point.y - p1.y) - dy * (point.x - p1.x);

    // Flip normal if needed based on point position and desired direction
    if ((cross > 0) !== inward) {
      nx = -nx;
      ny = -ny;
    }

    return { x: nx, y: ny };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Calculate Euclidean distance between two points
   */
  private distanceBetweenPoints(p1: Vector2, p2: Vector2): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Update track data (for dynamic tracks or testing)
   */
  updateTrackData(trackData: TrackData): void {
    this.trackData = trackData;
    this.innerSegments = this.computeSegments(trackData.boundaries.inner);
    this.outerSegments = this.computeSegments(trackData.boundaries.outer);
  }

  /**
   * Get current track data
   */
  getTrackData(): TrackData {
    return this.trackData;
  }
}
