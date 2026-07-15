# WxPusher Paper Plan Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one deduplicated WxPusher SPT notification before KAIROS submits an actionable plan to the local paper broker.

**Architecture:** A dedicated WxPusher client owns the external HTTP contract and reads its SPT only from server environment configuration. A paper-plan notifier formats actionable paper operations, records success/failure in the existing audit store without credentials, and is invoked by `PaperAutoExecutor` before local paper orders are submitted. Notification failures remain observable but cannot create or authorize real orders.

**Tech Stack:** TypeScript, Node.js `fetch`, Zod, Fastify, Vitest, existing `TradingStore` audit contract.

---

### Task 1: Add fail-closed WxPusher configuration

**Files:**
- Modify: `server/config.ts`
- Modify: `server/config.test.ts`
- Modify: `server/test/testConfig.ts`
- Modify: `.env.example`

- [x] Add failing configuration tests for disabled defaults, valid SPT configuration, missing SPT rejection, and invalid timeout rejection.
- [x] Add `WXPUSHER_ENABLED`, `WXPUSHER_SPT`, and `WXPUSHER_TIMEOUT_MS` to the server schema.
- [x] Require an `SPT_` credential only when the channel is enabled, and never expose it through a browser-prefixed environment variable.
- [x] Run `npm run test:server -- server/config.test.ts` and verify the focused configuration tests pass.

### Task 2: Implement the WxPusher SPT client

**Files:**
- Create: `server/notifications/wxPusherClient.ts`
- Create: `server/notifications/wxPusherClient.test.ts`

- [x] Write failing tests for the official `POST /api/send/message/simple-push` request, `code: 1000` success handling, timeout handling, and sanitized provider failures.
- [x] Implement a small client with injectable `fetch`, bounded timeout, text content, and response validation.
- [x] Ensure errors and return values never include the SPT.
- [x] Run `npm run test:server -- server/notifications/wxPusherClient.test.ts` and verify the focused client tests pass.

### Task 3: Notify once before actionable local paper operations

**Files:**
- Create: `server/notifications/paperPlanNotifier.ts`
- Create: `server/notifications/paperPlanNotifier.test.ts`
- Modify: `server/trading/paperAutoExecutor.ts`
- Modify: `server/app.ts`
- Modify: `server/app.test.ts`

- [x] Write failing tests showing watch-only plans do not send, actionable plans are formatted as simulation-only reminders, duplicate plan signatures do not resend, and provider failures are audited without blocking local paper execution.
- [x] Build a stable daily signature from trading date, symbol, action, quantity, and price.
- [x] Append credential-free `wxpusher.paper-plan.sent` or `wxpusher.paper-plan.failed` audit events.
- [x] Invoke the notifier after the plan is built and before the first local `PaperBroker` submission.
- [x] Wire the notifier only when `WXPUSHER_ENABLED=true`; keep `REAL_TRADING_ENABLED=false` and all existing paper guardrails unchanged.
- [x] Run the focused notifier, executor, and app tests.

### Task 4: Document and verify

**Files:**
- Modify: `docs/status/current-state.md`
- Modify: `docs/operations/development.md`
- Modify: `docs/safety/trading-boundaries.md`
- Modify: `docs/plans/2026-07-16-wxpusher-paper-plan-notifications.md`

- [x] Document local-only SPT storage, simulation-only message wording, deduplication, provider limits, and ClawBot reactivation behavior.
- [x] Run `npm test` and `npm run build`.
- [x] Run `git diff --check` and scan the diff for credential prefixes.
- [x] Record actual validation results and mark completed plan items.

## Validation Results

- `npm test`: 32 server files / 601 tests and 4 web files / 15 tests passed.
- `npm run build`: TypeScript project build and Vite production build passed.
- Focused notification coverage: official SPT request shape, provider success/failure, timeout, credential sanitization, watch-only suppression, successful-plan deduplication, and non-blocking local paper execution passed.
- `git diff --check`: passed with Windows line-ending conversion warnings only.
- Credential scan: no real-length `SPT_` or `UID_` value exists outside ignored `.env.local`; no user credential was written by this work.
- Live provider call: one explicit user-requested test returned `code: 1000` and `success: true`; the transient SPT was not written to the workspace and must be rotated before local configuration.
