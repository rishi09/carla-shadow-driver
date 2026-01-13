import Phaser from 'phaser';
import type { TrackData, Vector2, Checkpoint, ObstacleData } from '../../types/track';

/**
 * TrackRenderer - Renders track geometry using Phaser Graphics
 *
 * Draws the complete track including:
 * - Background fill
 * - Track surface (filled polygon between boundaries)
 * - Track edges (white lines)
 * - Center line (dashed yellow)
 * - Start/finish line (checkered pattern)
 * - Checkpoint indicators (subtle blue lines)
 * - Obstacles (cones and barriers)
 */
export class TrackRenderer {
  private trackData: TrackData;
  private graphics: Phaser.GameObjects.Graphics;

  // Track colors (can be overridden by trackData)
  private readonly DEFAULT_TRACK_SURFACE_COLOR = 0x3a3a4a;
  private readonly DEFAULT_TRACK_EDGE_COLOR = 0xffffff;
  private readonly DEFAULT_BACKGROUND_COLOR = 0x1a1a2e;
  private readonly CENTER_LINE_COLOR = 0xffdd00;
  private readonly FINISH_LINE_COLOR_1 = 0xffffff;
  private readonly FINISH_LINE_COLOR_2 = 0x000000;
  private readonly CHECKPOINT_COLOR = 0x44aaff;
  private readonly CONE_COLOR = 0xff6600;
  private readonly BARRIER_COLOR = 0xff0000;

  constructor(scene: Phaser.Scene, trackData: TrackData) {
    this.trackData = trackData;
    this.graphics = scene.add.graphics();
  }

  /**
   * Render the complete track
   */
  render(): void {
    this.graphics.clear();

    // Draw in order (bottom to top)
    this.renderBackground();
    this.renderTrackSurface();
    this.renderBoundaries();
    this.renderCenterLine();
    this.renderCheckpoints();
    this.renderStartFinish();
    this.renderObstacles();
  }

  /**
   * Get track surface color (from data or default)
   */
  private getTrackColor(): number {
    if (this.trackData.trackColor) {
      return Phaser.Display.Color.HexStringToColor(this.trackData.trackColor).color;
    }
    return this.DEFAULT_TRACK_SURFACE_COLOR;
  }

  /**
   * Get track edge color (from data or default)
   */
  private getBorderColor(): number {
    if (this.trackData.borderColor) {
      return Phaser.Display.Color.HexStringToColor(this.trackData.borderColor).color;
    }
    return this.DEFAULT_TRACK_EDGE_COLOR;
  }

  /**
   * Get background color (from data or default)
   */
  private getBackgroundColor(): number {
    if (this.trackData.backgroundColor) {
      return Phaser.Display.Color.HexStringToColor(this.trackData.backgroundColor).color;
    }
    return this.DEFAULT_BACKGROUND_COLOR;
  }

  /**
   * Fill the background
   */
  private renderBackground(): void {
    this.graphics.fillStyle(this.getBackgroundColor(), 1);
    this.graphics.fillRect(0, 0, 900, 600);
  }

  /**
   * Draw the track surface as a filled polygon
   */
  private renderTrackSurface(): void {
    const { outer, inner } = this.trackData.boundaries;

    // Draw outer boundary as filled polygon
    this.graphics.fillStyle(this.getTrackColor(), 1);
    this.graphics.beginPath();

    // Outer boundary (clockwise)
    if (outer.length > 0) {
      this.graphics.moveTo(outer[0].x, outer[0].y);
      for (let i = 1; i < outer.length; i++) {
        this.graphics.lineTo(outer[i].x, outer[i].y);
      }
      this.graphics.closePath();
    }

    this.graphics.fillPath();

    // Cut out inner area (for tracks with an inner boundary)
    if (inner.length > 0) {
      this.graphics.fillStyle(this.getBackgroundColor(), 1);
      this.graphics.beginPath();
      this.graphics.moveTo(inner[0].x, inner[0].y);
      for (let i = 1; i < inner.length; i++) {
        this.graphics.lineTo(inner[i].x, inner[i].y);
      }
      this.graphics.closePath();
      this.graphics.fillPath();
    }
  }

