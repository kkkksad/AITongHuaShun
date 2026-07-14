# Real Sector Outlook And Regime Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static sector-flow panel with traceable AkShare sector and historical-bar research, add deterministic 3/5-day sector outlooks and washout-versus-trend-deterioration classification, and broaden defensive strategy tests without enabling real trading.

**Architecture:** The Python bridge remains a read-only external-data boundary and normalizes AkShare data into bounded JSON contracts. Fastify fetches those contracts, computes time-safe research scores and walk-forward diagnostics, and exposes one authenticated research endpoint. React renders source state, evidence, uncertainty, and historical validation; no prediction output bypasses `PaperBroker` or existing risk checks.

**Tech Stack:** FastAPI, AkShare, Pydantic, Fastify, TypeScript, React, TanStack Query, Vitest, pytest.

**Status:** Completed and verified on 2026-07-14.

---

### Task 1: Audit and plan the static-to-real migration

**Files:**
- Create: `docs/plans/2026-07-14-real-sector-outlook-and-regime-analysis.md`
- Modify: `docs/status/current-state.md`

- [x] **Step 1: Record current static surfaces**

Record that `FlowPanel`, browser backtests, strategy leaderboard history, DCA/grid examples, and notification examples are static or synthetic, while AkShare quotes, indices, news, and global indices are real read-only inputs when the provider is enabled.

- [x] **Step 2: Define the first migration boundary**

Limit this iteration to sector snapshots, sector daily bars, bounded stock daily bars, outlook scoring, regime classification, two research strategies, and the market-page UI. Do not claim fundamentals, Level-2 flow, or licensed broker data.

- [x] **Step 3: Verify the worktree baseline**

Run: `git status --short`

Expected: no unrelated changes before implementation.

### Task 2: Add bounded real sector and historical data contracts

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `akshare-bridge/README.md`

- [x] **Step 1: Write failing normalization and endpoint tests**

Cover industry snapshot columns, fund-flow merge, daily-bar date/OHLCV normalization, maximum symbol count, allowed day range, source failure degradation, and server-token enforcement.

- [x] **Step 2: Run the focused Python tests and confirm failure**

Run: `python -m pytest akshare-bridge/test_bridge.py -q`

Expected: new tests fail because sector and history contracts do not exist.

- [x] **Step 3: Implement read-only bridge models and endpoints**

Add these contracts:

```text
GET /api/market/sectors?limit=20
GET /api/market/sector-history?sectors=半导体,银行&days=180
GET /api/market/stock-history?symbols=600519,000001&days=180
```

Each payload must include provider, source, fetched time, warnings, and normalized rows. Limit sectors to 20, stocks to 12, and history to 60-500 trading days. Use unadjusted sector bars and explicitly identified `qfq` stock bars.

- [x] **Step 4: Run Python tests**

Run: `python -m pytest akshare-bridge/test_bridge.py -q`

Expected: all bridge tests pass.

### Task 3: Build time-safe outlook and regime research

