# Stock Trend Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user enter an A-share name or six-digit code and receive a real-data, time-safe 3/5/10 trading-day trend outlook with historical validation, evidence, and risks.

**Architecture:** The AkShare bridge searches its bounded in-memory all-A-share quote cache and continues to provide forward-adjusted daily history. A focused Fastify research module resolves the query, computes deterministic technical features and walk-forward outcomes without future leakage, and returns an explicitly non-calibrated research report. React renders a search-first tool with a real history chart, horizon outlooks, validation, and source boundaries; it never creates an order.

**Tech Stack:** Python, FastAPI, Pydantic, AkShare, TypeScript, Fastify, Zod, React, TanStack Query, Recharts, Lucide, Pytest, Vitest.

---

### Task 1: Add bounded A-share name/code search to the bridge

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `akshare-bridge/README.md`

- [x] Add `StockSearchItem` and `StockSearchResponse` models containing only symbol, name, latest quote metadata, source, and fetch time.
- [x] Add a pure ranking helper where exact code ranks before exact name, then code/name prefixes, then contained names; cap results at 20.
- [x] Add `QuoteCache.search(query, limit)` using the existing stale-while-refresh cache without persisting the all-stock table.
- [x] Add protected `GET /api/market/stock-search?query=贵州茅台&limit=8`, reject blank/overlong queries, and return an empty real response instead of fabricated matches.
- [x] Add tests for exact code, exact Chinese name, fuzzy ambiguity, result bounds, and bearer-token protection.
- [x] Run `D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q`.

Bridge contract:

```py
class StockSearchItem(BaseModel):
    symbol: str
    name: str
    price: float
    changePercent: float
    updatedAt: str

class StockSearchResponse(BaseModel):
    provider: str
    source: str
    fetchedAt: str
    items: list[StockSearchItem]
    warning: str | None = None
```

### Task 2: Implement deterministic single-stock trend research

**Files:**
- Create: `server/research/stockTrendForecast.ts`
- Create: `server/research/stockTrendForecast.test.ts`

- [x] Define report types for resolution status, selected stock, chart series, factors, 3/5/10-day outlooks, validation, warnings, methodology, and guardrails.
- [x] Write failing synthetic-bar tests for constructive, cautious, sideways, insufficient-data, ambiguous-name, and unavailable-source outcomes.
- [x] Compute only trailing features at each decision index: 5/20/60-day returns, MA20/MA60 distances and 5-day slopes, RSI14, 20-day annualized volatility, ATR14 percent, 5-versus-20-day volume ratio, and 20-day drawdown.
- [x] Map a deterministic 0-100 rule score to `bullish`, `slightly-bullish`, `sideways`, `slightly-bearish`, or `bearish`; expose score as signal strength, never as a probability.
- [x] Walk forward from at least 65 prior bars and compare only later 3/5/10-day closes. Validate historical occurrences of the same direction and return sample count, hit rate, average/best/worst forward return, and last outcome date.
- [x] Return 90 chart points with close, MA20, and MA60 plus current 20-day support/resistance and a volatility reference band.
- [x] Resolve exact code/name automatically, return up to eight choices for fuzzy ambiguity, fetch one stock's 360-day forward-adjusted history, and return degraded/mock-disabled reports without static fallback data.
- [x] Run `npx vitest run server/research/stockTrendForecast.test.ts --environment node`.

Direction thresholds:

```ts
score >= 65 // bullish
score >= 56 // slightly-bullish
score <= 35 // bearish
score <= 44 // slightly-bearish
// otherwise sideways
```

### Task 3: Expose an authenticated Fastify endpoint

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] Add Zod query validation for trimmed `query` length `1..40` and `days` bounded to `120..500` with default `360`.
- [x] Add authenticated `GET /api/research/stock-trend?query=600519&days=360` and document that it is read-only, time-safe research.
- [x] Add the route to OpenAPI and protected-route tests.
- [x] Add a mock-mode test proving the endpoint returns `mock-disabled` with no fake selected stock, chart, or outlook.
- [x] Run focused app and stock-trend tests.

### Task 4: Build the market-page trend tool

