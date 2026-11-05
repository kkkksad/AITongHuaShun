import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketQuote, MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { MomentumStrategy } from "./MomentumStrategy";

const symbolA = "600001";
const symbolB = "600002";
type QuoteInput = Pick<MarketQuote, "symbol" | "price"> & { tradable?: boolean };

function history(rows: QuoteInput[][], days = rows.map((_, index) => index + 2)): MarketSnapshot[] {
  return rows.map((quotes, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
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
  strategy?: MomentumStrategy;
  seed?: StrategySignal;
  config?: Partial<BacktestConfig>;
} = {}) {
  const strategy = input.strategy ?? new MomentumStrategy(2, 1, 0.5);
  const signals: StrategySignal[][] = [];
  const contexts: StrategyContext[] = [];
  const engine = new BacktestEngine(snapshots, {
    name: strategy.name,
    reset() {
      strategy.reset();
      signals.length = 0;
      contexts.length = 0;
    },
    onBar(context) {
      contexts.push(context);
      const output = strategy.onBar(context);
      signals.push(output);
      // Acquire fixture holdings through the actual broker, independently of
      // this strategy's signals. Intentions alone must never create holdings.
      return context.barIndex === 0 && input.seed ? [input.seed, ...output] : output;
    },
  }, {
    initialCapital: 10_000, maxOrderNotional: 1_000_000,
    maxPositionWeight: 1, maxDailyLoss: 1,
    commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0,
    ...input.config,
  });
  return { engine, signals, contexts };
}

const channelCases = [
  { label: "small 2/1 channel", bars: 3, strategy: () => new MomentumStrategy(2, 1) },
  { label: "default 20/10 channel", bars: 21, strategy: () => new MomentumStrategy() },
];

function independentPair(bars: number, direction: "buy-trap" | "sell-trap", change?: "reorder" | "untradable") {
  return history(Array.from({ length: bars }, (_, index) => {
    const progress = index / (bars - 1);
    const a = { symbol: symbolA,
      price: direction === "buy-trap" ? 1 - progress * 0.2 : 100 - progress * 2,
      tradable: !(change === "untradable" && index === bars - 1) };
    const b = { symbol: symbolB,
      price: direction === "buy-trap" ? 12 - progress * 2 : 8 + progress * 2 };
    return change === "reorder" && index === bars - 1 ? [b, a] : [a, b];
  }));
}

describe.each(channelCases)("Momentum $label single-symbol history", ({ bars, strategy }) => {
  it.each(["reorder", "untradable"] as const)("does not buy an independently declining stock after %s", (change) => {
    const run = (snapshots: MarketSnapshot[]) => createRun(snapshots, { strategy: strategy() }).engine.run();
    const report = run(independentPair(bars, "buy-trap", change));
    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
    expect(report).toEqual(run(independentPair(bars, "buy-trap")));
    for (const symbol of [symbolA, symbolB]) {
      const single = independentPair(bars, "buy-trap").map((snapshot) => ({
        ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbol),
      }));
      expect(run(single).orders).toEqual([]);
    }
  });

  it.each(["reorder", "untradable"] as const)("does not sell another stock's rising actual holding after %s", (change) => {
    const run = (snapshots: MarketSnapshot[]) => createRun(snapshots, {
      strategy: strategy(), seed: { symbol: symbolB, side: "buy", type: "market", quantity: 100 },
      config: { initialCapital: 100_000 },
    }).engine.run();
    const report = run(independentPair(bars, "sell-trap", change));
    expect(report.trades).toMatchObject([
      { symbol: symbolB, side: "buy", quantity: 100, price: 8, commission: 5, barIndex: 0 },
    ]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol: symbolB, quantity: 100 }]);
    expect(report.finalAccount.cash).toBe(99_195);
    expect(report).toEqual(run(independentPair(bars, "sell-trap")));
    const singleB = independentPair(bars, "sell-trap").map((snapshot) => ({
      ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbolB),
    }));
    expect(run(singleB).orders).toHaveLength(1);
  });
});