  /**
   * Draw track edge lines
   */
  private renderBoundaries(): void {
    this.graphics.lineStyle(3, this.getBorderColor(), 1);

    // Draw outer boundary
    if (this.trackData.boundaries.outer.length > 1) {
      this.graphics.beginPath();
      const outer = this.trackData.boundaries.outer;
      this.graphics.moveTo(outer[0].x, outer[0].y);
      for (let i = 1; i < outer.length; i++) {
        this.graphics.lineTo(outer[i].x, outer[i].y);
      }
      this.graphics.closePath();
      this.graphics.strokePath();
    }

    // Draw inner boundary
    if (this.trackData.boundaries.inner.length > 1) {
      this.graphics.beginPath();
      const inner = this.trackData.boundaries.inner;
      this.graphics.moveTo(inner[0].x, inner[0].y);
      for (let i = 1; i < inner.length; i++) {
        this.graphics.lineTo(inner[i].x, inner[i].y);
      }
      this.graphics.closePath();
      this.graphics.strokePath();
    }
  }

  /**
   * Draw dashed center line
   */
  private renderCenterLine(): void {
    const { centerLine } = this.trackData;
    if (centerLine.length < 2) return;

    this.graphics.lineStyle(2, this.CENTER_LINE_COLOR, 0.7);

    const dashLength = 20;
    const gapLength = 15;

    for (let i = 0; i < centerLine.length - 1; i++) {
      const start = centerLine[i];
      const end = centerLine[i + 1];

      // Calculate segment properties
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      if (segmentLength === 0) continue;

      const unitX = dx / segmentLength;
      const unitY = dy / segmentLength;

      // Draw dashed line along segment
      let distance = 0;
      let drawing = true;

      while (distance < segmentLength) {
        const currentLength = drawing ? dashLength : gapLength;
        const remainingLength = segmentLength - distance;
        const drawLength = Math.min(currentLength, remainingLength);

        if (drawing) {
          const startX = start.x + unitX * distance;
          const startY = start.y + unitY * distance;
          const endX = start.x + unitX * (distance + drawLength);
          const endY = start.y + unitY * (distance + drawLength);

          this.graphics.beginPath();
          this.graphics.moveTo(startX, startY);
          this.graphics.lineTo(endX, endY);
          this.graphics.strokePath();
        }

        distance += drawLength;
        drawing = !drawing;
      }
    }
  }

  /**
   * Draw checkpoint indicators
   */
  private renderCheckpoints(): void {
    this.graphics.lineStyle(2, this.CHECKPOINT_COLOR, 0.3);

    for (const checkpoint of this.trackData.checkpoints) {
      const { position, width, angle } = checkpoint;

      // Calculate endpoints
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const halfWidth = width / 2;

      // Perpendicular to angle
      const x1 = position.x - halfWidth * sin;
      const y1 = position.y + halfWidth * cos;
      const x2 = position.x + halfWidth * sin;
      const y2 = position.y - halfWidth * cos;

      this.graphics.beginPath();
      this.graphics.moveTo(x1, y1);
      this.graphics.lineTo(x2, y2);
      this.graphics.strokePath();
    }
  }

