# Retrospective Agent

**Purpose:** Conduct thorough post-mortems when bugs are discovered after "completion." This skill transforms failures into organizational learning.

---

## When to Use This Skill

Trigger this skill when:
- A bug is discovered after declaring a task/project "complete"
- A deployment fails or causes user-facing issues
- Tests pass but the product doesn't work as expected
- Multiple agents worked on interconnected code that broke at integration
- The user says "what went wrong?" or "how did we miss this?"

---

## Retrospective Process

### Phase 1: Incident Documentation (5 minutes)

Document the basic facts immediately:

```markdown
## Incident Summary
**Date:** [Date]
**Severity:** [CRITICAL/HIGH/MEDIUM/LOW]
**Impact:** [Who was affected and how]
**Time to Discovery:** [How long after "completion"]
**Time to Fix:** [Once discovered]

### What Happened
[1-2 paragraph description of the failure]

### Symptoms
- [What the user saw]
- [Error messages if any]
- [Expected vs actual behavior]
```

---

### Phase 2: Root Cause Analysis (10-15 minutes)

Use the **5 Whys** technique:

```markdown
### 5 Whys Analysis

1. **Why did the bug occur?**
   → [Direct technical cause]

2. **Why wasn't this caught in development?**
   → [Gap in implementation/review]

3. **Why wasn't this caught in testing?**
   → [Gap in test coverage]

4. **Why wasn't this caught before deployment?**
   → [Gap in verification process]

5. **Why does this gap exist in our process?**
   → [Systemic/organizational issue]
```

Identify the **technical root cause** with code references:

```markdown
### Technical Root Cause

**File:** `path/to/file.ts:line`
**Bug:** [What was wrong]
**Fix:** [What was changed]

**Code Before:**
\`\`\`typescript
// The problematic code
\`\`\`

**Code After:**
\`\`\`typescript
// The fixed code
\`\`\`
```

---

### Phase 3: Accountability Analysis (5-10 minutes)

Identify all parties involved and their contribution to the bug. This is NOT about blame—it's about understanding failure modes.

```markdown
### Accountability Matrix

| Role | What They Did | What They Should Have Done | Accountability Level |
|------|---------------|---------------------------|---------------------|
| [Role 1] | [Action/inaction] | [Better action] | HIGH/MEDIUM/LOW |
| [Role 2] | [Action/inaction] | [Better action] | HIGH/MEDIUM/LOW |
| Manager | [Action/inaction] | [Better action] | [Usually HIGH] |

**Accountability Levels:**
- **HIGH**: Directly caused or could have prevented the bug
- **MEDIUM**: Had partial responsibility or visibility
- **LOW**: Peripheral involvement
```

**Important:** The Manager/Orchestrator almost always has HIGH accountability because they:
- Declared the work "complete"
- Could have requested manual verification
- Could have questioned skipped tests

---

### Phase 4: Why It Wasn't Caught (5-10 minutes)

Analyze each layer of defense that failed:

```markdown
### Defense Layer Analysis

| Layer | Status | Why It Failed |
|-------|--------|---------------|
| Unit Tests | PASSED | [Tests didn't cover this scenario / mocked too much] |
| Integration Tests | SKIPPED | [Reason given / no reason documented] |
| Code Review | N/A | [Was there a review? Who reviewed?] |
| Manual Testing | SKIPPED | [No one ran the app before deployment] |
| Staging Environment | N/A | [Was it deployed to staging first?] |
| Monitoring/Alerts | N/A | [No alerts configured] |
| **Deployment Topology** | N/A | [Were API URLs pointing to correct domains?] |
| **Smoke Test Post-Deploy** | SKIPPED | [Did anyone curl the API after deploy?] |
```

**Deployment-Specific Checks:**
If the bug involved API calls or cross-project communication:
- [ ] Are all API URLs absolute (not relative)?
- [ ] Do frontend and API live on the same domain?
- [ ] Was the API tested with curl after deploy?
- [ ] Did anyone check browser Network tab?

See `deployment-contract-validator.md` for full checklist.

---

### Phase 5: Lessons Learned (10 minutes)

Extract actionable lessons at multiple levels:

