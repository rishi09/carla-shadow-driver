/**
 * Mock WebSocket server for testing the v3 frontend without CARLA/GPU
 *
 * Run with: node v3/test/mock_ws_server.mjs
 * Then open the frontend dev server and connect to ws://localhost:8765
 */
import { WebSocketServer } from 'ws';
import { createCanvas } from 'canvas'; // npm install canvas ws

const PORT = 8765;
const FPS = 20;

// Create a simple test frame (colored rectangle with text)
function createTestFrame(frameNum, playerSpeed, aiSpeed) {
  const canvas = createCanvas(1280, 720);
  const ctx = canvas.getContext('2d');

  // Background - road-like
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, 1280, 720);

  // "Road"
  ctx.fillStyle = '#444';
  ctx.fillRect(200, 100, 880, 520);

  // Road markings
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 3;
  ctx.setLineDash([40, 20]);
  ctx.beginPath();
  ctx.moveTo(640, 100);
  ctx.lineTo(640, 620);
  ctx.stroke();

  // Player car (green rectangle)
  const px = 400 + Math.sin(frameNum * 0.05) * 100;
  const py = 400 + Math.cos(frameNum * 0.03) * 80;
  ctx.fillStyle = '#4CAF50';
  ctx.fillRect(px - 20, py - 30, 40, 60);
  ctx.fillStyle = '#81C784';
  ctx.fillRect(px - 15, py - 25, 30, 15);

  // AI car (blue rectangle)
  const ax = 700 + Math.sin(frameNum * 0.04 + 1) * 100;
  const ay = 350 + Math.cos(frameNum * 0.035 + 1) * 80;
  ctx.fillStyle = '#2196F3';
  ctx.fillRect(ax - 20, ay - 30, 40, 60);
  ctx.fillStyle = '#64B5F6';
  ctx.fillRect(ax - 15, ay - 25, 30, 15);

  // Frame info text
  ctx.fillStyle = '#fff';
  ctx.font = '20px sans-serif';
  ctx.fillText(`MOCK SERVER - Frame ${frameNum}`, 20, 30);
  ctx.fillText(`Player: ${playerSpeed.toFixed(0)} km/h  |  AI: ${aiSpeed.toFixed(0)} km/h`, 20, 60);

  return canvas.toBuffer('image/jpeg', { quality: 0.7 });
}

// Simple test frame without canvas dependency (generates a minimal valid JPEG)
function createMinimalJPEG(frameNum) {
  // 1x1 pixel JPEG - tiny but valid
  // In a real test you'd use the canvas version above
  const header = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
  ]);
  // This is actually not a complete valid JPEG, but for testing purposes
  // the frontend will just skip invalid frames gracefully
  return header;
}

const wss = new WebSocketServer({ port: PORT });
console.log(`Mock WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('Client connected');
  let frameNum = 0;
  let racing = false;
  let raceStartTime = null;
  let playerLap = 1;
  let aiLap = 1;
  let playerCheckpoint = 0;
  let aiCheckpoint = 0;
  let countdown = 3;

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', msg.type);

    if (msg.type === 'handshake') {
      ws.send(JSON.stringify({
        type: 'handshake_ack',
        server: 'shadow-driver-v3-mock',
        models: ['carla_pilotnet', 'alpamayo'],
      }));
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
    } else if (msg.type === 'start_race') {
      console.log(`Starting race: track=${msg.track}, laps=${msg.laps}`);
      racing = true;
      countdown = 3;
      raceStartTime = Date.now();
      startRaceLoop(ws);
    } else if (msg.type === 'switch_model') {
      ws.send(JSON.stringify({ type: 'model_switched', model: msg.model, success: true }));
    } else if (msg.type === 'control') {
      // Just log it
    }
  });

  function startRaceLoop() {
    const interval = setInterval(() => {
      if (ws.readyState !== 1) { clearInterval(interval); return; }

      frameNum++;
      const elapsed = (Date.now() - raceStartTime) / 1000;

      // Countdown phase
      if (countdown > 0 && elapsed < 3) {
        countdown = 3 - Math.floor(elapsed);
        ws.send(JSON.stringify({
          type: 'race_state',
          player: { speed_kmh: 0, lap: 1, total_laps: 3, checkpoint: 0, lap_time: 0, best_lap: null, position: 1, finished: false },
          ai: { speed_kmh: 0, lap: 1, total_laps: 3, checkpoint: 0, lap_time: 0, best_lap: null, position: 2, finished: false },
          model: 'carla_pilotnet',
          race_status: 'countdown',
          fps: FPS,
          countdown: countdown,
          winner: null,
        }));

        // Send a test frame
        try { ws.send(createMinimalJPEG(frameNum)); } catch (e) {}
        return;
      }

      // Racing phase
      const raceTime = elapsed - 3;
      const playerSpeed = 60 + Math.sin(raceTime * 0.5) * 30;
      const aiSpeed = 65 + Math.sin(raceTime * 0.4 + 1) * 25;

      // Simulate checkpoint/lap progress
      if (frameNum % 100 === 0) {
        playerCheckpoint++;
        if (playerCheckpoint >= 10) { playerCheckpoint = 0; playerLap++; }
      }
      if (frameNum % 90 === 0) {
        aiCheckpoint++;
        if (aiCheckpoint >= 10) { aiCheckpoint = 0; aiLap++; }
      }

      // Send race state
      ws.send(JSON.stringify({
        type: 'race_state',
        player: {
          speed_kmh: Math.round(playerSpeed * 10) / 10,
          lap: Math.min(playerLap, 3),
          total_laps: 3,
          checkpoint: playerCheckpoint,
          lap_time: raceTime % 45,
          best_lap: playerLap > 1 ? 42.3 : null,
          position: aiLap > playerLap ? 2 : 1,
          finished: playerLap > 3,
        },
        ai: {
          speed_kmh: Math.round(aiSpeed * 10) / 10,
          lap: Math.min(aiLap, 3),
          total_laps: 3,
          checkpoint: aiCheckpoint,
          lap_time: raceTime % 40,
          best_lap: aiLap > 1 ? 39.8 : null,
          position: aiLap > playerLap ? 1 : 2,
          finished: aiLap > 3,
        },
        model: 'carla_pilotnet',
        race_status: 'racing',
        fps: FPS,
        countdown: null,
        winner: null,
      }));

      // Send a test frame (minimal JPEG)
      try { ws.send(createMinimalJPEG(frameNum)); } catch (e) {}

      // End race after ~2 minutes
      if (raceTime > 120) {
        clearInterval(interval);
        ws.send(JSON.stringify({
          type: 'race_finished',
          winner: 'player',
          player_time: 120.3,
          ai_time: 125.1,
          player_laps: [41.2, 39.5, 39.6],
          ai_laps: [42.1, 41.8, 41.2],
        }));
      }
    }, 1000 / FPS);
  }

  ws.on('close', () => {
    console.log('Client disconnected');
    racing = false;
  });
});
