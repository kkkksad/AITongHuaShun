import { describe, expect, it } from "vitest";
import { calculateMaxDrawdown, runBacktest } from "./backtest";

const parameters = {
  lookback: 20,
  entryThreshold: 1.4,
  stopLoss: 6,
  takeProfit: 15,
  maxPosition: 35,
  rebalanceDays: 5,
};

describe("calculateMaxDrawdown", () => {
  it("returns the largest peak-to-trough decline", () => {
    expect(calculateMaxDrawdown([100, 120, 90, 108])).toBeCloseTo(0.25);
  });

  it("returns zero for an empty series", () => {
    expect(calculateMaxDrawdown([])).toBe(0);
  });
});

describe("runBacktest", () => {
  it("is deterministic for identical strategy inputs", () => {
    expect(runBacktest("momentum", parameters)).toEqual(runBacktest("momentum", parameters));
  });

  it("returns a complete metric and equity result", () => {
    const result = runBacktest("multi-factor", parameters);

    expect(result.equityCurve).toHaveLength(90);
    expect(result.metrics.tradeCount).toBeGreaterThan(0);
    expect(Number.isFinite(result.metrics.sharpe)).toBe(true);
    expect(result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
  });
});
