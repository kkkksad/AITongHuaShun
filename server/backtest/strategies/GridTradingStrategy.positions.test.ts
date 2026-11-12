import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { GridTradingStrategy } from "./GridTradingStrategy";

const symbol = "600001", other = "600002";

function history(rows: Array<[string, number, boolean?]>): MarketSnapshot[] {
  return rows.map(([time, price, tradable = true], index) => ({
    mode: "paper", sequence: index + 1, marketTime: time,
    quotes: [
      { symbol, name: symbol, price, previousClose: price, changePercent: 0,
        volume: 1_000_000, tradable, updatedAt: time },
      { symbol: other, name: other, price: 10, previousClose: 10, changePercent: 0,
        volume: 1_000_000, tradable: true, updatedAt: time },
    ],
  }));
}

function daily(prices: number[]): MarketSnapshot[] {
  return history(prices.map((price, index) => [new Date(Date.UTC(2026, 10, index + 2, 6)).toISOString(), price]));
}

function createRun(snapshots: MarketSnapshot[], input: {
  strategy?: GridTradingStrategy; perGrid?: number; seeds?: Record<number, StrategySignal[]>;
  config?: Partial<BacktestConfig>;
} = {}) {
  const strategy = input.strategy ?? new GridTradingStrategy(3, 10, input.perGrid ?? 100);
  const signals: StrategySignal[][] = [], contexts: StrategyContext[] = [];
  const engine = new BacktestEngine(snapshots, {
    name: strategy.name,
    reset() { strategy.reset(); signals.length = 0; contexts.length = 0; },
    onStart: context => strategy.onStart(context),
    onBar(context) {
      contexts.push(context);
      const output = strategy.onBar(context); signals.push(output);
      return [...input.seeds?.[context.barIndex] ?? [], ...output];
    },
  }, { initialCapital: 100_000, maxOrderNotional: 1_000_000, maxPositionWeight: 1,
    maxDailyLoss: 1, commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0, ...input.config });
  return { engine, signals, contexts };
}

const buy = (quantity: number, code = symbol): StrategySignal => ({ symbol: code, side: "buy", type: "market", quantity });
const sell = (quantity: number): StrategySignal => ({ symbol, side: "sell", type: "market", quantity });

