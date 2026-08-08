# Adaptive Strategy And Research Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore actionable paper research when real data is usable, route candidates across several regime-appropriate strategies, and reduce repeated online research requests without weakening A-share risk controls.

**Architecture:** Keep market-data reads and local paper execution separate. Treat partial historical coverage as usable only when minimum sector and stock coverage exists; retain warnings in the report and block only when the evidence is insufficient. Add a bounded promise cache at the bridge-request boundary so UI requests and the auto executor share short-lived read-only results.

**Tech Stack:** Fastify, TypeScript, React, TanStack Query, Vitest, AkShare bridge, JSON paper store.

---

### Task 1: Lock down the observed failure modes

**Files:**
- Create: `server/research/bridgeRequest.test.ts` additions for cache hit, expiry, and rejected-request eviction.
- Create: `server/research/adaptiveCandidateStrategy.test.ts` for regime-specific strategy selection.
- Modify: `server/research/marketRegimeResearch.test.ts` for usable partial coverage.
- Modify: `server/research/paperTradingPlan.adaptive.test.ts` for non-empty strategy routing.

- [x] Add tests that two identical cached bridge reads invoke `fetch` once, an expired entry invokes it again, and a rejected request is not retained.
- [x] Add tests that healthy historical trend selects a trend strategy, a validated washout selects a pullback/recovery strategy, and risk-off selects no buy strategy.
- [x] Add a market-regime test where valid sector and stock series coexist with a non-fatal warning and the report remains usable.
- [x] Add a paper-plan test asserting a buy operation records a routed strategy key/name and real-history evidence.

### Task 2: Make data quality gates proportional

**Files:**
- Modify: `server/research/marketRegimeResearch.ts` source-status calculation.
- Modify: `server/research/adaptiveStrategyRouter.ts` warning gate and routing version.

- [x] Classify the report as `live-read-only` when at least two sector outlooks and one stock regime have the required 61-bar history, even if a secondary flow or partial-series warning remains.
- [x] Keep `degraded` for empty or insufficient sector/stock history and retain every warning in the report.
- [x] Let the router use a usable report while appending warnings to `riskFlags`; continue to return `unclear` and forbid new positions when coverage is insufficient.
- [x] Preserve risk-off and risk-off-recovery as no-new-position states and update the routing version to `1.4.0`.

### Task 3: Route paper candidates across multiple strategies

**Files:**
- Create: `server/research/adaptiveCandidateStrategy.ts`.
- Create: `server/research/adaptiveCandidateStrategy.test.ts`.
- Modify: `server/research/paperTradingPlan.ts` candidate-pool construction and operation reasons.
- Modify: `server/research/paperTradingPlan.adaptive.test.ts`.
- Modify: `src/lib/tradingApi.ts` routing version type.

- [x] Implement pure strategy matching from the latest quote plus the real historical stock regime: low-volatility trend, trend health, momentum, quiet pullback, and washout recovery.
- [x] Require the selected key to be present in `adaptiveRouting.eligibleStrategyKeys`; do not generate a buy candidate in risk-off or unclear states.
- [x] Sort eligible routed candidates before unmatched observations and retain the existing cash, lot-size, T+1, fee, history-persistence, position and risk checks.
- [x] Record the routed strategy name and evidence in every executable paper operation so daily review and notifications explain the decision.

### Task 4: Bound online research load

**Files:**
- Modify: `server/research/bridgeRequest.ts` with a max-64-entry promise cache.
- Modify: `server/research/marketRegimeResearch.ts` to cache sector snapshot briefly and history reads for five minutes.
- Modify: `server/research/realResearchData.ts` to keep the existing news-only request small and cache news/global reads.
- Modify: `server/research/externalMarketImpact.ts` history reads with a ten-minute TTL.
- Modify: `src/lib/researchQueries.ts` and `src/components/NewsPanel.tsx` existing light-query behavior.

- [x] Deduplicate identical in-flight bridge reads, expire them on TTL, and delete failed reads so stale errors cannot poison later refreshes.
- [x] Use read-only cache keys based on URL and token scope, with bounded eviction; never cache orders or account state.
- [x] Keep current quote/bootstrap refreshes fresh while heavy history and news research reuses short-lived results.
- [x] Verify the news-only endpoint skips global markets and retains previous data while refreshing.

### Task 5: Document and verify

**Files:**
- Modify: `docs/status/current-state.md`.
- Modify: `docs/architecture/system-overview.md`.
- Modify: `docs/operations/development.md` if cache/test commands or runtime behavior changed.

- [x] Document that strategy routing is regime-dependent and that warnings remain visible when partial data is usable.
- [x] Document the bounded research cache and its non-applicability to account/order data.
- [x] Run `npm test`, `npm run build`, and `git diff --check`.
- [x] Record the verification date and any remaining live-service dependency in the current-state document.

## Completion Record

- Completed: 2026-08-08.
- Server Vitest: 54 files and 816 tests passed.
- Web Vitest: 29 files and 97 tests passed.
- TypeScript project references, Vite production build, and `git diff --check` passed.
- Verification used the workspace-bundled Node runtime because `npm` was not available on this shell path.
- Live dependency remaining: this run did not restart ports 4173/8787/8800; the authenticated `paper + akshare` three-service check must separately confirm source freshness and coverage. Public upstream failures remain explicit, and no static substitute is used.
