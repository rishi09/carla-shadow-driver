# Failure Mode Checklist

**Purpose:** Systematically identify what could go wrong BEFORE deploying. This skill prevents bugs by asking "what if?" questions during development, not after release.

---

## When to Use This Skill

Use this skill:
- Before any production deployment
- When adding new features with external dependencies
- When building async or multi-step workflows
- When integrating with third-party services
- During code review of critical paths
- When you catch yourself thinking "this should work"

---

## The Problem This Solves

**Shadow Driver had two bugs that could have been prevented:**

1. **API URL Bug:** Frontend called `/api/gpu/start` which resolved to wrong domain
   - **If asked:** "What if the API is on a different domain?" → Would have caught it

2. **Cold Start Bug:** GPU callback stored URL in memory, lost on cold start
   - **If asked:** "What if the function restarts between callback and poll?" → Would have caught it

**Neither question was asked. Both bugs shipped.**

---

## Core Failure Mode Categories

### 1. Network Failures

| Question | If Yes... |
|----------|-----------|
| Does the code make HTTP requests? | What if the request times out? |
| Does it call external APIs? | What if the API is down? Rate limited? |
| Does it use relative URLs? | What domain do they resolve to? |
| Does it cross domains? | Are CORS headers configured? |
| Does it use WebSockets? | What if connection drops mid-operation? |

### 2. State Failures

| Question | If Yes... |
|----------|-----------|
| Does it store state in memory? | What if the process restarts? (cold start) |
| Does it use global variables? | What if concurrent requests race? |
| Does it cache data? | What if cache is stale/empty/corrupted? |
| Does it use localStorage? | What if user is in incognito? |
| Does it rely on cookies? | What if cookies are blocked/expired? |

### 3. Timing Failures

| Question | If Yes... |
|----------|-----------|
| Does it have async operations? | What if they complete out of order? |
| Does it have timeouts? | What if operation exceeds timeout? |
| Does it poll for status? | What if status never arrives? |
| Does it have callbacks? | What if callback comes before handler is ready? |
| Does it have animations? | What if user interacts mid-animation? |

### 4. Data Failures

| Question | If Yes... |
|----------|-----------|
| Does it parse JSON? | What if response is HTML (404 page)? |
| Does it expect specific fields? | What if fields are missing/null? |
| Does it have user input? | What if input is empty/malformed/malicious? |
| Does it have file uploads? | What if file is too large/wrong type? |
| Does it display lists? | What if list is empty? What if 10,000 items? |

### 5. Environment Failures

| Question | If Yes... |
|----------|-----------|
| Does it use environment variables? | What if they're not set? |
| Does it differ dev vs prod? | What behaviors change? |
| Does it use serverless? | What about cold starts? Instance isolation? |
| Does it assume specific browser? | What about Safari? Mobile? |
| Does it use platform APIs? | What if API not available (permissions, device)? |

### 6. Integration Failures

| Question | If Yes... |
|----------|-----------|
| Does it call other services you built? | What if they're deployed separately? |
| Does it share state between components? | Is the contract documented? |
| Does it use events? | Do emitters and listeners use same object? |
| Does it have multiple deployment targets? | Are URLs hardcoded or configurable? |

---

## Pre-Deploy Failure Mode Review

Before every deployment, complete this checklist:

```markdown
## Failure Mode Review: [Feature/Deploy Name]

### Date: [Date]
### Reviewer: [Name]

### 1. Request Flow Analysis

Draw the request flow and identify failure points:

```
User → [1] Frontend → [2] API → [3] External Service → [4] Database
                         ↓
                    [5] Callback → [6] Poll for result