describe("Grid crossing sells use actual currently sellable holdings", () => {
  it("does not create short-sale intents on an initial rally with no holdings", () => {
    const { engine, signals } = createRun(daily([100, 121, 133.1]));
    const report = engine.run();
    expect(signals).toEqual([[], [], []]);
    expect(report.orders).toEqual([]);
    expect(report.finalAccount.cash).toBe(100_000);
  });

  it("does not borrow another stock's settled holdings to sell the bound stock", () => {
    const { engine, signals } = createRun(daily([100, 133.1]), { seeds: { 0: [buy(500, other)] } });
    const report = engine.run();
    expect(signals).toEqual([[], []]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol: other, quantity: 500 }]);
  });

  it("does not treat a rejected grid buy as actual inventory on the rebound", () => {
    const { engine, signals } = createRun(daily([100, 81, 100]), { config: { maxOrderNotional: 1_000 } });
    const report = engine.run();
    expect(signals[1]).toEqual([buy(100), buy(100)]);
    expect(signals[2]).toEqual([]);
    expect(report.orders).toHaveLength(2);
    expect(report.orders.every(order => order.side === "buy" && order.status === "rejected")).toBe(true);
    expect(report.trades).toEqual([]);
  });

  it("caps the whole multi-level batch to actual settled shares", () => {
    const { engine, signals } = createRun(daily([100, 133.1]), { seeds: { 0: [buy(100)] } });
    const report = engine.run();
    expect(signals[1]).toEqual([sell(100)]);
    expect(report.orders.every(order => order.status === "filled")).toBe(true);
    expect(report.trades.map(trade => [trade.side, trade.quantity])).toEqual([["buy", 100], ["sell", 100]]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(103_300);
    expect(report.metrics.totalCommission).toBe(10);
  });

  it("uses the configured per-grid quantity without inventing a fractional grid", () => {
    const { engine, signals } = createRun(daily([100, 133.1]), { perGrid: 200, seeds: { 0: [buy(300)] } });
    const report = engine.run();
    expect(signals[1]).toEqual([sell(200)]);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 100 }]);
    expect(report.orders.every(order => order.status === "filled")).toBe(true);
  });

  it("allows two whole configured grids from five settled lots and reserves them cumulatively", () => {
    const { engine, signals } = createRun(daily([100, 133.1]), { perGrid: 200, seeds: { 0: [buy(500)] } });
    const report = engine.run();
    expect(signals[1]).toEqual([sell(200), sell(200)]);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 100 }]);
    expect(report.orders).toHaveLength(3);
    expect(report.orders.every(order => order.status === "filled")).toBe(true);
  });

  it("does not send a smaller arbitrary order when no complete configured grid is sellable", () => {
    const { engine, signals } = createRun(daily([100, 133.1]), { perGrid: 200, seeds: { 0: [buy(100)] } });
    const report = engine.run();
    expect(signals[1]).toEqual([]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 100 }]);
  });

  it("does not sell locked T+1 shares after a same-day rally", () => {
    const snapshots = history([["2026-11-02T01:30:00Z", 100], ["2026-11-02T02:00:00Z", 133.1]]);
    const { engine, signals, contexts } = createRun(snapshots, { seeds: { 0: [buy(300)] } });
    const report = engine.run();
    expect(contexts[1].positions).toMatchObject([{ symbol, quantity: 300, availableQuantity: 0 }]);
    expect(signals[1]).toEqual([]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 300 }]);
  });

  it("sells only settled shares when the rest of the actual holding was acquired today", () => {
    const snapshots = history([["2026-11-02T06:00:00Z", 100], ["2026-11-03T01:30:00Z", 100], ["2026-11-03T02:00:00Z", 133.1]]);
    const { engine, signals, contexts } = createRun(snapshots, { seeds: { 0: [buy(100)], 1: [buy(200)] } });
    const report = engine.run();
    expect(contexts[2].positions).toMatchObject([{ symbol, quantity: 300, availableQuantity: 100 }]);
    expect(signals[2]).toEqual([sell(100)]);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 200, availableQuantity: 0 }]);
    expect(report.orders.every(order => order.status === "filled")).toBe(true);
  });

  it("keeps price crossings as events: an unavailable sell is not retried at the same level after settlement", () => {
    const snapshots = history([["2026-11-02T01:30:00Z", 100], ["2026-11-02T02:00:00Z", 110],
      ["2026-11-03T01:30:00Z", 110], ["2026-11-03T02:00:00Z", 121]]);
    const { engine, signals } = createRun(snapshots, { seeds: { 0: [buy(100)] } });
    const report = engine.run();
    expect(signals).toEqual([[], [], [], [sell(100)]]);
    expect(report.trades.map(trade => [trade.side, trade.barIndex])).toEqual([["buy", 0], ["sell", 3]]);
  });

  it("does not keep fictitious inventory after an observed complete liquidation", () => {
    const { engine, signals } = createRun(daily([100, 110, 100, 121]), { seeds: { 0: [buy(100)] } });
    const report = engine.run();
    expect(signals).toEqual([[], [sell(100)], [buy(100)], [sell(100)]]);
    expect(report.orders.every(order => order.status === "filled")).toBe(true);
    expect(report.finalPositions).toEqual([]);
  });

  it("does not move the crossing on an unavailable bound quote, then caps the resumed crossing", () => {
    const snapshots = daily([100, 133.1, 133.1]);
    snapshots[1].quotes[0].tradable = false;
    snapshots[2].quotes.reverse();
    const { engine, signals } = createRun(snapshots, { seeds: { 0: [buy(100)] } });
    const report = engine.run();
    expect(signals).toEqual([[], [], [sell(100)]]);
    expect(report.orders).toHaveLength(2);
  });

  it("preserves every crossing when actual sellable inventory covers it", () => {
    const { engine, signals } = createRun(daily([100, 81, 100]));
    const report = engine.run();
    expect(signals).toEqual([[], [buy(100), buy(100)], [sell(100), sell(100)]]);
    expect(report.finalAccount.cash).toBe(103_780);
    expect(report.metrics.totalCommission).toBe(20);
    expect(report.orders.every(order => order.status === "filled")).toBe(true);
  });

  it("resets observed levels and relies on the new run's holdings when reusing the same strategy", () => {
    const strategy = new GridTradingStrategy(3, 10, 100);
    const run = createRun(daily([100, 81, 100]), { strategy });
    const first = run.engine.run();
    expect(run.engine.run()).toEqual(first);
    const empty = createRun(daily([100, 121]), { strategy });
    expect(empty.engine.run().orders).toEqual([]);
    expect(empty.signals).toEqual([[], []]);
  });
});
