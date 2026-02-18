/**
 * Mock WebSocket server for testing the v3 frontend without CARLA/GPU
 *
 * Run with: node v3/test/mock_ws_server.mjs
 * Then open the frontend dev server and connect to ws://localhost:8765
 */
import { WebSocketServer } from 'ws';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 8765;
const FPS = 30;

// Load the test frame JPEG once at startup
const TEST_FRAME = readFileSync(join(__dirname, 'test-frame.jpg'));
console.log(`Loaded test frame: ${TEST_FRAME.length} bytes`);

function createValidJPEG() {
  return TEST_FRAME;
}

// Generate 10 fake checkpoint positions along a rough oval track
function generateCheckpoints() {
  const checkpoints = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    checkpoints.push({
      x: 200 + Math.cos(angle) * 150,
      y: 200 + Math.sin(angle) * 100,
      index: i,
    });
  }
  return checkpoints;
}

const TRACK_CHECKPOINTS = generateCheckpoints();

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
  let cameraMode = 'chase';
  let jpegQuality = 70;
  let raceTrack = 'Town01';
  let raceLaps = 3;
  let raceWeather = 'ClearNoon';

  // Slowly changing positions for player/AI (simulates driving around a track)
  let playerX = 200;
  let playerY = 200;
  let aiX = 210;
  let aiY = 210;

  // Ghost replay: record player positions during lap 1, replay with offset after
  const ghostPath = []; // recorded positions from lap 1
  let ghostIndex = 0;
  let recordingGhost = true; // true during lap 1

  // Stats accumulators for race_finished
  const playerPathHistory = [];
  const aiPathHistory = [];
  let playerMaxSpeed = 0;
  let aiMaxSpeed = 0;
  let playerTotalDistance = 0;
  let aiTotalDistance = 0;
  let totalPlayerCollisions = 0;
  let prevPlayerX = null;
  let prevPlayerY = null;
  let prevAiX = null;
  let prevAiY = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      // Binary data or invalid JSON, ignore
      return;
    }
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
      raceTrack = msg.track || 'Town01';
      raceLaps = msg.laps || 3;
      raceWeather = msg.weather || 'ClearNoon';
      console.log(`Starting race: track=${raceTrack}, laps=${raceLaps}, weather=${raceWeather}`);
      racing = true;
      countdown = 3;
      playerLap = 1;
      aiLap = 1;
      playerCheckpoint = 0;
      aiCheckpoint = 0;
      frameNum = 0;
      raceStartTime = Date.now();
      startRaceLoop(ws);
    } else if (msg.type === 'switch_model') {
      ws.send(JSON.stringify({ type: 'model_switched', model: msg.model, success: true }));
    } else if (msg.type === 'control') {
      // Log controls including space (handbrake) and latency field
      if (msg.latency !== undefined) {
        // Adapt JPEG quality based on reported latency
        if (msg.latency > 150) {
          jpegQuality = Math.max(30, jpegQuality - 5);
        } else if (msg.latency < 50) {
          jpegQuality = Math.min(90, jpegQuality + 2);
        }
      }
    } else if (msg.type === 'respawn') {
      console.log('Player requested respawn');
      // Reset player position to last checkpoint
      const cp = TRACK_CHECKPOINTS[playerCheckpoint] || TRACK_CHECKPOINTS[0];
      playerX = cp.x;
      playerY = cp.y;
      ws.send(JSON.stringify({
        type: 'respawn_ack',
        checkpoint: playerCheckpoint,
      }));
    } else if (msg.type === 'camera_mode') {
      cameraMode = msg.mode || 'chase';
      console.log(`Camera mode changed to: ${cameraMode}`);
      ws.send(JSON.stringify({
        type: 'camera_mode_changed',
        mode: cameraMode,
      }));
    }
  });

  function startRaceLoop() {
    const interval = setInterval(() => {
      if (ws.readyState !== 1) { clearInterval(interval); return; }

      frameNum++;
      const elapsed = (Date.now() - raceStartTime) / 1000;

      // Slowly update car positions (drive around an oval-ish track)
      const playerAngle = elapsed * 0.3;
      const aiAngle = elapsed * 0.32 + 0.5;
      const newPlayerX = 200 + Math.cos(playerAngle) * 150 + Math.sin(playerAngle * 0.7) * 20;
      const newPlayerY = 200 + Math.sin(playerAngle) * 100 + Math.cos(playerAngle * 0.5) * 15;
      const newAiX = 200 + Math.cos(aiAngle) * 150 + Math.sin(aiAngle * 0.7) * 20;
      const newAiY = 200 + Math.sin(aiAngle) * 100 + Math.cos(aiAngle * 0.5) * 15;

      // Accumulate distance traveled
      if (prevPlayerX !== null) {
        const pdx = newPlayerX - prevPlayerX;
        const pdy = newPlayerY - prevPlayerY;
        playerTotalDistance += Math.sqrt(pdx * pdx + pdy * pdy);
      }
      if (prevAiX !== null) {
        const adx = newAiX - prevAiX;
        const ady = newAiY - prevAiY;
        aiTotalDistance += Math.sqrt(adx * adx + ady * ady);
      }
      prevPlayerX = newPlayerX;
      prevPlayerY = newPlayerY;
      prevAiX = newAiX;
      prevAiY = newAiY;
      playerX = newPlayerX;
      playerY = newPlayerY;
      aiX = newAiX;
      aiY = newAiY;

      // Record path history (sample every 10th frame to keep size manageable)
      if (frameNum % 10 === 0) {
        playerPathHistory.push({ x: playerX, y: playerY });
        aiPathHistory.push({ x: aiX, y: aiY });
      }

      // Countdown phase
      if (countdown > 0 && elapsed < 3) {
        countdown = 3 - Math.floor(elapsed);
        ws.send(JSON.stringify({
          type: 'race_state',
          player: {
            speed_kmh: 0, lap: 1, total_laps: raceLaps, checkpoint: 0,
            lap_time: 0, best_lap: null, position: 1, finished: false,
            x: playerX, y: playerY,
            gear: 0, rpm: 800, throttle: 0, brake: 0, steer: 0,
            gap_seconds: 0,
            checkpoints: TRACK_CHECKPOINTS,
            jpeg_quality: jpegQuality,
            collisions: [],
          },
          ai: {
            speed_kmh: 0, lap: 1, total_laps: raceLaps, checkpoint: 0,
            lap_time: 0, best_lap: null, position: 2, finished: false,
            x: aiX, y: aiY,
            gear: 0, rpm: 800, throttle: 0, brake: 0, steer: 0,
            gap_seconds: 0,
            checkpoints: TRACK_CHECKPOINTS,
            jpeg_quality: jpegQuality,
            collisions: [],
          },
          ghost: null,
          model: 'carla_pilotnet',
          race_status: 'countdown',
          fps: FPS,
          countdown: countdown,
          winner: null,
          camera_mode: cameraMode,
        }));

        // Send a test frame
        try { ws.send(createValidJPEG()); } catch (e) {}
        return;
      }

      // Racing phase
      const raceTime = elapsed - 3;
      const playerSpeed = 60 + Math.sin(raceTime * 0.5) * 30;
      const aiSpeed = 65 + Math.sin(raceTime * 0.4 + 1) * 25;

      // Track max speeds
      if (playerSpeed > playerMaxSpeed) playerMaxSpeed = playerSpeed;
      if (aiSpeed > aiMaxSpeed) aiMaxSpeed = aiSpeed;

      // Ghost recording: during lap 1 record player positions
      if (recordingGhost && playerLap === 1) {
        ghostPath.push({ x: playerX, y: playerY });
      } else if (recordingGhost && playerLap > 1) {
        recordingGhost = false;
        ghostIndex = 0;
      }

      // Simulate checkpoint/lap progress
      if (frameNum % 100 === 0) {
        playerCheckpoint++;
        if (playerCheckpoint >= 10) { playerCheckpoint = 0; playerLap++; }
      }
      if (frameNum % 90 === 0) {
        aiCheckpoint++;
        if (aiCheckpoint >= 10) { aiCheckpoint = 0; aiLap++; }
      }

      // Occasionally generate a collision event (~every 15 seconds on average)
      const playerCollisions = [];
      const aiCollisions = [];
      if (Math.random() < 0.002) {
        playerCollisions.push({
          other_actor: 'static.prop.streetbarrier',
          intensity: Math.round(Math.random() * 800 + 200),
          timestamp: raceTime,
        });
        totalPlayerCollisions += 1;
        console.log('Collision event generated for player');
      }
      if (Math.random() < 0.001) {
        aiCollisions.push({
          other_actor: 'static.prop.trafficcone01',
          intensity: Math.round(Math.random() * 500 + 100),
          timestamp: raceTime,
        });
      }

      // Build ghost data: after lap 1, replay recorded positions with slight offset
      let ghostData = null;
      if (!recordingGhost && ghostPath.length > 0) {
        const gp = ghostPath[ghostIndex % ghostPath.length];
        // Apply a slight lateral offset so the ghost doesn't overlap exactly
        ghostData = {
          x: gp.x + 8,
          y: gp.y + 5,
          lap: 1,
          checkpoint: Math.floor((ghostIndex / ghostPath.length) * 10),
        };
        ghostIndex++;
      }

      // Send race state
      ws.send(JSON.stringify({
        type: 'race_state',
        player: {
          speed_kmh: Math.round(playerSpeed * 10) / 10,
          lap: Math.min(playerLap, raceLaps),
          total_laps: raceLaps,
          checkpoint: playerCheckpoint,
          lap_time: raceTime % 45,
          best_lap: playerLap > 1 ? 42.3 : null,
          position: aiLap > playerLap ? 2 : 1,
          finished: playerLap > raceLaps,
          gear: Math.min(6, Math.floor(playerSpeed / 30) + 1),
          rpm: playerSpeed * 40,
          throttle: 0.7 + Math.sin(raceTime * 2) * 0.3,
          brake: Math.max(0, Math.sin(raceTime * 1.5) * 0.3),
          steer: Math.sin(raceTime * 0.8) * 0.4,
          gap_seconds: (playerCheckpoint - aiCheckpoint) * 2.5,
          x: playerX,
          y: playerY,
          checkpoints: TRACK_CHECKPOINTS,
          jpeg_quality: jpegQuality,
          collisions: playerCollisions,
        },
        ai: {
          speed_kmh: Math.round(aiSpeed * 10) / 10,
          lap: Math.min(aiLap, raceLaps),
          total_laps: raceLaps,
          checkpoint: aiCheckpoint,
          lap_time: raceTime % 40,
          best_lap: aiLap > 1 ? 39.8 : null,
          position: aiLap > playerLap ? 1 : 2,
          finished: aiLap > raceLaps,
          gear: Math.min(6, Math.floor(aiSpeed / 30) + 1),
          rpm: aiSpeed * 40,
          throttle: 0.8 + Math.sin(raceTime * 1.8) * 0.2,
          brake: Math.max(0, Math.sin(raceTime * 1.2) * 0.2),
          steer: Math.sin(raceTime * 0.6 + 1) * 0.3,
          gap_seconds: (aiCheckpoint - playerCheckpoint) * 2.5,
          x: aiX,
          y: aiY,
          checkpoints: TRACK_CHECKPOINTS,
          jpeg_quality: jpegQuality,
          collisions: aiCollisions,
        },
        ghost: ghostData,
        model: 'carla_pilotnet',
        race_status: 'racing',
        fps: FPS,
        countdown: null,
        winner: null,
        camera_mode: cameraMode,
      }));

      // Send a test frame (minimal JPEG)
      try { ws.send(createValidJPEG()); } catch (e) {}

      // End race after ~2 minutes
      if (raceTime > 120) {
        clearInterval(interval);
        racing = false;
        ws.send(JSON.stringify({
          type: 'race_finished',
          winner: 'player',
          player_time: 120.3,
          ai_time: 125.1,
          player_laps: [41.2, 39.5, 39.6],
          ai_laps: [42.1, 41.8, 41.2],
          player_path: playerPathHistory,
          ai_path: aiPathHistory,
          player_max_speed: Math.round(playerMaxSpeed * 10) / 10,
          ai_max_speed: Math.round(aiMaxSpeed * 10) / 10,
          player_distance: Math.round(playerTotalDistance * 10) / 10,
          ai_distance: Math.round(aiTotalDistance * 10) / 10,
          player_collisions: totalPlayerCollisions,
        }));
      }
    }, 1000 / FPS);
  }

  ws.on('close', () => {
    console.log('Client disconnected');
    racing = false;
  });
});
