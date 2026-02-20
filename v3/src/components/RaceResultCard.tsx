import { useRef, useCallback, useState } from 'react';
import type { RaceFinished } from '../types/index.ts';

interface RaceResultCardProps {
  result: RaceFinished;
  raceSettings?: {
    track: string;
    laps: number;
    weather: string;
    model?: string;
    playerCar?: string;
    timeOfDay?: string;
  };
}

/** Map model IDs to display difficulty names */
const MODEL_DIFFICULTY: Record<string, string> = {
  carla_pilotnet: 'Easy',
  pilotnet: 'Medium',
  alpamayo: 'Hard',
};

/** Map track IDs to friendlier names */
const TRACK_NAMES: Record<string, string> = {
  Town01: 'Town 01 - River Town',
  Town02: 'Town 02 - Residential',
  Town03: 'Town 03 - Suburban Mix',
  Town04: 'Town 04 - Highway',
  Town05: 'Town 05 - Urban Grid',
  Town07: 'Town 07 - Rural Loop',
  Town10HD: 'Town 10 - Downtown',
};

function formatRaceTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}

/**
 * Renders a 600x400 canvas race result card and provides share/download functionality.
 */
export function RaceResultCard({ result, raceSettings }: RaceResultCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied' | 'downloaded' | 'error'>('idle');

  const playerWon = result.winner === 'player';
  const trackName = raceSettings?.track
    ? TRACK_NAMES[raceSettings.track] ?? raceSettings.track
    : 'Unknown Track';
  const laps = raceSettings?.laps ?? result.player_laps.length;
  const difficulty = raceSettings?.model
    ? MODEL_DIFFICULTY[raceSettings.model] ?? raceSettings.model
    : 'Easy';
  const topSpeed = result.player_max_speed ?? 0;
  const collisions = result.player_collisions ?? 0;
  const gap =
    result.player_time != null && result.ai_time != null
      ? result.player_time - result.ai_time
      : null;

  /** Draw the card onto the canvas */
  const renderCard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 600;
    const H = 400;
    canvas.width = W;
    canvas.height = H;

    // --- Background gradient ---
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0a0a1a');
    bgGrad.addColorStop(1, '#1a1a3a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // --- Accent lines (racing themed) ---
    ctx.strokeStyle = playerWon ? 'rgba(76, 175, 80, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    ctx.lineWidth = 2;
    // Top accent line
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.lineTo(W, 3);
    ctx.stroke();
    // Bottom accent line
    ctx.beginPath();
    ctx.moveTo(0, H - 3);
    ctx.lineTo(W, H - 3);
    ctx.stroke();
    // Diagonal racing stripes (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 30;
    for (let i = -H; i < W + H; i += 80) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + H, H);
      ctx.stroke();
    }

    // --- Top accent bar ---
    const barGrad = ctx.createLinearGradient(0, 0, W, 0);
    if (playerWon) {
      barGrad.addColorStop(0, 'rgba(76, 175, 80, 0.6)');
      barGrad.addColorStop(0.5, 'rgba(76, 175, 80, 0.2)');
      barGrad.addColorStop(1, 'rgba(76, 175, 80, 0.6)');
    } else {
      barGrad.addColorStop(0, 'rgba(239, 68, 68, 0.6)');
      barGrad.addColorStop(0.5, 'rgba(239, 68, 68, 0.2)');
      barGrad.addColorStop(1, 'rgba(239, 68, 68, 0.6)');
    }
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, 0, W, 4);

    // --- Title: SHADOW DRIVER ---
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SHADOW DRIVER', W / 2, 36);

    // --- Track name + laps ---
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '13px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${trackName}  |  ${laps} Lap${laps !== 1 ? 's' : ''}`, W / 2, 58);

    // --- Victory / Defeated badge ---
    const badgeY = 100;
    const badgeText = playerWon ? 'VICTORY' : 'DEFEATED';
    const badgeColor = playerWon ? '#4CAF50' : '#EF4444';
    const badgeBgColor = playerWon ? 'rgba(76, 175, 80, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    const badgeBorderColor = playerWon ? 'rgba(76, 175, 80, 0.4)' : 'rgba(239, 68, 68, 0.4)';

    // Badge pill background
    ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
    const badgeMetrics = ctx.measureText(badgeText);
    const badgePadX = 28;
    const badgePadY = 10;
    const badgeW = badgeMetrics.width + badgePadX * 2;
    const badgeH = 48;
    const badgeX = (W - badgeW) / 2;

    // Rounded rect
    const radius = 8;
    ctx.beginPath();
    ctx.moveTo(badgeX + radius, badgeY - badgeH / 2);
    ctx.lineTo(badgeX + badgeW - radius, badgeY - badgeH / 2);
    ctx.quadraticCurveTo(badgeX + badgeW, badgeY - badgeH / 2, badgeX + badgeW, badgeY - badgeH / 2 + radius);
    ctx.lineTo(badgeX + badgeW, badgeY + badgeH / 2 - radius);
    ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH / 2, badgeX + badgeW - radius, badgeY + badgeH / 2);
    ctx.lineTo(badgeX + radius, badgeY + badgeH / 2);
    ctx.quadraticCurveTo(badgeX, badgeY + badgeH / 2, badgeX, badgeY + badgeH / 2 - radius);
    ctx.lineTo(badgeX, badgeY - badgeH / 2 + radius);
    ctx.quadraticCurveTo(badgeX, badgeY - badgeH / 2, badgeX + radius, badgeY - badgeH / 2);
    ctx.closePath();

    ctx.fillStyle = badgeBgColor;
    ctx.fill();
    ctx.strokeStyle = badgeBorderColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Badge text
    ctx.fillStyle = badgeColor;
    ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, W / 2, badgeY + 1);

    // --- Race time (big monospace) ---
    ctx.textBaseline = 'alphabetic';
    const raceTimeStr = result.player_time != null ? formatRaceTime(result.player_time) : 'DNF';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 52px "Courier New", "SF Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(raceTimeStr, W / 2, 180);

    // --- Gap to AI ---
    if (gap != null) {
      const gapStr = gap < 0
        ? `-${Math.abs(gap).toFixed(1)}s ahead`
        : `+${gap.toFixed(1)}s behind`;
      ctx.fillStyle = playerWon ? '#4CAF50' : '#EF4444';
      ctx.font = 'bold 18px "Courier New", "SF Mono", monospace';
      ctx.fillText(gapStr, W / 2, 210);
    }

    // --- Divider line ---
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 235);
    ctx.lineTo(W - 60, 235);
    ctx.stroke();

    // --- Stats row ---
    const statsY = 272;
    const statsLabelY = statsY - 20;
    const colW = (W - 120) / 3;
    const statsStartX = 60;

    // Top Speed
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TOP SPEED', statsStartX + colW * 0.5, statsLabelY);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 22px "Courier New", "SF Mono", monospace';
    ctx.fillText(`${topSpeed.toFixed(0)} km/h`, statsStartX + colW * 0.5, statsY);

    // Difficulty
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillText('DIFFICULTY', statsStartX + colW * 1.5, statsLabelY);
    const diffColor = difficulty === 'Easy' ? '#4CAF50' : difficulty === 'Medium' ? '#F59E0B' : '#EF4444';
    ctx.fillStyle = diffColor;
    ctx.font = 'bold 22px "Courier New", "SF Mono", monospace';
    ctx.fillText(difficulty, statsStartX + colW * 1.5, statsY);

    // Collisions
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillText('COLLISIONS', statsStartX + colW * 2.5, statsLabelY);
    ctx.fillStyle = collisions === 0 ? '#4CAF50' : '#F59E0B';
    ctx.font = 'bold 22px "Courier New", "SF Mono", monospace';
    ctx.fillText(String(collisions), statsStartX + colW * 2.5, statsY);

    // --- Lap times row (if multiple laps) ---
    if (result.player_laps.length > 1) {
      const lapRowY = 310;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';

      const lapStrings = result.player_laps.map((lap, i) =>
        `L${i + 1}: ${formatRaceTime(lap)}`
      );
      ctx.fillText(lapStrings.join('   |   '), W / 2, lapRowY);
    }

    // --- Bottom divider ---
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 340);
    ctx.lineTo(W - 60, 340);
    ctx.stroke();

    // --- URL at bottom ---
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('shadow-driver-v3.vercel.app', W / 2, 370);

    // --- Bottom accent bar ---
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, H - 4, W, 4);
  }, [result, raceSettings, playerWon, trackName, laps, difficulty, topSpeed, collisions, gap]);

  /** Get canvas as PNG blob */
  const getBlob = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      renderCard();
      const canvas = canvasRef.current;
      if (!canvas) {
        reject(new Error('Canvas not available'));
        return;
      }
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create blob'));
      }, 'image/png');
    });
  }, [renderCard]);

  /** Share or download the card */
  const handleShare = useCallback(async () => {
    setShareState('sharing');
    try {
      const blob = await getBlob();
      const file = new File([blob], 'shadow-driver-result.png', { type: 'image/png' });

      // Try Web Share API (mobile-friendly, supports file sharing)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `Shadow Driver - ${playerWon ? 'Victory' : 'Race Result'}`,
          text: result.player_time != null
            ? `I ${playerWon ? 'beat' : 'raced against'} the AI in ${formatRaceTime(result.player_time)}!`
            : 'Check out my race result!',
          files: [file],
        });
        setShareState('idle');
        return;
      }

      // Try clipboard (desktop)
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
          setShareState('copied');
          setTimeout(() => setShareState('idle'), 2500);
          return;
        } catch {
          // Clipboard failed, fall through to download
        }
      }

      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shadow-driver-result.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShareState('downloaded');
      setTimeout(() => setShareState('idle'), 2500);
    } catch {
      setShareState('error');
      setTimeout(() => setShareState('idle'), 2500);
    }
  }, [getBlob, playerWon, result.player_time]);

  // Render card preview on mount / data change
  const canvasCallbackRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (node) {
        (canvasRef as React.MutableRefObject<HTMLCanvasElement>).current = node;
        // Small delay to ensure fonts are loaded
        setTimeout(() => renderCard(), 50);
      }
    },
    [renderCard],
  );

  const buttonLabel =
    shareState === 'sharing'
      ? 'Sharing...'
      : shareState === 'copied'
        ? 'Copied to clipboard!'
        : shareState === 'downloaded'
          ? 'Downloaded!'
          : shareState === 'error'
            ? 'Share failed'
            : 'Share Result Card';

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Canvas preview */}
      <canvas
        ref={canvasCallbackRef}
        width={600}
        height={400}
        className="rounded-lg border border-white/10 w-full max-w-[600px]"
        style={{ imageRendering: 'auto' }}
      />

      {/* Share button */}
      <button
        onClick={handleShare}
        disabled={shareState === 'sharing'}
        className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
          shareState === 'copied' || shareState === 'downloaded'
            ? 'bg-player/20 border border-player/40 text-player'
            : shareState === 'error'
              ? 'bg-warning/20 border border-warning/40 text-warning'
              : 'bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 hover:text-white'
        }`}
      >
        {/* Share icon */}
        {shareState === 'copied' || shareState === 'downloaded' ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        )}
        {buttonLabel}
      </button>
    </div>
  );
}
