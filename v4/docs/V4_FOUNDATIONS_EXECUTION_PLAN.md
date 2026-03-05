# Shadow Driver v4 Foundations Plan

Date: 2026-03-05  
Owner: Codex + Rishi  
Purpose: Build a parallel v4 track without breaking current v3 testing/deploys.

---

## 1) Goal (Plain English)
Ship a **credible, smooth, sharp demo** by fixing fundamentals first:
1. Visual quality baseline (no washout / ghosting)
2. Drivability baseline (reverse + recovery reliability)
3. Startup baseline (faster first frame / better loading UX)

Non-goal for this phase: full AI-opponent polish and auto-provisioning UX.

---

## 2) Isolation Strategy
- Create and use a separate branch: `v4-foundations`
- Keep current `v3` flow untouched
- Deploy to a separate Vercel project: `shadow-driver-v4`
- Vercel root directory remains `v3/` (branch separates behavior)

---

## 3) Team (Distinct Agent Roles)

### A) Product/Scope Agent
- Maintains strict “Now vs Later” boundaries
- Blocks feature creep

### B) Rendering/Video Agent
- Owns WebGL + codec visual output quality
- Removes stylization that hurts clarity

### C) Vehicle Feel Agent
- Owns steering/reverse/unstuck behavior
- Tunes for high-latency tolerance

### D) Network/Runtime Agent
- Owns startup-to-first-frame behavior and transport path reliability
- Ensures tunnel mode is treated as degraded but stable

### E) QA/Verification Agent
- Owns automated regression checks and artifact comparisons
- No “fixed” claim without evidence

### F) Release Agent
- Owns branch hygiene, deploy safety, rollback notes

---

## 4) Task List

## NOW (execute immediately)
1. Branch + deploy isolation
   - Work only on `v4-foundations`
   - Create `shadow-driver-v4` Vercel project, root `v3/`
2. Visual baseline pass
   - Disable remaining aggressive post-processing in `WebGLCanvas.tsx`
   - Temporarily disable `SpeedEffects` overlay in `Race.tsx`
3. Drivability reliability pass
   - Reduce reverse aggressiveness and improve fence/wall recovery behavior
4. Startup experience pass
   - Minimize black-screen pain before first frame (UX + pipeline timing)
5. Verification loop
   - Run structured gameplay tests and compare artifacts before/after

## LATER (defer)
1. AI opponent route/visibility correctness
2. ABR restart architecture + codec config re-send
3. Re-enable stylization under latency gates
4. Full user-facing “Play/auto-provision” polish
5. WebRTC direct-IP mode restoration

---

## 5) Verification Gates (must pass)
1. Startup black-screen interval clearly improved
2. No obvious ghosting on turns in test artifacts
3. Reverse enter/exit stable and wall recovery improved
4. FPS stable enough for playability (target 25+ in local tests)
5. Artifacts + summary documented per run

---

## 6) What Rishi sets up now (blockers)
1. **Vercel project created**
   - Name: `shadow-driver-v4`
   - Root Directory: `v3/`
   - Branch target: `v4-foundations` (once created)
2. **Vercel env vars copied**
   - `VASTAI_API_KEY`
   - `NGROK_AUTHTOKEN` (if needed)
3. **Confirm preferred test path for this phase**
   - Recommended: localhost + SSH tunnel (`ws://localhost:8765`) for low-latency truth
4. **Give go-ahead for branch creation + implementation**

---

## 7) First Deliverable from this plan
- One PR-sized patch set focused only on:
  - visual baseline cleanup,
  - reverse/unstuck reliability,
  - startup first-frame UX.
- Plus: before/after evidence summary for quick founder review.

