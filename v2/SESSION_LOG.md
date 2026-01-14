# Shadow Driver - Testing Session Log

## Session: 2026-01-13

### Test Environment
- Browser: Safari Technology Preview via Selenium
- safaridriver: port 4445
- Python: /usr/bin/python3
- Game URL: https://v2-sigma-lemon.vercel.app

---

## Key Findings

### Iteration 8 - BREAKTHROUGH!

**The 'W' key works, but Arrow keys don't!**

- When using JavaScript `KeyboardEvent` with 'w' key: **Speed reached 177 km/h** ✓
- When using JavaScript `KeyboardEvent` with 'ArrowUp': Speed stayed at 0 km/h ✗

**Root Cause:** Phaser.js handles WASD keys and Arrow keys differently. The synthetic KeyboardEvent for 'w' is recognized, but 'ArrowUp' is not.

**Solution:** Use WASD keys (w, a, s, d) instead of arrow keys.

### Requirements Status

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | See the track | ✅ PASSED | Canvas element visible, track renders correctly |
| 2 | Race using keyboard | ✅ PASSED | W key accelerates (177 km/h confirmed) |
| 3 | See AI car racing | ✅ PASSED | Red AI car visible and moves on track |
| 4 | Finish & compare times | 🔄 IN PROGRESS | Need to complete race with WASD |

---

## Iterations Summary

### Iteration 1-4: Navigation Flow
- Discovered game UI structure
- Found "Race Against Computer" → Track Selection → Start Race → GPU/Local AI modal
- Tutorial modal ("Got It!") blocks input until dismissed

### Iteration 5-6: Canvas Found, No Movement
- Game canvas renders correctly
- Selenium ActionChains keypresses not reaching Phaser.js

### Iteration 7: Safari Dialog Dismissal
- Added `osascript` command to dismiss Safari automation dialog
- ActionChains still not working

### Iteration 8: JavaScript KeyboardEvent
- Used `document.dispatchEvent(new KeyboardEvent(...))`
- **'w' key works! Speed reached 177 km/h**
- Arrow keys don't work with this method

### Iteration 9-10: Inconsistent Results
- WASD keys sometimes worked, sometimes didn't
- False positive on "finish" detection (matched tutorial text)

### Iteration 11: setExternalInput API (RECOMMENDED)
- Technical researcher discovered `setExternalInput()` API in InputManager.ts
- This API bypasses keyboard input entirely
- Same API used by mobile touch controls
- Script updated to use this method

**Current Blocker:** safaridriver needs manual restart (requires authentication)

**Waited for safaridriver:** ~45 minutes (multiple check intervals)

---

## Screenshots Evidence

| Screenshot | Speed | Notes |
|------------|-------|-------|
| 03_after_w_key.png | 175 km/h | Controls working |
| 02_lap_1.png | 0 km/h | Tutorial modal showing |
| 03_final.png | 0 km/h | Tutorial blocking input |

---

## Next Steps

1. ✅ Update script to use WASD keys only
2. ✅ Discovered setExternalInput API (better approach)
3. ⚠️ **BLOCKER:** Start safaridriver: `safaridriver --port 4445`
4. 🔄 Complete a full race with Local AI
5. ⏳ Test GPU mode (Vast.ai)
6. ⏳ Verify race completion and time comparison
7. ⏳ Destroy GPU instances when done

---

## Browser Automation Notes

**Chromium-based automation (Playwright/Puppeteer) DOES NOT WORK on this machine.**
- Chromium crashes with SEGV_ACCERR (signal 11)
- This is a system-level issue on this Mac
- Safari with Selenium is the ONLY working option

**To restart safaridriver:**
```bash
safaridriver --port 4445
```
(Requires authentication popup)

---

## API Status

| Endpoint | Status | Notes |
|----------|--------|-------|
| /api/gpu/callback | ✅ Working | using_redis: true |
| /api/gpu/status | ✅ Working | Requires instance_id |
| /api/gpu/start | ⏳ Untested | Need browser for full test |

**Vast.ai Instances:** None running (clean state)
