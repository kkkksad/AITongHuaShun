import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketQuote, MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { TurtleStrategy } from "./TurtleStrategy";

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

function createRun(snapshots: MarketSnapshot[], strategy = new TurtleStrategy(2, 1, 0, 0.5), config: Partial<BacktestConfig> = {}) {
  const contexts: StrategyContext[] = [];
  const signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, {
    name: strategy.name,
    reset: () => {
      strategy.reset();
      contexts.length = 0;
      signals.length = 0;
    },
    onBar(context) {
      contexts.push(context);
      const output = strategy.onBar(context);
      signals.push(output);
      return output;
    },
  }, {
    initialCapital: 10_000, maxOrderNotional: 1_000_000,
    maxPositionWeight: 1, maxDailyLoss: 1,
    commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0,
    ...config,
  });
  return { engine, contexts, signals };
}

function reordered(prices: number[]) {
  return history(prices.map((price, index) => {
    const a = { symbol: symbolA, price };
    const b = { symbol: symbolB, price: 100 + index };
    return index === 0 ? [a, b] : [b, a];
  }));
}

function decliningPair(bars: number, change?: "reorder" | "untradable") {
  return history(Array.from({ length: bars }, (_, index) => {
    const a = { symbol: symbolA, price: 1 - index * (0.2 / (bars - 1)),
      tradable: !(change === "untradable" && index === bars - 1) };
    const b = { symbol: symbolB, price: 12 - index * (2 / (bars - 1)) };
    return change === "reorder" && index === bars - 1 ? [b, a] : [a, b];
  }));
}

describe.each(["reorder", "untradable"] as const)("Turtle single-symbol channels after %s", (change) => {
  it.each(["small", "default"] as const)("does not buy another independently declining stock with %s parameters", (kind) => {
    const bars = kind === "small" ? 3 : 50;
    const run = (snapshots: MarketSnapshot[]) => createRun(snapshots,
      kind === "small" ? new TurtleStrategy(2, 1, 0, 0.5) : new TurtleStrategy(),
    ).engine.run();
    const report = run(decliningPair(bars, change));
    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
    expect(report).toEqual(run(decliningPair(bars)));
    for (const symbol of [symbolA, symbolB]) {
      const single = decliningPair(bars).map((snapshot) => ({
        ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbol),
      }));
      expect(run(single).orders).toEqual([]);
    }
  });
});

