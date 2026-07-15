# Adaptive Strategy Router And Runtime Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic market-regime strategy router to the local paper plan, make position reduction respond to real trend deterioration, and prevent an orphaned API watcher from leaving the frontend connected to a dead backend.

**Architecture:** AkShare historical research remains read-only and feeds a pure `AdaptiveStrategyRouter`. The router selects eligible strategy families and a bounded risk posture; `PaperTradingPlan` consumes the decision but all orders still pass through the existing `PaperAutoExecutor`, `RiskEngine`, and `PaperBroker`. Development startup runs the API as a foreground process under `concurrently` restart supervision so an API crash cannot leave a healthy-looking watcher behind.

**Tech Stack:** TypeScript, Fastify, Vitest, React, TanStack Query, concurrently, AkShare read-only bridge.

---

### Task 1: Add deterministic adaptive strategy routing

**Files:**
- Create: `server/research/adaptiveStrategyRouter.ts`
- Create: `server/research/adaptiveStrategyRouter.test.ts`

- [x] Write failing tests for constructive low-volatility, constructive high-volatility, risk-off, and degraded-data states.
- [x] Verify the tests fail because the router does not exist.
- [x] Implement a pure router using sector 20/60-day returns, MA slope, volatility, sector direction breadth, and stock-regime breadth.
- [x] Map each state to eligible strategy keys, cash reserve, new-position scale, and `accumulate` / `hold` / `reduce` posture.
- [x] Verify focused tests pass.

### Task 2: Include current positions in historical regime research

**Files:**
- Modify: `server/research/marketRegimeResearch.ts`
- Modify: `server/research/marketRegimeResearch.test.ts`

- [x] Write a failing fetch-contract test showing preferred held symbols are placed before generated quality candidates.
- [x] Add an optional bounded preferred-stock input, deduplicate symbols, and retain the 12-stock bridge limit.
- [x] Verify route behavior remains read-only and focused tests pass.

### Task 3: Apply routing to the paper trading plan

**Files:**
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/research/paperTradingPlan.test.ts`
- Modify: `server/research/paperTradingPlanService.ts`
- Modify: `server/app.test.ts`

- [x] Write failing tests for selecting the highest-ranked eligible strategy, reducing a T+1-available deteriorating position, holding healthy/washout positions, and returning cash observation instead of ten unaffordable blocked buys.
- [x] Build real market-regime research in the plan service and route strategies before building operations.
- [x] Use the adaptive cash reserve and position scale without weakening existing hard risk limits.
- [x] Add bounded half-position reduction for high-confidence trend deterioration; keep the existing 3% loss exit as the harder stop.
- [x] Preserve paper-only, T+1, lot-size, idempotency, cash, and manual-review guardrails.
- [x] Verify focused plan and API tests pass.

### Task 4: Expose the strategy state in the research UI

**Files:**
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/components/LearningPipeline.tsx`
- Modify: `src/styles/index.css`

- [x] Add client types for regime, confidence, selected strategy, eligible strategy list, posture, and evidence.
- [x] Render the current market state and strategy choice in the paper-plan section without claiming calibrated probability or guaranteed returns.
- [x] Keep the existing responsive layout and internal scrolling behavior.
- [x] Verify the web test suite and production build.

### Task 5: Make development API failure visible and restartable

**Files:**
- Modify: `package.json`
- Modify: `docs/operations/development.md`

- [x] Replace the orphan-prone `tsx watch` command in the three-service startup path with foreground `tsx server/index.ts` managed by unlimited `concurrently` restart attempts.
- [x] Keep a separate explicit `dev:api:watch` command for code-edit hot reload.
- [x] Start the stack, terminate only the API child in a controlled check, and verify `8787` returns after supervisor restart.
- [x] Document that the stable day-observation command favors crash recovery while the watch command favors code-edit reload.

### Task 6: Verify and document the behavior

**Files:**
- Modify: `docs/product/future-optimization.md`
- Modify: `docs/status/current-state.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/plans/2026-07-15-adaptive-strategy-router-and-runtime-reliability.md`

- [x] Run focused server tests.
- [x] Run `npm test` and `npm run build`.
- [x] Restart all services and verify health, authenticated strategy leaderboard, adaptive paper plan, auto-execution status, and browser rendering.
- [x] Confirm `REAL_TRADING_ENABLED=false`, no external broker order path, and no local credentials in the diff.
- [x] Record actual validation results and run `git diff --check`.

## Validation Results

- `npm test`: 30 server files / 587 tests and 4 web files / 15 tests passed.
- `npm run build`: TypeScript and Vite production build passed after the responsive navigation fix.
- `python -m pytest akshare-bridge/test_bridge.py -q`: 46 tests passed; one dependency deprecation warning remains.
- Runtime: API, Vite proxy, and AkShare bridge were healthy in `paper + akshare`; authentication was enabled and real trading disabled.
- Recovery: terminating API PID 287472 produced a non-zero exit and supervisor restart; port 8787 returned under PID 265224 without restarting the web or bridge listeners.
- Authenticated research: 12 leaderboard entries; adaptive plan reported `risk-off`, confidence 0.77, `reduce`, one eligible strategy, no new positions, two bounded paper sell plans, and one cash observation.
- Execution boundary: auto execution reported `local-paper-broker-only`, `liveTradingEnabled=false`, and `after-hours`; no external order was submitted.
- Browser: 1440 x 900 and 390 x 844 layouts had no horizontal overflow; the mobile drawer opened and closed, the adaptive panel rendered without overlap, and console errors were empty.
- `git diff --check`: passed with line-ending conversion warnings only; credential-pattern scan returned no matches.
