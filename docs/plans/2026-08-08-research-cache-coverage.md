# Research Cache Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the bounded read-only bridge cache to every repeated secondary research request so page refreshes do not create avoidable upstream timeouts.

**Architecture:** Keep live quote/bootstrap requests uncached or on very short TTLs. Add explicit TTLs at each research module's `fetchBridgeJson` call site: snapshots use seconds or a few minutes, historical series use 10-15 minutes, and IPO metadata uses 30 minutes. The existing bridge cache remains the only shared cache boundary, keyed by URL, credential scope, and fetch implementation; it never receives account, order, audit, or write requests.

**Tech Stack:** Fastify, TypeScript, Vitest, AkShare bridge, bounded in-memory Promise cache.

---

### Task 1: Lock down TTL coverage at module boundaries

**Files:**
- Modify: `server/research/crossMarketStrategyContext.ts`
- Modify: `server/research/cryptoMarketResearch.ts`
- Modify: `server/research/hongKongMarketResearch.ts`
- Modify: `server/research/stockTrendForecast.ts`
- Modify: `server/research/strategyRobustness.ts`
- Modify: `server/research/turningPointScanner.ts`
- Modify: `server/research/ipoSubscriptionResearch.ts`
- Tests: corresponding existing module test files where request shape is asserted

- [x] Use `cacheTtlMs: 60_000` for cross-market and Hong Kong/current crypto snapshots, `10 * 60_000` for historical series, and `30 * 60_000` for IPO metadata.
- [x] Use `10 * 60_000` for stock trend, turning-point and strategy robustness historical reads; keep stock-name search at `60_000`.
- [x] Leave external feature capture and current A-share quote polling uncached where the request represents a point-in-time capture or live snapshot.
- [x] Add or update tests that assert repeated same-key research calls reuse one bridge request while different days/symbol sets remain separate.

### Task 2: Verify no write-path cache regression

**Files:**
- Modify: `server/research/bridgeRequest.test.ts` only if a missing guard is exposed
- Modify: `docs/operations/development.md`
- Modify: `docs/architecture/system-overview.md`

- [x] Confirm all new cache use stays on `fetchBridgeJson` read paths and no account/order/audit call imports it for mutations.
- [x] Document the TTL classes and that cache entries are bounded in memory, evict failures immediately, and never write raw histories to `data/`.

### Task 3: Verify and record

- [x] Run the focused research tests.
- [x] Run all server and web tests.
- [x] Run TypeScript project-reference checks, Vite production build, and `git diff --check`.
- [x] Update `docs/status/current-state.md` with the verification result and any remaining public-source degradation.
- [x] Commit the implementation and documentation in Chinese.

## Review Notes

- This plan deliberately does not cache account state or paper orders.
- This plan deliberately does not relax risk gates or create trades; it only reduces duplicate reads before strategy evaluation.

## Completion Record

- Completed: 2026-08-08.
- Focused research tests: 7 files and 43 tests passed.
- Server Vitest: 54 files and 816 tests passed.
- Web Vitest: 29 files and 97 tests passed.
- TypeScript project references, Vite production build, and `git diff --check` passed.
