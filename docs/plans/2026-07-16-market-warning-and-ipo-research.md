# Market Warning And IPO Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send an explicit WeChat “市场不宜操作” paper-research warning when the current A-share breadth is broadly weak, and add a real read-only IPO subscription/listing module with transparent, time-safe participation guidance.

**Architecture:** Daily breadth classification remains a pure TypeScript research rule shared by the daily review and `PaperPlanNotifier`; a `risk-off` breadth snapshot changes the phase briefing headline and explicitly blocks new paper risk without creating an external order. The AkShare bridge exposes normalized EastMoney IPO rows, Fastify filters them by China-market date and scores only information available by the subscription date, and React renders open/upcoming, awaiting-listing, and recently-listed tabs.

**Tech Stack:** Python, FastAPI, AkShare `stock_xgsglb_em`, Pydantic, TypeScript, Fastify, React, TanStack Query, Lucide, Vitest, Pytest.

---

### Task 1: Add an explicit broad-market WeChat warning

**Files:**
- Modify: `server/research/dailyMarketReview.ts`
- Modify: `server/research/dailyMarketReview.test.ts`
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `server/notifications/paperPlanNotifier.ts`
- Modify: `server/notifications/paperPlanNotifier.test.ts`

- [x] Export a pure `assessMarketSnapshot` helper that returns tradable-stock breadth, tone, and summary; keep `risk-off` at average change `<= -0.8%` and advance/decline ratio `<= 0.67` with at least ten tradable quotes.
- [x] Refactor `buildDailyMarketReview` to consume the helper without changing existing review output.
- [x] Pass `tone` and breadth `summary` from the current snapshot into `PaperPlanNotificationContext`.
- [x] Add a failing notifier test where the plan has no executable action but breadth is `risk-off`; assert the summary and content contain `市场不宜操作` and `暂停新增 paper 仓位`.
- [x] Include market tone in material signatures and audit metadata so a transition to broad weakness can bypass same-phase cooldown.
- [x] Keep all messages explicitly local-paper research and preserve the eight-attempt daily budget.
- [x] Run `npx vitest run server/research/dailyMarketReview.test.ts server/notifications/paperPlanNotifier.test.ts --environment node`.

The warning rule must produce this meaning:

```ts
const avoidNewRisk =
  context.marketContext.tone === "risk-off" ||
  (plan.adaptiveRouting?.regime === "risk-off" &&
    plan.adaptiveRouting.allowNewPositions === false);
```

### Task 2: Expose normalized real IPO data from AkShare

**Files:**
- Modify: `akshare-bridge/main.py`
- Modify: `akshare-bridge/test_bridge.py`
- Modify: `akshare-bridge/README.md`

- [x] Add failing normalization tests for symbol/name, subscription code, exchange, board, issue price, issue/industry PE, market-value requirement, max shares, subscription date, listing date, winning rate, and first-day change.
- [x] Add a failing endpoint test proving upstream failure returns HTTP 200 with `source="unavailable"`, an empty list, and a warning; add the existing bearer-token protection test.
- [x] Add `IpoSubscriptionItem` and `IpoSubscriptionsResponse` Pydantic models with nullable fields instead of numeric zero placeholders.
- [x] Implement `fetch_ipo_subscriptions_dataframe()` with `ak.stock_xgsglb_em(symbol="全部股票")` and source `eastmoney-ipo-subscription`.
- [x] Normalize dates to `YYYY-MM-DD`, preserve `fetchedAt`, cap the endpoint at 200 rows, cache non-empty responses for the bounded research TTL, and never persist raw IPO tables to disk.
- [x] Add `GET /api/research/ipo-subscriptions?limit=80`.
- [x] Run `D:\conda\python.exe -m pytest akshare-bridge/test_bridge.py -q`.

The bridge contract is:

```py
class IpoSubscriptionItem(BaseModel):
    symbol: str
    name: str
    subscriptionCode: str
    exchange: str
    board: str
    issueTotalWanShares: float | None = None
    onlineIssueShares: int | None = None
    marketValueRequirementWan: float | None = None
    maxSubscriptionShares: int | None = None
    issuePrice: float | None = None
    latestPrice: float | None = None
    subscriptionDate: str | None = None
    ballotDate: str | None = None
    paymentDate: str | None = None
    listingDate: str | None = None
    issuePe: float | None = None
    industryPe: float | None = None
    winningRate: float | None = None
    firstDayChangePercent: float | None = None
```

### Task 3: Build time-safe IPO participation research

