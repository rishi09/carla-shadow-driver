# UI Visual Testing Skill

## Purpose

This skill provides guidance for visual regression testing of the Shadow Driver UI components using Playwright.

## When to Use

Use this skill when:
1. Making changes to UI components (especially overlays, HUDs, modals)
2. After fixing layout bugs (like HUD covering the track)
3. Before deploying UI changes to production
4. When the user requests visual verification

## Quick Start

```bash
# Install Playwright browsers (first time only)
cd v2 && npx playwright install

# Run visual tests
cd v2 && npx playwright test

# Update snapshots after intentional UI changes
cd v2 && npx playwright test --update-snapshots
```

## Test Structure

Visual tests are located in `v2/e2e/`:

```
v2/e2e/
├── visual.spec.ts     # Main visual regression tests
└── ...                # Additional test files as needed
```

## Key Test Scenarios

### 1. GameHUD Layout
Tests that the HUD doesn't cover the track on any track/mode combination:
- Nightmare Circuit (most likely to have overlap)
- Both Time Trial and Head-to-Head modes

### 2. Main Menu
Verifies all menu elements are visible and properly laid out.

### 3. Track Selection
Verifies all tracks are visible and selectable.

### 4. GPU Connection Modal
Verifies the GPU modal appears correctly for Head-to-Head mode.

## Updating Snapshots

When you intentionally change the UI:

1. Run tests first to see what changed:
   ```bash
   npx playwright test
   ```

2. Review the diff in the HTML report:
   ```bash
   npx playwright show-report
   ```

3. If the changes are correct, update snapshots:
   ```bash
   npx playwright test --update-snapshots
   ```

4. Commit the new snapshots with your UI changes.

## CI Integration

Playwright tests run in GitHub Actions. See `.github/workflows/test.yml`.

The workflow:
1. Installs dependencies
2. Installs Playwright browsers
3. Runs visual tests
4. Uploads test report as artifact on failure

## Troubleshooting

### Tests fail due to timing
Increase wait times or use more specific selectors:
```typescript
await page.waitForSelector('canvas', { timeout: 10000 });
await page.waitForTimeout(4000); // Wait for countdown
```

### Snapshot diff too strict
Increase `maxDiffPixels` in the test:
```typescript
await expect(page).toHaveScreenshot('name.png', {
  maxDiffPixels: 100,
});
```

### Canvas rendering issues
The Phaser game canvas may render differently on different machines. Use `maxDiffPixelRatio` for percentage-based tolerance:
```typescript
await expect(page).toHaveScreenshot('name.png', {
  maxDiffPixelRatio: 0.02, // 2% difference allowed
});
```

## Adding New Tests

1. Add test to `v2/e2e/visual.spec.ts` or create a new `.spec.ts` file
2. Follow the existing pattern:
   - Navigate to the page
   - Wait for elements to load
   - Interact if needed
   - Take screenshot with `expect(page).toHaveScreenshot()`
3. Run `npx playwright test --update-snapshots` to create baseline
4. Commit the snapshot files

## Related Files

- `v2/playwright.config.ts` - Playwright configuration
- `v2/e2e/visual.spec.ts` - Visual regression tests
- `.github/workflows/test.yml` - CI workflow with E2E tests

## Lessons Learned

### HUD Overlay Bug (2024-01)
- **Issue:** GameHUD covered parts of the racing track
- **Root Cause:** HUD used `absolute` positioning inside the track container
- **Fix:** Split HUD into TopHUD/BottomHUD, placed outside track container
- **Prevention:** Visual tests now verify HUD layout on all tracks