**Files:**
- Create: `src/components/StockTrendForecastPanel.tsx`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/MarketPage.tsx`
- Modify: `src/styles/index.css`

- [x] Add client types matching the Fastify report and `fetchStockTrendForecast(query, days=360)` with `URLSearchParams` encoding and bounded days.
- [x] Add a failing client test for Chinese-name encoding, bounded days, protected cookies, and no credential material in the URL.
- [x] Build a search form using a search icon, accessible label, submit command, loading/error/not-found states, and clickable choices for ambiguous names.
- [x] Render the selected quote and source, a real 90-bar Close/MA20/MA60 Recharts plot, 3/5/10-day outlook items, signal factors, historical validation, evidence, and risk flags.
- [x] Put the tool directly after the main index overview on `/market`; keep the separate `MarketPage` composition aligned.
- [x] Keep page-level width stable at 390px; constrain chart and wide validation content inside the module.
- [x] Run the frontend client tests and `npm run build`.

### Task 5: Document and verify the full feature

**Files:**
- Modify: `docs/product/overview.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`
- Modify: `docs/plans/2026-07-16-stock-trend-forecast.md`

- [x] Document source, qfq adjustment, 360-day default/500-day cap, cache behavior, 3/5/10 horizons, score meaning, walk-forward boundary, and no-order boundary.
- [x] Run bridge tests, `npm test`, `npm run build`, `git diff --check`, and the credential scan excluding ignored `.env.local`.
- [x] Restart only changed bridge/API child processes and confirm `paper + akshare`, authentication enabled, and `realTradingEnabled=false`.
- [x] Query by exact code, exact Chinese name, ambiguous partial name, and unknown input against the real endpoint without inventing results.
- [x] Inspect the authenticated market page at desktop and 390 x 844, including chart pixels, search states, overflow, and console errors.
- [x] Record actual source, bar count, latest date, outlooks, and validation counts in `docs/status/current-state.md`.

### Task 6: Add empirical direction probabilities and turning-time estimates

**Files:**
- Modify: `server/research/stockTrendForecast.ts`
- Modify: `server/research/stockTrendForecast.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/components/StockTrendForecastPanel.tsx`
- Modify: `src/styles/index.css`
- Modify: `docs/product/overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`

- [x] For every historical same-direction sample, classify the horizon outcome as up, down, or flat using a bounded noise threshold derived from ATR; ensure the three empirical frequencies sum to one.
- [x] Record the highest and lowest subsequent close inside each horizon, then return median peak/trough trading-day offsets and median peak/trough returns.
- [x] Keep insufficient or zero-sample values nullable instead of fabricating 50% probabilities or timing.
- [x] Add deterministic rising, falling, flat, and insufficient-data tests for frequencies, timing bounds, and median returns.
- [x] Show “经验上涨概率 / 经验下跌概率 / 震荡概率” plus “阶段高点/低点约第 N 个交易日” in each horizon item.
- [x] Label these values as conditional historical frequencies and median timing, not calibrated future probabilities or guaranteed calendar dates.
- [x] Run focused tests, full tests, production build, responsive browser checks, `git diff --check`, and the credential scan.

## Validation Record

- Completed on 2026-07-16 with `paper + akshare`, authentication enabled, and `realTradingEnabled=false`.
- `D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q`: 56 passed with one dependency deprecation warning.
- `npm test`: 36 server files / 647 tests and 4 web files / 18 tests passed.
- `npm run build`: TypeScript checks and Vite production build passed.
- `git diff --check`: passed with Windows line-ending conversion warnings only; the credential scan excluding `.env.local` passed.
- Real `600519`/`贵州茅台`: 360 qfq bars from `tencent-stock-history`, latest date 2026-07-16. Outlooks were 3-day slightly bullish 64/100, 5-day slightly bullish 60/100, and 10-day sideways 55/100; historical hit rates were 36.4%, 40.5%, and 65.3% with 44, 42, and 124 same-direction samples.
- Partial name `酒` returned eight choices and did not auto-select; an unknown name returned not-found without static fallback data.
- Desktop and 390 x 844 checks showed three non-empty chart paths, no page-level horizontal overflow, bounded horizon items, and no console errors after authenticated reload.
- Task 6 verification kept all earlier test totals green; the final production build and `git diff --check` passed, and an exact scan found no real credentials outside ignored `.env.local` and log files. The authenticated `600519` page rendered 3/5/10-day up/down/flat frequencies of 29.5%/54.5%/15.9%, 30.9%/52.4%/16.7%, and 46.0%/46.8%/7.3%, with median peak/trough trading-day offsets of 2/2, 2/4, and 5/7. The page also displayed the short-term rule-versus-history conflict warning.
