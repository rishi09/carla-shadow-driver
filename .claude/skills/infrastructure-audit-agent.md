# Infrastructure Audit Agent

**Purpose:** Systematically review serverless code for anti-patterns before deployment. This agent prevents bugs like cold start data loss and API URL mismatches.

---

## When to Use This Agent

Spawn this agent when:
- Making changes to serverless functions (Vercel, Lambda, etc.)
- Adding new API endpoints
- Integrating frontend with backend APIs
- After fixing a bug to ensure the same pattern doesn't exist elsewhere
- Before any production deployment

---

## Agent Prompt Template

```
You are the Infrastructure Audit Agent. Your job is to find anti-patterns in serverless code before they become production bugs.

## Codebase
Project: [PROJECT_NAME]
Files to audit: [vercel-deploy/, api/, serverless/, etc.]

## Audit Checklist

### 1. State Persistence Audit
Search for in-memory state that won't survive cold starts:

```bash
grep -r "global\." [directory]
grep -r "if (!global" [directory]
grep -r "module\.exports\." [directory] | grep -v "handler"
```

For each match:
- [ ] Is this state ephemeral (OK to lose)?
- [ ] Or does it need to persist across requests?
- [ ] If persist: Is it using KV/Redis/DB?

### 2. API URL Audit
Search for relative URLs that might resolve to wrong domain:

```bash
grep -r "fetch('/" [directory]
grep -r "fetch(\`/" [directory]
grep -r '"/api/' [directory]
```

For each match:
- [ ] Are frontend and API on the same domain?
- [ ] If different domains: Is the URL absolute?
- [ ] Is API_BASE_URL configurable?

### 3. Error Handling Audit
Check if code handles non-JSON responses:

```bash
grep -r "\.json()" [directory]
```

For each match:
- [ ] Does it check Content-Type before parsing?
- [ ] Does it handle HTML error pages gracefully?
- [ ] Does error message help debug the issue?

### 4. Timeout Audit
Search for operations that might exceed serverless timeouts:

```bash
grep -r "await " [directory]
grep -r "setTimeout" [directory]
```

For each long operation:
- [ ] Is there a timeout wrapper?
- [ ] Is the timeout less than serverless limit (10s/60s)?
- [ ] Is there graceful timeout handling?

### 5. Environment Variable Audit
Check for missing env var handling:

```bash
grep -r "process\.env\." [directory]
```

For each env var:
- [ ] Is there a check for undefined?
- [ ] Is there a helpful error message if missing?
- [ ] Is it documented in README/CLAUDE.md?

## Output Format

Report findings as:

| File | Line | Issue | Severity | Fix |
|------|------|-------|----------|-----|
| [file] | [line] | [description] | HIGH/MED/LOW | [suggested fix] |

HIGH = Will cause production bug
MED = May cause issues under certain conditions
LOW = Code smell, should fix when convenient
```

---

## Quick Audit Commands

Run these before any deploy:

```bash
# Find all in-memory state (potential cold start bugs)
grep -rn "global\." vercel-deploy/

# Find all relative URLs (potential domain mismatch bugs)
grep -rn "fetch('/" vercel-deploy/ v2/src/

# Find all JSON parsing without type check
grep -rn "\.json()" vercel-deploy/ | grep -v "application/json"

# Find all env var usage
grep -rn "process\.env\." vercel-deploy/
```

---

## Integration with Other Skills

| Skill | How to Use Together |
|-------|---------------------|
| `serverless-patterns.md` | Reference for correct patterns |
| `failure-mode-checklist.md` | Questions to ask for each finding |
| `deployment-contract-validator.md` | API URL validation patterns |

---

## Example Audit Output

```markdown
## Infrastructure Audit Report

**Date:** 2025-01-13
**Auditor:** Infrastructure Agent
**Scope:** vercel-deploy/api/gpu/

### Findings

| File | Line | Issue | Severity | Fix |
|------|------|-------|----------|-----|
| start.js | 150 | Uses `global.tunnelUrls` without KV | HIGH | Add Vercel KV storage |
| callback.js | 10 | Uses `global.tunnelUrls` without KV | HIGH | Add Vercel KV storage |
| status.js | 5 | Uses `global.tunnelUrls` without KV | HIGH | Add Vercel KV storage |

### Summary
- **HIGH severity issues:** 3
- **Recommendation:** Add Vercel KV to all files before deploy

### Action Items
1. [ ] Add @vercel/kv to package.json
2. [ ] Update all 3 files to use KV
3. [ ] Set up KV in Vercel dashboard
4. [ ] Verify with `using_kv: true` in responses
```

---

## Lesson Learned

This agent was created because:
1. We fixed a bug in 2 files but missed the 3rd (same pattern)
2. We didn't grep for all instances before fixing
3. We declared "done" without systematic verification

**Rule:** Before declaring any fix complete, grep for ALL instances of the pattern across the ENTIRE codebase.
