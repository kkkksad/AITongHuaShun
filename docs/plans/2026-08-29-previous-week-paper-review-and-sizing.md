# Previous Week Paper Review and Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review the previous complete A-share Paper trading week and make the reason for small orders and strategy performance directly verifiable without weakening Paper risk controls.

**Architecture:** Extend the existing weekly Paper review with an explicit `current`/`previous` period selector and an effective single-order-cap diagnostic. Keep order execution unchanged: the review remains read-only, while Paper plan sizing continues to use the effective risk cap, cash reserve, lot size, fees, T+1, position limits, phase pacing and circuit breaker. The research page will request the previous complete trading week by default and show closed-fill evidence separately from configuration constraints.

**Tech Stack:** React, TypeScript, Fastify, TanStack Query, Vitest, Vite.

---

### Task 1: Add a previous-complete-week review period and cap evidence

**Files:**
- Modify: `server/research/weeklyPaperReview.ts`
- Test: `server/research/weeklyPaperReview.test.ts`
- Modify: `server/app.ts`
- Test: `server/app.test.ts`

- [x] **Step 1: Write failing tests**

Add coverage for `period: "previous"` returning the Monday-Friday range before the current week, and for the review exposing the effective maximum single-order notional and its ratio to initial capital.

- [x] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
& "$env:LOCALAPPDATA\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" ".\node_modules\vitest\vitest.mjs" run server/research/weeklyPaperReview.test.ts server/app.test.ts --environment node
```

Expected: FAIL because the review input has no period/cap fields and the route does not parse `period=previous`.

- [x] **Step 3: Implement the bounded period and cap diagnostic**

Add a `WeeklyPaperReviewPeriod` union, resolve `current` as the current week-to-date and `previous` as the immediately preceding Monday-Friday trading week, and add these read-only fields:

```ts
period: "current" | "previous";
capital.maxSingleOrderNotional: number;
capital.maxOrderCapitalRatio: number;
capital.sizingConstraint: "configured-cap" | "cash-or-reserve" | "phase-budget" | "lot-size" | "strategy-or-signal" | "sample-or-signal" | "not-observed";
```

Pass `period` from the validated route query and pass `system.risk.getEffectiveMaxOrderNotional()` to the builder. Do not change the order plan or risk limits.

- [x] **Step 4: Run the focused tests and verify they pass**

Run the same Vitest command. Expected: all weekly review and app tests pass.

### Task 2: Connect the previous-week review to shared API/query/page presentation

**Files:**
- Modify: `src/lib/tradingApi.ts`
- Test: `src/lib/tradingApi.test.ts`
- Modify: `src/lib/researchQueries.ts`
- Test: `src/lib/researchQueries.test.ts`
- Modify: `src/components/LearningPipeline.tsx`
- Test: `src/components/LearningPipeline.test.tsx`

- [x] **Step 1: Add request and presentation tests**

Verify the shared query key includes `previous`, the request uses `/api/research/weekly-paper-review?period=previous`, and the page presents the configured single-order cap, its initial-capital ratio, the sizing constraint, and the closed-fill-only win-rate boundary.

- [x] **Step 2: Implement the previous-week request**

Make the period explicit in the fetcher and query options, defaulting the page to `previous`. Keep placeholder data and the existing 60-second refresh policy.

- [x] **Step 3: Implement the page fields**

Rename the section to “上周 Paper 复盘”, display the resolved date range, and add compact cap diagnostics. Keep “样本不足” when no closed trades exist; do not label backtest or unrealized results as win rate.

- [x] **Step 4: Run focused web tests**

Run:

```powershell
& "$env:LOCALAPPDATA\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" ".\node_modules\vitest\vitest.mjs" run src/components/LearningPipeline.test.tsx src/lib/researchQueries.test.ts src/lib/tradingApi.test.ts --environment jsdom
```

Expected: all focused web tests pass.

### Task 3: Validate risk-constrained sizing and document the production decision

**Files:**
- Modify: `server/research/paperTradingPlan.test.ts` or `server/research/paperTradingPlan.adaptive.test.ts`
- Modify: `docs/status/current-state.md`
- Modify: this plan

- [x] **Step 1: Add a sizing regression**

Prove that increasing `maxSingleOrderNotional` increases a qualified Paper plan's bounded quantity, while the plan never exceeds the cap or cash reserve and still rejects uneconomic lots.

- [x] **Step 2: Run the sizing regression**

Run the relevant Paper plan test file and expect PASS.

- [x] **Step 3: Record the production configuration finding**

Document that `deploy/production.env.example` uses a bounded 30-day history retention so a previous full trading week remains reviewable, while `MAX_ORDER_NOTIONAL=2500` remains an explicit Paper risk-budget setting. Changing that order cap is not silently deployed in this task. Record the previous-week period semantics and the distinction between order-size diagnosis and win-rate evidence.

### Task 4: Complete verification

- [x] **Step 1: Run all server tests**

Run:

```powershell
& "$env:LOCALAPPDATA\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" ".\node_modules\vitest\vitest.mjs" run --dir server --environment node
```

- [x] **Step 2: Run all web tests**

Run:

```powershell
& "$env:LOCALAPPDATA\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" ".\node_modules\vitest\vitest.mjs" run --dir src --environment jsdom
```

- [x] **Step 3: Run type checking, production build and diff checks**

Run `tsc -b`, Vite production build using `config/vite.app.config.js`, and `git diff --check`. Record exact results here and in `docs/status/current-state.md`.

- [x] **Step 4: Audit invariants**

Confirm no changes to real-trading enablement, Paper broker routing, cash/fee/T+1/position/circuit-breaker checks, or the configured daily hard cap. Mark the plan complete only after all evidence is present.

### Task 5: Distinguish empty history from retention-pruned history

**Files:**
- Modify: `server/research/weeklyPaperReview.ts`
- Test: `server/research/weeklyPaperReview.test.ts`
- Modify: `server/app.ts`
- Test: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/components/LearningPipeline.tsx`
- Test: `src/components/LearningPipeline.test.tsx`

