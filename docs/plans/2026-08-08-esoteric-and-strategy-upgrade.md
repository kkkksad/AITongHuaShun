# Esoteric Observation And Strategy Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the esoteric tab into a useful cultural review surface, add missing regime-aware paper strategy signals, and increase qualified paper-trade coverage without forcing daily orders or weakening risk controls.

**Architecture:** Keep the esoteric module entirely in the React research layer and derive only descriptive market context from the current snapshot; its result must never enter strategy routing, notifications, risk limits, or order execution. Extend the existing pure adaptive candidate ranker with deterministic rule sets for strategy keys the router already exposes, then let the existing paper plan retain final control over cash, fees, T+1, position limits, persistence, daily pacing, circuit breakers, and audit records.

**Tech Stack:** React, TypeScript, Fastify research services, Vitest, Vite, AkShare read-only market data, local PaperBroker.

---

### Task 1: Lock the cultural and trading boundaries with tests

**Files:**
- Modify: `src/lib/esotericMarket.test.ts`
- Modify: `src/components/EsotericMarketPanel.test.tsx`
- Modify: `server/research/adaptiveCandidateStrategy.test.ts`
- Modify: `server/research/paperTradingPlan.adaptive.test.ts`

- [x] Add an esoteric-domain test that derives advancing breadth, average change, average amplitude, usable coverage, and freshness from tradable snapshot quotes while excluding index quotes.
- [x] Add deterministic tests that the three methods produce different `methodLens` and `reviewQuestions` values for the same date and target.
- [x] Add tests for aligned, conflicted, and unavailable market mirrors, including the explicit statement that the score is an entertainment index rather than a probability.
- [x] Add a component test for the three-layer layout: cultural symbol, market mirror, and review questions; keep the paper-execution isolation warning visible.
- [x] Add adaptive-signal tests for `movingAverageCross`, `macd`, `turtle`, `rsi`, and `bollingerBands`, including negative tests for trend deterioration, non-tradable quotes, and ineligible strategy keys.
- [x] Add a paper-plan test proving a range-market candidate may become an executable small paper plan while the same candidate remains blocked in `risk-off` and `unclear`.
- [x] Run the focused Vitest regression; new assertions failed before implementation and pass afterward.

### Task 2: Rebuild the esoteric observation model

**Files:**
- Modify: `src/lib/esotericMarket.ts`
- Modify: `src/components/EsotericMarketPanel.tsx`
- Modify: `src/styles/index.css`

- [x] Add `EsotericMarketContext` with bounded descriptive fields only: sample size, breadth ratio, average change percent, average amplitude percent, usable coverage, freshness minutes, and state.
- [x] Add a pure `summarizeEsotericMarketContext(snapshot, now)` function that ignores non-tradable/index quotes, rejects invalid prices, and returns an unavailable state for insufficient samples.
- [x] Give each method a distinct deterministic interpretation: Yi Jing emphasizes hexagram/change-line tension, Wu Xing emphasizes date/element balance, and number divination emphasizes symbol/date rhythm.
- [x] Return separate `symbolLayer`, `marketMirror`, `alignment`, `entertainmentIndex`, and `reviewQuestions` fields. The alignment may describe agreement or conflict but may not expose buy/sell/action/position/order fields.
- [x] Render a compact three-layer research surface with real breadth, average movement, amplitude, coverage, freshness, conflict state, and two falsifiable review questions.
- [x] Keep all controls responsive, preserve the explicit cultural-reference warning, and label the entertainment index as neither win rate nor prediction probability.

### Task 3: Complete the regime-aware strategy signal set

**Files:**
- Modify: `server/research/adaptiveCandidateStrategy.ts`
- Modify: `server/research/adaptiveCandidateStrategy.test.ts`
- Modify: `server/research/adaptiveStrategyRouter.ts`
- Modify: `server/research/adaptiveStrategyRouter.test.ts`
- Modify: `src/lib/tradingApi.ts`

