import { test, expect } from '@playwright/test';

/**
 * Visual regression tests for Shadow Driver v2
 *
 * These tests verify that UI components don't have layout issues
 * like the HUD covering the track.
 */

test.describe('GameHUD Layout', () => {
  test('HUD does not cover track on Time Trial', async ({ page }) => {
    await page.goto('/');

    // Navigate to Time Trial mode
    await page.click('text=Time Trial');

    // Wait for track select to load
    await page.waitForSelector('text=Choose Your Track');

    // Select Nightmare Circuit (most likely to have overlap issues)
    await page.click('text=Nightmare Circuit');

    // Wait for game to load
    await page.waitForSelector('canvas', { timeout: 10000 });

    // Wait for countdown to finish
    await page.waitForTimeout(4000);

    // Take screenshot of game with HUD
    await expect(page).toHaveScreenshot('nightmare-circuit-time-trial.png', {
      maxDiffPixels: 100, // Allow small differences
    });
  });

  test('HUD does not cover track on Head-to-Head', async ({ page }) => {
    await page.goto('/');

    // Navigate to Head-to-Head mode
    await page.click('text=Head to Head');

    // Wait for track select to load
    await page.waitForSelector('text=Choose Your Track');

    // Select Nightmare Circuit
    await page.click('text=Nightmare Circuit');

    // GPU modal should appear - click "Use Local AI" to skip GPU provisioning
    await page.waitForSelector('text=Use Local AI', { timeout: 5000 });
    await page.click('text=Use Local AI');

    // Wait for game to load
    await page.waitForSelector('canvas', { timeout: 10000 });

    // Wait for countdown to finish
    await page.waitForTimeout(4000);

    // Take screenshot
    await expect(page).toHaveScreenshot('nightmare-circuit-head-to-head.png', {
      maxDiffPixels: 100,
    });
  });
});

test.describe('Main Menu', () => {
  test('Main menu loads correctly', async ({ page }) => {
    await page.goto('/');

    // Verify main menu elements are visible
    await expect(page.getByText('Shadow Driver')).toBeVisible();
    await expect(page.getByText('Time Trial')).toBeVisible();
    await expect(page.getByText('Head to Head')).toBeVisible();

    // Take screenshot
    await expect(page).toHaveScreenshot('main-menu.png', {
      maxDiffPixels: 100,
    });
  });
});

test.describe('Track Selection', () => {
  test('All tracks are visible and selectable', async ({ page }) => {
    await page.goto('/');

    // Go to Time Trial
    await page.click('text=Time Trial');

    // Wait for track select
    await page.waitForSelector('text=Choose Your Track');

    // Verify all tracks are visible
    await expect(page.getByText('Sunset Speedway')).toBeVisible();
    await expect(page.getByText('Mountain Pass')).toBeVisible();
    await expect(page.getByText('Nightmare Circuit')).toBeVisible();

    // Take screenshot
    await expect(page).toHaveScreenshot('track-selection.png', {
      maxDiffPixels: 100,
    });
  });
});

test.describe('GPU Connection Modal', () => {
  test('GPU modal appears for Head-to-Head mode', async ({ page }) => {
    await page.goto('/');

    // Navigate to Head-to-Head mode
    await page.click('text=Head to Head');

    // Select a track
    await page.waitForSelector('text=Choose Your Track');
    await page.click('text=Sunset Speedway');

    // GPU modal should appear
    await expect(page.getByText('Race Against Real AI?')).toBeVisible();
    await expect(page.getByText('Start GPU')).toBeVisible();
    await expect(page.getByText('Use Local AI')).toBeVisible();

    // Take screenshot
    await expect(page).toHaveScreenshot('gpu-modal.png', {
      maxDiffPixels: 100,
    });
  });
});
