/**
 * CollisionSystem Unit Tests
 *
 * Tests the collision detection system with:
 * - Point-in-polygon boundary detection (ray casting)
 * - Circle-rectangle obstacle collision
 * - Car-to-car collision (circle-circle)
 * - Checkpoint and finish line crossing
 * - Edge cases: corners, exact boundaries
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock Phaser before importing CollisionSystem
jest.unstable_mockModule('phaser', () => ({
  default: {
    Scene: class MockScene {
      add = {
        graphics: jest.fn(() => ({
          lineStyle: jest.fn().mockReturnThis(),
          strokeRect: jest.fn().mockReturnThis(),
          strokeCircle: jest.fn().mockReturnThis(),
          beginPath: jest.fn().mockReturnThis(),
          moveTo: jest.fn().mockReturnThis(),
          lineTo: jest.fn().mockReturnThis(),
          strokePath: jest.fn().mockReturnThis(),
          destroy: jest.fn(),
          setDepth: jest.fn().mockReturnThis(),
        })),
      };
    },
    GameObjects: {
      Graphics: class MockGraphics {},
    },
  },
  Scene: class MockScene {
    add = {
      graphics: jest.fn(() => ({
        lineStyle: jest.fn().mockReturnThis(),
        strokeRect: jest.fn().mockReturnThis(),
        strokeCircle: jest.fn().mockReturnThis(),
        beginPath: jest.fn().mockReturnThis(),
        moveTo: jest.fn().mockReturnThis(),
        lineTo: jest.fn().mockReturnThis(),
        strokePath: jest.fn().mockReturnThis(),
        destroy: jest.fn(),
        setDepth: jest.fn().mockReturnThis(),
      })),
    };
  },
  GameObjects: {
    Graphics: class MockGraphics {},
  },
}));

// Import types
import type { Vector2, TrackData } from '../types/track';

// Import after mocking
const { CollisionSystem } = await import('../game/systems/CollisionSystem');

// ============================================================================
// Mock Car Class
// ============================================================================

/**
 * Mock Car class for testing
 * Mimics the interface of the real Car class
 */
class MockCar {
  private position: Vector2;

  constructor(x: number, y: number) {
    this.position = { x, y };
  }

  getPosition(): Vector2 {
    return this.position;
  }

  setPosition(x: number, y: number): void {
    this.position = { x, y };
  }
}

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Create a simple rectangular track for testing
 * Outer boundary: 0,0 to 200,200
 * Inner boundary: 50,50 to 150,150
 * This creates a track that's a square ring
 */
function createSimpleTrack(): TrackData {
  return {
    id: 'test-track',
    name: 'Test Track',
    description: 'A simple test track',
    difficulty: 'easy',
    centerLine: [],
    width: 50,
    boundaries: {
      outer: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ],
      inner: [
        { x: 50, y: 50 },
        { x: 150, y: 50 },
        { x: 150, y: 150 },
        { x: 50, y: 150 },
      ],
    },
    laps: 3,
    startPosition: { x: 25, y: 100 },
    startAngle: 0,
    aiStartPosition: { x: 25, y: 120 },
    aiStartAngle: 0,
    checkpoints: [
      { id: 0, position: { x: 100, y: 25 }, width: 40, angle: 0 },
      { id: 1, position: { x: 175, y: 100 }, width: 40, angle: Math.PI / 2 },
      { id: 2, position: { x: 100, y: 175 }, width: 40, angle: Math.PI },
    ],
    finishLine: {
      position: { x: 25, y: 100 },
      width: 40,
      angle: Math.PI / 2,
    },
    obstacles: [],
    parTime: 60000,
    goldTime: 45000,
  };
}

/**
 * Create a track with obstacles for testing
 */
function createTrackWithObstacles(): TrackData {
  const track = createSimpleTrack();
  track.obstacles = [
    { type: 'cone', x: 10, y: 10 },
    { type: 'barrier', x: 170, y: 170 },
    { type: 'cone', x: 10, y: 170 },
  ];
  return track;
}

/**
 * Create a mock scene
 */
function createMockScene(): Phaser.Scene {
  return {
    add: {
      graphics: jest.fn(() => ({
        lineStyle: jest.fn().mockReturnThis(),
        strokeRect: jest.fn().mockReturnThis(),
        strokeCircle: jest.fn().mockReturnThis(),
        beginPath: jest.fn().mockReturnThis(),
        moveTo: jest.fn().mockReturnThis(),
        lineTo: jest.fn().mockReturnThis(),
        strokePath: jest.fn().mockReturnThis(),
        destroy: jest.fn(),
        setDepth: jest.fn().mockReturnThis(),
      })),
    },
  } as unknown as Phaser.Scene;
}