- [x] Expand `AdaptiveCandidateStrategySignal.strategyKey` to include the router's additional strategy keys, including the observation-only `kairosRiskOffRecovery` key.
- [x] Implement trend rules for moving-average cross, MACD confirmation, and Turtle breakout using only current quote fields and already-computed historical features; cap current gains and amplitude to avoid chasing.
- [x] Implement RSI and Bollinger mean-reversion proxies only in range regimes, only near the intraday lower area, and only when historical shape is `unclear` or healthy rather than deteriorating.
- [x] Keep `risk-off` and `unclear` as no-new-position states. Keep `risk-off-recovery` observation-only until multi-session confirmation exists; do not infer that confirmation from a single current snapshot.
- [x] Preserve deterministic scoring, primary-strategy boosts, eligibility filtering, and evidence strings for every selected signal.
- [x] Routing serialization did not change, so the existing `1.4.0` contract and matching tests remain valid.

### Task 4: Improve qualified paper-trade coverage

**Files:**
- Modify: `server/research/paperTradingPlanService.ts`
- Modify: `server/research/paperTradingPlanService.test.ts`
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/research/paperTradingPlan.adaptive.test.ts`

- [x] Build the preferred historical pool from positions first, then interleave actionable daily candidates and quality stocks so one scanner cannot consume all 12 history slots.
- [x] Keep the history request cap at 12 and all bridge single-flight/cache limits unchanged.
- [x] Rank qualified strategy signals ahead of unmatched candidates, but retain defensive score, affordability, persistence, cash reserve, minimum commission, T+1, same-day re-entry, and per-plan position caps.
- [x] Include a strategy-coverage summary in the paper plan that reports matched keys, unmatched candidates, and the dominant blocker without claiming expected profit.
- [x] Keep automatic execution at the configured one order per run and four per day defaults; do not synthesize an order when no candidate passes.

### Task 5: Expose the upgrade in the research workspace

**Files:**
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/components/LearningPipeline.tsx`
- Modify: `src/components/StrategyLeaderboard.tsx` only if the current strategy-name rendering cannot show the new routed keys
- Modify: `src/styles/index.css`
- Modify: related component tests

- [x] Show matched strategy count, strategy names, and the dominant blocker beside the existing paper-plan quality summary.
- [x] Clarify that “more opportunities” means broader rule coverage, not forced turnover or a daily-profit promise.
- [x] Keep dense operational styling, mobile wrapping, accessible labels, and existing icon conventions.

### Task 6: Document, verify, and inspect runtime safety

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/product/overview.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: this plan with completion evidence

- [x] Document the enhanced cultural module as entertainment-only and state that it is absent from strategy, notification, risk, and execution inputs.
- [x] Document the added adaptive signals and the distinction between qualified opportunity coverage and guaranteed daily trading.
- [x] Run the repository-equivalent server/web Vitest, TypeScript/Vite build, and `python -m pytest akshare-bridge -q` checks; pnpm's ignored-build policy prevented the wrapper `npm test` command.
- [x] Run `git diff --check` and inspect `git diff --stat` plus `git status --short` for unrelated or secret-bearing changes.
- [x] Confirm configuration and tests still enforce `paper`, `REAL_TRADING_ENABLED=false`, WxPusher credential isolation, and all existing order safeguards.
- [x] Record exact test/build counts and remaining live-data limitations in `docs/status/current-state.md` and the completion record below.

## Non-Goals

- No promise of daily profit, win rate, or guaranteed daily orders.
- No real broker integration, credential handling, or live-order path.
- No use of esoteric output in candidate ranking, WxPusher, paper positions, risk limits, or automatic execution.
- No unbounded candidate/history concurrency and no future data in backtests.

## Completion Record

- Status: complete on 2026-08-08.
- Server Vitest: 54 files and 822 tests passed.
- Web Vitest: 29 files and 100 tests passed.
- Python pytest: 109 tests passed with one existing FastAPI/httpx deprecation warning and one local cache-permission warning.
- TypeScript project-reference checks and Vite production build passed; Vite transformed 2,320 modules.
- Browser QA: authenticated local workbench at 1265px and 375px effective viewport; page and panel overflow were 0, strategy/observation cards had stable widths, and browser console errors were 0.
- Runtime limitation: live AkShare sector/history/news upstream availability was not changed by this work; the system continues to expose source warnings and keeps real trading disabled.
