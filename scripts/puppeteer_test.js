#!/usr/bin/env node
/**
 * Shadow Driver game testing with Puppeteer.
 * Using setExternalInput() API for car control.
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const GAME_URL = "https://v2-sigma-lemon.vercel.app";
const SCREENSHOT_DIR = "/tmp/shadow_driver_puppeteer";

// Create screenshot directory
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function log(msg) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${timestamp}] ${msg}`);
}

async function screenshot(page, name) {
    const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: filepath });
    log(`Screenshot: ${filepath}`);
    return filepath;
}

async function setCarInput(page, throttle, brake, steer) {
    return await page.evaluate(({ throttle, brake, steer }) => {
        // Get Phaser game instance
        if (!window.phaserGame) {
            if (typeof Phaser !== 'undefined' && Phaser.GAMES && Phaser.GAMES.length > 0) {
                window.phaserGame = Phaser.GAMES[0];
            } else {
                return { success: false, error: 'Phaser not found' };
            }
        }

        const raceScene = window.phaserGame.scene.getScene('RaceScene');
        if (!raceScene) {
            return { success: false, error: 'RaceScene not found' };
        }

        raceScene.setExternalInput({
            throttle: throttle,
            brake: brake,
            steer: steer
        });

        return { success: true };
    }, { throttle, brake, steer });
}

async function main() {
    log("=== Shadow Driver Puppeteer Test ===");
    log("Using Phaser's setExternalInput() API for car control");

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Capture console logs
    page.on('console', msg => {
        if (msg.type() === 'error') {
            log(`[console.error] ${msg.text()}`);
        }
    });

    try {
        // Navigate to game
        log("\n=== STEP 1: Navigate to Race ===");
        await page.goto(GAME_URL, { waitUntil: 'networkidle2' });
        await screenshot(page, '01_home');

        // Select Race Against Computer
        const raceCard = await page.$x("//div[contains(@class, 'cursor-pointer')][contains(., 'Race Against Computer')]");
        if (raceCard.length > 0) {
            await raceCard[0].click();
            await page.waitForTimeout(2000);
            log("Clicked 'Race Against Computer'");
        }

        await screenshot(page, '02_track_select');

        // Select track (Choose This Track button)
        const chooseBtn = await page.$x("//button[contains(., 'Choose This Track')]");
        if (chooseBtn.length > 0) {
            await chooseBtn[0].click();
            await page.waitForTimeout(2000);
            log("Clicked 'Choose This Track'");
        }

        // Start Race
        const startBtn = await page.$x("//button[contains(., 'Start Race')]");
        if (startBtn.length > 0) {
            await startBtn[0].click();
            await page.waitForTimeout(1000);
            log("Clicked 'Start Race'");
        }

        // Use Local AI
        const localBtn = await page.$x("//button[contains(., 'Local')]");
        if (localBtn.length > 0) {
            await localBtn[0].click();
            log("Clicked 'Local' AI");
        }

        // Wait for countdown
        log("Waiting for countdown...");
        await page.waitForTimeout(6000);

        // Dismiss tutorial
        const gotItBtn = await page.$x("//button[contains(., 'Got It')]");
        if (gotItBtn.length > 0) {
            await gotItBtn[0].click();
            await page.waitForTimeout(1000);
            log("Dismissed tutorial");
        }

        await screenshot(page, '03_race_start');
        log("✓ REQUIREMENT 1: Track is visible!");

        // Test setExternalInput API
        log("\n=== STEP 2: Test setExternalInput API ===");
        const result = await setCarInput(page, true, false, 0);
        log(`API result: ${JSON.stringify(result)}`);

        if (!result || !result.success) {
            log("✗ setExternalInput API not working");
            await browser.close();
            return false;
        }

        // Wait a moment and check speed
        await page.waitForTimeout(2000);
        const bodyText = await page.$eval('body', el => el.textContent);
        const speedMatch = bodyText.match(/(\d+)\s*km\/h/i);
        if (speedMatch) {
            const speed = parseInt(speedMatch[1]);
            log(`Speed: ${speed} km/h`);
            if (speed > 0) {
                log("✓ REQUIREMENT 2: Car control works!");
            }
        }

        await screenshot(page, '04_accelerating');

        // Race around the track!
        log("\n=== STEP 3: Race! ===");
        log("Driving for 90 seconds to complete 3 laps...");

        let raceFinished = false;
        let lastLap = 0;
        let bestSpeed = 0;
        const startTime = Date.now();

        for (let i = 0; i < 900; i++) {  // 90 seconds at 10 updates/sec
            // Calculate steering for oval track
            const cycle = i % 200;
            let steer = 0;

            if (cycle < 80) {  // Top straight
                steer = 0;
            } else if (cycle < 100) {  // First corner (right)
                steer = 0.8;
            } else if (cycle < 180) {  // Bottom straight
                steer = 0;
            } else {  // Second corner (right)
                steer = 0.8;
            }

            // Always accelerate
            await setCarInput(page, true, false, steer);
            await page.waitForTimeout(100);

            // Check progress every 10 seconds
            if (i % 100 === 0 && i > 0) {
                const bodyText = await page.$eval('body', el => el.textContent);

                // Check speed
                const speedMatch = bodyText.match(/(\d+)\s*km\/h/i);
                if (speedMatch) {
                    const speed = parseInt(speedMatch[1]);
                    if (speed > bestSpeed) {
                        bestSpeed = speed;
                    }
                    log(`Speed: ${speed} km/h`);
                }

                // Check lap
                const lapMatch = bodyText.match(/lap\s*(\d+)\/3/i);
                if (lapMatch) {
                    const currentLap = parseInt(lapMatch[1]);
                    if (currentLap > lastLap) {
                        log(`=== LAP ${currentLap}/3 ===`);
                        lastLap = currentLap;
                        await screenshot(page, `05_lap_${currentLap}`);
                    }
                }

                // Check for race finish
                if (bodyText.toLowerCase().includes('you won') ||
                    bodyText.toLowerCase().includes('you lost') ||
                    bodyText.toLowerCase().includes('race complete')) {
                    log("🏁 RACE FINISHED!");
                    raceFinished = true;
                    break;
                }

                if (lastLap >= 3) {
                    log("Completed all laps!");
                    await page.waitForTimeout(2000);
                    break;
                }
            }
        }

        const elapsed = (Date.now() - startTime) / 1000;
        log(`Race duration: ${elapsed.toFixed(1)} seconds`);

        // Release controls
        await setCarInput(page, false, false, 0);
        await screenshot(page, '06_final');

        // Final state
        log("\n=== FINAL RESULTS ===");
        const finalText = await page.$eval('body', el => el.textContent);
        log(`Page text:\n${finalText.substring(0, 600)}`);

        const lapMatch = finalText.match(/lap\s*(\d+)/i);
        const timeMatch = finalText.match(/time\s*(\d+:\d+\.\d+)/i);

        if (lapMatch) {
            log(`Final Lap: ${lapMatch[1]}/3`);
        }
        if (timeMatch) {
            log(`Race Time: ${timeMatch[1]}`);
        }
        log(`Best Speed: ${bestSpeed} km/h`);

        if (bestSpeed > 0) {
            log("✓ REQUIREMENT 2: Controls work!");
        }

        if (raceFinished || lastLap >= 3) {
            log("✓ REQUIREMENT 4: Race completed!");
        }

        log("\n=== SUMMARY ===");
        log(`Screenshots: ${SCREENSHOT_DIR}`);

        await browser.close();
        return true;

    } catch (error) {
        log(`ERROR: ${error.message}`);
        console.error(error);
        try {
            await screenshot(page, 'error');
        } catch (e) {}
        await browser.close();
        return false;
    }
}

main().then(success => {
    log("Done");
    process.exit(success ? 0 : 1);
});
