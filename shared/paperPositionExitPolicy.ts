/** Shared parameters of the current Paper plan, not strategy backtest defaults. */
export const PAPER_POSITION_EXIT_POLICY = Object.freeze({
  stopPriceMultiplier: 0.97,
  trendDeteriorationConfidence: 0.65,
  ordinaryReductionFraction: 0.5,
});
