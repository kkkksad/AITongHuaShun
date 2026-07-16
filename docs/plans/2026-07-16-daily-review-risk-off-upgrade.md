# Daily Review Risk-Off Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the 2026-07-16 market and local paper evidence to prevent repeated same-day reductions, make the defensive cash target executable, and stop after-hours audit churn.

**Architecture:** `buildPaperTradingPlan` remains the deterministic decision point and receives persisted paper orders so ordinary adaptive reductions can enforce a per-symbol daily limit while hard stops remain unrestricted. In `risk-off`, the plan converts `cashReserveRatio` into a staged exposure target by trimming only unclear or deteriorating positions, one bounded lot per symbol per day, while preserving healthy-trend and washout holdings. `PaperAutoExecutor` keeps startup/manual audit evidence but does not run its timer outside A-share sessions when `tradeWindowOnly` is enabled.

**Tech Stack:** TypeScript, Vitest, Fastify, existing AkShare read-only research, `PaperBroker`, `TradingStore`, local JSON paper state.

---

### Task 1: Enforce daily adaptive reduction discipline

**Files:**
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/research/paperTradingPlanService.ts`
- Modify: `server/research/paperTradingPlan.adaptive.test.ts`

- [x] Add a failing test with a filled `kairos-auto-paper:<date>:<symbol>:paper-sell-plan:<quantity>` order and assert that another ordinary adaptive sell for the same symbol is replaced by a `hold` operation containing `daily-reduction-limit`.
- [x] Add a failing test proving a position below the hard-stop threshold still emits a full available paper sell even when an adaptive sell already occurred that day.
- [x] Extend `buildPaperTradingPlan` input with `orders: OrderRecord[]`, derive the market date from `snapshot.marketTime`, and collect filled automatic sell symbols for that date.
- [x] Gate only ordinary adaptive and exposure-target reductions with the daily symbol set; leave `hardStop` before that gate.
- [x] Pass `system.store.listOrders(10_000)` from `buildCurrentPaperTradingPlan`.
- [x] Run `npx vitest run server/research/paperTradingPlan.adaptive.test.ts --environment node` and expect all focused tests to pass.

The daily filter must use the existing order contract:

```ts
function filledAutoSellSymbols(orders: OrderRecord[], tradingDate: string): Set<string> {
  const prefix = `kairos-auto-paper:${tradingDate}:`;
  return new Set(orders
    .filter((order) =>
      order.status === "filled" &&
      order.side === "sell" &&
      order.clientOrderId?.startsWith(prefix),
    )
    .map((order) => order.symbol));
}
```

### Task 2: Turn risk-off cash reserve into staged exposure reduction

**Files:**
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/research/paperTradingPlan.adaptive.test.ts`

- [x] Add a failing test with `positionPosture="reduce"`, 80% invested capital, and an `unclear` available holding; assert a one-lot `paper-sell-plan` named `风险仓位再平衡` is emitted.
- [x] Add a failing test proving `healthy-trend` and `washout-candidate` positions are not sold only to satisfy the broad exposure target.
- [x] Compute `targetMarketValue = account.equity * (1 - effectiveCashReserveRatio)` and subtract already planned sell notional before deciding whether another reduction is needed.
- [x] Rank eligible positions by regime severity, weaker 20-day return, then larger weight; exclude hard-stop/planned symbols, same-day automatic sell symbols, T+1-locked quantities, healthy trends, and washout candidates.
- [x] Emit at most one bounded lot per eligible symbol in a plan, stopping when projected market value reaches the target; keep executor per-run and daily order caps unchanged.
- [x] Include `risk-off-target`, current exposure, target exposure, and `daily-reduction-limit` rule checks so the decision remains auditable.
- [x] Run the focused adaptive paper-plan tests and expect them to pass.

The staged quantity must remain conservative:

```ts
const quantity = roundLot(
  Math.min(position.availableQuantity, Math.max(lotSize, position.quantity * 0.25)),
  lotSize,
);
```

### Task 3: Make the daily review identify today’s execution defect

**Files:**
- Modify: `server/research/dailyMarketReview.ts`
- Modify: `server/research/dailyMarketReview.test.ts`

