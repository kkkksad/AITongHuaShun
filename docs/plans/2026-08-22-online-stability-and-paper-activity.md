# Online Stability And Paper Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale or missing frontend chunks from blanking the app, document the real domain certificate blocker, and keep Paper activity ambitious but bounded and auditable.

**Architecture:** Add one shared lazy-import recovery wrapper for the root app and route-level chunks. It reloads once after a Vite preload/dynamic import failure, then leaves the error boundary visible instead of looping. Change the service worker to prefer current hashed assets while retaining offline fallback. Production remains Paper-only with a 6-order target and a 10-order hard cap; no real broker or unlimited execution is introduced.

**Tech Stack:** React, TypeScript, Vite, Service Worker, Fastify, Vitest, Docker/Nginx deployment docs.

---

### Task 1: Lock chunk recovery behavior with tests

**Files:**
- Create: `src/lib/chunkRecovery.ts`
- Test: `src/lib/chunkRecovery.test.ts`

- [x] **Step 1: Test dynamic import error classification and one-shot reload guard.**
- [x] **Step 2: Run `npx vitest run src/lib/chunkRecovery.test.ts --environment jsdom`; expect the new tests to fail before implementation.**
- [x] **Step 3: Implement pure helpers that recognize Vite chunk/preload errors and allow one reload per page URL through session storage.**
- [x] **Step 4: Re-run the focused test and expect PASS.**

### Task 2: Apply recovery to the app and service worker

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `public/sw.js`

- [x] **Step 1: Wrap root and named lazy imports with the recovery helper and listen for `vite:preloadError`.**
- [x] **Step 2: Bump the cache namespace and use network-first for hashed assets, with cached fallback only when offline.**
- [x] **Step 3: Run `npm run test:web` and `npm run build`; expect PASS.**

### Task 3: Verify Paper activity configuration and deployment facts

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/plans/2026-08-22-online-stability-and-paper-activity.md`

- [x] **Step 1: Record that production targets 6 filled Paper orders with a 10-order daily hard cap and one order per run.**
- [x] **Step 2: Record the online certificate facts: the current certificate is self-signed for the IP only, so the domain is rejected before JavaScript runs; replacing it with a trusted certificate containing both domain names is required.**
- [x] **Step 3: Run the server/web Vitest suites, TypeScript build, Vite production build, and `git diff --check`.** Python bridge tests were not runnable in this workspace because the bundled Python runtime has no `pytest` module.

### Task 4: Commit and publish the verified release

**Files:**
- No credentials or populated environment files.

- [x] **Step 1: Commit the code and documentation changes.** Commit `0d3f4b9` contains the code and initial documentation; the follow-up release note is recorded after deployment.
- [x] **Step 2: Push the verified commit to the production workflow branch `codex/real-market-regime`; the restricted GitHub Action is the only supported remote deployment path.** The published release is merge commit `d01be84`.
- [x] **Step 3: Recheck public health, HTML timestamp, and asset responses.** GitHub Actions run `32512350838` succeeded; public health and current static assets returned 200.

---

**Safety boundary:** This remains a local PaperBroker workflow. The 10-order daily hard cap, one-order-per-run pacing, fees, cash reserve, lot size, T+1, circuit breaker, idempotency, and manual review boundaries remain in force. No claim is made about profitability or guaranteed daily fills.

## Implementation status

- Tasks 1-4 completed. Server/web tests, TypeScript, Vite build, diff hygiene, GitHub Actions deployment, public health, and static resource checks passed. Python bridge tests remain unrun because `pytest` is unavailable in the current runtime. The domain certificate replacement remains an operator-side task.
