import { afterEach, describe, expect, it, vi } from "vitest";
import type { BacktestStrategy, StrategyContext } from "../../shared/backtest";
import type { MarketSnapshot } from "../../shared/trading";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { BacktestEngine } from "./backtestEngine";

function engine(prices: number[], onBar: BacktestStrategy["onBar"]) {
  const snapshots: MarketSnapshot[] = prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, index + 2, 7)).toISOString();
    return { mode: "paper", sequence: index + 1, marketTime, quotes: [{
      symbol: "600001", name: "account read fixture", tradable: true, price,
      previousClose: prices[Math.max(0, index - 1)], changePercent: 0,
      volume: 1_000_000, updatedAt: marketTime,
    }] };
  });
  return new BacktestEngine(snapshots, { name: "same-bar account reads", onBar }, {
    initialCapital: 10_000, maxOrderNotional: 10_000, maxPositionWeight: 1, maxDailyLoss: 1,
    commissionRate: 0, minimumCommission: 5, slippageBps: 0,
  });
}
afterEach(() => vi.restoreAllMocks());

describe("BacktestEngine same-bar account reuse", () => {
  it("reads the ledger once per idle bar plus the initial and final report snapshots", () => {
    const contexts: StrategyContext[] = [], prices = [10, 11, 9, 12, 10];
    const reads = vi.spyOn(InMemoryTradingStore.prototype, "getAccount");
    const runner = engine(prices, value => { contexts.push(value); return []; });
    const report = runner.run();
    expect(reads.mock.calls.length).toBeLessThanOrEqual(prices.length + 2);
    expect(contexts.map(context => context.snapshot.quotes[0].price)).toEqual(prices);
    expect(contexts.map(context => context.account.updatedAt)).toEqual(contexts.map(context => context.snapshot.marketTime));
    expect(contexts.every(context => context.cash === 10_000 && context.equity === 10_000)).toBe(true);
    expect(report.equityCurve.map(point => point.equity)).toEqual(Array(6).fill(10_000));
    expect(report.orders).toEqual([]);
    expect(runner.run()).toEqual(report);
  });

  it("keeps pending fee reservations and fills visible before an empty-signal callback", () => {
    const contexts: StrategyContext[] = [];
    const report = engine([11, 11, 10], context => {
      contexts.push(context);
      return context.barIndex === 0
        ? [{ symbol: "600001", side: "buy", type: "limit", quantity: 100, limitPrice: 10 }]
        : [];
    }).run();
    expect(contexts.map(context => context.cash)).toEqual([10_000, 8_995, 8_995]);
    expect(contexts[1].positions).toEqual([]);
    expect(contexts[2].positions).toMatchObject([{ quantity: 100, availableQuantity: 0 }]);
    expect(contexts[2].equity).toBe(9_995);
    expect(report.equityCurve.map(point => point.equity)).toEqual([10_000, 10_000, 10_000, 9_995]);
    expect(report.trades).toMatchObject([{ side: "buy", type: "limit", barIndex: 2, commission: 5 }]);
    expect(report.finalAccount).toMatchObject({ cash: 8_995, equity: 9_995 });
  });

  it("rereads after emitted market signals and preserves both sides' fees", () => {
    const report = engine([10, 11, 11], ({ barIndex }) => barIndex < 2
      ? [{ symbol: "600001", side: barIndex === 0 ? "buy" : "sell", type: "market", quantity: 100 }]
      : []).run();
    expect(report.equityCurve.map(point => point.equity)).toEqual([10_000, 9_995, 10_090, 10_090]);
    expect(report.trades.map(trade => [trade.side, trade.commission])).toEqual([["buy", 5], ["sell", 5]]);
    expect(report.finalAccount).toMatchObject({ cash: 10_090, equity: 10_090 });
    expect(report.finalPositions).toEqual([]);
  });

  it("does not reuse a callback's edited account or quotes on empty and failed callbacks", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const expected = engine([10, 11, 12], () => []).run();
    const report = engine([10, 11, 12], context => {
      context.account.cash = 0;
      context.account.equity = 0;
      context.snapshot.quotes[0].price = 100_000;
      if (context.account.tradingDayPerformance) context.account.tradingDayPerformance.openingEquity = 1;
      if (context.barIndex === 1) throw new Error("controlled empty callback failure");
      return [];
    }).run();
    expect(report).toEqual(expected);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
