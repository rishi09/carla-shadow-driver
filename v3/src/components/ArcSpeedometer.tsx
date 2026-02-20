import { useMemo } from 'react';
import { useInterpolatedState } from '../hooks/useInterpolatedState.ts';

interface ArcSpeedometerProps {
  speedKmh: number;
  maxSpeed?: number;
  size?: number;
}

const TICK_VALUES = [0, 50, 100, 150, 200];
// Arc spans from 220deg to 320deg (going clockwise)
// In SVG coordinate system: 0deg is 3 o'clock, angles go clockwise
// We want the arc from bottom-left (~220deg) to bottom-right (~320deg)
// Total sweep: 260 degrees
const ARC_START_DEG = 135;  // 7:30 position
const ARC_END_DEG = 405;    // 1:30 position (135 + 270)
const ARC_SWEEP_DEG = ARC_END_DEG - ARC_START_DEG; // 270 degrees

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = degToRad(angleDeg);
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/**
 * SVG-based arc speedometer with animated needle and gradient color.
 * Styled to match the existing HUD aesthetic (dark glass, translucent).
 */
export function ArcSpeedometer({ speedKmh, maxSpeed = 220, size = 120 }: ArcSpeedometerProps) {
  const smoothSpeed = useInterpolatedState(speedKmh);
  const displaySpeed = Math.round(Math.max(0, smoothSpeed));

  // SVG viewBox dimensions
  const viewSize = 100;
  const cx = viewSize / 2;
  const cy = viewSize / 2;
  const outerR = 42;
  const tickOuterR = 44;
  const tickInnerR = 38;
  const tickLabelR = 32;
  const needleR = 39;

  // Calculate needle angle
  const speedFraction = Math.min(1, Math.max(0, smoothSpeed / maxSpeed));
  const needleAngle = ARC_START_DEG + speedFraction * ARC_SWEEP_DEG;

  // Background arc path (full arc)
  const bgArcPath = useMemo(
    () => describeArc(cx, cy, outerR, ARC_START_DEG, ARC_END_DEG),
    [cx, cy]
  );

  // Colored fill arc (up to current speed)
  const fillEndDeg = ARC_START_DEG + speedFraction * ARC_SWEEP_DEG;
  const fillArcPath = useMemo(
    () => {
      if (speedFraction < 0.005) return '';
      return describeArc(cx, cy, outerR, ARC_START_DEG, fillEndDeg);
    },
    [cx, cy, fillEndDeg, speedFraction]
  );

  // Tick marks
  const ticks = useMemo(() => {
    return TICK_VALUES.map((val) => {
      const frac = val / maxSpeed;
      const angle = ARC_START_DEG + frac * ARC_SWEEP_DEG;
      const outer = polarToCartesian(cx, cy, tickOuterR, angle);
      const inner = polarToCartesian(cx, cy, tickInnerR, angle);
      const label = polarToCartesian(cx, cy, tickLabelR, angle);
      return { val, outer, inner, label, angle };
    });
  }, [cx, cy, maxSpeed]);

  // Needle tip
  const needleTip = polarToCartesian(cx, cy, needleR, needleAngle);

  // Color for the current speed value text
  const speedColor = useMemo(() => {
    if (displaySpeed < 80) return '#4CAF50';
    if (displaySpeed < 140) return '#FFD700';
    return '#f44336';
  }, [displaySpeed]);

  // Gradient ID unique per instance (in case multiple exist)
  const gradId = 'arc-speed-grad';

  return (
    <div style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${viewSize} ${viewSize}`} width={size} height={size}>
        <defs>
          {/* Gradient for the filled arc: green -> yellow -> red */}
          <linearGradient id={gradId} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4CAF50" />
            <stop offset="45%" stopColor="#FFD700" />
            <stop offset="100%" stopColor="#f44336" />
          </linearGradient>
        </defs>

        {/* Background arc (dim track) */}
        <path
          d={bgArcPath}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="5"
          strokeLinecap="round"
        />

        {/* Colored fill arc */}
        {fillArcPath && (
          <path
            d={fillArcPath}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="5"
            strokeLinecap="round"
            style={{ transition: 'none' }}
          />
        )}

        {/* Tick marks */}
        {ticks.map(({ val, outer, inner, label }) => (
          <g key={val}>
            <line
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth="1"
            />
            <text
              x={label.x}
              y={label.y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="rgba(255,255,255,0.4)"
              fontSize="5.5"
              fontFamily="monospace"
            >
              {val}
            </text>
          </g>
        ))}

        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke={speedColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 3px ${speedColor}80)`,
            transition: 'none',
          }}
        />

        {/* Center dot */}
        <circle cx={cx} cy={cy} r="2.5" fill={speedColor} opacity="0.8" />
        <circle cx={cx} cy={cy} r="1.2" fill="white" opacity="0.9" />

        {/* Speed number in center */}
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontSize="14"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {displaySpeed}
        </text>

        {/* km/h label */}
        <text
          x={cx}
          y={cy + 20}
          textAnchor="middle"
          dominantBaseline="central"
          fill="rgba(255,255,255,0.45)"
          fontSize="5"
          fontFamily="monospace"
        >
          km/h
        </text>
      </svg>
    </div>
  );
}
