import { useRef, useEffect, useMemo } from 'react';

interface RacingLineVizProps {
  playerPath?: Array<[number, number]>;
  aiPath?: Array<[number, number]>;
  checkpoints?: Array<{ x: number; y: number }>;
  /** Ideal racing line (checkpoint polyline) for comparison overlay */
  racingLine?: Array<{ x: number; y: number }>;
  /** Per-sector times for color-coded player line */
  sectorTimes?: { player: number[]; ai: number[] };
}

const WIDTH = 400;
const HEIGHT = 300;
const PADDING = 32;

/** Color constants for sector performance */
const SECTOR_COLOR_FASTER = '#22c55e'; // green
const SECTOR_COLOR_SAME = '#eab308';   // yellow
const SECTOR_COLOR_SLOWER = '#ef4444'; // red

/**
 * Find the index in `path` of the point nearest to `target`.
 * Optionally restrict the search to indices >= `startFrom` to keep monotonic ordering.
 */
function findNearestPathIndex(
  path: Array<[number, number]>,
  target: { x: number; y: number },
  startFrom = 0,
): number {
  let bestIdx = startFrom;
  let bestDist = Infinity;
  for (let i = startFrom; i < path.length; i++) {
    const dx = path[i][0] - target.x;
    const dy = path[i][1] - target.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Determine the sector color based on time comparison.
 * Player faster => green, within 0.2s => yellow, slower => red.
 */
function sectorColor(playerTime: number, aiTime: number): string {
  if (playerTime <= 0 || aiTime <= 0) return SECTOR_COLOR_SAME;
  const delta = playerTime - aiTime;
  if (delta < -0.2) return SECTOR_COLOR_FASTER;
  if (delta > 0.2) return SECTOR_COLOR_SLOWER;
  return SECTOR_COLOR_SAME;
}

/** Canvas-based post-race racing line visualization showing paths taken by both cars
 *  with an optional ideal racing line overlay for comparison.
 *  When sector times are provided, the player's line is color-coded by performance. */
export function RacingLineViz({ playerPath, aiPath, checkpoints, racingLine, sectorTimes }: RacingLineVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const hasPlayerPath = playerPath && playerPath.length > 1;
  const hasAiPath = aiPath && aiPath.length > 1;
  const hasRacingLine = racingLine && racingLine.length > 1;
  const hasSectorTimes = sectorTimes &&
    sectorTimes.player.length > 0 &&
    sectorTimes.ai.length > 0 &&
    checkpoints &&
    checkpoints.length > 1;

  // Pre-compute sector boundary indices into the player path
  const sectorBoundaries = useMemo(() => {
    if (!hasPlayerPath || !hasSectorTimes || !playerPath || !checkpoints) return null;

    const numSectors = Math.min(sectorTimes!.player.length, sectorTimes!.ai.length, checkpoints.length);
    if (numSectors === 0) return null;

    // Map each checkpoint to the nearest player-path point index
    const indices: number[] = [];
    let searchFrom = 0;
    for (let i = 0; i < checkpoints.length; i++) {
      const idx = findNearestPathIndex(playerPath, checkpoints[i], searchFrom);
      indices.push(idx);
      // Allow some overlap but generally move forward to maintain order
      searchFrom = Math.max(searchFrom, Math.min(idx, playerPath.length - 1));
    }

    return { indices, numSectors };
  }, [hasPlayerPath, hasSectorTimes, playerPath, checkpoints, sectorTimes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High-DPI support
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Dark background with rounded corners
    ctx.fillStyle = 'rgba(15, 15, 20, 0.95)';
    ctx.beginPath();
    ctx.roundRect(0, 0, WIDTH, HEIGHT, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, WIDTH, HEIGHT, 8);
    ctx.stroke();

    // Title
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '600 11px monospace';
    ctx.fillText('RACING LINES', 12, 18);

    // Collect all points to compute bounds
    const allPoints: Array<[number, number]> = [];
    if (hasPlayerPath) {
      for (const p of playerPath!) allPoints.push(p);
    }
    if (hasAiPath) {
      for (const p of aiPath!) allPoints.push(p);
    }
    if (checkpoints) {
      for (const cp of checkpoints) allPoints.push([cp.x, cp.y]);
    }
    if (hasRacingLine) {
      for (const p of racingLine!) allPoints.push([p.x, p.y]);
    }

    if (allPoints.length < 2) {
      // Not enough data to draw
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No path data available', WIDTH / 2, HEIGHT / 2);
      ctx.textAlign = 'start';
      return;
    }

    // Compute bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const [x, y] of allPoints) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const margin = Math.max(rangeX, rangeY) * 0.08;
    minX -= margin;
    maxX += margin;
    minY -= margin;
    maxY += margin;

    const drawWidth = WIDTH - PADDING * 2;
    const drawHeight = HEIGHT - PADDING * 2 - 10; // Extra space for title and legend
    const topOffset = PADDING + 6; // Below the title

    const adjRangeX = maxX - minX;
    const adjRangeY = maxY - minY;
    const scale = Math.min(drawWidth / adjRangeX, drawHeight / adjRangeY);
    const offsetX = PADDING + (drawWidth - adjRangeX * scale) / 2;
    const offsetY = topOffset + (drawHeight - adjRangeY * scale) / 2;

    function toCanvas(worldX: number, worldY: number): [number, number] {
      const cx = offsetX + (worldX - minX) * scale;
      const cy = offsetY + (worldY - minY) * scale;
      return [cx, cy];
    }

    // Draw track outline from checkpoints
    if (checkpoints && checkpoints.length > 1) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const [sx, sy] = toCanvas(checkpoints[0].x, checkpoints[0].y);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < checkpoints.length; i++) {
        const [px, py] = toCanvas(checkpoints[i].x, checkpoints[i].y);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(sx, sy); // Close the loop
      ctx.stroke();
      ctx.setLineDash([]);

      // Checkpoint dots
      for (const cp of checkpoints) {
        const [cx, cy] = toCanvas(cp.x, cp.y);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw ideal racing line (dashed blue-white, semi-transparent)
    if (hasRacingLine && racingLine) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(147, 197, 253, 0.45)';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      const [rlx0, rly0] = toCanvas(racingLine[0].x, racingLine[0].y);
      ctx.moveTo(rlx0, rly0);
      for (let i = 1; i < racingLine.length; i++) {
        const [rlx, rly] = toCanvas(racingLine[i].x, racingLine[i].y);
        ctx.lineTo(rlx, rly);
      }
      // Close the loop
      ctx.lineTo(rlx0, rly0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
    }

    // Draw a single-color path (used for AI and fallback player path)
    function drawPath(
      path: Array<[number, number]>,
      color: string,
      glowColor: string,
    ) {
      if (path.length < 2 || !ctx) return;

      // Glow layer
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      const [gx0, gy0] = toCanvas(path[0][0], path[0][1]);
      ctx.moveTo(gx0, gy0);
      for (let i = 1; i < path.length; i++) {
        const [gx, gy] = toCanvas(path[i][0], path[i][1]);
        ctx.lineTo(gx, gy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Main line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      const [x0, y0] = toCanvas(path[0][0], path[0][1]);
      ctx.moveTo(x0, y0);
      for (let i = 1; i < path.length; i++) {
        const [x, y] = toCanvas(path[i][0], path[i][1]);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Start marker
      const [sx, sy] = toCanvas(path[0][0], path[0][1]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw a segment of the player path with a specific color
    function drawPathSegment(
      path: Array<[number, number]>,
      startIdx: number,
      endIdx: number,
      color: string,
    ) {
      if (!ctx || endIdx <= startIdx) return;

      // Glow layer
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      const [gx0, gy0] = toCanvas(path[startIdx][0], path[startIdx][1]);
      ctx.moveTo(gx0, gy0);
      for (let i = startIdx + 1; i <= endIdx; i++) {
        const [gx, gy] = toCanvas(path[i][0], path[i][1]);
        ctx.lineTo(gx, gy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Main line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      const [x0, y0] = toCanvas(path[startIdx][0], path[startIdx][1]);
      ctx.moveTo(x0, y0);
      for (let i = startIdx + 1; i <= endIdx; i++) {
        const [x, y] = toCanvas(path[i][0], path[i][1]);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // Draw AI path first (under player)
    if (hasAiPath) {
      drawPath(aiPath!, '#3B82F6', '#3B82F6');
    }

    // Draw player path -- color-coded by sector if sector times available
    if (hasPlayerPath && playerPath) {
      if (sectorBoundaries && sectorTimes) {
        const { indices, numSectors } = sectorBoundaries;

        // Draw each sector segment with the appropriate color
        for (let s = 0; s < numSectors; s++) {
          const segStart = indices[s];
          const segEnd = s + 1 < indices.length ? indices[s + 1] : playerPath.length - 1;

          const pTime = sectorTimes.player[s] ?? 0;
          const aTime = sectorTimes.ai[s] ?? 0;
          const color = sectorColor(pTime, aTime);

          drawPathSegment(playerPath, segStart, segEnd, color);
        }

        // Draw any remaining tail after the last checkpoint boundary
        const lastBoundary = indices[indices.length - 1];
        if (lastBoundary < playerPath.length - 1 && numSectors < indices.length) {
          // Already covered by the loop above
        }

        // Draw start marker
        ctx.fillStyle = SECTOR_COLOR_FASTER;
        ctx.beginPath();
        const [sx, sy] = toCanvas(playerPath[0][0], playerPath[0][1]);
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();

        // Draw time delta labels at sector junctions (at each checkpoint boundary)
        for (let s = 0; s < numSectors; s++) {
          const pTime = sectorTimes.player[s] ?? 0;
          const aTime = sectorTimes.ai[s] ?? 0;
          if (pTime <= 0 || aTime <= 0) continue;

          const delta = pTime - aTime;
          // Position the label at the END of the sector (the next checkpoint)
          const labelIdx = s + 1 < indices.length ? indices[s + 1] : indices[0];
          const clampedIdx = Math.min(labelIdx, playerPath.length - 1);
          const [lx, ly] = toCanvas(playerPath[clampedIdx][0], playerPath[clampedIdx][1]);

          // Offset the label to avoid overlapping the line
          // Use a perpendicular offset based on the path direction at this point
          let offsetDx = 0;
          let offsetDy = -12; // default: above
          if (clampedIdx > 0) {
            const [prevX, prevY] = toCanvas(playerPath[clampedIdx - 1][0], playerPath[clampedIdx - 1][1]);
            const dirX = lx - prevX;
            const dirY = ly - prevY;
            const len = Math.sqrt(dirX * dirX + dirY * dirY);
            if (len > 0.5) {
              // Perpendicular offset (rotated 90 degrees)
              offsetDx = (-dirY / len) * 14;
              offsetDy = (dirX / len) * 14;
            }
          }

          const deltaStr = delta > 0
            ? `+${delta.toFixed(1)}s`
            : `${delta.toFixed(1)}s`;

          const textColor = delta < -0.2 ? SECTOR_COLOR_FASTER
            : delta > 0.2 ? SECTOR_COLOR_SLOWER
            : SECTOR_COLOR_SAME;

          // Background pill for readability
          ctx.font = 'bold 8px monospace';
          const textWidth = ctx.measureText(deltaStr).width;
          const pillX = lx + offsetDx - textWidth / 2 - 3;
          const pillY = ly + offsetDy - 7;

          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.beginPath();
          ctx.roundRect(pillX, pillY, textWidth + 6, 12, 3);
          ctx.fill();

          // Delta text
          ctx.fillStyle = textColor;
          ctx.textAlign = 'center';
          ctx.fillText(deltaStr, lx + offsetDx, ly + offsetDy + 2);
          ctx.textAlign = 'start';

          // Small sector number near the label
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.font = '6px monospace';
          ctx.fillText(`S${s + 1}`, lx + offsetDx + textWidth / 2 + 5, ly + offsetDy + 1);
        }
      } else {
        // Fallback: draw the player path as a single green line
        drawPath(playerPath, '#22C55E', '#22C55E');
      }
    }

    // Reset shadow
    ctx.shadowBlur = 0;

    // Legend (bottom)
    const legendY = HEIGHT - 10;
    let legendX = PADDING;

    if (sectorBoundaries && sectorTimes) {
      // Color-coded legend when sector data is available
      // Green segment
      ctx.strokeStyle = SECTOR_COLOR_FASTER;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(legendX, legendY);
      ctx.lineTo(legendX + 12, legendY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '8px monospace';
      ctx.fillText('FASTER', legendX + 15, legendY + 3);
      legendX += 55;

      // Yellow segment
      ctx.strokeStyle = SECTOR_COLOR_SAME;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(legendX, legendY);
      ctx.lineTo(legendX + 12, legendY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText('EVEN', legendX + 15, legendY + 3);
      legendX += 47;

      // Red segment
      ctx.strokeStyle = SECTOR_COLOR_SLOWER;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(legendX, legendY);
      ctx.lineTo(legendX + 12, legendY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText('SLOWER', legendX + 15, legendY + 3);
      legendX += 58;

      // "vs AI" label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = '7px monospace';
      ctx.fillText('vs AI', legendX, legendY + 3);
      legendX += 30;

      // AI legend
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.arc(legendX, legendY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(legendX + 7, legendY);
      ctx.lineTo(legendX + 18, legendY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '8px monospace';
      ctx.fillText('AI', legendX + 22, legendY + 3);
    } else {
      // Original legend (no sector data)
      // Player legend
      ctx.fillStyle = '#22C55E';
      ctx.beginPath();
      ctx.arc(legendX, legendY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#22C55E';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(legendX + 7, legendY);
      ctx.lineTo(legendX + 18, legendY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '9px monospace';
      ctx.fillText('YOU', legendX + 22, legendY + 3);
      legendX += 55;

      // AI legend
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.arc(legendX, legendY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(legendX + 7, legendY);
      ctx.lineTo(legendX + 18, legendY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText('AI', legendX + 22, legendY + 3);
      legendX += 45;

      // Ideal racing line legend (only if shown)
      if (hasRacingLine) {
        ctx.strokeStyle = 'rgba(147, 197, 253, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(legendX, legendY);
        ctx.lineTo(legendX + 18, legendY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillText('IDEAL', legendX + 22, legendY + 3);
      }
    }
  }, [playerPath, aiPath, checkpoints, racingLine, sectorTimes, sectorBoundaries, hasPlayerPath, hasAiPath, hasRacingLine, hasSectorTimes]);

  // Don't render at all if there's no path data
  if (!hasPlayerPath && !hasAiPath) {
    return null;
  }

  return (
    <div className="flex justify-center">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ width: WIDTH, height: HEIGHT }}
      />
    </div>
  );
}