describe("Momentum same-symbol warmup, actual holdings and reset", () => {
  it("continues the bound stock's own entry and exit after quote reordering", () => {
    const snapshots = history([8, 9, 10, 9].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: 100 + index };
      return index === 0 ? [a, b] : [b, a];
    }));
    const { engine, signals } = createRun(snapshots, { strategy: new MomentumStrategy(2, 1, 0.42) });
    const report = engine.run();
    expect(signals[2]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.42 }]);
    expect(signals[3]).toEqual([{ symbol: symbolA, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 400, price: 10, commission: 5, barIndex: 2 },
      { symbol: symbolA, side: "sell", quantity: 400, price: 9, commission: 5, barIndex: 3 },
    ]);
    expect(report.finalAccount.cash).toBe(9_590);
    expect(report.finalPositions).toEqual([]);
  });

  it("does not advance either historical channel with another stock during unavailable quotes", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 8 }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 500 }],
      [{ symbol: symbolA, price: 1_000, tradable: false }, { symbol: symbolB, price: 0.1 }],
      [{ symbol: symbolB, price: 600 }, { symbol: symbolA, price: 9 }],
      [{ symbol: symbolB, price: 700 }, { symbol: symbolA, price: 10 }],
    ]);
    const { engine, signals } = createRun(snapshots);
    const report = engine.run();
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(report.orders).toHaveLength(1);
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 500, price: 10, barIndex: 4 }]);
  });

  it("waits with an actual bound holding and exits that stock when its quote returns", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 8 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolA, price: 9 }, { symbol: symbolB, price: 101 }],
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 102 }],
      [{ symbol: symbolB, price: 1 }],
      [{ symbol: symbolA, price: 0.1, tradable: false }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 1 }, { symbol: symbolA, price: 9 }],
    ]);
    const { engine, signals, contexts } = createRun(snapshots);
    const report = engine.run();
    expect(contexts[3].positions).toMatchObject([{ symbol: symbolA, quantity: 500, availableQuantity: 500 }]);
    expect(signals[3]).toEqual([]);
    expect(signals[4]).toEqual([]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 500, barIndex: 2 },
      { symbol: symbolA, side: "sell", quantity: 500, price: 9, barIndex: 5 },
    ]);
    expect(report.orders).toHaveLength(2);
    expect(report.finalAccount.cash).toBe(9_490);
    expect(report.finalPositions).toEqual([]);
  });

  it("binds the first tradable stock only after empty and wholly untradable snapshots", () => {
    const snapshots = history([
      [],
      [{ symbol: symbolA, price: 900, tradable: false }],
      [{ symbol: symbolA, price: 900, tradable: false }, { symbol: symbolB, price: 8 }],
      [{ symbol: symbolA, price: 1 }, { symbol: symbolB, price: 9 }],
      [{ symbol: symbolA, price: 2 }, { symbol: symbolB, price: 10 }],
    ]);
    const { engine, signals } = createRun(snapshots);
    const report = engine.run();
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(signals[4]).toEqual([{ symbol: symbolB, side: "buy", type: "market", targetWeight: 0.5 }]);
    expect(report.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 500, price: 10, barIndex: 4 }]);
  });

  it("retains actual share quantities and T+1 through reordering before exiting the bound stock", () => {
    const snapshots = history([10, 9, 8, 7].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: 100 + index };
      return index === 0 ? [a, b] : [b, a];
    }), [2, 2, 2, 3]);
    const { engine, signals, contexts } = createRun(snapshots, {
      seed: { symbol: symbolA, side: "buy", type: "market", quantity: 300 },
    });
    const report = engine.run();
    expect(contexts[2].positions).toMatchObject([{ symbol: symbolA, quantity: 300, availableQuantity: 0 }]);
    expect(signals[2]).toEqual([]);
    expect(signals[3]).toEqual([{ symbol: symbolA, side: "sell", type: "market", quantity: 300 }]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 300, price: 10, barIndex: 0 },
      { symbol: symbolA, side: "sell", quantity: 300, price: 7, barIndex: 3 },
    ]);
    expect(report.finalAccount.cash).toBe(9_090);
    expect(report.finalPositions).toEqual([]);
  });

  it("does not confuse another stock's actual holding with the bound breakout stock", () => {
    const snapshots = history([8, 9, 10].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: 100 + index };
      return index === 0 ? [a, b] : [b, a];
    }));
    const { engine, signals } = createRun(snapshots, {
      strategy: new MomentumStrategy(2, 1, 0.42),
      seed: { symbol: symbolB, side: "buy", type: "market", quantity: 100 },
      config: { initialCapital: 100_000 },
    });
    const report = engine.run();
    expect(signals[2]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.42 }]);
    expect(report.trades.map(({ symbol, side }) => [symbol, side])).toEqual([[symbolB, "buy"], [symbolA, "buy"]]);
    expect(report.finalPositions.find((position) => position.symbol === symbolB)?.quantity).toBe(100);
  });

  it("retains the symbol after closing a position and reenters its next breakout", () => {
    const snapshots = history([8, 9, 10, 9, 8, 9, 10].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: 100 + index };
      return index === 0 ? [a, b] : [b, a];
    }));
    const report = createRun(snapshots).engine.run();
    expect(report.trades.map(({ symbol, side, barIndex }) => [symbol, side, barIndex]))
      .toEqual([[symbolA, "buy", 2], [symbolA, "sell", 3], [symbolA, "buy", 5]]);
  });

  it("clears the symbol and channel history between reused engine and strategy runs", () => {
    const strategy = new MomentumStrategy(2, 1, 0.5, "local momentum symbol replay");
    const first = history([8, 9, 10].map((price) => [
      { symbol: symbolA, price }, { symbol: symbolB, price: 100 },
    ]));
    const { engine } = createRun(first, { strategy });
    const report = engine.run();
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 500, barIndex: 2 }]);
    expect(engine.run()).toEqual(report);
    strategy.reset();
    const second = history([18, 19, 20].map((price) => [
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    const next = createRun(second, { strategy }).engine.run();
    expect(next.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 200, barIndex: 2 }]);
    expect(next).toEqual(createRun(second, {
      strategy: new MomentumStrategy(2, 1, 0.5, "local momentum symbol replay"),
    }).engine.run());
    expect(next.strategyName).toBe("local momentum symbol replay");
  });

  it("preserves the full stable-order report against the same bound stock alone", () => {
    const cycle = [8, 9, 10, 9, 8, 9, 10, 11];
    const multi = history(Array.from({ length: 24 }, (_, index) => [
      { symbol: symbolA, price: cycle[index % cycle.length] },
      { symbol: symbolB, price: 100 + index },
    ]));
    const single = multi.map((snapshot) => ({
      ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbolA),
    }));
    const config = { slippageBps: 10 };
    const report = createRun(multi, { config }).engine.run();
    expect(report.trades.length).toBeGreaterThan(2);
    expect(report.metrics.totalCommission).toBeGreaterThan(0);
    expect(report).toEqual(createRun(single, { config }).engine.run());
  });
});
