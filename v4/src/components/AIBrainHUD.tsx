/**
 * AIBrainHUD - Neural Network Explainability overlay showing what the AI "sees and thinks".
 *
 * Displays:
 * - Camera preview: downscaled view of what the AI camera sees (placeholder using main game frame)
 * - Attention heatmap: simulated Grad-CAM visualization based on current telemetry
 * - Control prediction bars: steering, throttle, brake from actual AI telemetry
 * - Confidence meter: simulated based on driving conditions
 * - Decision text: natural language description of AI's current strategy
 *
 * Toggle with 'B' key during racing.
 * When the real PilotNet model is deployed, replace simulated data with actual model outputs.
 */

import { useRef, useEffect, useCallback, useState } from 'react';

export interface AIBrainHUDProps {
  steer: number;       // AI steering -1 to 1
  throttle: number;    // AI throttle 0-1
  brake: number;       // AI brake 0-1
  speed: number;       // AI speed km/h
  playerGap: number;   // Gap to player in seconds (positive = AI behind)
  isVisible: boolean;
  className?: string;
}

/** Compute a simulated confidence percentage from driving telemetry */
function computeConfidence(speed: number, steer: number, brake: number, throttle: number): number {
  // Base confidence: high on straights at constant speed
  let confidence = 85;

  // Sharp steering reduces confidence
  const absSteer = Math.abs(steer);
  if (absSteer > 0.5) {
    confidence -= (absSteer - 0.5) * 40; // up to -20 for full lock
  } else if (absSteer > 0.2) {
    confidence -= (absSteer - 0.2) * 15; // mild reduction for gentle turns
  }

  // Hard braking reduces confidence (emergency situation)
  if (brake > 0.5) {
    confidence -= (brake - 0.5) * 30;
  }

  // Very high speed slightly reduces confidence (pushing limits)
  if (speed > 120) {
    confidence -= (speed - 120) * 0.1;
  }

  // Very low speed with throttle suggests recovery/restart -- lower confidence
  if (speed < 10 && throttle > 0.3) {
    confidence -= 15;
  }

  // Full throttle on straight = very confident
  if (throttle > 0.8 && absSteer < 0.1 && speed > 30) {
    confidence += 8;
  }

  return Math.max(15, Math.min(98, confidence));
}

/** Generate a natural language decision string from current AI state */
function computeDecision(steer: number, throttle: number, brake: number, speed: number, playerGap: number): string {
  const absSteer = Math.abs(steer);
  const direction = steer < -0.1 ? 'left' : steer > 0.1 ? 'right' : null;

  // Priority: braking
  if (brake > 0.6) {
    if (absSteer > 0.3) {
      return `Braking hard into ${direction === 'left' ? 'left' : 'right'} turn`;
    }
    return 'Heavy braking for upcoming corner';
  }
  if (brake > 0.2) {
    return `Trail braking, ${direction ? `turning ${direction}` : 'scrubbing speed'}`;
  }

  // Cornering
  if (absSteer > 0.5) {
    if (throttle > 0.5) {
      return `Power through ${direction === 'left' ? 'sweeping left' : 'sweeping right'}`;
    }
    return `Tight ${direction === 'left' ? 'left' : 'right'} turn, managing grip`;
  }
  if (absSteer > 0.15) {
    if (speed > 80) {
      return `High-speed ${direction} adjustment`;
    }
    return `Gentle ${direction} correction`;
  }

  // Straight line
  if (throttle > 0.8 && speed > 60) {
    if (playerGap > 1) {
      return 'Closing gap, full throttle on straight';
    }
    if (playerGap < -1) {
      return 'Controlling pace in the lead';
    }
    return 'Full throttle on the straight';
  }

  if (speed < 10) {
    if (throttle > 0.3) {
      return 'Accelerating from standstill';
    }
    return 'Recovering position...';
  }

  if (playerGap > 0 && playerGap < 1.5) {
    return 'Right behind, looking for overtake';
  }
  if (playerGap < 0 && Math.abs(playerGap) < 1.5) {
    return 'Defending position against player';
  }

  return 'Maintaining optimal racing line';
}

