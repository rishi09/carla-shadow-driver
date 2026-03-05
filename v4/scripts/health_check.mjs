#!/usr/bin/env node
/**
 * health_check.mjs - Shadow Driver v3 server health check
 *
 * Connects to the game server via WebSocket, performs a handshake,
 * starts a race, receives frames for 30 seconds, and reports
 * performance metrics.
 *
 * Usage:
 *   node scripts/health_check.mjs [ws_url] [--duration=30]
 *
 * Examples:
 *   node scripts/health_check.mjs
 *   node scripts/health_check.mjs ws://localhost:8765
 *   node scripts/health_check.mjs wss://abc-xyz.trycloudflare.com --duration=15
 */

import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let serverUrl = 'ws://localhost:8765';
let durationSeconds = 30;

for (const arg of args) {
  if (arg.startsWith('--duration=')) {
    durationSeconds = parseInt(arg.split('=')[1], 10);
    if (isNaN(durationSeconds) || durationSeconds <= 0) {
      console.error('Error: --duration must be a positive integer');
      process.exit(1);
    }
  } else if (arg.startsWith('ws://') || arg.startsWith('wss://')) {
    serverUrl = arg;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Shadow Driver v3 Health Check

Usage:
  node scripts/health_check.mjs [ws_url] [--duration=30]

Options:
  ws_url          WebSocket URL (default: ws://localhost:8765)
  --duration=N    How many seconds to receive frames (default: 30)
  --help, -h      Show this help message
`);
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Metrics state
// ---------------------------------------------------------------------------

const metrics = {
  // Connection
  connectStartTime: 0,
  connectEndTime: 0,
  handshakeAckTime: 0,
  handshakeSentTime: 0,

  // Frames
  totalFrames: 0,           // Binary messages with 0x00 prefix (main camera JPEG)
  totalFrameBytes: 0,
  rearViewFrames: 0,        // Binary messages with 0x01 prefix
  h264Keyframes: 0,         // Binary messages with 0x10 prefix
  h264DeltaFrames: 0,       // Binary messages with 0x11 prefix
  codecConfigReceived: false, // Any 0x12 prefix messages
  codecConfigDetails: null,

  // JSON messages
  raceStateCount: 0,
  noChangeCount: 0,         // 'no_change' messages (skipped frames)
  pongCount: 0,
  commentaryCount: 0,
  perfStatsCount: 0,
  otherJsonCount: 0,
  errorMessages: [],

  // Latency (ping/pong round-trip)
  latencies: [],
  pingsSent: 0,
  pongsReceived: 0,

  // Race state
  raceStarted: false,
  raceFinished: false,
  lastRaceStatus: null,
  models: [],
  serverName: null,

  // Timing
  frameReceiveStart: 0,
  frameReceiveEnd: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now() {
  return performance.now();
}

function formatMs(ms) {
  return `${Math.round(ms)}ms`;
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('=== Shadow Driver Health Check ===');
console.log(`Server: ${serverUrl}`);
console.log(`Duration: ${durationSeconds}s`);
console.log('');

const ws = new WebSocket(serverUrl);
ws.binaryType = 'arraybuffer';

let pingInterval = null;
let durationTimer = null;
let frameCollectionActive = false;

// Track outstanding pings for latency measurement
const pendingPings = new Map(); // timestamp -> send time (performance.now)

function sendPing() {
  if (ws.readyState !== WebSocket.OPEN) return;
  const timestamp = Date.now();
  pendingPings.set(timestamp, now());
  metrics.pingsSent++;
  ws.send(JSON.stringify({ type: 'ping', timestamp }));
}

function finish() {
  // Stop timers
  if (pingInterval) clearInterval(pingInterval);
  if (durationTimer) clearTimeout(durationTimer);

  metrics.frameReceiveEnd = now();

  // Close connection gracefully
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close(1000, 'Health check complete');
  }

  printReport();
  process.exit(metrics.errorMessages.length > 0 ? 1 : 0);
}

function printReport() {
  const elapsed = (metrics.frameReceiveEnd - metrics.frameReceiveStart) / 1000;
  const effectiveDuration = elapsed > 0 ? elapsed : durationSeconds;

  console.log('');
  console.log('=== Shadow Driver Health Check ===');
  console.log(`Server: ${serverUrl}`);
  console.log(`Duration: ${effectiveDuration.toFixed(1)}s`);
  console.log('');

  // Connection
  if (metrics.handshakeAckTime > 0) {
    const handshakeLatency = metrics.handshakeAckTime - metrics.handshakeSentTime;
    console.log(`Connection: OK (handshake_ack in ${formatMs(handshakeLatency)})`);
    if (metrics.serverName) {
      console.log(`Server ID: ${metrics.serverName}`);
    }
    if (metrics.models.length > 0) {
      console.log(`Models: ${metrics.models.join(', ')}`);
    }
  } else {
    console.log('Connection: FAILED (no handshake_ack received)');
  }

  // Codec
  if (metrics.h264Keyframes > 0 || metrics.h264DeltaFrames > 0) {
    const totalH264 = metrics.h264Keyframes + metrics.h264DeltaFrames;
    console.log(`Codec: H.264 (${totalH264} frames: ${metrics.h264Keyframes} keyframes, ${metrics.h264DeltaFrames} delta)`);
  } else if (metrics.codecConfigReceived) {
    const cfg = metrics.codecConfigDetails;
    console.log(`Codec: H.264 negotiated (${cfg?.codec || 'unknown'} ${cfg?.width || '?'}x${cfg?.height || '?'}) but no H.264 frames received`);
  } else {
    console.log('Codec: JPEG (H.264 not negotiated)');
  }

  // Frames
  const fps = effectiveDuration > 0 ? (metrics.totalFrames / effectiveDuration).toFixed(1) : '0.0';
  const avgFrameSize = metrics.totalFrames > 0
    ? formatKB(metrics.totalFrameBytes / metrics.totalFrames)
    : '0.0 KB';

  console.log(`Frames: ${metrics.totalFrames} total (${fps} fps)`);
  console.log(`Avg frame size: ${avgFrameSize}`);

  if (metrics.rearViewFrames > 0) {
    console.log(`Rear-view frames: ${metrics.rearViewFrames}`);
  }

  // Latency
  if (metrics.latencies.length > 0) {
    const sorted = [...metrics.latencies].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    console.log(`Latency: ${formatMs(avg)} avg (min: ${formatMs(min)}, max: ${formatMs(max)}, p50: ${formatMs(p50)}, p95: ${formatMs(p95)})`);
  } else {
    console.log('Latency: N/A (no pong responses)');
  }

  // Skipped frames
  console.log(`Skipped: ${metrics.noChangeCount} frames (no_change messages)`);

  // Telemetry
  console.log(`Telemetry: ${metrics.raceStateCount} race_state messages`);
  if (metrics.commentaryCount > 0) {
    console.log(`Commentary: ${metrics.commentaryCount} messages`);
  }
  if (metrics.perfStatsCount > 0) {
    console.log(`Perf stats: ${metrics.perfStatsCount} reports`);
  }

  // Race status
  if (metrics.raceStarted) {
    console.log(`Race: started (last status: ${metrics.lastRaceStatus || 'unknown'})`);
  } else {
    console.log('Race: NOT started');
  }

  // Errors
  console.log(`Errors: ${metrics.errorMessages.length}`);
  for (const err of metrics.errorMessages) {
    console.log(`  - ${err}`);
  }

  // Verdict
  console.log('');
  const fpsNum = parseFloat(fps);
  const avgLatency = metrics.latencies.length > 0
    ? metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length
    : null;

  if (metrics.errorMessages.length > 0) {
    console.log('Verdict: UNHEALTHY (errors detected)');
  } else if (metrics.totalFrames === 0) {
    console.log('Verdict: UNHEALTHY (no frames received)');
  } else if (metrics.handshakeAckTime === 0) {
    console.log('Verdict: UNHEALTHY (handshake failed)');
  } else if (fpsNum >= 24 && avgLatency !== null && avgLatency < 200) {
    console.log('Verdict: EXCELLENT (smooth gameplay expected)');
  } else if (fpsNum >= 15 && (avgLatency === null || avgLatency < 500)) {
    if (avgLatency !== null && avgLatency >= 200) {
      console.log('Verdict: PLAYABLE (but choppy - high latency)');
    } else {
      console.log('Verdict: GOOD (playable)');
    }
  } else if (fpsNum >= 8) {
    console.log('Verdict: DEGRADED (low fps - may feel sluggish)');
  } else {
    console.log('Verdict: UNPLAYABLE (fps too low)');
  }
}

// ---------------------------------------------------------------------------
// WebSocket event handlers
// ---------------------------------------------------------------------------

ws.on('open', () => {
  metrics.connectEndTime = now();
  const connectTime = metrics.connectEndTime - metrics.connectStartTime;
  console.log(`Connected in ${formatMs(connectTime)}`);

  // Send handshake
  metrics.handshakeSentTime = now();
  ws.send(JSON.stringify({ type: 'handshake', client: 'shadow-driver-v3' }));
  console.log('Sent handshake...');
});

ws.on('message', (data) => {
  // Binary message
  if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length === 0) return;

    const frameType = buf[0];
    const payloadSize = buf.length - 1; // Subtract the 1-byte prefix

    if (frameType === 0x00) {
      // Main camera JPEG frame
      metrics.totalFrames++;
      metrics.totalFrameBytes += payloadSize;
      if (!frameCollectionActive) {
        frameCollectionActive = true;
        metrics.frameReceiveStart = now();
      }
    } else if (frameType === 0x01) {
      // Rear-view mirror JPEG
      metrics.rearViewFrames++;
    } else if (frameType === 0x10) {
      // H.264 keyframe
      metrics.h264Keyframes++;
      metrics.totalFrames++;
      metrics.totalFrameBytes += payloadSize;
      if (!frameCollectionActive) {
        frameCollectionActive = true;
        metrics.frameReceiveStart = now();
      }
    } else if (frameType === 0x11) {
      // H.264 delta frame
      metrics.h264DeltaFrames++;
      metrics.totalFrames++;
      metrics.totalFrameBytes += payloadSize;
      if (!frameCollectionActive) {
        frameCollectionActive = true;
        metrics.frameReceiveStart = now();
      }
    } else if (frameType === 0x12) {
      // Codec config JSON
      metrics.codecConfigReceived = true;
      try {
        const jsonStr = buf.slice(1).toString('utf-8');
        metrics.codecConfigDetails = JSON.parse(jsonStr);
        console.log(`Codec config received: ${metrics.codecConfigDetails.codec} ${metrics.codecConfigDetails.width}x${metrics.codecConfigDetails.height}`);
      } catch (e) {
        console.warn('Failed to parse codec config:', e.message);
      }
    }
    return;
  }

  // Text/JSON message
  let msg;
  try {
    const text = typeof data === 'string' ? data : data.toString();
    msg = JSON.parse(text);
  } catch (e) {
    console.warn('Failed to parse JSON message:', e.message);
    return;
  }

  switch (msg.type) {
    case 'handshake_ack': {
      metrics.handshakeAckTime = now();
      metrics.serverName = msg.server || null;
      metrics.models = msg.models || [];
      const handshakeLatency = metrics.handshakeAckTime - metrics.handshakeSentTime;
      console.log(`Handshake OK (${formatMs(handshakeLatency)})`);
      console.log(`Available models: ${metrics.models.join(', ') || 'none'}`);

      // Send codec negotiation (mimicking the frontend)
      ws.send(JSON.stringify({ type: 'codec_negotiate', codecs: ['h264'] }));

      // Start race after a short delay to let the server settle
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        console.log('Starting race...');
        ws.send(JSON.stringify({
          type: 'start_race',
          track: 'Town03',
          laps: 1,
          weather: 'clear',
          model: 'carla_autopilot',
          player_car: 'vehicle.tesla.model3',
          player_name: 'health_check',
        }));
        metrics.raceStarted = true;

        // Start pinging every 5 seconds to measure latency
        pingInterval = setInterval(sendPing, 5000);
        // Send the first ping immediately
        sendPing();

        // Stop after the configured duration
        durationTimer = setTimeout(() => {
          console.log(`\n${durationSeconds}s elapsed, finishing...`);
          finish();
        }, durationSeconds * 1000);
      }, 500);
      break;
    }

    case 'pong': {
      metrics.pongsReceived++;
      metrics.pongCount++;
      const sendTime = pendingPings.get(msg.timestamp);
      if (sendTime !== undefined) {
        const rtt = now() - sendTime;
        metrics.latencies.push(rtt);
        pendingPings.delete(msg.timestamp);
      }
      break;
    }

    case 'race_state': {
      metrics.raceStateCount++;
      metrics.lastRaceStatus = msg.race_status || null;
      break;
    }

    case 'race_finished': {
      metrics.raceFinished = true;
      console.log(`Race finished! Winner: ${msg.winner}`);
      // Give a moment for any trailing frames, then finish
      setTimeout(() => finish(), 2000);
      break;
    }

    case 'no_change': {
      metrics.noChangeCount++;
      break;
    }

    case 'commentary': {
      metrics.commentaryCount++;
      break;
    }

    case 'perf_stats': {
      metrics.perfStatsCount++;
      break;
    }

    case 'error': {
      metrics.errorMessages.push(msg.message || 'Unknown server error');
      console.error(`Server error: ${msg.message}`);
      break;
    }

    case 'server_shutdown': {
      metrics.errorMessages.push(`Server shutdown: ${msg.message || msg.reason || 'unknown'}`);
      console.error(`Server shutting down: ${msg.message}`);
      finish();
      break;
    }

    case 'model_switched':
    case 'camera_mode_changed':
    case 'restart_ack':
    case 'respawn_ack':
    case 'drift_end':
    case 'ai_chat':
    case 'dc_answer':
    case 'webrtc_answer': {
      metrics.otherJsonCount++;
      break;
    }

    default: {
      metrics.otherJsonCount++;
      break;
    }
  }
});

ws.on('error', (err) => {
  const errMsg = err.message || 'connection refused or unreachable';
  metrics.errorMessages.push(`WebSocket error: ${errMsg}`);
  console.error(`WebSocket error: ${errMsg}`);
});

ws.on('close', (code, reason) => {
  const reasonStr = reason ? reason.toString() : 'no reason';
  if (code !== 1000) {
    metrics.errorMessages.push(`WebSocket closed unexpectedly: code=${code} reason=${reasonStr}`);
    console.error(`WebSocket closed: code=${code} reason=${reasonStr}`);
  } else {
    console.log('WebSocket closed cleanly');
  }

  // If we haven't finished yet (unexpected close), print whatever we have
  if (!metrics.frameReceiveEnd) {
    metrics.frameReceiveEnd = now();
    printReport();
    process.exit(1);
  }
});

// Record connection start time
metrics.connectStartTime = now();

// Global timeout: if nothing happens for 60 seconds, bail out
const globalTimeout = setTimeout(() => {
  if (!metrics.frameReceiveEnd) {
    console.error('\nGlobal timeout: no response from server after 60 seconds');
    metrics.errorMessages.push('Global timeout: no response from server after 60 seconds');
    metrics.frameReceiveEnd = now();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, 'Health check timeout');
    }
    printReport();
    process.exit(1);
  }
}, 60000);

// Don't let the global timeout keep the process alive if we finish normally
globalTimeout.unref?.();