- [x] **Step 1: Add retention coverage regression tests**

Verify a review reports the configured retention window and marks a period as `may-be-pruned` when its end date is older than the configured window.

- [x] **Step 2: Implement the bounded coverage diagnostic**

Pass `TRADING_HISTORY_RETENTION_DAYS` from the API route, expose `within-retention` / `may-be-pruned` / `unknown`, and explicitly state that an empty period outside retention cannot prove zero trading. Keep the order and audit stores unchanged.

- [x] **Step 3: Surface the evidence boundary in the research page**

Show the retention status and summary beside the weekly diagnosis so missing historical records are not presented as a strategy or execution conclusion.

- [x] **Step 4: Verify and preserve safety invariants**

Run the full server and web suites, `tsc -b`, the Vite production build and `git diff --check`. Confirm this diagnostic does not change Paper order generation, real-trading enablement, fees, cash, T+1, position, circuit-breaker or daily order limits.

### Task 6: Make planned-vs-filled capital loss observable

**Files:**
- Modify: `server/trading/paperAutoExecutor.ts`
- Test: `server/trading/paperAutoExecutor.test.ts`
- Modify: `server/research/weeklyPaperReview.ts`
- Test: `server/research/weeklyPaperReview.test.ts`
- Modify: `server/app.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/components/LearningPipeline.tsx`
- Test: `src/components/LearningPipeline.test.tsx`

- [x] **Step 1: Persist a bounded plan snapshot**

Record buy/sell operation counts and estimated notionals in each successful automatic Paper run. Select the largest buy snapshot for each day in the weekly review so repeated timer runs do not inflate the weekly plan amount.

- [x] **Step 2: Compare plan and execution using Paper-only order IDs**

Report planned buy notional, automatic filled buy notional, plan realization ratio, plan snapshot days and daily peak planned buy notional. Count only `kairos-auto-paper:` filled buys as automatic execution evidence; manual orders remain separate.

- [x] **Step 3: Preserve the execution-layer explanation**

Store strategy, strategy key, quantity, price and estimated notional on skipped plan operations and include them in the audit signature. Diagnose missing snapshots, plans without automatic fills and low realization without relaxing any guardrail.

- [x] **Step 4: Surface compatibility-safe evidence**

Show plan amount, automatic fill amount, snapshot days and realization rate in the research pipeline. The browser treats fields missing from an older API response as zero/unknown so a rolling deployment does not crash the page.

- [x] **Step 5: Add daily reconciliation**

Expose daily planned buy/sell notional, automatic filled buy notional and daily realization rate alongside submitted/filled/rejected counts. Render only days with a plan or order so the weekly page stays compact while preserving the first useful execution-layer clue.

- [x] **Step 6: Add blocker notional context**

Aggregate the recorded estimated notional for each blocker category and show it as context in the research page. Keep the value explicitly labeled as an estimate; it is not realized loss, and it cannot release or bypass any Paper risk budget.

## Verification Results

- Server Vitest: 61 files, 872 tests passed.
- Web Vitest: 31 files, 114 tests passed.
- TypeScript project build passed.
- Vite production build passed with 2,322 modules transformed.
- `git diff --check` passed.
- Daily reconciliation focused tests: 10 tests passed across the weekly review and research pipeline suites.
- Blocker notional regression: cash rejection and skipped-plan estimates are attributed without changing blocker counts or execution decisions.
- The two-hour heartbeat `kairos-paper` is active with four 30-minute runs; it is Paper-only and does not deploy or alter credentials.
- Plan snapshots and skipped sizing metadata are local code changes only; they have not been deployed to the production server in this task.

## Decisions

- Previous week means the immediately preceding Monday-Friday A-share trading week relative to the request date; the current week remains available for backward-compatible API callers.
- The application may diagnose a configured cap but must not silently raise it. A larger Paper order budget requires an explicit production configuration change and a separate deployment review.
- Production example history retention is 30 days, bounded and sufficient for weekly review; this does not recover records already removed by an older 7-day deployment.
- A win rate is only computed from filled Paper buy/sell FIFO closures. Open positions, unrealized PnL, synthetic backtests and target order counts are not success-rate evidence.
- A weekly empty result outside the configured trading-history retention window is marked `may-be-pruned`; it is not evidence that no orders ran. Future production weekly reviews should use a retention period covering the review window or persist a separate weekly summary.
- The sizing diagnostic now distinguishes `configured-cap`, `cash-or-reserve`, `phase-budget`, `lot-size`, `strategy-or-signal`, `sample-or-signal` and `not-observed`; this is explanatory metadata only and does not bypass any corresponding check.
- Planned-vs-filled capital is an execution observability metric, not a promise that every generated plan will fill. A low realization rate must be investigated through the recorded skip reason and current Paper risk state.

## Follow-up

After deployment is explicitly approved, compare the previous-week planned notional, filled notional, cap utilization, blocker counts, per-strategy closed outcomes and next-week Paper observations. The current production example uses 30-day bounded history retention for future weekly review, but records already pruned under the old 7-day setting cannot be reconstructed. Do not infer profitability from a larger average order alone.
