/**
 * DebugOverlay.tsx - Real-time performance debug panel
 *
 * Toggle with backtick/tilde (~) key.
 * Shows FPS, latency, JPEG quality, resolution, frame size, encode time,
 * connection state, codec, and skip rate -- everything needed to diagnose
 * choppiness, quality drops, and connection issues in the cloud-streamed game.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { PerfStats, WebSocketConnectionState } from '../types/index.ts';

export interface DebugOverlayProps {
  /** Current WebSocket connection state */
  connectionState: WebSocketConnectionState;
  /** Round-trip latency in ms (from ping/pong) */
  latencyMs: number | null;
  /** performance.now() timestamp of the last received binary frame */
  lastFrameTime: number;
  /** Server-sent perf stats (quality, encode time, frame size, resolution) */
  perfStats: PerfStats | null;
  /** Total no_change messages received (delta-skipped frames) */
  noChangeCount: number;
  /** Total binary frames received */
  totalFrameCount: number;
  /** WebRTC data channel state */
  dataChannelState: string;
}

/** Rolling window for computing client-side FPS */
const FPS_WINDOW_MS = 1000;

export function DebugOverlay({
  connectionState,
  latencyMs,
  lastFrameTime,
  perfStats,
  noChangeCount,
  totalFrameCount,
  dataChannelState,
}: DebugOverlayProps) {
  const [visible, setVisible] = useState(false);

  // --- Client-side FPS calculation (frames received per second) ---
  const frameTimesRef = useRef<number[]>([]);
  const [clientFps, setClientFps] = useState(0);
  const [avgFrameBytes, setAvgFrameBytes] = useState(0);
  const prevFrameTimeRef = useRef(0);

  // Track frame sizes for average calculation (from binary messages)

  // Update client FPS whenever a new frame arrives
  useEffect(() => {
    if (lastFrameTime === 0 || lastFrameTime === prevFrameTimeRef.current) return;
    prevFrameTimeRef.current = lastFrameTime;

    const now = lastFrameTime;
    const frameTimes = frameTimesRef.current;
    frameTimes.push(now);

    // Trim to window
    const cutoff = now - FPS_WINDOW_MS;
    while (frameTimes.length > 0 && frameTimes[0] < cutoff) {
      frameTimes.shift();
    }

    setClientFps(frameTimes.length);
  }, [lastFrameTime]);

  // Compute average frame size from perfStats (server provides avg_frame_size_kb)
  useEffect(() => {
    if (perfStats) {
      setAvgFrameBytes(Math.round(perfStats.avg_frame_size_kb * 1024));
    }
  }, [perfStats]);

  // Compute skip rate
  const skipRate = useCallback(() => {
    const total = totalFrameCount + noChangeCount;
    if (total === 0) return 0;
    return noChangeCount / total;
  }, [totalFrameCount, noChangeCount]);

  // --- Toggle with backtick/tilde key ---
  // Use e.code === 'Backquote' as primary check (works regardless of shift/dead-key state),
  // with e.key fallback for non-standard keyboards. // Tuned for high-latency playability
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Backquote' || e.key === '`' || e.key === '~') {
        e.preventDefault();
        e.stopPropagation();
        setVisible(prev => !prev);
      }
    };
    // Use capture phase so this fires before other keydown handlers that might interfere
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  if (!visible) return null;

  // Determine codec in use
  const codec = perfStats
    ? (perfStats.resolution?.includes('h264') ? 'h264' : 'jpeg')
    : 'jpeg';

  // Latency color coding
  const latencyColor = latencyMs == null
    ? '#888'
    : latencyMs < 100 ? '#4ade80'    // green: excellent
    : latencyMs < 200 ? '#facc15'    // yellow: acceptable
    : latencyMs < 400 ? '#fb923c'    // orange: concerning
    : '#f87171';                     // red: bad

  // FPS color coding (target 30 fps)
  const serverFps = perfStats?.fps ?? 0;
  const fpsColor = (fps: number) =>
    fps >= 25 ? '#4ade80'
    : fps >= 15 ? '#facc15'
    : fps >= 5 ? '#fb923c'
    : '#f87171';

  // Connection state indicator
  const connColor = connectionState === 'connected' ? '#4ade80'
    : connectionState === 'connecting' ? '#facc15'
    : '#f87171';

  const connLabel = connectionState === 'connected' ? 'CONNECTED'
    : connectionState === 'connecting' ? 'CONNECTING'
    : 'DISCONNECTED';

  // Data channel label
  const dcLabel = dataChannelState === 'open' ? 'UDP'
    : dataChannelState === 'connecting' ? 'UDP...'
    : 'TCP';
  const dcColor = dataChannelState === 'open' ? '#4ade80'
    : dataChannelState === 'connecting' ? '#facc15'
    : '#888';

  const sr = skipRate();

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(6px)',
        borderRadius: 6,
        padding: '8px 12px',
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace',
        fontSize: 11,
        lineHeight: '17px',
        color: '#ccc',
        pointerEvents: 'none',
        userSelect: 'none',
        border: '1px solid rgba(255,255,255,0.08)',
        minWidth: 200,
      }}
    >
      {/* Title bar */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: '#888',
          marginBottom: 4,
          textTransform: 'uppercase',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          paddingBottom: 3,
        }}
      >
        DEBUG
      </div>

      {/* Connection state */}
      <Row label="conn" value={connLabel} valueColor={connColor} />
      <Row label="transport" value={dcLabel} valueColor={dcColor} />
      <Row label="codec" value={codec.toUpperCase()} />

      <Divider />

      {/* Timing */}
      <Row
        label="client fps"
        value={`${clientFps}`}
        valueColor={fpsColor(clientFps)}
      />
      <Row
        label="server fps"
        value={serverFps > 0 ? `${serverFps}` : '--'}
        valueColor={serverFps > 0 ? fpsColor(serverFps) : '#888'}
      />
      <Row
        label="latency"
        value={latencyMs != null ? `${latencyMs} ms` : '--'}
        valueColor={latencyColor}
      />
      <Row
        label="encode"
        value={perfStats ? `${perfStats.avg_encode_ms} ms` : '--'}
      />

      <Divider />

      {/* Quality */}
      <Row
        label="quality"
        value={perfStats ? `${perfStats.quality}%` : '--'}
      />
      <Row
        label="resolution"
        value={perfStats?.resolution ?? '--'}
      />
      <Row
        label="frame size"
        value={avgFrameBytes > 0 ? formatBytes(avgFrameBytes) : '--'}
      />
      <Row
        label="skip rate"
        value={`${(sr * 100).toFixed(1)}%`}
        valueColor={sr > 0.3 ? '#fb923c' : sr > 0.1 ? '#facc15' : '#4ade80'}
      />

      <Divider />

      {/* Totals */}
      <Row label="frames rx" value={`${totalFrameCount}`} />
      <Row label="skipped" value={`${noChangeCount}`} />
      {perfStats?.frames_sent != null && (
        <Row label="frames tx" value={`${perfStats.frames_sent}`} />
      )}
      {perfStats?.auto_reduced && (
        <Row label="auto-reduced" value="YES" valueColor="#fb923c" />
      )}
      {perfStats?.speed_downscaled && (
        <Row label="downscaled" value="YES" valueColor="#facc15" />
      )}
    </div>
  );
}

/** Single row: label on left, value on right */
function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ color: '#777' }}>{label}</span>
      <span style={{ color: valueColor ?? '#ccc', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

/** Thin divider line */
function Divider() {
  return (
    <div
      style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        margin: '4px 0',
      }}
    />
  );
}

/** Format byte count to human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}
