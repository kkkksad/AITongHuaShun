# Research Recovery and Weekly Review Implementation Plan

> **For agentic workers:** Use executing-plans to implement and verify each task in this session.

**Goal:** Recover promptly from partial market history and make weekly Paper evidence available independently of expensive research.

**Architecture:** Keep the existing bounded bridge request cache, but distinguish pending requests from completed responses and shorten retention for structured warnings. Keep weekly reviews keyed by period and load them independently in the existing research pipeline.

**Tech Stack:** TypeScript, Fastify, React, TanStack Query, Vitest.

## Scope and Evidence

- The working tree contains prior changes; preserve them and do not stage unrelated files.
- HTTP 200 bridge responses with `warning` are currently cached for the full healthy TTL (up to 10 minutes).
- Pending requests can expire before completion, defeating request deduplication.
- Weekly audit data currently waits for leaderboard and candidate queries, despite not depending on them.
- Local services were stopped at inspection; local Paper records only reach September 6. Current production performance is not verified.
- No production secrets, broker connection, order limits or safety boundaries change.

## Task 1: Bridge Response Recovery

Files: `server/research/bridgeRequest.ts`, `server/research/bridgeRequest.test.ts`, `server/research/marketRegimeResearch.test.ts`.

- [x] Add regressions for HTTP 200 warning recovery after 5 seconds, healthy TTL after completion, pending deduplication and eviction safety. Pre-fix run reproduced three failures.
- [x] Represent pending expiry as `null`; reuse pending promises until settlement. On success set `expiresAt = Date.now() + (warning ? Math.min(cacheTtlMs, 5_000) : cacheTtlMs)`. Only update the same cache entry; failed requests are removed.
- [x] Evict completed entries before pending requests. At 64 pending entries, bypass caching for a new key rather than evict an active shared request.
- [x] Add a market-regime recovery regression using the same request URLs; focused server tests passed (27 at this checkpoint).

## Task 2: Weekly Review Loading and Controls

Files: `src/components/LearningPipeline.tsx`, its tests, `src/lib/researchQueries.ts`, its tests, `src/styles/index.css`.

- [x] Test that weekly reviews start while expensive research is pending, switching periods never relabels stale data, and refresh retries an error. Pre-fix run reproduced four failures across query policy and UI behavior.
- [x] Add a current/previous segmented control (default previous), an accessible refresh icon and period-aware loading/error text. Remove weekly `enabled: researchFoundationReady`.
- [x] Remove cross-period `placeholderData`; same-key refreshes retain their own data normally. Reuse existing typography and controls; add only scoped responsive styling.
- [x] Run frontend tests and inspect desktop/mobile rendering.

## Task 3: Verification and Documentation

Browser inspection found two additional presentation defects within the same component: fixed demo progress (24/24, 7/24, day 8) appears as real progress, and a 100,000 account figure overflows a three-column mobile metric cell.

- [x] Replace fixed pipeline progress and missing-data score with API-derived states; do not describe synthetic leaderboard results as out-of-sample validation. Make generated-status messages conditional on actual data.
- [x] Use responsive metric columns and bounded number wrapping, then repeat browser checks.

- [x] Run server and frontend suites, TypeScript, Vite build and `git diff --check` using existing local executables.
- [x] Start a loopback preview without enabling auto trading or changing credentials; document any unavailable backend/data source explicitly.
- [x] Update `docs/operations/development.md`, `docs/product/overview.md` and `docs/status/current-state.md` with actual behavior, test counts and deployment status.

Commands: `node_modules/.bin/vitest.cmd run --dir server --environment node`, `node_modules/.bin/vitest.cmd run --dir src --environment jsdom`, `node_modules/.bin/tsc.cmd -b`, `node_modules/.bin/vite.cmd build --config config/vite.app.config.js --configLoader runner`.

## Results

Completed locally. Server: 62 files / 890 tests. Web: 32 files / 120 tests. TypeScript and production build passed (2,322 modules); diff whitespace check passed. Browser checks used an isolated fixture with a simulated 100,000 account, not production data. Desktop and 390px mobile layouts had no horizontal overflow; individual metric cells had no overflow and the console had no errors. The mobile defect was reproduced visually before correction.

Local preview at `http://127.0.0.1:4173` uses a loopback API on 8787, mock quotes and an in-memory Paper account. Auto execution, WxPusher and external feature capture are disabled for these processes only. Existing login configuration and persistent files are unchanged. The AkShare bridge is not running. No commit or production deployment was performed; current production transactions and win rates remain unverified.

## Deployment Follow-Up

User requested deployment after the local verification. Target: existing production branch `codex/real-market-regime`, server `124.221.165.45`, `/opt/kairos` and domain `kairosq.cn`.

- [x] Read existing deployment workflow and confirm authenticated SSH, healthy containers and available disk (22 GB).
- [x] Add `.env.*` Docker build-context exclusion and a regression test. The pre-fix test failed as expected; no credential contents were inspected or changed.
- [x] Back up production Paper data under the protected runtime directory: `runtime/backups/paper-before-20260920-154311.tar.gz`; archive listing verified. A server-local configuration digest will verify that `.env.production` remains unchanged.
- [ ] Commit the verified application changes and deploy via the existing production workflow. Leave unrelated pnpm runtime metadata untracked.
- [ ] Verify container health, HTTPS, protected API authorization and new frontend assets; record the exact deployed revision.

Pre-existing TLS issue confirmed: `kairosq.cn` resolves to the target, but the installed certificate is self-signed and only lists IP `124.221.165.45` (valid August 2026 to August 2027). Standard client trust validation fails before deployment. A trusted domain certificate is a separate follow-up; this release does not silently replace it or bypass browser warnings.

First workflow attempt `35520517204` stopped at web tests without deploying. Its annotation identified an old weekly API test that depended on the local `VITE_API_BASE_URL`; the production same-origin path correctly lacks that prefix. The test now explicitly exercises both same-origin and configured-base requests with isolated environment stubs. Application URL behavior is unchanged.
