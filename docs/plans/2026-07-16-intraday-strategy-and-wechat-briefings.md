# Intraday Strategy And WeChat Briefings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn KAIROS market-regime routing into an explicit intraday strategy playbook, pace local paper capital through the trading day, and send concise WxPusher briefings containing current/target paper positions, sectors, risk, and imminent paper actions within a strict daily message budget.

**Architecture:** `AdaptiveStrategyRouter` remains the single deterministic authority for market-state strategy eligibility and adds a versioned playbook plus per-phase invested-ratio caps. `PaperAutoExecutor` performs a preflight pass before any local `PaperBroker` submission so pacing, cash, daily caps, and the exact imminent operations are known before notification. `PaperPlanNotifier` receives that preflight context, sends one briefing per trading phase plus material updates, and persists credential-free budget/deduplication audit state.

**Tech Stack:** TypeScript, Fastify, Node.js `fetch`, Zod, Vitest, existing AkShare read-only research, `PaperBroker`, and `TradingStore` audit persistence.

---

### Task 1: Version the market-state strategy playbook

**Files:**
- Modify: `server/research/adaptiveStrategyRouter.ts`
- Modify: `server/research/adaptiveStrategyRouter.test.ts`
- Modify: `server/research/paperTradingPlan.adaptive.test.ts`

- [x] Write failing tests for low/high-volatility trend, low/high-volatility range, risk-off, and degraded-data playbooks.
- [x] Upgrade routing to version `1.1.0` with `strategyPlaybook` fields for primary strategies, use conditions, avoid conditions, and recheck triggers.
- [x] Add regime-specific opening, morning, afternoon, and closing maximum invested ratios; keep `risk-off` and `unclear` unable to open new positions.
- [x] Require available breadth to confirm an uptrend and surface weak breadth as a risk flag rather than silently treating it as healthy trend evidence.
- [x] Run focused router and adaptive paper-plan tests.

### Task 2: Preflight and pace imminent local paper operations

**Files:**
- Create: `server/trading/intradayExecutionPolicy.ts`
- Create: `server/trading/intradayExecutionPolicy.test.ts`
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `server/app.test.ts`

- [x] Write failing tests for A-share phase classification at 09:30, 10:15, 13:00, and 14:15 China time.
- [x] Write failing app tests showing an opening buy that would exceed the playbook invested-ratio cap is skipped while risk-reduction sells remain outside the buy-only pacing check.
- [x] Build a pure policy that maps the current China-market phase and routing playbook to a maximum invested ratio, with conservative defaults when real routing is unavailable.
- [x] Refactor `PaperAutoExecutor` into a preflight pass and a submission pass so per-run/daily order caps, quote availability, cash reserve, and phase pacing are evaluated before notification.
- [x] Include `phase` and `phaseMaxInvestedRatio` in run status and credential-free audit data.
- [x] Keep all existing local-only, T+1, lot-size, idempotency, cash, position, and circuit-breaker checks.
- [x] Run focused policy and app tests.

### Task 3: Send concise, budgeted paper-account briefings

**Files:**
- Modify: `server/config.ts`
- Modify: `server/config.test.ts`
- Modify: `server/test/testConfig.ts`
- Modify: `.env.example`
- Modify: `server/notifications/paperPlanNotifier.ts`
- Modify: `server/notifications/paperPlanNotifier.test.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] Write failing configuration tests for `WXPUSHER_DAILY_MESSAGE_LIMIT` defaulting to 8 with a hard maximum of 10 and a bounded material-update cooldown.
- [x] Write failing notifier tests for current positions, exact preflight target positions, cash/invested ratio, selected strategy/playbook, top three sectors, source warnings, and risk flags.
- [x] Remove reference price from the material signature so ordinary quote changes cannot consume additional messages.
- [x] Send at most one phase briefing for opening, morning confirmation, afternoon confirmation, and closing risk review; allow material action/regime changes after cooldown and cap all daily attempts at the configured limit.
- [x] Count provider failures as attempts, persist only credential-free summaries, and reserve two of the ClawBot ten-message allowance by default.
- [x] Wire market-regime research, account, positions, phase policy, and exact preflight operations into the notifier before local paper submission.
- [x] Run focused configuration, notifier, and app tests.

### Task 4: Fix time consistency and expose the playbook

**Files:**
- Modify: `server/research/paperTradingPlan.ts`
- Modify: `server/research/paperTradingPlan.test.ts`
- Modify: `src/lib/tradingApi.ts`
- Modify: `src/components/LearningPipeline.tsx`
- Modify: `src/lib/adaptiveStrategyPresentation.test.ts`

- [x] Write a failing paper-plan test proving `generatedAt` and `tradingDate` come from the market snapshot rather than the workstation clock.
- [x] Use snapshot market time consistently in paper plans and notification signatures.
- [x] Extend client routing types with the playbook and phase caps.
- [x] Show the current playbook's use condition, avoid condition, and capital pacing inside the existing strategy-state section without adding a new nested card.
- [x] Run focused server and web tests.

### Task 5: Document and verify tomorrow's operating contract

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/product/future-optimization.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/plans/2026-07-16-intraday-strategy-and-wechat-briefings.md`

- [x] Document the eight-message default budget, four phase briefings, material-update cooldown, current/target paper holdings, sector/risk summary, and ClawBot reactivation requirement.
- [x] Document strategy-to-regime mappings and state that they are deterministic paper research rules, not calibrated profit probabilities.
- [x] Run `npm test` and `npm run build`.
- [x] Run `git diff --check` and scan tracked/untracked files for real-length SPT/UID values outside ignored `.env.local`.
- [x] Record actual validation results and any residual runtime limitation.

## Validation record

- `npm test`: 33 server files / 619 tests and 4 web files / 16 tests passed.
- `npm run build`: TypeScript project build and Vite production build passed.
- `git diff --check`: passed.
- Credential scan: no real-length `SPT_` or `UID_` value was found outside ignored `.env.local`; test-only placeholders remain intentionally short.
- Runtime limitation: the existing local app loaded its protected login page and the paper/AkShare health endpoint returned 200, but no live WxPusher allowance was consumed and no authenticated strategy page was inspected. Tomorrow's run still requires restarting the project with the new code and reactivating ClawBot in WeChat if its 24-hour window has expired.
