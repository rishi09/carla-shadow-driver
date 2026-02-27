#!/usr/bin/env node
/**
 * CDP Gameplay Test Runner for Shadow Driver v3
 *
 * Controls Chrome via Chrome DevTools Protocol to automate gameplay testing.
 * Takes screenshots, captures telemetry, and generates structured test reports.
 *
 * Usage:
 *   node scripts/cdp_gameplay_test.js                     # Full test (60s gameplay)
 *   node scripts/cdp_gameplay_test.js --scenario reverse   # Test reverse gear
 *   node scripts/cdp_gameplay_test.js --scenario speed     # Test top speed
 *   node scripts/cdp_gameplay_test.js --duration 30        # Custom duration
 *   node scripts/cdp_gameplay_test.js --screenshots-dir ./shots  # Custom screenshot dir
 *
 * Prerequisites:
 *   - Chrome running with --remote-debugging-port=9222
 *   - Game loaded at http://localhost:5173/race?ws=ws://localhost:8765
 *   - SSH tunnel active on port 8765
 *   - Vite dev server on port 5173
 *
 * Architecture:
 *   - Connects to Chrome CDP at ws://localhost:9222
 *   - Finds or creates the game tab
 *   - Simulates keyboard inputs (WASD + space + R)
 *   - Captures screenshots at configurable intervals
 *   - Reads telemetry from the page (speed, FPS, latency)
 *   - Generates JSON test report
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CDP_URL = 'http://localhost:9222';
const GAME_URL = 'http://localhost:5173/race?ws=ws://localhost:8765';
const RESULTS_DIR = path.join(__dirname, '..', 'test-results', 'manus');
const SCREENSHOT_INTERVAL_MS = 2000; // Screenshot every 2s
const TELEMETRY_INTERVAL_MS = 500;   // Read telemetry every 0.5s

// Keyboard key codes for CDP Input.dispatchKeyEvent
const KEYS = {
  w: { key: 'w', code: 'KeyW', keyCode: 87 },
  a: { key: 'a', code: 'KeyA', keyCode: 65 },
  s: { key: 's', code: 'KeyS', keyCode: 83 },
  d: { key: 'd', code: 'KeyD', keyCode: 68 },
  r: { key: 'r', code: 'KeyR', keyCode: 82 },
  ' ': { key: ' ', code: 'Space', keyCode: 32 },
};

// ---------------------------------------------------------------------------
// CDP Helper
// ---------------------------------------------------------------------------
class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
    this.events = [];
    this.eventHandlers = new Map(); // method -> callback
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
        if (msg.method) {
          this.events.push(msg);
          const handler = this.eventHandlers.get(msg.method);
          if (handler) handler(msg.params);
        }
      });
    });
  }

  on(method, callback) {
    this.eventHandlers.set(method, callback);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);

      this.pending.set(id, (msg) => {
        clearTimeout(timeout);
        if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`));
        else resolve(msg.result);
      });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ---------------------------------------------------------------------------
// Key simulation helpers
// ---------------------------------------------------------------------------
// Use the game's built-in E2E testing hook (window.__e2eKeys).
// The game checks this every 33ms and applies it directly, bypassing the
// keyboard event system entirely. This works even without window focus.
// See Race.tsx line 826: if (window.__e2eKeys) keysRef.current = e2eKeys;
const activeKeys = { w: false, a: false, s: false, d: false, space: false };

async function keyDown(cdp, keyName) {
  const k = KEYS[keyName];
  if (!k) return;
  const mappedKey = k.key === ' ' ? 'space' : k.key;
  if (mappedKey in activeKeys) {
    activeKeys[mappedKey] = true;
    await syncKeys(cdp);
  }
}

async function keyUp(cdp, keyName) {
  const k = KEYS[keyName];
  if (!k) return;
  const mappedKey = k.key === ' ' ? 'space' : k.key;
  if (mappedKey in activeKeys) {
    activeKeys[mappedKey] = false;
    await syncKeys(cdp);
  }
}

async function syncKeys(cdp) {
  await cdp.send('Runtime.evaluate', {
    expression: `window.__e2eKeys = ${JSON.stringify(activeKeys)};`,
    returnByValue: true,
  });
}

async function pressKey(cdp, keyName, durationMs = 100) {
  await keyDown(cdp, keyName);
  await sleep(durationMs);
  await keyUp(cdp, keyName);
}

async function holdKeys(cdp, keys, durationMs) {
  for (const k of keys) await keyDown(cdp, k);
  await sleep(durationMs);
  for (const k of keys) await keyUp(cdp, k);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Screenshot & Telemetry
// ---------------------------------------------------------------------------
async function captureScreenshot(cdp, filepath) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    quality: 90,
  });
  fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
  return filepath;
}

async function getTelemetry(cdp) {
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const title = document.title;
        const fpsMatch = title.match(/(\\d+)\\s*fps/i);
        const latMatch = title.match(/(\\d+)\\s*ms/i);

        // Read speed from ArcSpeedometer SVG text elements
        // The speed number is in an SVG text element, followed by "km/h"
        let speed = 'N/A';
        const svgTexts = document.querySelectorAll('svg text');
        for (const t of svgTexts) {
          const val = parseInt(t.textContent);
          // Speed is a number 0-300, the "km/h" text is a sibling
          if (!isNaN(val) && val >= 0 && val <= 300 && t.getAttribute('font-size') === '14') {
            speed = val.toString();
            break;
          }
        }
        // Fallback: check if keysRef shows what the game thinks
        const keysRef = window.__keysRef?.current;

        // WebSocket state
        const ws = window.__gameWs;
        const wsState = ws ? ['CONNECTING','OPEN','CLOSING','CLOSED'][ws.readyState] : 'none';

        // Canvas info
        const canvas = document.querySelector('canvas');
        const canvasInfo = canvas ? { w: canvas.width, h: canvas.height, display: canvas.style.display } : null;

        // Connection overlay
        const connecting = document.querySelector('[class*="connecting"]') ||
                          document.body.innerText.includes('Connecting');

        return JSON.stringify({
          fps: fpsMatch ? parseInt(fpsMatch[1]) : null,
          latency: latMatch ? parseInt(latMatch[1]) : null,
          speed: speed,
          wsState: wsState,
          canvas: canvasInfo,
          connecting: !!connecting,
          title: title,
          keysActive: keysRef ? Object.keys(keysRef).filter(k => keysRef[k]) : [],
        });
      })()`,
      returnByValue: true,
    });
    return JSON.parse(result.result.value);
  } catch (e) {
    return { error: e.message };
  }
}

async function clickStartRace(cdp) {
  // Find and click the Start Race button
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      // Look for Start Race button
      const buttons = Array.from(document.querySelectorAll('button'));
      const startBtn = buttons.find(b => b.textContent.includes('Start Race'));
      if (startBtn) {
        startBtn.click();
        return 'clicked';
      }
      // Check if already in race (no start button visible)
      const canvas = document.querySelector('canvas');
      if (canvas && canvas.width > 100) {
        return 'already_racing';
      }
      return 'not_found';
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function dismissOverlays(cdp) {
  // The FirstTimeOverlay registers its keydown listener with a 200ms delay (line 23 of FirstTimeOverlay.tsx).
  // We need to wait for that listener to be registered, then dispatch a keydown event.
  // Repeat multiple times to be safe, since race countdown takes ~4s.
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(500);
    await cdp.send('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'w', code: 'KeyW', keyCode: 87, which: 87, bubbles: true
        }));
        window.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'w', code: 'KeyW', keyCode: 87, which: 87, bubbles: true
        }));
      `,
      returnByValue: true,
    });
    // Check if overlay is still visible
    const result = await cdp.send('Runtime.evaluate', {
      expression: `!!document.querySelector('.absolute.inset-0.z-50')`,
      returnByValue: true,
    });
    if (!result.result.value) {
      console.log(`Overlay dismissed after ${attempt + 1} attempts`);
      return;
    }
  }
  console.log('Warning: overlay may still be visible after 8 dismiss attempts');
}

async function setLocalStoragePlayed(cdp) {
  // Mark as returning player so FirstTimeOverlay is skipped entirely
  await cdp.send('Runtime.evaluate', {
    expression: `localStorage.setItem('shadow_driver_has_played', 'true');`,
    returnByValue: true,
  });
}

// ---------------------------------------------------------------------------
// Test Scenarios
// ---------------------------------------------------------------------------
const SCENARIOS = {
  full: {
    name: 'Full Gameplay Test',
    duration: 75,
    phases: [
      { name: 'forward_driving', start: 0, end: 25, keys: ['w'], description: 'Drive forward, steer around obstacles' },
      { name: 'coast_down', start: 25, end: 28, keys: [], description: 'Release throttle to coast down' },
      { name: 'braking', start: 28, end: 35, keys: ['s'], description: 'Brake from lower speed' },
      { name: 'respawn_before_reverse', start: 35, end: 37, keys: ['r'], description: 'Respawn to clear road for reverse test' },
      { name: 'wait_after_respawn', start: 37, end: 39, keys: [], description: 'Wait for respawn to settle' },
      { name: 'reverse_straight', start: 39, end: 46, keys: ['s'], description: 'Reverse straight back' },
      { name: 'reverse_steer_right', start: 46, end: 50, keys: ['s', 'd'], description: 'Reverse + steer right' },
      { name: 'reverse_steer_left', start: 50, end: 54, keys: ['s', 'a'], description: 'Reverse + steer left' },
      { name: 'exit_reverse', start: 54, end: 60, keys: ['w'], description: 'Exit reverse, drive forward' },
      { name: 'forward_resume', start: 60, end: 75, keys: ['w'], description: 'Drive forward to confirm recovery' },
    ],
  },
  reverse: {
    name: 'Reverse Gear Test',
    duration: 30,
    phases: [
      { name: 'accelerate', start: 0, end: 8, keys: ['w'], description: 'Build up speed' },
      { name: 'brake_to_stop', start: 8, end: 15, keys: ['s'], description: 'Brake to a stop' },
      { name: 'reverse_straight', start: 15, end: 20, keys: ['s'], description: 'Reverse straight' },
      { name: 'reverse_right', start: 20, end: 23, keys: ['s', 'd'], description: 'Reverse + steer right' },
      { name: 'reverse_left', start: 23, end: 26, keys: ['s', 'a'], description: 'Reverse + steer left' },
      { name: 'exit_reverse', start: 26, end: 30, keys: ['w'], description: 'Exit reverse' },
    ],
  },
  speed: {
    name: 'Top Speed Test',
    duration: 45,
    phases: [
      { name: 'straight_run', start: 0, end: 20, keys: ['w'], description: 'Full throttle straight' },
      { name: 'cornering', start: 20, end: 35, keys: ['w'], steering: true, description: 'Full throttle with steering' },
      { name: 'respawn_test', start: 35, end: 40, keys: ['r'], description: 'Test respawn' },
      { name: 'post_respawn', start: 40, end: 45, keys: ['w'], description: 'Drive after respawn' },
    ],
  },
  hud: {
    name: 'HUD Visibility Test',
    duration: 20,
    phases: [
      { name: 'static', start: 0, end: 5, keys: [], description: 'Static view - check HUD elements' },
      { name: 'slow_drive', start: 5, end: 15, keys: ['w'], description: 'Slow drive - watch speedometer' },
      { name: 'fast_drive', start: 15, end: 20, keys: ['w'], description: 'Fast drive - check all HUD' },
    ],
  },
  twolap: {
    name: 'Two Lap Full Game Test',
    duration: 600,
    phases: [
      { name: 'forward_driving', start: 0, end: 600, keys: ['w'], description: 'Drive 2 full laps with auto-steering' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Video Recording (screencast frames → mp4 via ffmpeg)
// ---------------------------------------------------------------------------
class ScreencastRecorder {
  constructor(cdp, outputDir) {
    this.cdp = cdp;
    this.outputDir = outputDir;
    this.framesDir = path.join(outputDir, '_frames');
    this.frameCount = 0;
    this.recording = false;
  }

  async start() {
    fs.mkdirSync(this.framesDir, { recursive: true });
    this.recording = true;
    this.frameCount = 0;

    // Listen for screencast frames
    this.cdp.on('Page.screencastFrame', async (params) => {
      if (!this.recording) return;
      const frameFile = path.join(this.framesDir, `frame_${String(this.frameCount).padStart(5, '0')}.jpg`);
      fs.writeFileSync(frameFile, Buffer.from(params.data, 'base64'));
      this.frameCount++;
      // Acknowledge the frame so Chrome keeps sending
      try {
        await this.cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
      } catch { /* ignore ack errors */ }
    });

    // Start screencast: JPEG format, every frame for smooth video
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 75,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 1, // Capture every frame for accurate FPS measurement
    });

    console.log('Video recording started');
  }

  async stop() {
    this.recording = false;
    try {
      await this.cdp.send('Page.stopScreencast');
    } catch { /* ignore */ }
    console.log(`Video recording stopped (${this.frameCount} frames captured)`);
  }

  assemble(outputFile) {
    if (this.frameCount < 2) {
      console.log('Not enough frames for video');
      return null;
    }

    // Try local ffmpeg first
    try {
      execSync('which ffmpeg', { stdio: 'ignore' });
      const cmd = `ffmpeg -y -framerate 10 -i "${this.framesDir}/frame_%05d.jpg" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 23 "${outputFile}" 2>&1`;
      execSync(cmd, { timeout: 30000 });
      console.log(`Video saved: ${outputFile} (${this.frameCount} frames)`);
      try { fs.rmSync(this.framesDir, { recursive: true }); } catch {}
      return outputFile;
    } catch {
      // Local ffmpeg not available, try remote assembly via Vast.ai
      console.log('Local ffmpeg not found, trying remote assembly via Vast.ai SSH...');
      try {
        // Tar frames locally to avoid SCP-ing hundreds of individual files
        const tarFile = path.join(this.outputDir, '_frames.tar.gz');
        execSync(`tar czf "${tarFile}" -C "${this.framesDir}" .`, { timeout: 30000 });
        console.log(`Tarred ${this.frameCount} frames`);

        const sshOpts = '-o StrictHostKeyChecking=no -o ConnectTimeout=10';
        execSync(`ssh ${sshOpts} -p 16740 root@ssh3.vast.ai "rm -rf /tmp/video_frames; mkdir -p /tmp/video_frames"`, { timeout: 15000, stdio: 'ignore' });
        execSync(`scp ${sshOpts} -P 16740 "${tarFile}" root@ssh3.vast.ai:/tmp/video_frames.tar.gz`, { timeout: 300000 });
        execSync(`ssh ${sshOpts} -p 16740 root@ssh3.vast.ai 'rm -rf /tmp/video_frames; mkdir -p /tmp/video_frames && cd /tmp/video_frames && tar xzf /tmp/video_frames.tar.gz && ffmpeg -y -framerate 30 -i "frame_%05d.jpg" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 23 /tmp/test_video.mp4 2>/dev/null'`, { timeout: 120000 });
        execSync(`scp ${sshOpts} -P 16740 root@ssh3.vast.ai:/tmp/test_video.mp4 "${outputFile}"`, { timeout: 120000 });
        execSync(`ssh ${sshOpts} -p 16740 root@ssh3.vast.ai 'rm -rf /tmp/video_frames /tmp/video_frames.tar.gz /tmp/test_video.mp4'`, { timeout: 10000, stdio: 'ignore' });
        console.log(`Video saved (via remote ffmpeg): ${outputFile} (${this.frameCount} frames)`);
        try { fs.unlinkSync(tarFile); } catch {}
        try { fs.rmSync(this.framesDir, { recursive: true }); } catch {}
        return outputFile;
      } catch (e2) {
        console.log(`Remote video assembly also failed: ${e2.message}`);
        console.log(`Raw frames preserved at: ${this.framesDir}`);
        return null;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main Test Runner
// ---------------------------------------------------------------------------
async function runTest(scenario, options = {}) {
  const config = SCENARIOS[scenario] || SCENARIOS.full;
  const duration = options.duration || config.duration;
  const screenshotDir = options.screenshotDir || path.join(RESULTS_DIR, `screenshots_${Date.now()}`);

  console.log(`\n=== ${config.name} ===`);
  console.log(`Duration: ${duration}s, Screenshots: ${screenshotDir}`);

  // Ensure dirs exist
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Find game tab
  console.log('Finding game tab...');
  const tabsResp = await fetch(`${CDP_URL}/json/list`);
  const tabs = await tabsResp.json();
  let gameTab = tabs.find(t => t.type === 'page' && t.url.includes('localhost:5173'));

  if (!gameTab) {
    console.log('No game tab found, creating one...');
    const newTabResp = await fetch(`${CDP_URL}/json/new?${GAME_URL}`, { method: 'PUT' });
    gameTab = await newTabResp.json();
    await sleep(3000); // Wait for page load
  }

  console.log(`Game tab: ${gameTab.url}`);

  // Connect CDP
  const cdp = new CDPClient(gameTab.webSocketDebuggerUrl);
  await cdp.connect();
  console.log('CDP connected');

  // Enable required domains
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // Mark as returning player BEFORE page load to skip FirstTimeOverlay
  await setLocalStoragePlayed(cdp);
  console.log('Set localStorage: shadow_driver_has_played = true');

  // Reload the page to get a clean state (previous test may have left stale state)
  console.log('Reloading page for fresh start...');
  await cdp.send('Page.navigate', { url: GAME_URL });
  await sleep(4000); // Wait for page to fully load
  // Re-set localStorage after reload (navigate clears Runtime context)
  await setLocalStoragePlayed(cdp);
  console.log('Page reloaded, localStorage re-set');

  // Take initial screenshot
  const screenshots = [];
  const initShot = path.join(screenshotDir, 'init.png');
  await captureScreenshot(cdp, initShot);
  screenshots.push({ time: 0, file: initShot, phase: 'init' });
  console.log('Initial screenshot captured');

  // Check page state
  let telemetry = await getTelemetry(cdp);
  console.log('Initial state:', JSON.stringify(telemetry));

  // Click Start Race if needed
  const startResult = await clickStartRace(cdp);
  console.log(`Start Race: ${startResult}`);

  if (startResult === 'clicked') {
    // Wait for countdown (3-2-1-GO = ~4s) plus race status transition
    console.log('Waiting for countdown...');
    await sleep(5000);
    // Dismiss any overlays (ControlsHint auto-hides after 4s, but dismiss early)
    await dismissOverlays(cdp);
    await sleep(500);
  }

  // Take post-start screenshot
  const startShot = path.join(screenshotDir, 'race_start.png');
  await captureScreenshot(cdp, startShot);
  screenshots.push({ time: 0, file: startShot, phase: 'race_start' });

  // Main gameplay loop
  const telemetryLog = [];
  const startTime = Date.now();
  let lastScreenshotTime = 0;
  let lastTelemetryTime = 0;
  let maxSpeed = 0;
  let phaseIndex = 0;
  let currentKeys = new Set();
  let steerToggle = 0; // For alternating A/D steering

  console.log('\n--- Starting gameplay ---');

  // Start video recording
  const recorder = new ScreencastRecorder(cdp, screenshotDir);
  await recorder.start();

  while (true) {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed >= duration) break;

    // Determine current phase
    const phase = config.phases.find(p => elapsed >= p.start && elapsed < p.end);
    const phaseName = phase ? phase.name : 'idle';

    // Release old keys, press new ones
    const targetKeys = phase ? new Set(phase.keys) : new Set();

    // Handle steering during forward phases
    if (phase && phase.steering) {
      steerToggle++;
      // Hold each direction longer (2s each = 10 ticks at 200ms) for actual cornering
      if (steerToggle % 20 < 10) targetKeys.add('a');
      else targetKeys.add('d');
    } else if (phase && (phase.name === 'forward_driving' || phase.name === 'forward_resume')) {
      // Periodically steer to avoid walls — hold direction longer
      steerToggle++;
      if (steerToggle % 30 < 5) targetKeys.add('a');
      else if (steerToggle % 30 < 10) targetKeys.add('d');
    }

    // Handle respawn as a single tap (not a hold)
    if (phase && phase.name === 'respawn_before_reverse' && !phase._respawnDone) {
      targetKeys.delete('r'); // Don't hold R, just tap it
      await pressKey(cdp, 'r', 100);
      phase._respawnDone = true;
      console.log('[RESPAWN] Sent R key tap for clean reverse test');
    }

    // Release keys no longer needed
    for (const k of currentKeys) {
      if (!targetKeys.has(k)) {
        await keyUp(cdp, k);
        currentKeys.delete(k);
      }
    }
    // Press new keys
    for (const k of targetKeys) {
      if (!currentKeys.has(k)) {
        await keyDown(cdp, k);
        currentKeys.add(k);
      }
    }

    // Capture telemetry
    if (Date.now() - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
      telemetry = await getTelemetry(cdp);
      telemetry.elapsed = elapsed.toFixed(1);
      telemetry.phase = phaseName;
      telemetry.keysHeld = [...currentKeys];
      telemetryLog.push(telemetry);

      // Track max speed
      const speedNum = parseFloat(telemetry.speed);
      if (!isNaN(speedNum) && speedNum > maxSpeed) maxSpeed = speedNum;

      // Log periodically
      if (telemetryLog.length % 4 === 0) {
        const gameKeys = telemetry.keysActive ? telemetry.keysActive.join(',') : '?';
        console.log(`[${elapsed.toFixed(0)}s] phase=${phaseName} fps=${telemetry.fps || '?'} speed=${telemetry.speed} lat=${telemetry.latency || '?'}ms cdp_keys=[${[...currentKeys].join(',')}] game_keys=[${gameKeys}]`);
      }
      lastTelemetryTime = Date.now();
    }

    // Capture screenshots
    if (Date.now() - lastScreenshotTime >= SCREENSHOT_INTERVAL_MS) {
      const shotFile = path.join(screenshotDir, `t${elapsed.toFixed(0)}s_${phaseName}.png`);
      try {
        await captureScreenshot(cdp, shotFile);
        screenshots.push({ time: elapsed.toFixed(1), file: shotFile, phase: phaseName });
      } catch (e) {
        console.log(`Screenshot error at ${elapsed.toFixed(0)}s: ${e.message}`);
      }
      lastScreenshotTime = Date.now();
    }

    await sleep(200); // Main loop tick
  }

  // Release all held keys
  for (const k of currentKeys) {
    await keyUp(cdp, k);
  }

  // Stop video recording
  await recorder.stop();

  // Final screenshot
  const finalShot = path.join(screenshotDir, 'final.png');
  await captureScreenshot(cdp, finalShot);
  screenshots.push({ time: duration, file: finalShot, phase: 'final' });

  console.log('\n--- Gameplay complete ---');

  // Assemble video from screencast frames
  const videoFile = path.join(RESULTS_DIR, `cdp_test_${scenario}_${Date.now()}.mp4`);
  const videoPath = recorder.assemble(videoFile);

  // Compute stats
  const fpsValues = telemetryLog.map(t => t.fps).filter(v => v != null);
  const latValues = telemetryLog.map(t => t.latency).filter(v => v != null);
  const connectionDrops = telemetryLog.filter(t => t.connecting).length;

  const avgFps = fpsValues.length > 0 ? Math.round(fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length) : null;
  const minFps = fpsValues.length > 0 ? Math.min(...fpsValues) : null;
  const maxFps = fpsValues.length > 0 ? Math.max(...fpsValues) : null;
  const avgLat = latValues.length > 0 ? Math.round(latValues.reduce((a, b) => a + b, 0) / latValues.length) : null;

  // Check canvas sizing
  const canvasOk = telemetryLog.some(t => t.canvas && t.canvas.w > 800);

  // Build report
  const report = {
    test_date: new Date().toISOString().split('T')[0],
    scenario: scenario,
    scenario_name: config.name,
    duration_seconds: duration,
    screenshots_count: screenshots.length,
    screenshots_dir: screenshotDir,
    video: videoPath || null,
    video_frames: recorder.frameCount,
    telemetry_samples: telemetryLog.length,
    fps: { avg: avgFps, min: minFps, max: maxFps },
    latency_ms: { avg: avgLat },
    max_speed_kmh: maxSpeed,
    connection_drops: connectionDrops,
    canvas_fills_viewport: canvasOk,
    ws_connected: telemetryLog.some(t => t.wsState === 'OPEN'),
    telemetry_timeline: telemetryLog.slice(0, 20), // First 20 samples for report
    screenshots: screenshots.map(s => ({ time: s.time, phase: s.phase, file: path.basename(s.file) })),
  };

  // Save report
  const reportFile = path.join(RESULTS_DIR, `cdp_test_${scenario}_${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportFile}`);
  if (videoPath) console.log(`Video: ${videoPath}`);
  console.log(`Screenshots: ${screenshotDir} (${screenshots.length} files)`);
  console.log(`FPS: avg=${avgFps}, min=${minFps}, max=${maxFps}`);
  console.log(`Latency: avg=${avgLat}ms`);
  console.log(`Max speed: ${maxSpeed} km/h`);
  console.log(`Connection drops: ${connectionDrops}`);

  cdp.close();
  return { report, reportFile, screenshotDir, videoPath };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  let scenario = 'full';
  let duration = null;
  let screenshotDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) scenario = args[++i];
    if (args[i] === '--duration' && args[i + 1]) duration = parseInt(args[++i]);
    if (args[i] === '--screenshots-dir' && args[i + 1]) screenshotDir = args[++i];
    if (args[i] === '--list') {
      console.log('Available scenarios:');
      for (const [name, config] of Object.entries(SCENARIOS)) {
        console.log(`  ${name}: ${config.name} (${config.duration}s)`);
      }
      process.exit(0);
    }
  }

  if (!SCENARIOS[scenario]) {
    console.error(`Unknown scenario: ${scenario}. Use --list to see available scenarios.`);
    process.exit(1);
  }

  try {
    const { report, reportFile, screenshotDir: shotDir } = await runTest(scenario, {
      duration: duration,
      screenshotDir: screenshotDir,
    });

    // Print summary
    console.log('\n=== TEST SUMMARY ===');
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