**Files:**
- Create: `server/research/ipoSubscriptionResearch.ts`
- Create: `server/research/ipoSubscriptionResearch.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] Add failing tests for `open-today`, `upcoming`, `awaiting-listing`, and `listed-recently` statuses using an injected China-time clock.
- [x] Add failing tests that a discounted issue PE can score `consider`, issue PE over twice industry PE scores `avoid`, missing issue price/PE scores `wait-for-pricing`, and closed subscriptions score `closed`.
- [x] Fetch the bridge with timeout and bearer token, retain source/warning metadata, and return explicit `mock-disabled`/`degraded` reports instead of static fallback data.
- [x] Filter to subscriptions up to 30 days ahead and listings/subscriptions up to 30 days behind; sort open today first, then upcoming, awaiting listing, and recent listings.
- [x] Score only issue-time fields: base 50; PE ratio `<=0.8 +20`, `<=1.0 +10`, `1.0-1.25 -5`, `1.25-2.0 -20`, `>2.0 -35`; issue price `<=20 +5`, `>50 -8`, `>100 -15`; clamp to 0-100.
- [x] Add board-specific permission/rule risks without treating them as return predictors.
- [x] Add authenticated `GET /api/research/ipo-subscriptions?limit=40`; the route remains read-only and cannot submit subscriptions.
- [x] Run focused IPO research and app tests.

Recommendation labels:

```ts
type IpoRecommendation =
  | "consider"
  | "cautious"
  | "avoid"
  | "wait-for-pricing"
  | "closed";
```

`consider` means “估值规则下可关注申购”, not guaranteed profit or personalized investment advice.

### Task 4: Add the IPO module to the market page

**Files:**
- Create: `src/components/IpoSubscriptionPanel.tsx`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/lib/tradingApi.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/MarketPage.tsx`
- Modify: `src/styles/index.css`

- [x] Add client types matching the Fastify report and a bounded `fetchIpoSubscriptionResearch(limit=40)` function.
- [x] Add a failing API client test proving limits are clamped to `1..80` and credentials use the protected request path.
- [x] Build a panel with segmented tabs for `可申购`, `待上市`, and `近期上市`, a refresh icon, source timestamp, loading/error/degraded states, and a horizontally contained table.
- [x] Display subscription/listing dates, issue price, issue PE versus industry PE, top-subscription market value, recommendation, first reason, and first risk; never show a recommendation as a calibrated probability.
- [x] Lazy-load the panel on `/market` after market-regime research and before news; keep the unused page component aligned for future route extraction.
- [x] Add stable responsive dimensions and verify no mobile text overlap or page-level horizontal overflow.
- [x] Run `npx vitest run src/lib/tradingApi.test.ts --environment jsdom` and `npm run build`.

### Task 5: Document and verify the full chain

**Files:**
- Modify: `docs/product/overview.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/status/current-state.md`
- Modify: `docs/plans/2026-07-16-market-warning-and-ipo-research.md`

- [x] Document real source, cache/window limits, field units, recommendation meaning, board eligibility warning, and no-subscription/no-broker boundary.
- [x] Run Python bridge tests, `npm test`, `npm run build`, `git diff --check`, and the credential scan excluding ignored `.env.local`.
- [x] Restart the AkShare bridge and API children, verify health and authenticated IPO endpoint, and confirm `REAL_TRADING_ENABLED=false`.
- [x] Inspect `/market` at desktop and mobile widths; verify tabs, table overflow, source labels, and no console errors.
- [x] Trigger no live notification during verification; rely on deterministic notifier tests so the user’s daily WxPusher allowance is not consumed.
- [x] Record actual current IPO rows and identify any upstream warning or missing pricing without inventing values.

## Validation Record

- Completed on 2026-07-16 in local `paper + akshare` mode with authentication enabled and `realTradingEnabled=false`.
- `D:\conda\python.exe -m pytest akshare-bridge\test_bridge.py -q`: 50 passed, with one upstream dependency deprecation warning.
- `npm test`: 35 server files / 638 tests and 4 web files / 17 tests passed.
- `npm run build`: TypeScript and Vite production build passed.
- `git diff --check`: passed with Windows line-ending conversion warnings only; the credential scan excluding `.env.local` passed.
- Runtime source `eastmoney-ipo-subscription`: 1 open today, 4 upcoming, 4 awaiting listing, and 11 recently listed. Missing issue price/PE fields remained null and displayed as waiting for pricing.
- Board eligibility correction verified after restarting the API child: `301677` reports ChiNext permission risk; `603468` and `001232` do not report STAR Market risk.
- Desktop and 390 x 844 mobile checks passed with three working tabs, no page-level horizontal overflow, internal table scrolling, and no console errors.
- Verification did not send a live WxPusher notification or consume the daily notification allowance.
