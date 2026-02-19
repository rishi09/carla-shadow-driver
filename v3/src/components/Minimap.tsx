import { useRef, useEffect, useMemo, useState } from 'react';
import type { RaceState } from '../types/index.ts';

interface MinimapProps {
  raceState: RaceState | null;
}

const MAP_SIZE = 200;
const PADDING = 16;
const DRAW_AREA = MAP_SIZE - PADDING * 2;

/** Canvas-based minimap showing car positions on the track. */
export function Minimap({ raceState }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pulsePhase, setPulsePhase] = useState(0);

  // Animate pulse for next checkpoint highlight
  useEffect(() => {
    let frame: number;
    const animate = () => {
      setPulsePhase(Date.now() % 2000 / 2000); // 0..1 over 2 seconds
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Compute the bounding box from all known positions (checkpoints + cars)
  const bounds = useMemo(() => {
    if (!raceState) return null;

    const points: Array<{ x: number; y: number }> = [];

    // Collect checkpoint positions
    if (raceState.checkpoints) {
      for (const cp of raceState.checkpoints) {
        points.push(cp);
      }
    }

    // Collect car positions
    if (raceState.player.x != null && raceState.player.y != null) {
      points.push({ x: raceState.player.x, y: raceState.player.y });
    }
    if (raceState.ai.x != null && raceState.ai.y != null) {
      points.push({ x: raceState.ai.x, y: raceState.ai.y });
    }
    if (raceState.ghost) {
      points.push({ x: raceState.ghost.x, y: raceState.ghost.y });
    }

    if (points.length === 0) return null;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    // Add margin so points aren't right on the edge
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const margin = Math.max(rangeX, rangeY) * 0.08;

    return {
      minX: minX - margin,
      maxX: maxX + margin,
      minY: minY - margin,
      maxY: maxY + margin,
    };
  }, [raceState?.checkpoints, raceState?.player.x, raceState?.player.y, raceState?.ai.x, raceState?.ai.y, raceState?.ghost?.x, raceState?.ghost?.y]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High-DPI support
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MAP_SIZE * dpr;
    canvas.height = MAP_SIZE * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.roundRect(0, 0, MAP_SIZE, MAP_SIZE, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, MAP_SIZE, MAP_SIZE, 8);
    ctx.stroke();

    // "MAP" label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '600 10px monospace';
    ctx.fillText('MAP', 8, 14);

    // North indicator (top-right corner)
    const nX = MAP_SIZE - 16;
    const nY = 16;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('N', nX - 3, nY);
    // Small arrow pointing up
    ctx.beginPath();
    ctx.moveTo(nX, nY + 3);
    ctx.lineTo(nX - 3, nY + 8);
    ctx.lineTo(nX + 3, nY + 8);
    ctx.closePath();
    ctx.fill();

    if (!bounds || !raceState) return;

    const rangeX = bounds.maxX - bounds.minX;
    const rangeY = bounds.maxY - bounds.minY;
    // Use uniform scaling to maintain aspect ratio
    const scale = DRAW_AREA / Math.max(rangeX, rangeY);
    // Center offset to account for aspect ratio difference
    const offsetX = PADDING + (DRAW_AREA - rangeX * scale) / 2;
    const offsetY = PADDING + (DRAW_AREA - rangeY * scale) / 2;

    function toCanvas(worldX: number, worldY: number): [number, number] {
      const cx = offsetX + (worldX - bounds!.minX) * scale;
      const cy = offsetY + (worldY - bounds!.minY) * scale;
      return [cx, cy];
    }

    // Draw checkpoint connections (route line in cyan)
    const checkpoints = raceState.checkpoints;
    const nextCheckpointIdx = raceState.player.checkpoint ?? 0;
    if (checkpoints && checkpoints.length > 1) {
      // Draw the full route as a semi-transparent cyan line
      ctx.strokeStyle = 'rgba(0, 210, 255, 0.35)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      const [sx, sy] = toCanvas(checkpoints[0].x, checkpoints[0].y);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < checkpoints.length; i++) {
        const [px, py] = toCanvas(checkpoints[i].x, checkpoints[i].y);
        ctx.lineTo(px, py);
      }
      // Close the loop back to start
      ctx.lineTo(sx, sy);
      ctx.stroke();

      // Highlight the segment leading to the next checkpoint (brighter)
      const prevIdx = (nextCheckpointIdx - 1 + checkpoints.length) % checkpoints.length;
      const [px1, py1] = toCanvas(checkpoints[prevIdx].x, checkpoints[prevIdx].y);
      const [px2, py2] = toCanvas(checkpoints[nextCheckpointIdx % checkpoints.length].x, checkpoints[nextCheckpointIdx % checkpoints.length].y);
      ctx.strokeStyle = 'rgba(0, 230, 255, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(px2, py2);
      ctx.stroke();
    }

    // Draw checkpoint dots and numbers
    if (checkpoints) {
      const pulseSize = 1 + Math.sin(pulsePhase * Math.PI * 2) * 0.6; // oscillates 0.4..1.6

      for (let i = 0; i < checkpoints.length; i++) {
        const cp = checkpoints[i];
        const [cx, cy] = toCanvas(cp.x, cp.y);
        const isNext = i === (nextCheckpointIdx % checkpoints.length);

        if (isNext) {
          // Next checkpoint: pulsing glow effect
          ctx.shadowColor = '#00D2FF';
          ctx.shadowBlur = 8 + pulseSize * 4;
          ctx.fillStyle = 'rgba(0, 210, 255, 0.9)';
          ctx.beginPath();
          ctx.arc(cx, cy, 4 + pulseSize, 0, Math.PI * 2);
          ctx.fill();
          // Inner white dot
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(cx, cy, 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Regular checkpoint dot
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(0, 210, 255, 0.35)';
          ctx.beginPath();
          ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Checkpoint number label (only show if enough space - skip if too many checkpoints)
        if (checkpoints.length <= 20) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = isNext ? 'rgba(0, 230, 255, 0.9)' : 'rgba(255, 255, 255, 0.3)';
          ctx.font = isNext ? 'bold 8px monospace' : '7px monospace';
          ctx.fillText(String(i + 1), cx + 5, cy + 3);
        }
      }
      ctx.shadowBlur = 0;
    }

    // Draw AI car (blue, drawn first so player appears on top)
    if (raceState.ai.x != null && raceState.ai.y != null) {
      const [ax, ay] = toCanvas(raceState.ai.x, raceState.ai.y);
      // Glow
      ctx.shadowColor = '#3B82F6';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.arc(ax, ay, 5, 0, Math.PI * 2);
      ctx.fill();
      // Inner bright dot
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#93C5FD';
      ctx.beginPath();
      ctx.arc(ax, ay, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw ghost car (semi-transparent white, from best lap recording)
    if (raceState.ghost) {
      const [gx, gy] = toCanvas(raceState.ghost.x, raceState.ghost.y);
      ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.arc(gx, gy, 5, 0, Math.PI * 2);
      ctx.fill();
      // Inner bright dot
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.arc(gx, gy, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw player car (green, on top)
    if (raceState.player.x != null && raceState.player.y != null) {
      const [px, py] = toCanvas(raceState.player.x, raceState.player.y);
      // Glow
      ctx.shadowColor = '#22C55E';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#22C55E';
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      // Inner bright dot
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#86EFAC';
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Reset shadow
    ctx.shadowBlur = 0;

    // Legend (bottom)
    const legendY = MAP_SIZE - 10;
    // Player dot
    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    ctx.arc(PADDING, legendY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '9px monospace';
    ctx.fillText('YOU', PADDING + 6, legendY + 3);

    // AI dot
    ctx.fillStyle = '#3B82F6';
    ctx.beginPath();
    ctx.arc(PADDING + 40, legendY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillText('AI', PADDING + 48, legendY + 3);

    // Ghost dot (only show in legend if ghost is active)
    if (raceState.ghost) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.arc(PADDING + 72, legendY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText('GHOST', PADDING + 78, legendY + 3);
    }
  }, [raceState, bounds, pulsePhase]);

  return (
    <canvas
      ref={canvasRef}
      width={MAP_SIZE}
      height={MAP_SIZE}
      className="absolute bottom-4 right-4 z-20 pointer-events-none"
      style={{ width: MAP_SIZE, height: MAP_SIZE }}
    />
  );
}