/** Draw a simulated Grad-CAM attention heatmap on a canvas */
function drawAttentionHeatmap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  steer: number,
  speed: number,
  brake: number,
  time: number,
) {
  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Create image data for pixel-level control
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // Determine attention hotspot positions
  // Primary hotspot: shifts left/right with steering
  const primaryX = width * 0.5 + steer * width * 0.35;
  // At high speed, attention focuses on horizon (upper center)
  const horizonBias = Math.min(1, speed / 120);
  const primaryY = height * (0.55 - horizonBias * 0.25);

  // Secondary hotspot: slight wobble for realism
  const wobble = Math.sin(time * 0.003) * 8;
  const secondaryX = width * 0.5 + wobble;
  const secondaryY = height * 0.3;

  // Hotspot sizes
  const primarySigmaX = width * (0.25 + Math.abs(steer) * 0.1);
  const primarySigmaY = height * 0.35;
  const secondarySigmaX = width * 0.18;
  const secondarySigmaY = height * 0.22;

  // Braking: broader, more scattered attention
  const brakingSpread = brake * 0.4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Gaussian blob for primary attention
      const dx1 = (x - primaryX) / (primarySigmaX * (1 + brakingSpread));
      const dy1 = (y - primaryY) / (primarySigmaY * (1 + brakingSpread));
      const g1 = Math.exp(-0.5 * (dx1 * dx1 + dy1 * dy1));

      // Gaussian blob for secondary attention (horizon scanning)
      const dx2 = (x - secondaryX) / secondarySigmaX;
      const dy2 = (y - secondaryY) / secondarySigmaY;
      const g2 = Math.exp(-0.5 * (dx2 * dx2 + dy2 * dy2)) * 0.4;

      // Combine: max of the two blobs
      let intensity = Math.min(1, Math.max(g1, g2));

      // Add subtle noise for realism
      const noise = (Math.sin(x * 0.5 + y * 0.3 + time * 0.002) * 0.5 + 0.5) * 0.08;
      intensity = Math.min(1, intensity + noise * intensity);

      // Heatmap color gradient: blue -> cyan -> green -> yellow -> red
      let r = 0, g = 0, b = 0, a = 0;
      if (intensity < 0.01) {
        // Below threshold: transparent
        a = 0;
      } else {
        a = Math.floor(intensity * 180); // Semi-transparent

        if (intensity < 0.25) {
          // Blue to cyan
          const t = intensity / 0.25;
          r = 0;
          g = Math.floor(t * 180);
          b = Math.floor(180 - t * 60);
        } else if (intensity < 0.5) {
          // Cyan to green
          const t = (intensity - 0.25) / 0.25;
          r = 0;
          g = Math.floor(180 + t * 75);
          b = Math.floor(120 - t * 120);
        } else if (intensity < 0.75) {
          // Green to yellow
          const t = (intensity - 0.5) / 0.25;
          r = Math.floor(t * 255);
          g = 255;
          b = 0;
        } else {
          // Yellow to red
          const t = (intensity - 0.75) / 0.25;
          r = 255;
          g = Math.floor(255 - t * 255);
          b = 0;
        }
      }

      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function AIBrainHUD({ steer, throttle, brake, speed, playerGap, isVisible, className = '' }: AIBrainHUDProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [confidence, setConfidence] = useState(85);
  const [decision, setDecision] = useState('Analyzing track...');

  // Smooth confidence transitions
  const smoothConfidenceRef = useRef(85);

  // Update decision and confidence from telemetry
  useEffect(() => {
    if (!isVisible) return;
    const newConfidence = computeConfidence(speed, steer, brake, throttle);
    // Smooth confidence: lerp toward target
    smoothConfidenceRef.current += (newConfidence - smoothConfidenceRef.current) * 0.15;
    setConfidence(Math.round(smoothConfidenceRef.current));
    setDecision(computeDecision(steer, throttle, brake, speed, playerGap));
  }, [steer, throttle, brake, speed, playerGap, isVisible]);

  // Animate the attention heatmap
  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isVisible) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawAttentionHeatmap(ctx, canvas.width, canvas.height, steer, speed, brake, performance.now());
    animFrameRef.current = requestAnimationFrame(drawHeatmap);
  }, [steer, speed, brake, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }
    animFrameRef.current = requestAnimationFrame(drawHeatmap);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isVisible, drawHeatmap]);

  if (!isVisible) return null;

  const confidenceColor =
    confidence >= 80 ? '#4CAF50' :
    confidence >= 50 ? '#FF9800' :
    '#f44336';

  return (
    <div
      className={`absolute top-28 right-4 z-20 pointer-events-none ${className}`}
      style={{ animation: 'aibrain-fade-in 0.3s ease-out forwards' }}
    >
      <style>{`
        @keyframes aibrain-fade-in {
          0% { opacity: 0; transform: translateX(20px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes aibrain-pulse {
          0%, 100% { box-shadow: 0 0 8px rgba(0,210,255,0.2); }
          50% { box-shadow: 0 0 16px rgba(0,210,255,0.4); }
        }
      `}</style>
      <div
        className="bg-black/75 backdrop-blur-md rounded-lg border border-cyan-500/30 overflow-hidden"
        style={{
          width: '260px',
          animation: 'aibrain-pulse 3s ease-in-out infinite',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-cyan-900/30 border-b border-cyan-500/20">
          <BrainIcon />
          <span className="text-cyan-400 text-[11px] font-mono font-bold uppercase tracking-widest">AI Brain</span>
          <span className="ml-auto text-cyan-500/40 text-[9px] font-mono">LIVE</span>
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        </div>

        {/* Camera Feed + Attention Heatmap side by side */}
        <div className="flex gap-px p-2 pb-1">
          {/* Camera feed placeholder (dark gradient simulating a road view) */}
          <div className="relative flex-1">
            <div className="text-[8px] font-mono text-white/30 mb-0.5 uppercase tracking-wider">Input</div>
            <div
              className="rounded overflow-hidden border border-white/10"
              style={{ width: '112px', height: '37px' }}
            >
              {/* Simulated camera feed: gradient representing road + sky */}
              <div
                className="w-full h-full"
                style={{
                  background: 'linear-gradient(180deg, #1a2a3a 0%, #2a3a4a 35%, #3a3a3a 50%, #4a4a4a 70%, #3a3a3a 100%)',
                }}
              >
                {/* Road lines (simulated) */}
                <svg width="112" height="37" viewBox="0 0 112 37" className="absolute inset-0">
                  <line x1="40" y1="37" x2="53" y2="18" stroke="white" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="3,3" />
                  <line x1="72" y1="37" x2="59" y2="18" stroke="white" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="3,3" />
                  <line x1="56" y1="37" x2="56" y2="18" stroke="white" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="2,4" />
                </svg>
              </div>
            </div>
          </div>

          {/* Attention heatmap */}
          <div className="relative flex-1">
            <div className="text-[8px] font-mono text-white/30 mb-0.5 uppercase tracking-wider">Attention</div>
            <div
              className="rounded overflow-hidden border border-white/10 relative"
              style={{ width: '112px', height: '37px' }}
            >
              {/* Dark background to show heatmap over */}
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(180deg, #0a1520 0%, #151f2a 50%, #1a2530 100%)',
                }}
              />
              <canvas
                ref={canvasRef}
                width={112}
                height={37}
                className="absolute inset-0 w-full h-full"
              />
            </div>
          </div>
        </div>

        {/* Control prediction bars */}
        <div className="px-3 pb-1 space-y-1">
          <ControlBar label="Steer" value={steer} min={-1} max={1} centered color="#2196F3" />
          <ControlBar label="Throt" value={throttle} min={0} max={1} color="#4CAF50" />
          <ControlBar label="Brake" value={brake} min={0} max={1} color="#f44336" />
        </div>

        {/* Confidence meter */}
        <div className="px-3 pb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-white/40 w-[52px]">Confidence</span>
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${confidence}%`,
                  backgroundColor: confidenceColor,
                  opacity: 0.8,
                  boxShadow: `0 0 6px ${confidenceColor}60`,
                }}
              />
            </div>
            <span
              className="text-[10px] font-mono font-bold min-w-[28px] text-right"
              style={{ color: confidenceColor }}
            >
              {confidence}%
            </span>
          </div>
        </div>

        {/* Decision text */}
        <div className="px-3 pb-2 border-t border-white/5 pt-1.5">
          <div
            className="text-[10px] font-mono text-cyan-300/70 leading-tight"
            style={{ minHeight: '14px' }}
          >
            &quot;{decision}&quot;
          </div>
        </div>
      </div>
    </div>
  );
}

/** Horizontal control bar for steering/throttle/brake */
function ControlBar({ label, value, min, max, centered, color }: {
  label: string;
  value: number;
  min: number;
  max: number;
  centered?: boolean;
  color: string;
}) {
  const range = max - min;
  const normalizedValue = (value - min) / range; // 0 to 1

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-white/40 w-[52px]">{label}</span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden relative">
        {centered ? (
          // Centered bar: grows from middle
          <div
            className="absolute top-0 h-full rounded-full transition-all duration-100"
            style={{
              backgroundColor: color,
              opacity: 0.7,
              left: normalizedValue < 0.5
                ? `${normalizedValue * 100}%`
                : '50%',
              width: `${Math.abs(normalizedValue - 0.5) * 100}%`,
              boxShadow: Math.abs(value) > 0.3 ? `0 0 4px ${color}60` : 'none',
            }}
          />
        ) : (
          <div
            className="absolute top-0 left-0 h-full rounded-full transition-all duration-100"
            style={{
              backgroundColor: color,
              opacity: 0.7,
              width: `${normalizedValue * 100}%`,
              boxShadow: value > 0.5 ? `0 0 4px ${color}60` : 'none',
            }}
          />
        )}
        {/* Center line for centered bars */}
        {centered && (
          <div className="absolute top-0 left-1/2 w-px h-full bg-white/20" />
        )}
      </div>
      <span className="text-[9px] font-mono text-white/50 min-w-[28px] text-right">
        {centered ? (value > 0 ? '+' : '') + value.toFixed(2) : value.toFixed(2)}
      </span>
    </div>
  );
}

/** Small brain/neural-network icon */
function BrainIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
      {/* Simplified brain outline */}
      <path d="M12 2C8 2 5 5 5 8c0 1.5.5 3 1.5 4C5.5 13 5 14.5 5 16c0 3 3 6 7 6s7-3 7-6c0-1.5-.5-3-1.5-4 1-1 1.5-2.5 1.5-4 0-3-3-6-7-6z" />
      {/* Neural connections */}
      <path d="M12 2v20" strokeOpacity="0.3" />
      <path d="M8 6c2 1 4 1 6 0" strokeOpacity="0.4" />
      <path d="M7 12c2.5 1.5 5.5 1.5 8 0" strokeOpacity="0.4" />
      <path d="M8 18c2-1 4-1 6 0" strokeOpacity="0.4" />
    </svg>
  );
}
