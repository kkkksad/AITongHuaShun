import { describe, expect, it } from "vitest";
import type { StrategyContext } from "../../shared/backtest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "./backtestEngine";

function snapshots(price: number): MarketSnapshot[] {
  return [0, 1, 2].map((index) => {
    const marketTime = new Date(Date.UTC(2026, 10, index + 2, 6)).toISOString();
    return {
      mode: "paper", sequence: index + 1, marketTime,
      quotes: [{ symbol: "600001", name: "execution-cost fixture", tradable: true, price,
        previousClose: price, changePercent: 0, volume: 1_000_000, updatedAt: marketTime }],
    };
  });
}

describe("BacktestEngine complete pending costs", () => {
  it("uses Broker available cash consistently in contexts, curves and the final report", () => {
    const contexts: StrategyContext[] = [];
    let startCash: number | undefined;
    let endCash: number | undefined;
    const engine = new BacktestEngine(snapshots(11), {
      name: "pending-cost consistency",
      onStart: (context) => { startCash = context.cash; },
      onEnd: (context) => { endCash = context.cash; },
      onBar: (context) => {
        contexts.push(context);
        return context.barIndex === 0
          ? [{ symbol: "600001", side: "buy", type: "limit", quantity: 100, limitPrice: 10 }]
          : [];
      },
    }, { initialCapital: 1_005, maxPositionWeight: 1, minimumCommission: 5, slippageBps: 0 });
    const report = engine.run();

    expect(startCash).toBe(1_005);
    expect(contexts.map(({ cash, account }) => [cash, account.cash])).toEqual([[1_005, 1_005], [0, 0], [0, 0]]);
    expect(report.equityCurve.map(({ cash }) => cash)).toEqual([1_005, 0, 0, 0]);
    expect(endCash).toBe(0);
    expect(report.finalAccount).toMatchObject({ cash: 0, equity: 1_005 });
    expect(report.orders).toMatchObject([{ status: "pending" }]);
    expect(report.trades).toEqual([]);
    expect(engine.run()).toEqual(report);
  });

  it("records an unaffordable market signal as rejected without a trade or equity loss", () => {
    const report = new BacktestEngine(snapshots(10), {
      name: "principal-only rejection",
      onBar: ({ barIndex }) => barIndex === 0
        ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }]
        : [],
    }, { initialCapital: 1_000, maxPositionWeight: 1, minimumCommission: 5, slippageBps: 0 }).run();

    expect(report.orders).toMatchObject([{ status: "rejected", rejectionReason: "可用资金不足" }]);
    expect(report.trades).toEqual([]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount).toMatchObject({ cash: 1_000, equity: 1_000 });
    expect(report.metrics.totalCommission).toBe(0);
  });
});
