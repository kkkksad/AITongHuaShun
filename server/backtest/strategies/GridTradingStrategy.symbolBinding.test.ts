import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketQuote, MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { GridTradingStrategy } from "./GridTradingStrategy";

const symbolA = "600001";
const symbolB = "600002";
type QuoteInput = Pick<MarketQuote, "symbol" | "price"> & { tradable?: boolean };

function history(rows: QuoteInput[][]): MarketSnapshot[] {
  return rows.map((quotes, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, index + 2, 6)).toISOString();
    return {
      mode: "paper", sequence: index + 1, marketTime,
      quotes: quotes.map((quote) => ({
        name: quote.symbol, previousClose: quote.price, changePercent: 0,
        volume: 1_000_000, updatedAt: marketTime, tradable: true, ...quote,
      })),
    };
  });
}

function createRun(snapshots: MarketSnapshot[], input: {
  strategy?: GridTradingStrategy;
  seed?: StrategySignal;
  config?: Partial<BacktestConfig>;
} = {}) {
  const strategy = input.strategy ?? new GridTradingStrategy();
  const contexts: StrategyContext[] = [];
  const signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, {
    name: strategy.name,
    reset: () => {
      strategy.reset();
      contexts.length = 0;
      signals.length = 0;
    },
    onStart: (context) => strategy.onStart(context),
    onBar(context) {
      contexts.push(context);
      const output = strategy.onBar(context);
      signals.push(output);
      // Acquire any control holding through the real Broker separately from
      // Grid's own signals, so later sell assertions use actual settled shares.
      return context.barIndex === 0 && input.seed ? [input.seed, ...output] : output;
    },
  }, {
    initialCapital: 100_000, maxOrderNotional: 1_000_000,
    maxPositionWeight: 1, maxDailyLoss: 1,
    commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0,
    ...input.config,
  });
  return { engine, contexts, signals };
}

function reordered(prices: number[]) {
  return history(prices.map((price, index) => {
    const a = { symbol: symbolA, price };
    const b = { symbol: symbolB, price: 1_000 + index };
    return index === 0 ? [a, b] : [b, a];
  }));
}

function constantPair(aPrice: number, bPrice: number, change?: "reorder" | "untradable" | "missing") {
  return history([0, 1].map((index) => {
    const a = { symbol: symbolA, price: aPrice, tradable: !(change === "untradable" && index === 1) };
    const b = { symbol: symbolB, price: bPrice };
    if (index === 1 && change === "missing") return [b];
    return index === 1 && change === "reorder" ? [b, a] : [a, b];
  }));
}

describe.each(["reorder", "untradable", "missing"] as const)("Grid base-symbol binding after %s", (change) => {
  it("does not buy a different constant-price stock against the original stock's higher base", () => {
    const run = (snapshots: MarketSnapshot[]) => createRun(snapshots).engine.run();
    const report = run(constantPair(100, 10, change));
    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalAccount.cash).toBe(100_000);
    expect(report).toEqual(run(constantPair(100, 10)));
    for (const symbol of [symbolA, symbolB]) {
      const single = constantPair(100, 10).map((snapshot) => ({
        ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbol),
      }));
      expect(run(single).orders).toEqual([]);
    }
  });

  it("does not sell an actual holding of another constant-price stock against the original stock's lower base", () => {
    const run = (snapshots: MarketSnapshot[]) => createRun(snapshots, {
      seed: { symbol: symbolB, side: "buy", type: "market", quantity: 500 },
    }).engine.run();
    const report = run(constantPair(10, 100, change));
    expect(report.orders).toHaveLength(1);
    expect(report.trades).toMatchObject([
      { symbol: symbolB, side: "buy", quantity: 500, price: 100, commission: 15, barIndex: 0 },
    ]);
    expect(report.finalPositions).toMatchObject([{ symbol: symbolB, quantity: 500 }]);
    expect(report.finalAccount.cash).toBe(49_985);
    expect(report).toEqual(run(constantPair(10, 100)));
  });
});

