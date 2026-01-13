# Multi-Agent Development Orchestration

**Purpose:** Patterns for managing parallel agent teams on complex software projects. Learned from the Shadow Driver v2 game overhaul (90+ files, 27k+ lines of code).

---

## When to Use This Skill

Use these patterns when:
- Managing 3+ parallel agents on a shared codebase
- Working on projects with cross-cutting concerns
- Coordinating research, implementation, and testing in parallel
- Building organizational memory across agent sessions

---

## Core Principle: Functional Organization

Treat agents like a development team, not just tools. Assign clear roles:

| Role | Focus | Tools |
|------|-------|-------|
| **Engine Lead** | Core logic, algorithms, data structures | All |
| **UI/UX Lead** | Components, styling, user experience | All |
| **QA Lead** | Testing, bug fixes, edge cases | All |
| **Innovation Lead** | Research, prototypes, stretch goals | WebSearch, WebFetch |
| **Release Lead** | Git, documentation, deployment | Bash, Read, Write |

---

## Pattern 1: Parallel Agent Launch

**When:** Starting a complex project with independent workstreams.

```
Launch simultaneously:
1. Research agent → Explore codebase, gather context
2. Design agent → Plan architecture, identify patterns
3. Infrastructure agent → Set up testing, CI/CD
```

**Key:** Use `run_in_background: true` for all agents, then poll with `TaskOutput`.

---

## Pattern 2: Shared Knowledge Base

**Problem:** Agents working in isolation rediscover the same problems.

**Solution:** Create a `TEAM_KNOWLEDGE.md` file that all agents read/update.

```markdown
# Team Knowledge Base

## Architecture Decisions
- [Date] Decision: X because Y

## Patterns Discovered
- Pattern: How to do X

## Lessons Learned
- Don't do Y because Z

## Session Logs
### [Team] (Date)
**Task:** What
**Findings:** What discovered
**Files Changed:** List
```

**Rule:** Every agent should:
1. Read TEAM_KNOWLEDGE.md at session start
2. Write learnings at session end

---

## Pattern 3: Staged Execution

Not everything should be parallel. Use stages:

```
STAGE 1: EXPLORATION (Parallel)
├── Agent A: Explore architecture
├── Agent B: Explore UI patterns
└── Agent C: Explore testing setup

STAGE 2: IMPLEMENTATION (Parallel with gates)
├── Agent D: Core game engine (blocks UI)
├── Agent E: UI components (waits for types)
└── Agent F: Testing framework

STAGE 3: INTEGRATION (Sequential)
├── Agent G: Wire everything together
└── Agent H: Bug fixes and polish

STAGE 4: RELEASE (Sequential)
├── Git cleanup and commits
└── Documentation and deployment
```

---

## Pattern 4: Conflict Resolution

**Problem:** Multiple agents edit the same file.

**Solutions:**
1. **File ownership:** Assign files to specific agents
2. **Interface contracts:** Define types first, implement later
3. **Merge strategy:** One agent does final integration
4. **Event-driven:** Use events instead of shared state

---

## Pattern 5: Progress Monitoring

Check agent output regularly. Look for:
- Stuck patterns (same tool calls repeated)
- Errors in tool output
- Deviation from assigned task
- Conflicts with other agents

**Pattern:** Poll every 60-90 seconds with non-blocking TaskOutput:
```
TaskOutput(task_id, block=false)
```

---

## Pattern 6: Context Management

**Problem:** Agents lose context in long sessions.

**Solutions:**
1. **Task descriptions:** Be very specific in agent prompts
2. **File references:** Point to exact files needed
3. **Scope boundaries:** Tell agents what NOT to touch
4. **Summary requests:** Ask for summaries at checkpoints

**Template for agent prompts:**
```
You are the [ROLE] for [PROJECT].

Your task: [SPECIFIC GOAL]

Files you should read:
- path/to/file1.ts
- path/to/file2.ts

Files you will create/modify:
- path/to/new-file.ts

DO NOT modify:
- src/game/** (owned by Engine Lead)

When complete:
1. Update TEAM_KNOWLEDGE.md with findings
2. Commit changes with descriptive message
3. Report summary of what was done
```

---

## Pattern 7: Skill Extraction

After major projects, extract reusable patterns into skills:

1. **What went well?** → Document as patterns
2. **What went wrong?** → Document as anti-patterns
3. **What was repeated?** → Abstract into reusable code
4. **What was researched?** → Cache findings

**Skill structure:**
```markdown
# [Skill Name]

## When to Use
- Trigger conditions

## Patterns
1. Pattern: Solution

## Anti-Patterns
- What to avoid

## Quick Reference
- Commands, templates, snippets
```

---

## Pattern 8: Periodic Saves

**Rule:** Push commits every 30-60 minutes of work.

**Rationale:**
1. Prevents loss from crashes/timeouts
2. Creates restore points
3. Enables collaboration
4. Provides audit trail

**Commit message pattern:**
```
[scope]: Brief description

- Bullet 1
- Bullet 2

Files changed:
- path/to/file.ts
```

---

## Anti-Patterns to Avoid

