# E2E Browser Testing Agent

**Purpose:** Verify that applications work end-to-end in a real browser before declaring completion. This agent catches bugs that unit tests miss by simulating actual user behavior.

---

## When to Use This Skill

Use this skill:
- Before declaring any UI project "complete"
- After all unit/integration tests pass
- Before deploying to production
- When the user asks to "verify it works" or "test the full flow"
- As part of the Manager Verification Phase

---

## Core Principle

> **Unit tests prove code works. E2E tests prove the product works.**

Unit tests with mocks can pass while the actual product is broken. This happened in the Shadow Driver v2 project where all 209 tests passed but the game wouldn't start due to an event emitter mismatch.

---

## E2E Testing Checklist

Before any deployment, run through this checklist:

```markdown
## E2E Verification Checklist

### 1. Application Loads
- [ ] Navigate to the app URL
- [ ] Page loads without errors (check console)
- [ ] No blank screens or loading spinners stuck
- [ ] All critical assets load (images, fonts, scripts)

### 2. Primary User Flow
- [ ] Identify the main user journey
- [ ] Click through each step
- [ ] Verify each transition works
- [ ] Complete the flow successfully
- [ ] Take screenshot at each step

### 3. Secondary Flows
- [ ] List all alternative paths
- [ ] Test each path
- [ ] Verify error handling works

### 4. Interactive Elements
- [ ] All buttons are clickable
- [ ] All forms submit correctly
- [ ] All navigation links work
- [ ] Modals open and close properly

### 5. State Persistence
- [ ] Refresh the page - state preserved?
- [ ] Close and reopen - data still there?
- [ ] localStorage/cookies working?

### 6. Edge Cases
- [ ] Empty states (no data)
- [ ] Error states (failed requests)
- [ ] Large data sets
- [ ] Rapid clicking/interactions
```

---

## Playwright Test Template

Use this template for automated E2E tests:

```python
#!/usr/bin/env python3
"""
E2E Test: [Application Name] - [Flow Name]
"""
from playwright.sync_api import sync_playwright
import os

def test_primary_flow():
    """Test the main user journey."""
    os.makedirs('/tmp/screenshots', exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Step 1: Load application
        print("Step 1: Loading application...")
        page.goto('http://localhost:3000')  # or production URL
        page.wait_for_load_state('networkidle')
        page.screenshot(path='/tmp/screenshots/01_initial.png')

        # Verify page loaded
        assert page.title() != '', "Page title should not be empty"
        print("  ✓ Application loaded")

        # Step 2: [First interaction]
        print("Step 2: [Description]...")
        # page.click('text=Button Text')
        # page.wait_for_selector('text=Expected Result')
        page.screenshot(path='/tmp/screenshots/02_after_action.png')
        print("  ✓ [Action completed]")

        # Step 3: [Second interaction]
        print("Step 3: [Description]...")
        # ...

        # Final verification
        print("\n✅ E2E Test PASSED")
        browser.close()
        return True

def test_error_handling():
    """Test error states and edge cases."""
    # Similar structure
    pass

if __name__ == '__main__':
    success = test_primary_flow()
    if not success:
        print("\n❌ E2E Test FAILED")
        exit(1)
```

---

## Manual Testing Protocol

When Playwright isn't available, follow this manual protocol:

### Step 1: Open Browser DevTools
- Open Chrome/Firefox
- Press F12 to open DevTools
- Go to Console tab
- Clear console

### Step 2: Navigate to Application
- Load the application URL
- Check console for errors (red messages)
- Check Network tab for failed requests

### Step 3: Document Each Step
For each action:
1. Describe what you're clicking/doing
2. Take a screenshot (Cmd/Ctrl + Shift + S)
3. Note what happened
4. Note any console errors

### Step 4: Record Results

```markdown
## Manual E2E Test Results

**Date:** [Date]
**Tester:** [Name/Agent]
**URL:** [Application URL]
**Browser:** [Chrome/Firefox/Safari + version]

### Steps Executed

| Step | Action | Expected | Actual | Status |
|------|--------|----------|--------|--------|
| 1 | Load page | See main menu | [What happened] | PASS/FAIL |
| 2 | Click X | See Y | [What happened] | PASS/FAIL |
| ... | ... | ... | ... | ... |

### Console Errors
- [List any errors]

### Screenshots
- /tmp/screenshots/01_*.png
- /tmp/screenshots/02_*.png

### Verdict: PASS / FAIL
```

