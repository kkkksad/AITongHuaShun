# Paper Activity and Strategy Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagnose this week's low Paper activity and improve qualified candidate coverage without forcing trades or weakening the existing Paper controls.

**Architecture:** Separate execution coverage from signal eligibility. Verify the local and production runtime configuration, then make only deterministic strategy or observability changes that preserve real-history, fee, cash, lot-size, T+1, position, circuit-breaker, idempotency, phase pacing and daily hard-cap checks. The result remains a local Paper research workflow, never a real broker path.

**Tech Stack:** React, TypeScript, Fastify, local PaperBroker, AkShare read-only bridge, Vitest, Vite.

---

### Task 1: Audit runtime activity and configuration

**Files:**
- Inspect: `.env.local`, `data/paper-trading-state.json`, `server/trading/paperAutoExecutor.ts`, `server/research/weeklyPaperReview.ts`
- Modify: `docs/status/current-state.md`
- Modify: this plan

- [x] Confirm `MARKET_MODE=paper`, `REAL_TRADING_ENABLED=false`, the active activity mode, target, daily cap, phase pacing, cash reserve and strategy profile.
- [x] Compare the current week's automatic-run audit coverage with orders and distinguish service-not-running, market-closed, data-degraded, signal-blocked and risk-blocked states.
- [x] Record the evidence and avoid treating missing retained history as proof of zero trading.

### Task 2: Improve qualified Paper candidate coverage

**Files:**
- Modify: `server/research/adaptiveCandidateStrategy.ts` or `server/research/paperTradingPlan.ts` only if the audit identifies a deterministic eligibility defect
- Test: the corresponding strategy and Paper plan test files

- [x] Add a failing regression for the identified defect, using a fixed snapshot and historical evidence.
- [x] Implement the smallest rule correction that expands only qualified candidates; do not lower history, liquidity, fee, cash, lot-size, T+1, position, route, phase or circuit-breaker checks.
- [x] Verify strategy rotation remains explainable and does not manufacture an order when no candidate passes.

### Task 3: Keep high activity observable and bounded

**Files:**
- Modify: `.env.local` only for local Paper validation settings
- Modify: `docs/operations/development.md` or `docs/status/current-state.md` if the effective local settings change
- Test: `server/trading/paperAutoExecutor.test.ts` and relevant API tests

- [x] Use the existing validation-probe mode with target 6 and daily hard cap 10 for local verification.
- [x] Do not remove the hard cap or create unlimited same-round submissions; each operation must continue through PaperBroker and risk checks.
- [x] Confirm skipped operations record a strategy, quantity, estimated notional and concrete blocking reason.

### Task 4: Complete verification

- [x] Run focused Paper strategy and executor tests.
- [x] Run all Server and Web Vitest suites.
- [x] Run `tsc -b`, the Vite production build and `git diff --check`.
- [x] Recheck local bridge/API health and document whether production was deployed. Do not deploy or alter production credentials in this task.

## Audit findings

- Local `.env.local` had Paper auto execution enabled but remained at `observe`, target default `2`, and daily cap `4`.
- Local `data/paper-trading-state.json` contains one weekend startup audit and no current-week automatic Paper orders. This proves execution coverage is missing for that retained window; it does not prove the strategy had no eligible signal.
- The local AkShare bridge currently reports healthy caches with thousands of symbols and indices. Earlier transient bridge connection errors recovered to HTTP 200 responses.
- The public production health endpoint is healthy and still reports `paper`, `akshare`, and `realTradingEnabled=false`; this worktree has not been deployed.
- Cold-start execution now stops before expensive research when no positive-price tradable quote exists; a later scheduled run can re-evaluate after the market provider recovers.
- Position valuation falls back to average cost for non-finite or non-positive quotes, and pending limit orders ignore such quotes until a valid price arrives.
- Degraded research cache entries expire after 5 seconds, while healthy entries retain the existing 30-second TTL, so a recovered bridge is retried promptly.

## Safety decisions

- No real broker, TongHuashun, SuperMind or live account connection.
- No forced orders, target guarantee, return guarantee or win-rate claim.
- The maximum automatic Paper order count remains 10 per trading day; target 6 is an activity objective only.
- Paper activity mode can widen qualified sample coverage only when real historical and risk checks pass.
- Production configuration and persisted account state are not silently reset or resized.

## Verification

- Focused regression set: 7 files, 168 tests passed.
- Full server suite: 62 files, 882 tests passed.
- Full web suite: 31 files, 116 tests passed.
- `tsc -b`, Vite production build (2,322 modules), and `git diff --check` passed.
- Local services checked: API `8787`, AkShare bridge `8800`, and Vite `4173`; bridge reported healthy caches and no last stock/index error. No production deployment was performed.