```markdown
### Lessons Learned

#### For the Organization
1. **[Lesson Title]**: [Explanation and why it matters]
2. **[Lesson Title]**: [Explanation and why it matters]

#### For Individual Roles

**[Role 1]:**
- [Specific lesson for this role]
- [Actionable change they should make]

**[Role 2]:**
- [Specific lesson for this role]
- [Actionable change they should make]

**Managers:**
- [Specific lesson - managers always get lessons]
- [This is how they prevent recurrence]
```

---

### Phase 6: Action Items (5 minutes)

Create concrete follow-ups:

```markdown
### Action Items

| Item | Owner | Priority | Status |
|------|-------|----------|--------|
| [Immediate fix] | [Who] | P0 | DONE |
| [Add missing test] | [Who] | P1 | TODO |
| [Update skill/docs] | [Who] | P1 | TODO |
| [Process improvement] | [Who] | P2 | TODO |

### Skills/Agents to Create or Update

| Skill/Agent | Type | Description |
|-------------|------|-------------|
| [Name] | NEW/UPDATE | [What it should do] |
```

---

### Phase 7: Pattern Extraction (5 minutes)

Convert the incident into reusable patterns:

```markdown
### Pattern: [Name of Pattern]

**Problem:** [What goes wrong without this pattern]

**Solution:** [The pattern to follow]

**Example:**
\`\`\`typescript
// Good example
\`\`\`

### Anti-Pattern: [Name of Anti-Pattern]

**Description:** [What NOT to do]

**Why It's Bad:** [Consequences]

**Instead:** [What to do instead]
```

---

## Retrospective Template

Copy this template when conducting a retrospective:

```markdown
# Retrospective: [Brief Title]

## Incident Summary
**Date:**
**Severity:**
**Impact:**
**Time to Discovery:**
**Time to Fix:**

### What Happened
[Description]

### Technical Root Cause
**File:**
**Bug:**
**Fix:**

## 5 Whys Analysis
1. Why did the bug occur? →
2. Why wasn't this caught in development? →
3. Why wasn't this caught in testing? →
4. Why wasn't this caught before deployment? →
5. Why does this gap exist? →

## Accountability Matrix
| Role | Contribution | Should Have Done | Level |
|------|--------------|------------------|-------|
| | | | |

## Defense Layer Analysis
| Layer | Status | Why It Failed |
|-------|--------|---------------|
| Unit Tests | | |
| Integration Tests | | |
| Manual Testing | | |

## Lessons Learned

### For the Organization
1.
2.

### For Individual Roles
**[Role]:**
-

**Managers:**
-

## Action Items
| Item | Owner | Priority | Status |
|------|-------|----------|--------|
| | | | |

## Patterns Extracted
### Pattern:
**Problem:**
**Solution:**

### Anti-Pattern:
**Description:**
**Instead:**
```

---

## Example: Event Emitter Bug Retrospective

See `TEAM_KNOWLEDGE.md` section "Post-Mortem: Critical Event Emitter Bug (F-007)" for a complete example of this retrospective process applied to the Shadow Driver v2 project.

Key elements demonstrated:
- Clear accountability matrix with 5 roles analyzed
- 6 specific reasons why the bug wasn't caught
- 5 organizational lessons + role-specific lessons
- Event Contract Registry as extracted pattern
- Manager Verification Phase as new process

---

## Best Practices

1. **Do retrospectives immediately** - Context fades quickly
2. **Be specific** - Vague lessons don't prevent recurrence
3. **Include code references** - Future readers need to understand exactly what went wrong
4. **Always include Manager accountability** - Someone declared it "done"
5. **Extract reusable patterns** - Turn failures into organizational assets
6. **Update skills** - Prevent the same mistake across projects
7. **No blame, just facts** - Accountability is about understanding, not punishment
8. **Question skipped tests** - "We skipped this because..." is often the root cause

---

## Integration with Other Skills

| Skill | Integration |
|-------|-------------|
| `multi-agent-orchestration.md` | Update anti-patterns and add new patterns |
| `game-development-patterns.md` | Add technical patterns discovered |
| `TEAM_KNOWLEDGE.md` | Document the full post-mortem |

---

## Metrics to Track

Over time, track these to measure improvement:

1. **Mean Time to Detection (MTTD)** - How long before bugs are discovered
2. **Bugs per deployment** - Quality trend over time
3. **Test coverage gaps** - Which test types catch bugs
4. **Recurrence rate** - Same bug category appearing again
5. **Lesson adoption rate** - Are lessons being applied?