---

## Common E2E Failure Patterns

### 1. Event Not Received
**Symptom:** Button clicked but nothing happens
**Debug:** Check if event emitters match (scene.events vs game.events)
**Fix:** Verify event contracts between components

### 2. Async Race Condition
**Symptom:** Works sometimes, fails other times
**Debug:** Add explicit waits, check network timing
**Fix:** Use proper loading states and await

### 3. State Not Initialized
**Symptom:** Works on refresh but not first load
**Debug:** Check initialization order
**Fix:** Ensure state is set before components render

### 4. Network Request Fails Silently
**Symptom:** No error shown, but data missing
**Debug:** Check Network tab for failed requests
**Fix:** Add error handling and user feedback

### 5. Mobile-Only Bug
**Symptom:** Works on desktop, fails on mobile
**Debug:** Test with mobile viewport and touch events
**Fix:** Check responsive breakpoints and touch handlers

---

## Integration with CI/CD

Add E2E tests to your deployment pipeline:

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Build application
        run: npm run build

      - name: Start server
        run: npm run preview &

      - name: Wait for server
        run: npx wait-on http://localhost:4173

      - name: Run E2E tests
        run: npx playwright test

      - name: Upload screenshots
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: screenshots
          path: /tmp/screenshots/
```

---

## Quick Reference: Playwright Selectors

```python
# By text content
page.click('text=Click Me')
page.locator('text=Hello World')

# By role (accessibility)
page.click('role=button[name="Submit"]')
page.locator('role=heading[name="Welcome"]')

# By CSS selector
page.click('.button-primary')
page.locator('#submit-form')

# By test ID (recommended)
page.click('[data-testid="login-button"]')

# Combining selectors
page.locator('div.card').filter(has_text='Premium').click()

# Waiting
page.wait_for_selector('text=Success')
page.wait_for_load_state('networkidle')
page.wait_for_timeout(1000)  # last resort
```

---

## Reporting Results

After E2E testing, report results in this format:

```markdown
## E2E Test Report

**Application:** [Name]
**Date:** [Date]
**Environment:** [Local/Staging/Production]

### Summary
- **Total Flows Tested:** [N]
- **Passed:** [N]
- **Failed:** [N]
- **Skipped:** [N]

### Failed Tests
| Test | Step | Expected | Actual | Screenshot |
|------|------|----------|--------|------------|
| [Name] | [Step] | [Expected] | [Actual] | [path] |

### Recommendations
1. [Fix required]
2. [Additional test needed]

### Verdict
[ ] READY FOR DEPLOYMENT
[ ] NEEDS FIXES BEFORE DEPLOYMENT
```

---

## Best Practices

1. **Test on production URL when possible** - Dev servers can hide bugs
2. **Use networkidle wait** - Ensures all async operations complete
3. **Take screenshots at every step** - Evidence for debugging
4. **Check console for errors** - Even if UI looks correct
5. **Test the unhappy path** - Error states often untested
6. **Run before EVERY deployment** - Not just major releases
7. **Automate what you can** - But manual testing still valuable
8. **Test on multiple browsers** - At minimum: Chrome + Safari

---

## Async Multi-Step Flow Testing

### The Problem

Many features involve multi-step async flows:
1. User clicks button → API call starts
2. Backend starts long operation
3. Backend calls back with result
4. Frontend polls for result
5. Frontend shows success

**Standard E2E tests miss this** because:
- Step 2-4 happen outside the browser
- Cold starts can break the callback chain
- Polling may hit different server instances

### Async Flow Testing Checklist

```markdown
## Async Flow Test: [Feature Name]

### 1. Map the Request Chain
```
User Action → API 1 → External Service → Callback API → Poll API → UI Update
```

For each step, document:
- [ ] URL being called
- [ ] Expected response format
- [ ] Timeout value
- [ ] What triggers the next step

### 2. Test Each API Independently

Before testing the full flow, curl each API:

```bash
# Step 1: Trigger the operation
curl -X POST https://your-domain.vercel.app/api/start \
  -H "Content-Type: application/json" \
  -d '{"param": "value"}' | jq

# Step 2: Simulate the callback (what the external service sends)
curl -X POST https://your-domain.vercel.app/api/callback \
  -H "Content-Type: application/json" \
  -d '{"id": "test123", "result": "success"}' | jq

# Step 3: Poll for the result
curl "https://your-domain.vercel.app/api/status?id=test123" | jq
```