1. **Launching too many agents** - Context switching overhead
2. **No clear ownership** - Leads to conflicts and gaps
3. **Ignoring agent output** - Errors compound
4. **Parallel integration** - Always do final merge sequentially
5. **Skipping knowledge sharing** - Repeats mistakes
6. **Long-running agents without checkpoints** - Risk of context loss
7. **Skipping tests and declaring "done"** - Skipped tests are hidden bugs
8. **Manager trusting without verifying** - Run the product manually before completion
9. **Undocumented event contracts** - When components communicate via events, document the contract

---

## Pattern 9: Manager Verification Phase

**Problem:** Multi-agent teams can declare completion while critical bugs remain.

**Context:** During the Shadow Driver v2 project, 5+ agents worked in parallel. All tests passed, deployment succeeded, but the game didn't work because of an event emitter mismatch between Phaser and React. The bug was only discovered when a human actually tried to play the game.

**Solution:** Add an explicit Manager Verification Phase before declaring any project complete.

**Manager Verification Checklist:**
```markdown
## Pre-Completion Verification

### 1. Test Results Audit
- [ ] All tests pass (no failures)
- [ ] No tests skipped without documented follow-up
- [ ] Code coverage meets threshold

### 2. Manual E2E Testing
- [ ] Run the application in a real browser
- [ ] Click through the entire primary user flow
- [ ] Click through secondary flows
- [ ] Take screenshots at each step
- [ ] Test on mobile (if applicable)

### 3. Integration Verification
- [ ] All component interfaces documented
- [ ] Event contracts between components verified
- [ ] API contracts between services verified

### 4. MANDATORY: API Smoke Test (DO NOT SKIP)
**You MUST curl every API endpoint after deploy. This takes 30 seconds and catches 90% of integration bugs.**

```bash
# For each API endpoint your frontend calls:
curl -X POST https://YOUR-DEPLOYED-DOMAIN/api/endpoint | head -1

# If response starts with '{' or '[' = JSON = GOOD
# If response starts with '<' or 'The page' = HTML = WRONG URL
```

- [ ] List all API endpoints the frontend calls
- [ ] curl each one from the DEPLOYED frontend domain
- [ ] Verify each returns JSON, not HTML
- [ ] If any return HTML, the URL is pointing to wrong domain

**Why this catches bugs:** Build passes, tests pass, deploy succeeds - but relative URLs resolve to the wrong domain. Only a real HTTP request reveals this.

### 5. Edge Cases
- [ ] Test with empty/null inputs
- [ ] Test error states
- [ ] Test offline/network failure modes

### 5. Documentation
- [ ] README updated
- [ ] TEAM_KNOWLEDGE.md updated with learnings
- [ ] Skills extracted for reuse
```

**Key Rule:** If you can't personally verify it works, it's not done.

---

## Pattern 10: Event Contract Documentation

**Problem:** When multiple agents write code that communicates via events, mismatches occur.

**Solution:** Create an Event Contract Registry in TEAM_KNOWLEDGE.md.

**Template:**
```markdown
## Event Contract: [ComponentA] ↔ [ComponentB]

| Event | Emitter | Emitter Object | Listener | Listener Object | Payload |
|-------|---------|----------------|----------|-----------------|---------|
| eventName | ComponentA | this.events / game.events | ComponentB | same | { type: Interface } |
```

**Rule:** Before implementing events:
1. Document the contract first
2. Both sides agree on the emitter object
3. Write a simple test: emit → receive → log

---

## Agent Prompt Templates

### Research Agent
```
You are the Innovation Lead researching [TOPIC].

Your task: Research and document findings for [SPECIFIC QUESTION].

Steps:
1. Search for [KEYWORDS]
2. Read relevant documentation
3. Evaluate options with pros/cons
4. Write findings to TEAM_KNOWLEDGE.md
5. Create prototype file if applicable

Output: Summary of findings with recommendation.
```

### Implementation Agent
```
You are the [ROLE] implementing [FEATURE].

Files to read first:
- [List of context files]

Files to create:
- [List of new files]

Requirements:
1. [Requirement 1]
2. [Requirement 2]

Constraints:
- Do not modify [files]
- Follow patterns in [reference]

When complete: Update TEAM_KNOWLEDGE.md and commit.
```

### Testing Agent
```
You are the QA Lead testing [COMPONENT].

Your task: Review code and fix bugs.

Steps:
1. Read component at [path]
2. Identify edge cases and potential bugs
3. Fix issues directly in the code
4. Add defensive coding where needed
5. Run tests to verify fixes

Focus areas:
- Empty array handling
- Null/undefined checks
- Memory leaks (intervals, listeners)
- Error states
```

---

## Metrics for Success

Track these to evaluate multi-agent projects:

1. **Parallel efficiency:** Actual vs theoretical speedup
2. **Conflict rate:** Files edited by multiple agents
3. **Knowledge reuse:** Patterns extracted per project
4. **Error rate:** Bugs caught in integration
5. **Context overhead:** Tokens spent on coordination

---

## Quick Reference: Agent Types by Task

| Task Type | Recommended Agent | Model |
|-----------|-------------------|-------|
| Complex implementation | opus 4.5 | Full ultrathink |
| Research/exploration | opus 4.5 | Explore subagent |
| Quick fixes | haiku | Fast iteration |
| Documentation | haiku | Straightforward |
| Integration | opus 4.5 | Needs full context |