describe("Grid initialization, levels and reset stay with one stock", () => {
  it("preserves multiple real buys and sells for the bound stock and configured lots per grid", () => {
    const { engine, signals } = createRun(reordered([100, 81, 100]), {
      strategy: new GridTradingStrategy(3, 10, 200),
    });
    const report = engine.run();
    expect(signals).toEqual([
      [],
      Array.from({ length: 2 }, () => ({ symbol: symbolA, side: "buy", type: "market", quantity: 200 })),
      Array.from({ length: 2 }, () => ({ symbol: symbolA, side: "sell", type: "market", quantity: 200 })),
    ]);
    expect(report.trades.map(({ symbol, side, quantity, barIndex }) => [symbol, side, quantity, barIndex]))
      .toEqual([[symbolA, "buy", 200, 1], [symbolA, "buy", 200, 1], [symbolA, "sell", 200, 2], [symbolA, "sell", 200, 2]]);
    expect(report.orders.every((order) => order.status === "filled")).toBe(true);
    expect(report.finalAccount.cash).toBe(107_578);
    expect(report.metrics.totalCommission).toBe(22);
    expect(report.finalPositions).toEqual([]);
  });

  it("waits through missing and untradable quotes and resumes the original base and levels", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 100 }, { symbol: symbolB, price: 10 }],
      [{ symbol: symbolB, price: 1 }],
      [{ symbol: symbolA, price: 1, tradable: false }, { symbol: symbolB, price: 1_000 }],
      [{ symbol: symbolB, price: 1 }, { symbol: symbolA, price: 81 }],
      [{ symbol: symbolB, price: 1 }, { symbol: symbolA, price: 100 }],
    ]);
    const { engine, signals } = createRun(snapshots, { strategy: new GridTradingStrategy(3, 10, 200) });
    const report = engine.run();
    expect(signals.slice(0, 3)).toEqual([[], [], []]);
    expect(report.trades.map(({ symbol, side, barIndex }) => [symbol, side, barIndex]))
      .toEqual([[symbolA, "buy", 3], [symbolA, "buy", 3], [symbolA, "sell", 4], [symbolA, "sell", 4]]);
    expect(report.finalAccount.cash).toBe(107_578);
  });

  it("keeps held shares and the last grid level through unavailable quotes without duplicate entries on return", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 100 }, { symbol: symbolB, price: 10 }],
      [{ symbol: symbolA, price: 81 }, { symbol: symbolB, price: 10 }],
      [{ symbol: symbolB, price: 1_000 }],
      [{ symbol: symbolA, price: 1, tradable: false }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 1 }, { symbol: symbolA, price: 81 }],
      [{ symbol: symbolB, price: 1 }, { symbol: symbolA, price: 100 }],
    ]);
    const { engine, signals, contexts } = createRun(snapshots, { strategy: new GridTradingStrategy(3, 10, 200) });
    const report = engine.run();
    expect(contexts[2].positions).toMatchObject([{ symbol: symbolA, quantity: 400, availableQuantity: 400 }]);
    expect(signals.slice(2, 5)).toEqual([[], [], []]);
    expect(report.trades.map(({ symbol, side, barIndex }) => [symbol, side, barIndex]))
      .toEqual([[symbolA, "buy", 1], [symbolA, "buy", 1], [symbolA, "sell", 5], [symbolA, "sell", 5]]);
    expect(report.finalAccount.cash).toBe(107_578);
  });

  it("binds the same first tradable quote that supplied the initial base even when earlier quotes become tradable", () => {
    const snapshots = history([100, 81, 100].map((price, index) => [
      { symbol: symbolA, price: index === 0 ? 900 : index, tradable: index !== 0 },
      { symbol: symbolB, price },
    ]));
    const report = createRun(snapshots, { strategy: new GridTradingStrategy(3, 10, 200) }).engine.run();
    expect(report.trades.map(({ symbol, side }) => [symbol, side]))
      .toEqual([[symbolB, "buy"], [symbolB, "buy"], [symbolB, "sell"], [symbolB, "sell"]]);
    expect(report.finalAccount.cash).toBe(107_578);
  });

  it.each(["empty", "untradable"] as const)("keeps the original disabled lifecycle after an initially %s snapshot", (kind) => {
    const snapshots = history([
      kind === "empty" ? [] : [{ symbol: symbolA, price: 100, tradable: false }],
      [{ symbol: symbolA, price: 81 }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolA, price: 100 }, { symbol: symbolB, price: 1_000 }],
    ]);
    const { engine, signals } = createRun(snapshots);
    const report = engine.run();
    expect(signals).toEqual([[], [], []]);
    expect(report.orders).toEqual([]);
    expect(report.finalAccount.cash).toBe(100_000);
  });

  it("clears binding, base and both grid levels for repeated engines and a new first stock", () => {
    const strategy = new GridTradingStrategy(3, 10, 200, "local Grid symbol replay");
    const first = history([100, 81].map((price) => [
      { symbol: symbolA, price }, { symbol: symbolB, price: 1_000 },
    ]));
    const { engine } = createRun(first, { strategy });
    const report = engine.run();
    expect(report.trades).toHaveLength(2);
    expect(report.trades.every((trade) => trade.symbol === symbolA && trade.side === "buy")).toBe(true);
    expect(engine.run()).toEqual(report);
    strategy.reset();
    const second = history([10, 8.1, 10].map((price) => [
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    const next = createRun(second, { strategy }).engine.run();
    expect(next.trades.map(({ symbol, side }) => [symbol, side]))
      .toEqual([[symbolB, "buy"], [symbolB, "buy"], [symbolB, "sell"], [symbolB, "sell"]]);
    expect(next).toEqual(createRun(second, { strategy: new GridTradingStrategy(3, 10, 200, "local Grid symbol replay") }).engine.run());
  });

  it("preserves the complete stable multi-stock report compared with the same bound stock alone including costs", () => {
    const cycle = [100, 81, 100, 110, 90, 100];
    const multi = history(Array.from({ length: 24 }, (_, index) => [
      { symbol: symbolA, price: cycle[index % cycle.length] },
      { symbol: symbolB, price: 1_000 + index },
    ]));
    const single = multi.map((snapshot) => ({
      ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbolA),
    }));
    const input = { config: { slippageBps: 10 } };
    const report = createRun(multi, { ...input, strategy: new GridTradingStrategy(3, 10, 200) }).engine.run();
    expect(report.trades.length).toBeGreaterThan(2);
    expect(report.metrics.totalCommission).toBeGreaterThan(0);
    expect(report).toEqual(createRun(single, { ...input, strategy: new GridTradingStrategy(3, 10, 200) }).engine.run());
  });
});