describe("Turtle bound-symbol warmup, channels and reset", () => {
  it("uses the bound stock for real entry and exit after reordering with the original target weights", () => {
    const { engine, signals } = createRun(reordered([10, 10, 11, 12, 9]), new TurtleStrategy(2, 1, 0, 0.42));
    const report = engine.run();
    expect(signals[2]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.42 }]);
    expect(signals[4]).toEqual([{ symbol: symbolA, side: "sell", type: "market", targetWeight: 1 }]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 300, price: 11, commission: 5, barIndex: 2 },
      { symbol: symbolA, side: "sell", quantity: 300, price: 9, commission: 5, barIndex: 4 },
    ]);
    expect(report.finalAccount.cash).toBe(9_390);
    expect(report.finalPositions).toEqual([]);
  });

  it("keeps the same bound stock's exit through the below-moving-average branch", () => {
    const { engine, signals } = createRun(reordered([10, 10, 11, 9]), new TurtleStrategy(2, 1, 3, 0.42));
    const report = engine.run();
    expect(signals.slice(0, 2)).toEqual([[], []]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 300, barIndex: 2 },
      { symbol: symbolA, side: "sell", quantity: 300, barIndex: 3 },
    ]);
    expect(report.finalAccount.cash).toBe(9_390);
  });

  it("does not add other prices or estimated highs and lows while the bound stock is unavailable", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 500 }],
      [{ symbol: symbolA, price: 1_000, tradable: false }, { symbol: symbolB, price: 0.1 }],
      [{ symbol: symbolB, price: 600 }, { symbol: symbolA, price: 10 }],
      [{ symbol: symbolB, price: 700 }, { symbol: symbolA, price: 11 }],
    ]);
    const { engine, signals } = createRun(snapshots);
    const report = engine.run();
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(report.orders).toHaveLength(1);
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 400, price: 11, barIndex: 4 }]);
  });

  it("preserves entry state while the bound holding is missing and exits only on its own resumed low", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 101 }],
      [{ symbol: symbolA, price: 11 }, { symbol: symbolB, price: 102 }],
      [{ symbol: symbolB, price: 1 }],
      [{ symbol: symbolA, price: 1_000, tradable: false }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 1 }, { symbol: symbolA, price: 12 }],
      [{ symbol: symbolB, price: 1 }, { symbol: symbolA, price: 9 }],
    ]);
    const { engine, signals, contexts } = createRun(snapshots);
    const report = engine.run();
    expect(contexts[3].positions).toMatchObject([{ symbol: symbolA, quantity: 400, availableQuantity: 400 }]);
    expect(signals.slice(3, 6)).toEqual([[], [], []]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 400, barIndex: 2 },
      { symbol: symbolA, side: "sell", quantity: 400, price: 9, barIndex: 6 },
    ]);
    expect(report.orders).toHaveLength(2);
    expect(report.finalAccount.cash).toBe(9_190);
  });

  it("waits to bind until the first tradable stock appears and counts only its complete prior observations", () => {
    const snapshots = history([
      [],
      [{ symbol: symbolA, price: 900, tradable: false }],
      [{ symbol: symbolA, price: 900, tradable: false }, { symbol: symbolB, price: 10 }],
      [{ symbol: symbolA, price: 1 }, { symbol: symbolB, price: 10 }],
      [{ symbol: symbolA, price: 2 }, { symbol: symbolB, price: 11 }],
    ]);
    const { engine, signals } = createRun(snapshots);
    const report = engine.run();
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(report.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 400, price: 11, barIndex: 4 }]);
  });

  it("retains the oldest high in the complete prior entry window after quote reordering", () => {
    const { engine, signals } = createRun(reordered([20, 10, 10, 15, 21]), new TurtleStrategy(3, 2, 0, 0.5));
    const report = engine.run();
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 200, price: 21, barIndex: 4 }]);
  });

  it("waits for all prior exit observations even when the bound price falls below the available lows earlier", () => {
    const { engine, signals } = createRun(reordered([10, 10, 11, 5, 12, 4]), new TurtleStrategy(2, 5, 0, 0.5));
    const report = engine.run();
    expect(signals.slice(3, 5)).toEqual([[], []]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 400, barIndex: 2 },
      { symbol: symbolA, side: "sell", quantity: 400, price: 4, barIndex: 5 },
    ]);
  });

  it("retains its symbol after an exit so the next breakout also belongs to the original stock", () => {
    const report = createRun(reordered([10, 10, 11, 9, 9, 10])).engine.run();
    expect(report.trades.map(({ symbol, side, barIndex }) => [symbol, side, barIndex]))
      .toEqual([[symbolA, "buy", 2], [symbolA, "sell", 3], [symbolA, "buy", 5]]);
  });

  it("resets binding, all three histories and entry state for reused engine and strategy runs", () => {
    const strategy = new TurtleStrategy(2, 1, 0, 0.5, "local Turtle symbol replay");
    const first = history([10, 10, 11].map((price) => [
      { symbol: symbolA, price }, { symbol: symbolB, price: 100 },
    ]));
    const { engine } = createRun(first, strategy);
    const report = engine.run();
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 400, barIndex: 2 }]);
    expect(engine.run()).toEqual(report);
    strategy.reset();
    const second = history([20, 20, 22].map((price) => [
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    const next = createRun(second, strategy).engine.run();
    expect(next.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 200, barIndex: 2 }]);
    expect(next).toEqual(createRun(second, new TurtleStrategy(2, 1, 0, 0.5, "local Turtle symbol replay")).engine.run());
  });

  it("preserves the entire stable multi-stock report compared with the same bound stock alone including costs", () => {
    const cycle = [10, 10, 11, 12, 9, 9, 10, 11];
    const multi = history(Array.from({ length: 24 }, (_, index) => [
      { symbol: symbolA, price: cycle[index % cycle.length] },
      { symbol: symbolB, price: 100 + index },
    ]));
    const single = multi.map((snapshot) => ({
      ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbolA),
    }));
    const config = { slippageBps: 10 };
    const report = createRun(multi, new TurtleStrategy(2, 1, 0, 0.5), config).engine.run();
    expect(report.trades.length).toBeGreaterThan(2);
    expect(report.metrics.totalCommission).toBeGreaterThan(0);
    expect(report).toEqual(createRun(single, new TurtleStrategy(2, 1, 0, 0.5), config).engine.run());
  });
});
