# Weekly Paper Capital Efficiency Upgrade

**Date:** 2026-08-29
**Status:** Completed

## Goal

Improve the use of a 100,000 CNY Paper account when evidence-backed validation signals are present. The change targets the observed failure mode where `qualified-probe` and `validation-basket` entries were always reduced to the minimum fee-efficient lot, while keeping the strategy gate and all execution controls intact.

## Findings

- The weekly Paper review now separates filled buys, filled sells, closed FIFO batches, cash deployment, average order size, realized PnL, fees, strategy usage and blockers.
- The small validation orders were caused by a fixed `minimumFeeEfficientQuantity` branch, not by a missing account balance.
- The production environment template still caps each order at `MAX_ORDER_NOTIONAL=2500`. A persisted 100,000 CNY Paper account will therefore remain limited to 2.5% per order unless the operator explicitly changes and redeploys that production setting.
- Local strategy usage was previously consumed before the candidate pool's final ranking. A lower-ranked candidate could take the primary strategy slot before the strongest candidate was selected.
- Increasing order size cannot establish a higher win rate. Signal quality must remain gated by market regime, historical persistence, liquidity, anti-chasing checks, fee discipline and PaperBroker risk checks.

## Implementation

- Add bounded validation budgets as a percentage of the already capped single-order notional.
- Scale the budget between a floor and ceiling using both the candidate score and the selected strategy score.
- Keep `kairosQualifiedProbe` at a higher validation budget tier than `kairosValidationBasket` because the latter is a fallback sample-collection route.
- Reuse one candidate quantity function for sorting, affordability diagnostics and final Paper plans so the displayed candidate count matches executable sizing.
- Rank the top candidate pool before applying plan-local strategy usage, so the strongest candidate receives the best eligible strategy and close-scoring later candidates still rotate across strategies.
- Increment plan-local strategy usage only after an executable buy plan is created. Existing positions and candidates blocked by sizing, persistence, fees or profile limits do not consume the primary strategy slot.
- Report closed FIFO win rate for each strategy in the weekly review, with `null`/sample-insufficient output when that strategy has no closed trades.
- Preserve the minimum round-trip fee-efficiency check, cash reserve, lot size, max position weight, phase pacing, T+1, circuit breaker, idempotency, daily hard cap and Paper-only execution boundary.

## Verification

- [x] Add regression coverage for weak, medium and strong qualified-probe sizing.
- [x] Add regression coverage for non-minimum but bounded validation-basket sizing.
- [x] Add regression coverage for post-ranking strategy assignment and within-plan strategy rotation.
- [x] Add regression coverage proving an existing position cannot consume the primary strategy slot.
- [x] Verify the weekly endpoint, shared query, cancellation signal and research-page evidence fields.
- [x] Verify the existing small-order fee blocker still blocks uneconomic orders.
- [x] Run the full server/web test suites (61 server files / 863 tests and 31 web files / 112 tests), production build and diff checks.
- [ ] Observe the next live-read-only Paper session before judging capital deployment or win rate.

## Follow-up

The next session should compare planned versus filled notional, realized FIFO outcomes and per-strategy results. Before changing production sizing, reconcile the persisted account's actual initial capital with the independently configured 2,500 CNY per-order cap and choose an explicit risk budget. The activity target remains a research pacing aid, not a promise of fills or profit; no result should be promoted to a success-rate claim without an independent out-of-sample sample.