// ============================================================================
// Test Suites
// ============================================================================

describe('CollisionSystem', () => {
  let scene: Phaser.Scene;

  beforeEach(() => {
    scene = createMockScene();
  });

  describe('Constructor', () => {
    it('should create a collision system with valid track data', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      expect(system).toBeDefined();
    });

    it('should store track data', () => {
      const track = createTrackWithObstacles();
      const system = new CollisionSystem(scene, track);
      const storedTrack = system.getTrackData();
      expect(storedTrack.obstacles).toHaveLength(3);
    });
  });

  describe('isOnTrack', () => {
    let system: InstanceType<typeof CollisionSystem>;

    beforeEach(() => {
      const track = createSimpleTrack();
      system = new CollisionSystem(scene, track);
    });

    it('should return true for a point on the track (between boundaries)', () => {
      // Point in the track ring (between inner and outer)
      expect(system.isOnTrack({ x: 25, y: 25 })).toBe(true);
      expect(system.isOnTrack({ x: 175, y: 175 })).toBe(true);
      expect(system.isOnTrack({ x: 25, y: 175 })).toBe(true);
      expect(system.isOnTrack({ x: 175, y: 25 })).toBe(true);
    });

    it('should return false for a point inside the inner boundary (off track)', () => {
      // Point in the center (inside inner boundary)
      expect(system.isOnTrack({ x: 100, y: 100 })).toBe(false);
      expect(system.isOnTrack({ x: 75, y: 75 })).toBe(false);
      expect(system.isOnTrack({ x: 125, y: 125 })).toBe(false);
    });

    it('should return false for a point outside the outer boundary', () => {
      // Points outside the track entirely
      expect(system.isOnTrack({ x: -10, y: -10 })).toBe(false);
      expect(system.isOnTrack({ x: 250, y: 250 })).toBe(false);
      expect(system.isOnTrack({ x: -50, y: 100 })).toBe(false);
      expect(system.isOnTrack({ x: 100, y: 300 })).toBe(false);
    });

    it('should handle edge cases near boundaries', () => {
      // Points just inside outer boundary
      expect(system.isOnTrack({ x: 1, y: 1 })).toBe(true);
      expect(system.isOnTrack({ x: 199, y: 199 })).toBe(true);

      // Points just outside inner boundary
      expect(system.isOnTrack({ x: 49, y: 49 })).toBe(true);
      expect(system.isOnTrack({ x: 151, y: 151 })).toBe(true);
    });
  });

  describe('checkObstacleCollision', () => {
    let system: InstanceType<typeof CollisionSystem>;

    beforeEach(() => {
      const track = createTrackWithObstacles();
      system = new CollisionSystem(scene, track);
    });

    it('should return null when car is not colliding with any obstacle', () => {
      const car = new MockCar(100, 25); // In the track, away from obstacles
      const result = system.checkObstacleCollision(car as any);
      expect(result).toBeNull();
    });

    it('should return obstacle when car overlaps it', () => {
      // Car at position 15,15 should collide with obstacle at 10,10 (20x20 default)
      const car = new MockCar(15, 15);
      const result = system.checkObstacleCollision(car as any);
      expect(result).not.toBeNull();
      expect(result?.obstacle.x).toBe(10);
      expect(result?.obstacle.y).toBe(10);
    });

    it('should return collision normal pointing away from obstacle', () => {
      const car = new MockCar(15, 15);
      const result = system.checkObstacleCollision(car as any);
      expect(result).not.toBeNull();
      expect(result?.normal).toBeDefined();
      // Normal should be a unit vector
      const magnitude = Math.sqrt(
        result!.normal.x * result!.normal.x + result!.normal.y * result!.normal.y
      );
      expect(magnitude).toBeCloseTo(1, 1);
    });

    it('should not detect collision when car is just outside obstacle', () => {
      // Car collision radius is 25, obstacle at 10,10 is 20x20 (ends at 30,30)
      // Car at 60,60 should be outside collision range
      const car = new MockCar(60, 60);
      const result = system.checkObstacleCollision(car as any);
      expect(result).toBeNull();
    });
  });

  describe('checkCollision', () => {
    it('should return no collision when car is safely on track', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(25, 25);

      const result = system.checkCollision(car as any);

      expect(result.collided).toBe(false);
      expect(result.type).toBe('none');
      expect(result.obstacle).toBeUndefined();
    });

    it('should return boundary collision when car is off track (inside inner)', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(100, 100); // Inside inner boundary

      const result = system.checkCollision(car as any);

      expect(result.collided).toBe(true);
      expect(result.type).toBe('wall');
    });

    it('should return boundary collision when car is off track (outside outer)', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(-50, -50); // Outside outer boundary

      const result = system.checkCollision(car as any);

      expect(result.collided).toBe(true);
      expect(result.type).toBe('wall');
    });

    it('should return obstacle collision when car hits obstacle', () => {
      const track = createTrackWithObstacles();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(20, 20); // Near obstacle at 10,10

      const result = system.checkCollision(car as any);

      expect(result.collided).toBe(true);
      expect(result.type).toBe('obstacle');
      expect(result.obstacle).toBeDefined();
    });

    it('should prioritize boundary collision over obstacle collision', () => {
      const track = createTrackWithObstacles();
      const system = new CollisionSystem(scene, track);
      // Car outside track, but also near an obstacle
      const car = new MockCar(-5, -5);

      const result = system.checkCollision(car as any);

      expect(result.collided).toBe(true);
      expect(result.type).toBe('wall');
    });

    it('should return collision normal for boundary collision', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(-50, 100); // Outside left boundary

      const result = system.checkCollision(car as any);

      expect(result.collided).toBe(true);
      expect(result.normal).toBeDefined();
    });
  });

  describe('checkCarCollision', () => {
    it('should detect collision when cars overlap', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car1 = new MockCar(100, 100);
      const car2 = new MockCar(110, 100); // 10px apart, radius is 25

      const result = system.checkCarCollision(car1 as any, car2 as any);

      expect(result.collided).toBe(true);
      expect(result.type).toBe('car');
    });

    it('should not detect collision when cars are far apart', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car1 = new MockCar(50, 100);
      const car2 = new MockCar(150, 100); // 100px apart

      const result = system.checkCarCollision(car1 as any, car2 as any);

      expect(result.collided).toBe(false);
      expect(result.type).toBe('none');
    });

    it('should return collision normal pointing from car1 to car2', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car1 = new MockCar(100, 100);
      const car2 = new MockCar(120, 100); // To the right

      const result = system.checkCarCollision(car1 as any, car2 as any);

      expect(result.collided).toBe(true);
      expect(result.normal?.x).toBeGreaterThan(0); // Normal points right
      expect(result.normal?.y).toBeCloseTo(0, 5);
    });
  });

  describe('checkCheckpointCrossing', () => {
    it('should detect when car is at checkpoint', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(100, 25); // At checkpoint 0

      expect(system.checkCheckpointCrossing(car as any, 0)).toBe(true);
    });

    it('should not detect when car is away from checkpoint', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(25, 25); // Away from checkpoint 0

      expect(system.checkCheckpointCrossing(car as any, 0)).toBe(false);
    });

    it('should return false for invalid checkpoint id', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(100, 25);

      expect(system.checkCheckpointCrossing(car as any, 999)).toBe(false);
    });
  });

  describe('checkFinishLineCrossing', () => {
    it('should detect when car crosses finish line', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(25, 100); // At finish line

      expect(system.checkFinishLineCrossing(car as any)).toBe(true);
    });

    it('should not detect when car is away from finish line', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);
      const car = new MockCar(175, 100); // Far from finish line

      expect(system.checkFinishLineCrossing(car as any)).toBe(false);
    });
  });

  describe('getDistanceToBoundary', () => {
    it('should return distances to both boundaries', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);

      // Point at 25, 100 (on left side of track)
      const distances = system.getDistanceToBoundary({ x: 25, y: 100 });

      // Should be 25 from outer (x=0) and 25 from inner (x=50)
      expect(distances.outer).toBeCloseTo(25, 1);
      expect(distances.inner).toBeCloseTo(25, 1);
    });

    it('should return smaller distance when closer to boundary', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);

      // Point very close to outer boundary
      const distances = system.getDistanceToBoundary({ x: 5, y: 100 });

      expect(distances.outer).toBeLessThan(10);
      expect(distances.inner).toBeGreaterThan(40);
    });
  });

  describe('updateTrackData', () => {
    it('should update the track data', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);

      const newTrack = createTrackWithObstacles();
      system.updateTrackData(newTrack);

      const storedTrack = system.getTrackData();
      expect(storedTrack.obstacles).toHaveLength(3);
    });
  });

  describe('Debug methods', () => {
    it('should create debug graphics when drawDebug is called', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);

      // Should not throw
      expect(() => system.drawDebug()).not.toThrow();
    });

    it('should clear debug graphics', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);

      system.drawDebug();
      expect(() => system.clearDebug()).not.toThrow();
    });

    it('should handle setDebugEnabled', () => {
      const track = createSimpleTrack();
      const system = new CollisionSystem(scene, track);

      expect(() => system.setDebugEnabled(true)).not.toThrow();
      expect(() => system.setDebugEnabled(false)).not.toThrow();
    });
  });

  describe('Complex polygon shapes', () => {
    it('should handle L-shaped track', () => {
      // L-shaped outer boundary
      const lShapedTrack = createSimpleTrack();
      lShapedTrack.boundaries = {
        outer: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 },
          { x: 50, y: 50 },
          { x: 50, y: 100 },
          { x: 0, y: 100 },
        ],
        inner: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 40 },
          { x: 40, y: 40 },
          { x: 40, y: 90 },
          { x: 10, y: 90 },
        ],
      };

      const system = new CollisionSystem(scene, lShapedTrack);

      // Point in the track
      expect(system.isOnTrack({ x: 5, y: 50 })).toBe(true);

      // Point in inner boundary (off track)
      expect(system.isOnTrack({ x: 50, y: 25 })).toBe(false);

      // Point outside outer boundary
      expect(system.isOnTrack({ x: 75, y: 75 })).toBe(false);
    });
  });

  describe('Performance considerations', () => {
    it('should handle track with many obstacles efficiently', () => {
      const track = createSimpleTrack();

      // Add 100 obstacles
      for (let i = 0; i < 100; i++) {
        track.obstacles.push({
          type: 'cone',
          x: (i % 10) * 15 + 5,
          y: Math.floor(i / 10) * 15 + 5,
        });
      }

      const system = new CollisionSystem(scene, track);

      // Car far from obstacles
      const car = new MockCar(175, 175);
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        system.checkObstacleCollision(car as any);
      }

      const endTime = performance.now();

      // Should complete 1000 checks in reasonable time (< 100ms)
      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});

describe('Edge Cases', () => {
  let scene: Phaser.Scene;

  beforeEach(() => {
    scene = createMockScene();
  });

  it('should handle polygon with minimum points (triangle)', () => {
    const triangleTrack = createSimpleTrack();
    triangleTrack.boundaries = {
      outer: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 100 },
      ],
      inner: [
        { x: 30, y: 20 },
        { x: 70, y: 20 },
        { x: 50, y: 60 },
      ],
    };

    const system = new CollisionSystem(scene, triangleTrack);

    // Point in the track
    expect(system.isOnTrack({ x: 20, y: 10 })).toBe(true);

    // Point in inner triangle
    expect(system.isOnTrack({ x: 50, y: 35 })).toBe(false);
  });

  it('should handle empty boundaries gracefully', () => {
    const emptyTrack = createSimpleTrack();
    emptyTrack.boundaries = {
      outer: [],
      inner: [],
    };

    const system = new CollisionSystem(scene, emptyTrack);

    // With no outer boundary, point is considered "inside" (allowed)
    // With no inner boundary, point is not considered "inside inner"
    // So technically any point is "on track"
    expect(system.isOnTrack({ x: 0, y: 0 })).toBe(true);
  });

  it('should handle car at exact corner of track', () => {
    const track = createSimpleTrack();
    const system = new CollisionSystem(scene, track);

    // Exact corner points (boundary behavior depends on algorithm)
    // Just slightly inside should be on track
    expect(system.isOnTrack({ x: 1, y: 1 })).toBe(true);
    expect(system.isOnTrack({ x: 199, y: 1 })).toBe(true);
    expect(system.isOnTrack({ x: 1, y: 199 })).toBe(true);
    expect(system.isOnTrack({ x: 199, y: 199 })).toBe(true);
  });

  it('should handle zero-distance car collision', () => {
    const track = createSimpleTrack();
    const system = new CollisionSystem(scene, track);
    const car1 = new MockCar(100, 100);
    const car2 = new MockCar(100, 100); // Exact same position

    const result = system.checkCarCollision(car1 as any, car2 as any);

    // Same position means distance is 0, which is < 50 (2 * radius)
    // But we have a check for distance > 0 to avoid division by zero
    expect(result.collided).toBe(false);
  });
});