### 3. Test Cold Start Resilience

Wait 2+ minutes between callback and poll to simulate cold start:

```bash
# Send callback
curl -X POST .../api/callback -d '{"id": "cold-test"}'

# Wait for cold start
echo "Waiting 2 minutes for cold start..."
sleep 120

# Poll - should still find the data
curl ".../api/status?id=cold-test"
# If using KV: data should be there
# If using in-memory: data will be LOST
```

### 4. Test Concurrent Requests

Multiple users doing the same flow:

```bash
# Start 3 concurrent operations
curl -X POST .../api/start -d '{"id": "user1"}' &
curl -X POST .../api/start -d '{"id": "user2"}' &
curl -X POST .../api/start -d '{"id": "user3"}' &
wait

# Each should have independent state
curl ".../api/status?id=user1"
curl ".../api/status?id=user2"
curl ".../api/status?id=user3"
```
```

### Async Flow Test Template (Playwright)

```python
async def test_async_flow():
    """Test a multi-step async operation."""

    # Step 1: Start the operation via UI
    await page.click('button:text("Start GPU")')

    # Step 2: Verify loading state appears
    await page.wait_for_selector('text=Starting server', timeout=5000)
    screenshot(page, 'loading_state')

    # Step 3: Simulate the callback (if testing infrastructure)
    # In real E2E, this happens from external service
    # For testing, we might need a test endpoint

    # Step 4: Wait for completion (with generous timeout)
    try:
        await page.wait_for_selector('text=Connected', timeout=120000)
        screenshot(page, 'connected')
    except TimeoutError:
        # Capture what we're stuck on
        screenshot(page, 'timeout_state')
        # Check if it's a known failure mode
        if await page.is_visible('text=Starting server'):
            raise Exception("Stuck on loading - callback may not have been received")
        raise

    # Step 5: Verify the operation actually worked
    # Don't just check UI - verify the effect
    result = await page.evaluate('window.gpuConnection?.isConnected()')
    assert result == True, "GPU should be connected"
```

### Testing GPU-Like Flows

For operations that take 2-5 minutes:

```python
async def test_long_running_operation():
    """Test operation that takes several minutes."""

    # Start operation
    await page.click('button:text("Start")')
    start_time = time.time()

    # Poll with logging
    max_wait = 300  # 5 minutes
    poll_interval = 10  # Check every 10 seconds

    while time.time() - start_time < max_wait:
        # Check for success
        if await page.is_visible('text=Success'):
            elapsed = time.time() - start_time
            print(f"✓ Completed in {elapsed:.0f} seconds")
            return True

        # Check for failure
        if await page.is_visible('text=Error'):
            error_text = await page.text_content('.error-message')
            raise Exception(f"Operation failed: {error_text}")

        # Log progress
        elapsed = time.time() - start_time
        status = await page.text_content('.status') if await page.is_visible('.status') else 'unknown'
        print(f"  [{elapsed:.0f}s] Status: {status}")

        await page.wait_for_timeout(poll_interval * 1000)

    raise TimeoutError(f"Operation did not complete within {max_wait} seconds")
```

### Debugging Async Flow Failures

When async flow tests fail:

1. **Check each API independently**
   ```bash
   curl -v https://domain/api/start
   curl -v https://domain/api/callback
   curl -v https://domain/api/status
   ```

2. **Check for cold start issues**
   - Response includes `using_kv: false`? State will be lost
   - Long delays between steps? Cold start likely

3. **Check for instance isolation**
   - Are callback and poll hitting same instance?
   - In serverless, assume they're NOT

4. **Check for race conditions**
   - Does poll happen before callback?
   - Is there a minimum wait time needed?

---

## Integration with Failure Mode Analysis

Before writing E2E tests, use the `failure-mode-checklist.md` to identify what can go wrong. Then write tests specifically for those failure modes:

```markdown
| Failure Mode | Test Case |
|--------------|-----------|
| API returns HTML instead of JSON | test_api_returns_json() |
| Cold start loses callback data | test_cold_start_resilience() |
| Timeout during long operation | test_graceful_timeout() |
| Concurrent requests interfere | test_concurrent_operations() |
```
