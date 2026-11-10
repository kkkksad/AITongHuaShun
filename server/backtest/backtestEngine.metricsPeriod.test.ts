import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "./backtestEngine";

function holdEngine(prices: number[], minimumCommission = 0, enter = true) {
  const snapshots: MarketSnapshot[] = prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2024, 0, index + 2, 7)).toISOString();
    return {
      mode: "paper", sequence: index + 1, marketTime,
      quotes: [{ symbol: "600001", name: "period fixture", price, tradable: true,
        previousClose: prices[Math.max(0, index - 1)], changePercent: 0,
        volume: 1_000_000, updatedAt: marketTime }],
    };
  });
  return new BacktestEngine(snapshots, {
    name: "period buy and hold",
    onBar: ({ barIndex }) => enter && barIndex === 0
      ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }]
      : [],
  }, {
    initialCapital: 1_000 + minimumCommission,
    maxOrderNotional: 2_000, maxPositionWeight: 1, maxDailyLoss: 1,
    minimumCommission, commissionRate: 0, slippageBps: 0,
  });
}

describe("BacktestEngine replay period metrics", () => {
  it.each([2, 5, 252])("counts %i replay bars without counting the initial capital point", (count) => {
    const prices = Array.from({ length: count }, (_, index) => index === count - 1 ? 11 : 10);
    const report = holdEngine(prices).run();

    expect(report.metrics.barCount).toBe(count);
    expect(report.equityCurve).toHaveLength(count + 1);
    expect(report.equityCurve[0]).toMatchObject({ equity: 1_000, cumulativeReturn: 0 });
    expect(report.metrics.totalReturn).toBeCloseTo(0.1, 14);
    expect(report.metrics.annualizedReturn).toBeCloseTo(1.1 ** (252 / count) - 1, 12);
    expect(report.trades).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ quantity: 100, currentPrice: 11 }]);
  });

  it("annualizes a 252-bar ten-percent gain as ten percent and uses that period for ratios", () => {
    const report = holdEngine([...Array<number>(251).fill(10), 11]).run();
    // There are 252 returns: 251 zeros and one +10%, including the first replay bar.
    const volatility = 0.1 * Math.sqrt(251 / 252);
    expect(report.metrics.annualizedReturn).toBeCloseTo(0.1, 14);
    expect(report.metrics.annualizedVolatility).toBeCloseTo(volatility, 14);
    expect(report.metrics.sharpeRatio).toBeCloseTo(0.1 / volatility, 14);
    expect(report.metrics.calmarRatio).toBeCloseTo(10, 12);
    expect(report.metrics.sortinoRatio).toBe(0);
    expect(report.metrics.maxDrawdown).toBe(0);
  });

  it("keeps the initial fee loss in the curve, volatility, drawdown and downside denominator", () => {
    const engine = holdEngine([10, 11], 5);
    const report = engine.run();
    // Invest 1000, pay 5 at the first bar, then mark the 100 shares at 11.
    const firstReturn = -5 / 1_005;
    const secondReturn = 100 / 1_000;
    const volatility = Math.abs(secondReturn - firstReturn) / 2 * Math.sqrt(252);
    const downside = Math.abs(firstReturn) / Math.sqrt(2) * Math.sqrt(252);
    const annualized = (1_100 / 1_005) ** 126 - 1;

    expect(report.equityCurve.map(point => point.equity)).toEqual([1_005, 1_000, 1_100]);
    expect(report.metrics.totalCommission).toBe(5);
    expect(report.metrics.totalReturn).toBeCloseTo(95 / 1_005, 14);
    expect(report.metrics.barCount).toBe(2);
    expect(report.metrics.annualizedReturn).toBeCloseTo(annualized, 8);
    expect(report.metrics.annualizedVolatility).toBeCloseTo(volatility, 14);
    expect(report.metrics.maxDrawdown).toBe(5);
    expect(report.metrics.maxDrawdownPercent).toBeCloseTo(5 / 1_005, 14);
    expect(report.metrics.sharpeRatio).toBeCloseTo(annualized / volatility, 8);
    expect(report.metrics.sortinoRatio).toBeCloseTo(annualized / downside, 6);
    expect(report.metrics.calmarRatio).toBeCloseTo(annualized / (5 / 1_005), 5);
    expect(engine.run()).toEqual(report);
  });

  it("reports actual bars for a no-trade run without creating a return or risk sample", () => {
    const report = holdEngine([10, 9, 11, 10, 12], 0, false).run();
    expect(report.metrics).toMatchObject({
      barCount: 5, totalReturn: 0, annualizedReturn: 0, annualizedVolatility: 0,
      sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, maxDrawdown: 0,
      totalTrades: 0, totalCommission: 0,
    });
    expect(report.orders).toEqual([]);
    expect(report.equityCurve.map(point => point.equity)).toEqual(Array(6).fill(1_000));
  });
});
