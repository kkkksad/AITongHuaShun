# Research Reliability And Performance Upgrade

**Date:** 2026-08-23
**Status:** Complete

## Goal

Make the Paper-only research workflow responsive when auxiliary market sources are slow or unavailable, while preserving A-share cash, lot-size, T+1, risk and daily-order constraints.

## Scope

1. Reuse in-flight and recently completed snapshot research instead of recomputing the strategy leaderboard and historical market regime for concurrent Paper-plan consumers.
2. Keep the Paper-plan API available when optional news or external-market inputs are delayed, with explicit degraded metadata rather than simulated replacements.
3. Treat client request cancellation as cancellation, not a retryable API outage.
4. Restrict market-workspace code preloading to intentional navigation and isolate a failed lazy panel from the rest of the page.
5. Improve strategy coverage diagnostics only from evidence-backed, Paper-only strategy signals. Do not force trades or relax risk checks to meet a count target.

## Implementation Notes

- `server/research/paperTradingPlanService.ts` owns the composed plan. Cached research must exclude account, order and position state so each plan still performs fresh cash, T+1, position and fee checks.
- Core regime/history evidence stays critical. News and global-market research are auxiliary: their failure or bounded timeout must yield a neutral/degraded report, never a fabricated quote or a new-position permission.
- Core regime/history research now has a 12-second request budget; a timeout returns a degraded report and cannot authorize new Paper positions. Position symbols participate in the short-lived research identity so position-prioritized auxiliary research cannot remain stale after a position change.
- Browser cancellation should retain `AbortError` so TanStack Query does not present an aborted screen navigation as a failed query.
- The current 10-per-day Paper hard cap, one-lot minimum, T+1, circuit breaker, idempotency and `REAL_TRADING_ENABLED=false` are non-negotiable.

## Verification

- [x] Add unit coverage for TTL single-flight behavior and failed-entry eviction.
- [x] Add client API coverage for aborted research requests.
- [x] Add focused server and web test runs.
- [x] Run the full test suite, production build and `git diff --check`.
- [x] Update current-state documentation with verified behavior.

## Final Verification

- Server Vitest: 60 files, 855 tests passed.
- Web Vitest: 31 files, 111 tests passed.
- TypeScript project build passed.
- Vite production build passed with 2,322 modules transformed.
- `git diff --check` passed.
- Local mock Paper API timing: repeated plan request improved from about 1.3 seconds to about 5 milliseconds within the 30-second research cache window.
- Browser smoke check: login, `/learning`, and `/market` rendered without captured page errors; the temporary local API used mock market data and no real trading.