**Files:**
- Create: `server/research/marketRegimeResearch.ts`
- Create: `server/research/marketRegimeResearch.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] **Step 1: Write failing deterministic research tests**

Use fixed historical bars to verify:

```text
contracting volume + controlled pullback + rising MA60 -> washout-candidate
high-volume break below falling MA20 and MA60 -> trend-deterioration
positive 20/60-day momentum + controlled volatility -> constructive sector outlook
walk-forward diagnostics only compare score at t with returns after t
insufficient or degraded history -> insufficient-data, never fabricated confidence
```

- [x] **Step 2: Run focused server tests and confirm failure**

Run: `npm run test:server -- server/research/marketRegimeResearch.test.ts server/app.test.ts`

Expected: tests fail because the research builder and route do not exist.

- [x] **Step 3: Implement the research engine**

Create `buildMarketRegimeResearch()` with deterministic indicators: 5/20/60-day returns, MA20/MA60 slope, 20-day volatility, pullback depth, volume contraction/expansion, current breadth, main net inflow when supplied, and 3/5-day forward walk-forward validation. Return probabilities as bounded research scores, not calibrated certainties.

- [x] **Step 4: Add the authenticated Fastify route**

Add:

```text
GET /api/research/market-regime?sectorLimit=10&stockLimit=8&days=180
```

Build the stock universe from current quality candidates, call only the read-only bridge, preserve warnings, and return HTTP 200 with `degraded` state when upstream history is unavailable.

- [x] **Step 5: Run focused server tests**

Run: `npm run test:server -- server/research/marketRegimeResearch.test.ts server/app.test.ts`

Expected: all focused tests pass.

### Task 4: Add two defensive research strategies

**Files:**
- Create: `server/backtest/strategies/KairosRegimeStrategies.ts`
- Modify: `server/backtest/strategies/index.ts`
- Modify: `server/optimizer/index.ts`
- Modify: `server/backtest/strategies.test.ts`
- Modify: `server/optimizer/optimizer.test.ts`

- [x] **Step 1: Write failing strategy tests**

Verify that the washout-recovery strategy requires an intact medium trend, controlled drawdown, contracting sell volume, and rebound confirmation. Verify that the trend-health strategy exits on high-volume MA breakdown and does not immediately re-enter during cooldown.

- [x] **Step 2: Run focused strategy tests and confirm failure**

Run: `npm run test:server -- server/backtest/strategies.test.ts server/optimizer/optimizer.test.ts`

Expected: new strategy names are missing.

- [x] **Step 3: Implement and register the strategies**

Add `KairosWashoutRecoveryStrategy` and `KairosTrendHealthStrategy` using only bars available at `onBar()`. Register bounded parameter factories in `builtInFactories`; do not add them to automatic paper execution until real-history validation is available.

- [x] **Step 4: Run strategy tests**

Run: `npm run test:server -- server/backtest/strategies.test.ts server/optimizer/optimizer.test.ts`

Expected: all focused strategy and optimizer tests pass.

### Task 5: Replace the static sector panel with the real research module

**Files:**
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`
- Create: `src/components/MarketRegimePanel.tsx`
- Modify: `src/components/FlowPanel.tsx`
- Modify: `src/pages/MarketPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/index.css`

- [x] **Step 1: Write failing API-client tests**

Verify that `fetchMarketRegimeResearch()` requests `/api/research/market-regime` with bounded parameters and retains credentials through `apiRequest()`.

- [x] **Step 2: Implement API types and query helper**

Model source status, sector outlook, 3/5-day diagnostics, stock regime, evidence, risks, bar count, and timestamps. Do not accept a response that omits source-state fields.

- [x] **Step 3: Build the market research panel**

Render compact tabs for sector outlook and stock regime. Show source, latest bar date, sample count, historical hit rate, expected direction, washout/trend labels, evidence, and degradation warnings. Use icon buttons for refresh and tab controls for views.

- [x] **Step 4: Remove static sector data from active pages**

Make `FlowPanel` consume the real endpoint or replace it with `MarketRegimePanel` in both overview and market routes. When unavailable, show a truthful empty/degraded state rather than `mockData.sectorFlows`.

- [x] **Step 5: Run frontend tests and build**

Run: `npm run test:web`

Expected: all frontend tests pass.

Run: `npm run build`

Expected: TypeScript and Vite production build pass.

### Task 6: Verify, document, and retain truthful boundaries

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/product/overview.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/roadmap.md`
- Modify: `akshare-bridge/README.md`

- [x] **Step 1: Run the complete test suite**

Run: `npm test`

Expected: all server and web tests pass.

- [x] **Step 2: Run the production build**

Run: `npm run build`

Expected: build passes without type errors.

- [x] **Step 3: Verify the live local chain**

Restart the bridge and API, log in, then request `/api/research/market-regime`. Confirm `provider=akshare`, real source timestamps, non-empty historical samples when upstream is available, and an explicit degraded warning otherwise.

- [x] **Step 4: Update authoritative documentation**

Document exact real/static boundaries, endpoint limits, adjustment semantics, scoring inputs, walk-forward limitations, storage behavior, and the fact that all execution remains local paper-only.

- [x] **Step 5: Final worktree check**

Run: `git diff --check`

Expected: no whitespace errors.
