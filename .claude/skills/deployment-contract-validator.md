# Deployment Contract Validator

**Purpose:** Prevent API URL mismatches and cross-project integration failures by documenting and validating deployment topology before implementation.

---

## When to Use This Skill

Use this skill when:
- Frontend calls backend APIs
- Multiple Vercel/deployment projects need to communicate
- Code uses relative URLs (`/api/...`) that might resolve to wrong domain
- Migrating or splitting a monolith into separate deployments
- You see errors like "Unexpected token '<'" or "is not valid JSON" (HTML returned instead of JSON)

---

## The Problem This Solves

The Shadow Driver v2 project had a critical bug:

```typescript
// useGPUConnection.ts used relative URL
const response = await fetch('/api/gpu/start', { method: 'POST' });
```

**Deployment Reality:**
- v2 app deployed to: `v2-sigma-lemon.vercel.app`
- GPU API deployed to: `carla-shadow-driver.vercel.app`

**Result:** `/api/gpu/start` resolved to `v2-sigma-lemon.vercel.app/api/gpu/start` which doesn't exist. Server returned HTML 404 page, JSON.parse() threw "Unexpected token 'T'".

---

## Deployment Contract Template

Before implementing any cross-project API calls, document the contract:

```markdown
## Deployment Contract: [Frontend] → [Backend API]

### Projects

| Project | Vercel Project | Domain | What It Serves |
|---------|---------------|--------|----------------|
| v2 Game | v2 | v2-sigma-lemon.vercel.app | React SPA |
| GPU API | vercel-deploy | carla-shadow-driver.vercel.app | Serverless API |

### API Endpoints

| Endpoint | Method | Served By | Full URL |
|----------|--------|-----------|----------|
| /api/gpu/start | POST | vercel-deploy | https://carla-shadow-driver.vercel.app/api/gpu/start |
| /api/gpu/stop | POST | vercel-deploy | https://carla-shadow-driver.vercel.app/api/gpu/stop |
| /api/gpu/status | GET | vercel-deploy | https://carla-shadow-driver.vercel.app/api/gpu/status |

### Cross-Origin Considerations

- [ ] CORS headers configured on API?
- [ ] Credentials (cookies) needed?
- [ ] API key/auth required?
```

---

## Validation Checklist

Run this checklist for every API integration:

```markdown
## API Integration Validation: [Feature Name]

### 1. URL Analysis
- [ ] Are URLs absolute or relative?
- [ ] If relative, what domain do they resolve to?
- [ ] Is the API on the SAME domain as the frontend?
- [ ] If different domains, is the full URL hardcoded or configurable?

### 2. Deployment Topology
- [ ] Document which Vercel project serves the API
- [ ] Document which Vercel project serves the frontend
- [ ] Are they the same project? If not, use absolute URLs

### 3. Test in Production Environment
- [ ] curl the API endpoint directly to verify it works
- [ ] Open browser devtools and check Network tab for the actual request URL
- [ ] Verify response is JSON, not HTML

### 4. Error Handling
- [ ] What happens if API returns HTML instead of JSON?
- [ ] Does the code catch JSON parse errors gracefully?
- [ ] Does error message help debug the issue?
```

---

## Common Patterns

### Pattern 1: Same-Project API (Safe with Relative URLs)

```
my-app/
├── src/           # Frontend
├── api/           # Serverless functions
└── vercel.json    # Single deployment
```

Frontend can use `/api/endpoint` safely.

### Pattern 2: Separate Projects (MUST Use Absolute URLs)

```
Project A (frontend): my-app.vercel.app
Project B (api):      my-api.vercel.app
```

Frontend MUST use `https://my-api.vercel.app/api/endpoint`.

### Pattern 3: Environment-Based URLs (Recommended)

```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://my-api.vercel.app';

fetch(`${API_BASE_URL}/api/endpoint`);
```

---

## Anti-Patterns

### Anti-Pattern 1: Assuming Same Domain

```typescript
// ❌ WRONG: Assumes API is on same domain
fetch('/api/gpu/start');

// ✅ CORRECT: Explicit domain
const API_BASE_URL = 'https://carla-shadow-driver.vercel.app';
fetch(`${API_BASE_URL}/api/gpu/start`);
```

### Anti-Pattern 2: Not Testing After Deploy

```bash
# ❌ WRONG: Just deploy and trust it works
vercel --prod

# ✅ CORRECT: Verify API is reachable
vercel --prod
curl -X POST https://v2-sigma-lemon.vercel.app/api/gpu/start  # Should work!
```

### Anti-Pattern 3: Ignoring "Unexpected token" Errors

```
Error: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

This ALWAYS means: "I expected JSON but got HTML (probably a 404 page)."

**Debug steps:**
1. Check the URL being requested
2. curl it directly
3. See what's actually returned

---

## Quick Reference: Debugging API URL Issues

### Step 1: Identify the Actual URL

```typescript
// Add logging before fetch
console.log('Fetching:', `${API_BASE_URL}/api/endpoint`);
const response = await fetch(...);
console.log('Status:', response.status);
console.log('Content-Type:', response.headers.get('content-type'));
```

### Step 2: Check Content-Type

```typescript
const contentType = response.headers.get('content-type');
if (!contentType?.includes('application/json')) {
  const text = await response.text();
  console.error('Expected JSON but got:', text.substring(0, 200));
  throw new Error('API returned non-JSON response');
}
```

### Step 3: Test with curl

```bash
# Test the exact URL your code is calling
curl -X POST https://your-domain.vercel.app/api/endpoint -v

# Check if you get JSON or HTML
curl -s https://your-domain.vercel.app/api/endpoint | head -1
# JSON starts with { or [
# HTML starts with <!DOCTYPE or <html
```

---

## Integration with Other Skills

- **event-contract-validator.md**: Use for in-app communication (events)
- **deployment-contract-validator.md**: Use for cross-project/API communication (this skill)
- **retrospective-agent.md**: Add deployment topology to incident analysis

---

## Best Practices

1. **Document deployment topology** at project start
2. **Use absolute URLs** when frontend and API are separate projects
3. **Add content-type validation** before JSON.parse()
4. **Test API endpoints with curl** after every deploy
5. **Keep API_BASE_URL configurable** via environment variable
6. **Add deployment verification** to CI/CD pipeline
