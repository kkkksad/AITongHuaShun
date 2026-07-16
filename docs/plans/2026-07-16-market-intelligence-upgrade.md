# Market Intelligence Upgrade Implementation Plan

**Status:** Completed on 2026-07-16. The reports remain research-grade conditional frequencies, not production-calibrated forecasts.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve KAIROS Quant's research accuracy and market-page usability by adding a time-safe A-share turning-point scanner, a separate read-only Hong Kong market workspace, and clearer UI boundaries between overview, stock research, sectors, events, and cross-market data.

**Architecture:** The AkShare bridge remains the only public-market network boundary and exposes bounded A-share/HK daily data without any account capability. Fastify research modules turn historical bars into deterministic, walk-forward validated reports; React groups reports into task-oriented tabs so a user does not need to scan every module at once. A-share paper execution remains unchanged and must never consume HK signals or the new read-only turning scanner directly.

**Tech Stack:** Python, FastAPI, Pydantic, AkShare, TypeScript, Fastify, Zod, React, TanStack Query, Recharts, Lucide, Pytest, Vitest.

---

## Product Direction

### UI

- Replace the single long market page with task tabs: `A 股概览`, `变盘雷达`, `个股研判`, `板块形态`, `港股观察`, and `事件资讯`.
- Keep the index overview visible as the market entry signal, but load expensive research only when its tab is active.
- Use compact source/status strips, sortable research tables, explicit empty/error states, and module-local horizontal scrolling on mobile.
- Keep stock-level explanations next to their probabilities. Do not show score-only cards without sample count, validation boundary, and risk flags.

### Strategy Accuracy

- Define a turning event before scoring it: within five later trading days, the close must leave the decision-time 20-day range by a bounded ATR margin. If both sides break, the first close decides direction.
- Estimate `up / down / no-break` from historical samples with similar compression states using only data available at each historical decision point.
- Return probability values only with at least 20 historical samples. Below that threshold return `null`, rank conservatively, and display `样本不足`.
- Rank with empirical break probability, compression quality, trigger readiness, and sample confidence; never rename a heuristic score as a probability.
- Next accuracy work after this phase: point-in-time universe history, purged walk-forward folds, strategy-by-regime baselines, parameter plateau selection, transaction-cost stress, and shadow promotion/rollback.

### Code And Data

- Keep A-share turning logic in `server/research/turningPointScanner.ts`; do not add more branches to `marketRegimeResearch.ts`.
- Keep HK quote/history normalization in the bridge and HK report composition in `server/research/hongKongMarketResearch.ts`.
- Share the existing historical bar contract and bounded fetch pattern; do not persist unlimited daily data or raw ticks.
- Cache bridge research responses with the existing bounded TTL. Report actual provider, adjustment, fetch time, requested universe, failures, and bar count.
- Add route and client contract tests whenever a report field changes.

### Hong Kong Market Boundary

- Use five-digit HK symbols, EastMoney/AkShare read-only spot quotes, and forward-adjusted daily history.
- HK research is a separate market domain. It does not inherit A-share 100-share lot size, T+1, price-limit, trading-calendar, or fee assumptions.
- This phase provides observation and historical trend context only. It does not create HK orders, holdings, paper balances, or broker credentials.
- Before any future HK paper execution, implement HKEX calendar/session rules, board-lot metadata, T+0 semantics, stamp duty/fees, currency/FX, and an independent account risk budget.

## Delivery Tasks

### Task 1: Document Scope And Contracts

**Files:**
- Create: `docs/plans/2026-07-16-market-intelligence-upgrade.md`
- Modify: `docs/product/future-optimization.md`
- Modify: `docs/roadmap.md`

- [x] Define task-oriented market tabs and keep expensive reports lazy by active tab.
- [x] Define the five-day turning label, minimum sample threshold, and probability wording.
- [x] Define HK as a separate read-only market and list execution prerequisites.
- [x] Link completed implementation and actual validation results from the product blueprint and roadmap.

### Task 2: Build The Turning-Point Research Engine With TDD

**Files:**
- Create: `server/research/turningPointScanner.ts`
- Create: `server/research/turningPointScanner.test.ts`

- [x] Add synthetic tests for a compressed upward break, compressed downward break, two-way uncertainty, no-break history, insufficient bars, and fewer than 20 matching samples.
- [x] Implement trailing MA, ATR, volatility, Bollinger bandwidth, range width, volume ratio, range position, compression score, and trigger score using decision-time bars only.
- [x] Walk forward from a 120-bar lookback and classify the first five-day close outside the frozen 20-day range plus ATR margin as up/down; otherwise classify no-break.
- [x] Match historical compression scores within a bounded bucket, return nullable empirical frequencies, median event day/return, and sample confidence.
- [x] Rank candidates conservatively and include evidence, risk flags, source, adjustment, latest date, and universe scope.
- [x] Run `npx vitest run server/research/turningPointScanner.test.ts --environment node` and expect all focused tests to pass.

Core report contract:

```ts
type TurningBias = "up" | "down" | "two-way" | "none" | "insufficient-data";

interface TurningPointCandidate {
  symbol: string;
  name: string;
  bias: TurningBias;
  readinessScore: number;
  compressionScore: number;
  samples: number;
  breakProbability: number | null;
  upProbability: number | null;
  downProbability: number | null;
  noBreakProbability: number | null;
  medianEventTradingDay: number | null;
  medianEventReturn: number | null;
}
```

### Task 3: Expose The Turning Scanner Through Fastify

