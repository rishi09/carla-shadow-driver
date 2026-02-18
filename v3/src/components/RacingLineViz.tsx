import { useRef, useEffect } from 'react';

interface RacingLineVizProps {
  playerPath?: Array<[number, number]>;
  aiPath?: Array<[number, number]>;
  checkpoints?: Array<{ x: number; y: number }>;
}

const WIDTH = 400;
const HEIGHT = 300;
const PADDING = 32;

/** Canvas-based post-race racing line visualization showing paths taken by both cars. */
export function RacingLineViz({ playerPath, aiPath, checkpoints }: RacingLineVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const hasPlayerPath = playerPath && playerPath.length > 1;
  const hasAiPath = aiPath && aiPath.length > 1;

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
      for (const p of playerPath) allPoints.push(p);
    }
    if (hasAiPath) {
      for (const p of aiPath) allPoints.push(p);
    }
    if (checkpoints) {
      for (const cp of checkpoints) allPoints.push([cp.x, cp.y]);
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

    // Draw racing line helper
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

    // Draw AI path first (under player)
    if (hasAiPath) {
      drawPath(aiPath, '#3B82F6', '#3B82F6');
    }

    // Draw player path on top
    if (hasPlayerPath) {
      drawPath(playerPath, '#22C55E', '#22C55E');
    }

    // Reset shadow
    ctx.shadowBlur = 0;

    // Legend (bottom)
    const legendY = HEIGHT - 10;
    // Player legend
    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    ctx.arc(PADDING, legendY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#22C55E';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PADDING + 7, legendY);
    ctx.lineTo(PADDING + 18, legendY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '9px monospace';
    ctx.fillText('YOU', PADDING + 22, legendY + 3);

    // AI legend
    const aiLegendX = PADDING + 55;
    ctx.fillStyle = '#3B82F6';
    ctx.beginPath();
    ctx.arc(aiLegendX, legendY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(aiLegendX + 7, legendY);
    ctx.lineTo(aiLegendX + 18, legendY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillText('AI', aiLegendX + 22, legendY + 3);
  }, [playerPath, aiPath, checkpoints, hasPlayerPath, hasAiPath]);

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