- [x] Add a failing review test with two `市场状态减仓` decisions for the same symbol on one date.
- [x] Assert the review reports repeated same-symbol reductions and recommends one ordinary reduction per symbol per day with hard-stop override.
- [x] Change the risk-off high-exposure text to report the actual closing invested percentage and state that the defensive target must be implemented as staged reductions.
- [x] Keep all paper-only and incomplete-history warnings unchanged.
- [x] Run `npx vitest run server/research/dailyMarketReview.test.ts --environment node` and expect all tests to pass.

### Task 4: Stop after-hours audit churn

**Files:**
- Modify: `server/trading/paperAutoExecutor.ts`
- Create: `server/trading/paperAutoExecutor.test.ts`

- [x] Add tests for a pure `shouldRunScheduledPaperAutoExecution` helper: open session returns true; pre-market, lunch, after-hours, and weekend return false when `tradeWindowOnly=true`; all sessions return true when false.
- [x] Use the helper in the interval callback so timer runs are skipped outside trading sessions.
- [x] Preserve the one startup run and all manual runs so an operator can still see why no trade occurred.
- [x] Run the focused executor test and existing intraday policy tests.

### Task 5: Verify and document the upgrade

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/plans/2026-07-16-daily-review-risk-off-upgrade.md`

- [x] Run focused tests for paper planning, daily review, and executor scheduling.
- [x] Run `npm test` and `npm run build`.
- [x] Run `git diff --check` and scan tracked/untracked files for real-length `SPT_` or `UID_` credentials outside ignored `.env.local`.
- [x] Restart only the API child, then verify `/api/health`, authenticated `/api/research/daily-review`, and `/api/research/paper-trading-plan` with `REAL_TRADING_ENABLED=false`.
- [x] Record actual test counts, runtime findings, residual risks, and the distinction between real read-only market data and local paper results.

## Evidence baseline

- Real read-only close snapshot: Shanghai Composite -1.85%, Shenzhen Component -1.97%, ChiNext -2.95%, CSI 300 -1.85%.
- Configured 100-stock observation pool: 35 advancers, 63 decliners, 2 flat, average -0.86%; daily review classified `risk-off`.
- Local paper account: 10,129 equity, 1,931 cash, 8,198 market value, 80.9% invested. This is simulated account state, not real profit.
- Local paper executions: three filled sells, including two ordinary adaptive reductions of `600010` on the same day; total sell notional 1,534 and commission 15.
- Current routing: `risk-off`, 0.77 heuristic confidence, 55% cash reserve, no new positions, but the plan has not yet converted that target into sufficient portfolio-level staged reductions.
- Storage symptom: the one-minute timer persisted more than one thousand after-hours skip audits and grew the JSON state to roughly 2.3 MB in one day.

## Validation record

- Focused tests: 9 adaptive paper-plan tests, 3 daily-review tests, and 13 executor/intraday policy tests passed.
- `npm test`: 34 server files / 631 server tests and 4 web files / 16 web tests passed.
- `npm run build`: TypeScript project checks and Vite production build passed.
- `git diff --check`: passed with Windows line-ending conversion warnings only.
- Credential scan: no real-length `SPT_` or `UID_` value exists outside ignored `.env.local`.
- Runtime: after an API-only restart, `/api/health` returned `paper + akshare`, authentication enabled, and `realTradingEnabled=false`.
- Daily review: the real read-only configured pool remained `risk-off`; local paper review found two issues, same-day repeated ordinary reduction of `600010` and 80.9% invested capital.
- Upgraded plan: already-reduced `600010` and `601600` changed to `hold` with hard-stop override; `601398`, `601328`, and `601857` received one-lot `风险仓位再平衡` paper plans because their historical regime was unclear. These are next-session local paper plans, not real orders or guaranteed outcomes.
- Timer suppression: more than two configured intervals after restart, executor memory still contained only the single startup after-hours run; no scheduled after-hours run was appended.
- Residual risk: one day is not enough to judge win rate or drawdown. The new exposure rule needs at least one trading week of paper evidence, and today’s 100-stock breadth is a configured observation pool rather than full-exchange breadth.