  /**
   * Draw start/finish line with checkered pattern
   */
  private renderStartFinish(): void {
    const { finishLine } = this.trackData;
    const { position, width, angle } = finishLine;

    // Calculate endpoints of finish line
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const halfWidth = width / 2;

    // Perpendicular direction for the line
    const x1 = position.x - halfWidth * sin;
    const y1 = position.y + halfWidth * cos;
    const x2 = position.x + halfWidth * sin;
    const y2 = position.y - halfWidth * cos;

    // Calculate line properties
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const unitX = dx / length;
    const unitY = dy / length;

    // Draw checkered pattern (2 rows of 8 squares)
    const stripeWidth = 8;
    const squareSize = length / 8;

    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 8; col++) {
        const isWhite = (row + col) % 2 === 0;
        this.graphics.fillStyle(isWhite ? this.FINISH_LINE_COLOR_1 : this.FINISH_LINE_COLOR_2, 1);

        const baseX = x1 + unitX * col * squareSize + cos * row * stripeWidth;
        const baseY = y1 + unitY * col * squareSize + sin * row * stripeWidth;

        this.graphics.fillRect(
          baseX - 2,
          baseY - 2,
          squareSize,
          stripeWidth
        );
      }
    }
  }

  /**
   * Draw obstacles (cones and barriers)
   */
  private renderObstacles(): void {
    if (!this.trackData.obstacles) return;

    for (const obstacle of this.trackData.obstacles) {
      if (obstacle.type === 'cone') {
        this.drawCone(obstacle);
      } else if (obstacle.type === 'barrier') {
        this.drawBarrier(obstacle);
      }
    }
  }

  /**
   * Draw a traffic cone
   */
  private drawCone(obstacle: ObstacleData): void {
    const { x, y } = obstacle;
    const size = 8;

    // Orange cone body (triangle)
    this.graphics.fillStyle(this.CONE_COLOR, 1);
    this.graphics.beginPath();
    this.graphics.moveTo(x, y - size);
    this.graphics.lineTo(x - size * 0.7, y + size * 0.5);
    this.graphics.lineTo(x + size * 0.7, y + size * 0.5);
    this.graphics.closePath();
    this.graphics.fillPath();

    // White stripe
    this.graphics.lineStyle(2, 0xffffff, 1);
    this.graphics.beginPath();
    this.graphics.moveTo(x - size * 0.35, y);
    this.graphics.lineTo(x + size * 0.35, y);
    this.graphics.strokePath();
  }

  /**
   * Draw a barrier
   */
  private drawBarrier(obstacle: ObstacleData): void {
    const { x, y, rotation = 0 } = obstacle;
    const barrierWidth = 40;
    const barrierHeight = 12;

    // Calculate rotation
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // Draw rotated rectangle with red/white stripes
    const stripeCount = 4;
    const stripeWidth = barrierWidth / stripeCount;

    for (let i = 0; i < stripeCount; i++) {
      const isRed = i % 2 === 0;
      this.graphics.fillStyle(isRed ? this.BARRIER_COLOR : 0xffffff, 1);

      // Calculate stripe corners with rotation
      const localX = -barrierWidth / 2 + i * stripeWidth;
      const corners = [
        { x: localX, y: -barrierHeight / 2 },
        { x: localX + stripeWidth, y: -barrierHeight / 2 },
        { x: localX + stripeWidth, y: barrierHeight / 2 },
        { x: localX, y: barrierHeight / 2 },
      ];

      // Apply rotation and translation
      const rotatedCorners = corners.map((c) => ({
        x: x + c.x * cos - c.y * sin,
        y: y + c.x * sin + c.y * cos,
      }));

      this.graphics.beginPath();
      this.graphics.moveTo(rotatedCorners[0].x, rotatedCorners[0].y);
      for (let j = 1; j < rotatedCorners.length; j++) {
        this.graphics.lineTo(rotatedCorners[j].x, rotatedCorners[j].y);
      }
      this.graphics.closePath();
      this.graphics.fillPath();
    }

    // Border
    this.graphics.lineStyle(1, 0x333333, 1);
    const halfW = barrierWidth / 2;
    const halfH = barrierHeight / 2;
    const borderCorners = [
      { x: -halfW, y: -halfH },
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH },
    ].map((c) => ({
      x: x + c.x * cos - c.y * sin,
      y: y + c.x * sin + c.y * cos,
    }));

    this.graphics.beginPath();
    this.graphics.moveTo(borderCorners[0].x, borderCorners[0].y);
    for (let i = 1; i < borderCorners.length; i++) {
      this.graphics.lineTo(borderCorners[i].x, borderCorners[i].y);
    }
    this.graphics.closePath();
    this.graphics.strokePath();
  }

  /**
   * Get the graphics object for additional rendering
   */
  getGraphics(): Phaser.GameObjects.Graphics {
    return this.graphics;
  }

  /**
   * Get inner boundary points for collision detection
   */
  getInnerBoundary(): Vector2[] {
    return [...this.trackData.boundaries.inner];
  }

  /**
   * Get outer boundary points for collision detection
   */
  getOuterBoundary(): Vector2[] {
    return [...this.trackData.boundaries.outer];
  }

  /**
   * Get track data
   */
  getTrackData(): TrackData {
    return this.trackData;
  }

  /**
   * Get checkpoints for collision/lap detection
   */
  getCheckpoints(): Checkpoint[] {
    return [...this.trackData.checkpoints];
  }

  /**
   * Clean up graphics
   */
  destroy(): void {
    this.graphics.destroy();
  }
}
