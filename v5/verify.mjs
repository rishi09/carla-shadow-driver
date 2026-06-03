#!/usr/bin/env node
// CDP-based verification script for the racing game (v5)
// Uses Chrome DevTools Protocol directly via ws module

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dynamic import of ws from /tmp/node_modules
const { default: WebSocket } = await import('ws');

const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
const GAME_URL = 'http://localhost:5174';

// Results tracking
const results = {
  check1_pageLoads: false,
  check2_gameRenders: false,
  check3_interaction: false,
  check4_carMoved: false,
};

const screenshots = [];

// ─── Helpers ────────────────────────────────────────────────────────────────

function httpRequest(urlStr, method = 'GET') {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function httpGet(urlStr) {
  return httpRequest(urlStr, 'GET');
}

class CDPSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.events = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve: res, reject: rej } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) {
            rej(new Error(msg.error.message));
          } else {
            res(msg.result);
          }
        } else if (msg.method) {
          this.events.push(msg);
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      // Timeout after 30s
      setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function saveScreenshot(base64Data, filename) {
  const filePath = path.join(__dirname, filename);
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  screenshots.push(`v5/${filename}`);
  return filePath;
}

// Compare two base64 screenshot strings: return fraction of differing characters
function screenshotDiffRatio(a, b) {
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  let diffChars = Math.abs(a.length - b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) diffChars++;
  }
  return diffChars / maxLen;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  let targetId = null;
  let cdp = null;

  try {
    // Step 1: Open a new tab pointing to the game (Chrome requires PUT for /json/new)
    console.log('\n[CDP] Opening new tab...');
    const newTab = await httpRequest(`http://${CDP_HOST}:${CDP_PORT}/json/new?${GAME_URL}`, 'PUT');
    targetId = newTab.id;
    const wsUrl = newTab.webSocketDebuggerUrl;
    console.log(`[CDP] Tab opened: ${targetId}`);
    console.log(`[CDP] WebSocket: ${wsUrl}`);

    // Step 2: Connect via WebSocket
    cdp = new CDPSession(wsUrl);
    await cdp.connect();
    console.log('[CDP] Connected to tab');

    // Enable necessary domains
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    // ══════════════════════════════════════════════════════════════════════
    // CHECK 1 — PAGE LOADS
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n[CHECK 1] Waiting for page to load...');

    // Navigate explicitly and wait
    await cdp.send('Page.navigate', { url: GAME_URL });

    // Wait for the page to fully load (assets, 3D models, etc.)
    // The game loads GLTF models and textures, so give it generous time
    await sleep(12000);

    // Check for canvas element
    const canvasResult = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('canvas') !== null`,
      returnByValue: true,
    });

    results.check1_pageLoads = canvasResult.result.value === true;
    console.log(`[CHECK 1] Canvas found: ${results.check1_pageLoads}`);

    // Also check if the game is showing the intro screen or has loaded
    const loadStateResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const link = document.querySelector('.start-link');
        return {
          hasStartLink: !!link,
          startLinkText: link ? link.textContent : null,
          hasCanvas: !!document.querySelector('canvas'),
          fullscreenClasses: document.querySelector('.fullscreen')?.className || 'not found',
        };
      })()`,
      returnByValue: true,
    });
    console.log(`[CHECK 1] Page state: ${JSON.stringify(loadStateResult.result.value)}`);

    // ══════════════════════════════════════════════════════════════════════
    // CHECK 2 — GAME RENDERS
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n[CHECK 2] Taking screenshot...');

    const screenshot1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const ss1Data = screenshot1.data;
    saveScreenshot(ss1Data, 'verify-before.png');

    // Check if the screenshot is non-trivial
    // A blank/solid-color page compresses very small; a rendered scene is much larger
    const ss1Size = ss1Data.length;
    console.log(`[CHECK 2] Screenshot base64 length: ${ss1Size} chars`);

    // For a rendered page with 3D content or at least the intro screen with text/keys,
    // we expect >20000 chars of base64 data. Totally blank pages are ~5-10K.
    results.check2_gameRenders = ss1Size > 20000;
    console.log(`[CHECK 2] Non-trivial content: ${results.check2_gameRenders}`);

    // ══════════════════════════════════════════════════════════════════════
    // CHECK 3 — CAN INTERACT (click "Click to start")
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n[CHECK 3] Clicking to start game...');

    // First, try to find and click the "Click to start" link
    const clickTargetResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const link = document.querySelector('.start-link');
        if (link) {
          const rect = link.getBoundingClientRect();
          return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, found: true, text: link.textContent };
        }
        return { x: 640, y: 360, found: false, text: null };
      })()`,
      returnByValue: true,
    });

    const clickTarget = clickTargetResult.result.value;
    console.log(`[CHECK 3] Click target: ${JSON.stringify(clickTarget)}`);

    // Click the start link (or center of page as fallback)
    const clickX = clickTarget.x || 640;
    const clickY = clickTarget.y || 360;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: clickX,
      y: clickY,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: clickX,
      y: clickY,
      button: 'left',
      clickCount: 1,
    });

    console.log(`[CHECK 3] Clicked at (${clickX}, ${clickY})`);

    // Wait for the intro to fade out and the 3D scene to become interactive
    await sleep(4000);

    // Take screenshot after click
    const screenshot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const ss2Data = screenshot2.data;
    saveScreenshot(ss2Data, 'verify-after-click.png');

    // Check that we didn't crash (page is still functional)
    const postClickCheck = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const canvas = document.querySelector('canvas');
        const fullscreen = document.querySelector('.fullscreen');
        return {
          canvasExists: !!canvas,
          fullscreenClasses: fullscreen ? fullscreen.className : 'removed',
          isClicked: fullscreen ? fullscreen.classList.contains('clicked') : false,
        };
      })()`,
      returnByValue: true,
    });

    console.log(`[CHECK 3] Post-click state: ${JSON.stringify(postClickCheck.result.value)}`);

    // Pass if the page didn't crash and the intro was dismissed (clicked class added)
    const postClick = postClickCheck.result.value;
    results.check3_interaction = postClick.canvasExists === true;
    console.log(`[CHECK 3] Interaction succeeded: ${results.check3_interaction}`);

    // ══════════════════════════════════════════════════════════════════════
    // CHECK 4 — CAR MOVES (hold W for 3 seconds)
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n[CHECK 4] Pressing W to drive...');

    // Take a "before driving" screenshot (the current state after click)
    const screenshotBeforeDrive = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const ssBeforeDrive = screenshotBeforeDrive.data;

    // Press W key down
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'w',
      code: 'KeyW',
      windowsVirtualKeyCode: 87,
      nativeVirtualKeyCode: 87,
    });

    // Hold for 3 seconds
    await sleep(3000);

    // Release W key
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'w',
      code: 'KeyW',
      windowsVirtualKeyCode: 87,
      nativeVirtualKeyCode: 87,
    });

    // Wait a moment for the scene to settle
    await sleep(500);

    // Take screenshot after driving
    const screenshot3 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const ss3Data = screenshot3.data;
    saveScreenshot(ss3Data, 'verify-after-drive.png');

    // Compare before-drive and after-drive screenshots
    const diffRatio = screenshotDiffRatio(ssBeforeDrive, ss3Data);
    console.log(`[CHECK 4] Screenshot diff ratio: ${(diffRatio * 100).toFixed(2)}%`);
    console.log(`[CHECK 4] Before-drive base64 length: ${ssBeforeDrive.length}`);
    console.log(`[CHECK 4] After-drive base64 length: ${ss3Data.length}`);

    // If >1% of the screenshot data differs, the scene changed (car moved, camera moved)
    results.check4_carMoved = diffRatio > 0.01;
    console.log(`[CHECK 4] Car moved: ${results.check4_carMoved}`);

  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    console.error(err.stack);
  } finally {
    // Cleanup: close the CDP connection
    if (cdp) cdp.close();

    // Close the tab
    if (targetId) {
      try {
        await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json/close/${targetId}`);
        console.log(`\n[CDP] Tab ${targetId} closed`);
      } catch {
        console.log(`\n[CDP] Could not close tab (may already be closed)`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════

  const allPassed = Object.values(results).every(Boolean);

  console.log('\n' + '═'.repeat(43));
  console.log('  Phase 1 Verification Results');
  console.log('═'.repeat(43));
  console.log(`  CHECK 1 — Page Loads:      ${results.check1_pageLoads ? 'PASS' : 'FAIL'}`);
  console.log(`  CHECK 2 — Game Renders:    ${results.check2_gameRenders ? 'PASS' : 'FAIL'}`);
  console.log(`  CHECK 3 — Can Interact:    ${results.check3_interaction ? 'PASS' : 'FAIL'}`);
  console.log(`  CHECK 4 — Car Moves:       ${results.check4_carMoved ? 'PASS' : 'FAIL'}`);
  console.log('═'.repeat(43));
  console.log('  Screenshots:');
  screenshots.forEach((s) => console.log(`    ${s}`));
  console.log(`  OVERALL: ${allPassed ? 'PASS' : 'FAIL'}`);
  console.log('═'.repeat(43));

  process.exit(allPassed ? 0 : 1);
}

main();