```

For each numbered point, ask:
- [ ] What if this step fails?
- [ ] What if this step is slow (>10s)?
- [ ] What if this step returns unexpected data?

### 2. State Analysis

List all state storage:
- [ ] Where: _____________ | Persistent? Y/N | What if lost? _____________
- [ ] Where: _____________ | Persistent? Y/N | What if lost? _____________

### 3. Timing Analysis

List all async operations:
- [ ] Operation: _____________ | Timeout? ____s | What if exceeded? _____________
- [ ] Operation: _____________ | Timeout? ____s | What if exceeded? _____________

### 4. Environment Analysis

- [ ] All required env vars documented?
- [ ] Dev/prod differences identified?
- [ ] Serverless cold start considered?

### 5. Integration Analysis

- [ ] All API URLs absolute (not relative)?
- [ ] All event contracts documented?
- [ ] All external dependencies have fallbacks?

### Identified Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk 1] | H/M/L | H/M/L | [What we'll do] |
| [Risk 2] | H/M/L | H/M/L | [What we'll do] |

### Sign-off

- [ ] All high-likelihood or high-impact risks mitigated
- [ ] Ready for deployment
```

---

## Quick Failure Mode Questions

When short on time, ask these five questions:

1. **"What if the network fails?"**
   - Timeout handling? Retry logic? Error messages?

2. **"What if the server restarts?"**
   - State persistence? Session recovery? Cold start handling?

3. **"What if data is missing?"**
   - Null checks? Default values? Empty state UI?

4. **"What if URLs are wrong?"**
   - Absolute vs relative? Domain resolution? CORS?

5. **"What if it takes too long?"**
   - Timeout handling? Loading states? User feedback?

---

## Failure Mode by Feature Type

### API Integration

```markdown
- [ ] What if API returns non-JSON (HTML error page)?
- [ ] What if API is rate limited?
- [ ] What if API changes response format?
- [ ] What if API credentials expire?
- [ ] What if API has different domains for dev/prod?
```

### User Authentication

```markdown
- [ ] What if token expires mid-session?
- [ ] What if user opens multiple tabs?
- [ ] What if refresh token also expired?
- [ ] What if user clears cookies?
- [ ] What if SSO provider is down?
```

### File Operations

```markdown
- [ ] What if file is too large?
- [ ] What if disk is full?
- [ ] What if file is locked?
- [ ] What if path doesn't exist?
- [ ] What if permissions are denied?
```

### Database Operations

```markdown
- [ ] What if connection pool exhausted?
- [ ] What if query times out?
- [ ] What if data violates constraints?
- [ ] What if transaction fails mid-way?
- [ ] What if connection string changes?
```

### Real-time Features

```markdown
- [ ] What if WebSocket disconnects?
- [ ] What if messages arrive out of order?
- [ ] What if client reconnects mid-operation?
- [ ] What if server sends update to dead connection?
- [ ] What if offline user comes back online?
```

---

## Implementing Mitigations

### For Network Failures

```javascript
// Add timeout and error handling
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);

try {
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  // Check content type before parsing
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    throw new Error(`Expected JSON but got ${contentType}`);
  }

  return await response.json();
} catch (error) {
  if (error.name === 'AbortError') {
    throw new Error('Request timed out');
  }
  throw error;
}
```

### For State Failures

```javascript
// Use external storage with fallback
async function getState(key) {
  try {
    // Primary: persistent storage
    const data = await kv.get(key);
    if (data) return data;
  } catch (e) {
    console.error('KV read failed:', e);
  }

  // Fallback: in-memory (with warning)
  console.warn('Using in-memory fallback - data will be lost on restart');
  return memoryCache[key] || null;
}
```

### For Timing Failures

```javascript
// Add explicit timeouts to all async operations
const withTimeout = (promise, ms, message) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms)
  );
  return Promise.race([promise, timeout]);
};

// Usage
const result = await withTimeout(
  slowOperation(),
  30000,
  'Operation timed out after 30 seconds'
);
```

---

## Integration with Other Skills

| Skill | How to Integrate |
|-------|------------------|
| `deployment-contract-validator.md` | Add failure mode review to pre-deploy |
| `serverless-patterns.md` | Reference for cold start failures |
| `e2e-browser-testing.md` | Test identified failure modes |
| `retrospective-agent.md` | Use failures to update this checklist |

---

## Lesson Learned

**From the Shadow Driver bugs:**

> The bugs that ship are the ones you didn't think of. Before deploying, spend 5 minutes asking "what if?" for each component. The bugs you imagine cost minutes to prevent. The bugs you don't imagine cost hours to debug.

This skill exists because two bugs shipped that could have been caught by asking simple questions. The fix for each took 30 minutes. The debugging and user impact took hours. The questions take 5 minutes.
