# External API Integration Skill

## Purpose

Prevent failures caused by third-party APIs and external services. These failures are often silent, hard to reproduce, and outside our direct control.

## When to Use

Use this skill when:
1. Integrating with any external API (Vast.ai, Stripe, AWS, etc.)
2. Selecting resources from a marketplace or pool
3. Depending on external services for critical functionality
4. Debugging issues that only happen in production with real services

## Pre-Integration Checklist

Before writing code that calls an external API, answer these questions:

### 1. Error States
- [ ] What error responses can the API return?
- [ ] What HTTP status codes are possible?
- [ ] Are there "soft failures" (resource exists but is broken)?
- [ ] What does a timeout look like vs a rejection?

### 2. Resource Selection
If selecting from a pool of resources (GPUs, servers, instances):
- [ ] What quality/health indicators exist? (verified, reliability score, status)
- [ ] What filtering parameters should we use?
- [ ] Can we get a "bad" resource that passes basic filters?
- [ ] Should we retry with a different resource on failure?

### 3. Failure Detection
- [ ] How do we detect that the external resource failed?
- [ ] Is there a status we should poll for?
- [ ] What's the difference between "still starting" and "failed"?
- [ ] How long should we wait before declaring failure?

### 4. Retry Strategy
- [ ] Should we retry with the same resource or a different one?
- [ ] How many retries are appropriate?
- [ ] What's the backoff strategy?
- [ ] When do we give up and show an error?

### 5. Observability
- [ ] Are we logging which resources we select?
- [ ] Are we logging why resources fail?
- [ ] Can we build a blacklist over time?
- [ ] Do we have metrics on success/failure rates?

## Vast.ai Specific Knowledge

### GPU Selection Filters
Always include these filters when selecting GPUs:
```javascript
const suitable = offers.filter(o =>
  o.gpu_ram >= 16000 &&        // Enough VRAM
  o.verified !== false &&       // NOT deverified (critical!)
  o.reliability >= 0.95 &&      // High reliability
  o.dph_total < 1.00            // Reasonable price
);
```

### Known Failure Modes

| Status | Meaning | Action |
|--------|---------|--------|
| `running` | GPU is healthy | Connect |
| `stopped` | GPU failed to start | Retry with different GPU |
| `exited` | Container crashed | Retry with different GPU |
| Deverified host | Host has known issues | Never select these |
| OCI runtime error | Docker/GPU config broken | Retry with different GPU |

### Status Polling
- Poll every 5 seconds
- Timeout after 5 minutes
- Check for `status === 'stopped'` and retry
- Check for `setup_status === 'error'` and retry

## Lessons Learned

### 2026-01 Deverified Host Incident
- **Issue:** GPU provisioning failed with "OCI runtime create failed: failed to inject CDI devices"
- **Root Cause:** Selected a Vast.ai host marked as "Deverified" - meaning Vast.ai knows the host is broken
- **Fix:** Added `verified !== false` filter and increased reliability threshold to 0.95
- **Prevention:** Always check for quality/health indicators when selecting from resource pools

## Template: External API Integration Review

When reviewing code that integrates with external APIs, check:

```markdown
## External API Review: [API Name]

### Error Handling
- [ ] All error responses handled
- [ ] Timeouts configured
- [ ] Retry logic implemented

### Resource Selection (if applicable)
- [ ] Quality filters applied
- [ ] Bad resources excluded
- [ ] Retry with different resource on failure

### Observability
- [ ] Selections logged
- [ ] Failures logged with reason
- [ ] Metrics tracked

### Testing
- [ ] Tested with real API (not just mocks)
- [ ] Tested failure scenarios
- [ ] Tested retry logic
```