**Files:**
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`

- [x] Add authenticated `GET /api/research/turning-points?limit=12&days=360` with Zod bounds `1..12` and `180..500`.
- [x] Build the bounded universe from current tradable A-share quotes, prioritizing liquidity and de-duplicating symbols.
- [x] Fetch one bounded stock-history batch and return `mock-disabled` instead of static candidates when AkShare is unavailable.
- [x] Add route, authentication, query-bound, mock-disabled, and client encoding tests.
- [x] Run focused API/client tests and expect protected access plus deterministic report fields.

### Task 4: Add Real Read-Only Hong Kong Market Data

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `akshare-bridge/README.md`
- Create: `server/research/hongKongMarketResearch.ts`
- Create: `server/research/hongKongMarketResearch.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`

- [x] Add normalized HK spot response models and `GET /api/market/hk/quotes?limit=20` using Sina first and `stock_hk_spot_em` as fallback.
- [x] Add bounded `GET /api/market/hk/history?symbols=00700,09988&days=180` using `stock_hk_hist(..., adjust="qfq")` with Sina daily fallback and the existing history response contract.
- [x] Add bridge tests for five-digit validation, limits, provider failures, normalized amounts, cached responses, and provider fallback order.
- [x] Add authenticated Fastify `GET /api/research/hong-kong-market?limit=12&days=180` that combines liquid spot names with their real daily histories.
- [x] Report 5/20/60-day return, MA20/MA60 structure, volatility, drawdown, volume ratio, trend label, and source boundaries without producing an order action.
- [x] Add server/client tests and run the Python bridge suite plus focused Vitest tests.

### Task 5: Recompose The Market UI

**Files:**
- Create: `src/components/MarketResearchWorkspace.tsx`
- Create: `src/components/TurningPointPanel.tsx`
- Create: `src/components/HongKongMarketPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/MarketPage.tsx`
- Modify: `src/styles/index.css`

- [x] Add an accessible tablist with the six product tabs and stable compact controls.
- [x] Render `TurningPointPanel` as a sortable table with readiness, conditional break/up/down/no-break probabilities, sample count, event timing, and primary evidence/risk.
- [x] Render `HongKongMarketPanel` with quote, trend, 5/20/60-day return, volatility, drawdown, source, and explicit read-only boundary.
- [x] Move existing stock, sector, IPO, and news modules into their task tabs and avoid nested cards.
- [x] Keep the page at 390px without page-level overflow; wide research tables may scroll only inside their module.
- [x] Verify keyboard tab selection, loading/error/empty states, desktop layout, mobile layout, and no console errors.

### Task 6: Validate And Record The Release

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/product/overview.md`
- Modify: `docs/product/future-optimization.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/plans/2026-07-16-market-intelligence-upgrade.md`

- [x] Run `D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q`.
- [x] Run focused server/web tests, then `npm test` and `npm run build`.
- [x] Run `git diff --check` and scan real credentials excluding `.env.local`, logs, generated output, and test placeholders.
- [x] Restart only changed bridge/API processes and query real turning/HK endpoints without inventing fallback data.
- [x] Inspect authenticated desktop and 390 x 844 market tabs, including overflow, visible source labels, table dimensions, and console errors.
- [x] Record actual source, latest date, candidate counts, samples, degraded warnings, test totals, and build result below.

## Validation Record

Completed on 2026-07-16:

- Python bridge: `66 passed`, with one dependency deprecation warning.
- Focused research suites: `14 passed` across the turning-point and Hong Kong research modules.
- Full Vitest: `38` server files / `665` server tests and `4` web files / `20` web tests passed.
- Production build: TypeScript checks and Vite build passed; `2,299` modules transformed.
- Diff and credential checks: `git diff --check` passed with line-ending conversion warnings only. The scan excluding `.env.local`, logs, data, generated output, and test placeholders found no configured SPT, UID, or login password in source or documentation.
- Runtime services: Vite `4173`, Fastify `8787`, and AkShare bridge `8800` were listening during validation. Authentication, paper mode, real read-only AkShare data, and the realtime channel were all visible in the app.
- Real A-share turning scan: `tencent-stock-history`, qfq, 12 requested and 12 analyzed, 360 bars per displayed candidate, no degraded warning. No candidate met the high-probability break threshold. 寒武纪 had 33 matching samples with 42.4% break / 12.1% up / 30.3% down; 中芯国际 had 61 samples and 29.5% break; 新易盛 had 72 samples and 26.4% break. The UI correctly showed `暂未变盘` or `样本不足` rather than forcing a pick.
- Real Hong Kong scan: `sina-hk-spot + sina-hk-history`, 10 quotes and 10 histories, 180 requested days, no degraded warning. 泡泡玛特 was the only current row with at least 20 same-trend samples: 32 samples and a 46.9% future-five-day up frequency. Other rows kept the probability nullable.
- UI: authenticated 1280px desktop and 390 x 844 mobile states were inspected. At 390px the document had no page-level horizontal overflow, six tabs formed two 175px columns, and the 1,180px turning table scrolled inside its 324px wrapper. Arrow keys changed both focus and selection, the panel `aria-labelledby` followed the active tab, and browser logs contained no error or warning.

The remaining accuracy work is deliberately not marked complete: point-in-time universe history, purged/embargoed folds, confidence intervals, probability calibration, regime-specific baselines, and transaction-cost stress are the next research phase. Until those checks pass, the displayed frequencies are research evidence rather than production-calibrated forecasts.
