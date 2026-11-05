import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketQuote, MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { BollingerBandsStrategy } from "./BollingerBandsStrategy";

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
  strategy?: BollingerBandsStrategy;
  seed?: StrategySignal;
  config?: Partial<BacktestConfig>;
} = {}) {
  const strategy = input.strategy ?? new BollingerBandsStrategy(3, 1, 0.5);
  const signals: StrategySignal[][] = [];
  const contexts: StrategyContext[] = [];
  const engine = new BacktestEngine(snapshots, {
    name: strategy.name,
    reset: () => {
      strategy.reset();
      signals.length = 0;
      contexts.length = 0;
    },
    onBar(context) {
      contexts.push(context);
      const output = strategy.onBar(context);
      signals.push(output);
      // Explicitly acquire the fixture holding through the real broker. The
      // seed is separate from Bollinger's signals and cannot claim a fake fill.
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

function independentPair(direction: "rising" | "falling", change?: "reorder" | "untradable") {
  return history(Array.from({ length: 6 }, (_, index) => {
    const a = { symbol: symbolA, price: direction === "rising" ? 100 + index : 10 - index,
      tradable: !(change === "untradable" && index === 5) };
    const b = { symbol: symbolB, price: direction === "rising" ? 5 + index : 105 - index };
    return change === "reorder" && index === 5 ? [b, a] : [a, b];
  }));
}

describe.each(["reorder", "untradable"] as const)("Bollinger single-symbol history after %s", (change) => {
  it("does not buy another independently rising stock from a mixed-price lower band", () => {
    const snapshots = independentPair("rising", change);
    const run = (input: MarketSnapshot[]) => createRun(input, {
      strategy: new BollingerBandsStrategy(6, 2, 0.5),
    }).engine.run();
    const report = run(snapshots);
    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
    expect(report).toEqual(run(independentPair("rising")));
    for (const symbol of [symbolA, symbolB]) {
      const single = independentPair("rising").map((snapshot) => ({
        ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbol),
      }));
      expect(run(single).trades).toEqual([]);
    }
  });

  it("does not sell an actual holding in another independently falling stock from a mixed-price middle band", () => {
    const run = (snapshots: MarketSnapshot[]) => createRun(snapshots, {
      strategy: new BollingerBandsStrategy(6, 2, 0.5),
      seed: { symbol: symbolB, side: "buy", type: "market", quantity: 100 },
      config: { initialCapital: 100_000 },
    }).engine.run();
    const report = run(independentPair("falling", change));
    expect(report.trades).toMatchObject([
      { symbol: symbolB, side: "buy", quantity: 100, price: 105, commission: 5, barIndex: 0 },
    ]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol: symbolB, quantity: 100 }]);
    expect(report.finalAccount.cash).toBe(89_495);
    expect(report).toEqual(run(independentPair("falling")));
    const singleB = independentPair("falling").map((snapshot) => ({
      ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbolB),
    }));
    expect(run(singleB).trades).toHaveLength(1);
  });
});

describe("Bollinger single-symbol warmup, holdings and reset", () => {
  it("continues the bound stock's own lower-band entry and middle-band exit after reordering", () => {
    const snapshots = history([12, 11, 10, 12, 13].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: 100 + index };
      return index === 0 ? [a, b] : [b, a];
    }));
    const { engine, signals } = createRun(snapshots, { strategy: new BollingerBandsStrategy(3, 1, 0.42) });
    const report = engine.run();
    expect(signals[2]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.42 }]);
    expect(signals[3]).toEqual([{ symbol: symbolA, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 400, price: 10, commission: 5, barIndex: 2 },
      { symbol: symbolA, side: "sell", quantity: 400, price: 12, commission: 5, barIndex: 3 },
    ]);
    expect(report.finalAccount.cash).toBe(10_790);
    expect(report.finalPositions).toEqual([]);
  });

  it("does not advance warmup with other stocks while the bound quote is missing or untradable", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 12 }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 500 }],
      [{ symbol: symbolA, price: 1_000, tradable: false }, { symbol: symbolB, price: 0.1 }],
      [{ symbol: symbolB, price: 600 }, { symbol: symbolA, price: 11 }],
      [{ symbol: symbolB, price: 700 }, { symbol: symbolA, price: 10 }],
    ]);
    const { engine, signals } = createRun(snapshots);
    const report = engine.run();
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(report.orders).toHaveLength(1);
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 500, price: 10, barIndex: 4 }]);
  });

  it("waits with an actual bound holding through unavailable quotes and exits only when that stock returns", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 12 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolA, price: 11 }, { symbol: symbolB, price: 101 }],
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 102 }],
      [{ symbol: symbolB, price: 1 }],
      [{ symbol: symbolA, price: 1_000, tradable: false }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 1 }, { symbol: symbolA, price: 12 }],
    ]);
    const { engine, signals, contexts } = createRun(snapshots);
    const report = engine.run();
    expect(contexts[3].positions).toMatchObject([{ symbol: symbolA, quantity: 500, availableQuantity: 500 }]);
    expect(signals[3]).toEqual([]);
    expect(signals[4]).toEqual([]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 500, barIndex: 2 },
      { symbol: symbolA, side: "sell", quantity: 500, price: 12, barIndex: 5 },
    ]);
    expect(report.orders).toHaveLength(2);
    expect(report.finalAccount.cash).toBe(10_990);
    expect(report.finalPositions).toEqual([]);
  });

  it("binds the first tradable stock only after empty or wholly untradable snapshots", () => {
    const snapshots = history([
      [],
      [{ symbol: symbolA, price: 900, tradable: false }],
      [{ symbol: symbolA, price: 900, tradable: false }, { symbol: symbolB, price: 12 }],
      [{ symbol: symbolA, price: 1 }, { symbol: symbolB, price: 11 }],
      [{ symbol: symbolA, price: 2 }, { symbol: symbolB, price: 10 }],
    ]);
    const { engine, signals } = createRun(snapshots);
    const report = engine.run();
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(signals[4]).toEqual([{ symbol: symbolB, side: "buy", type: "market", targetWeight: 0.5 }]);
    expect(report.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 500, price: 10, barIndex: 4 }]);
  });

  it("preserves the first tradable choice and uses that stock's actual shares for an exit", () => {
    const snapshots = history([10, 11, 12].map((price) => [
      { symbol: "display-only", price: 900, tradable: false },
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    const { engine } = createRun(snapshots, {
      seed: { symbol: symbolB, side: "buy", type: "market", quantity: 300 },
    });
    const report = engine.run();
    expect(report.trades).toMatchObject([
      { symbol: symbolB, side: "buy", quantity: 300, price: 10, barIndex: 0 },
      { symbol: symbolB, side: "sell", quantity: 300, price: 12, barIndex: 2 },
    ]);
    expect(report.finalAccount.cash).toBe(10_590);
  });

  it("does not confuse a different actual holding with the bound lower-band stock", () => {
    const snapshots = history([12, 11, 10].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: 100 + index };
      return index === 0 ? [a, b] : [b, a];
    }));
    const { engine, signals } = createRun(snapshots, {
      strategy: new BollingerBandsStrategy(3, 1, 0.42),
      seed: { symbol: symbolB, side: "buy", type: "market", quantity: 100 },
      config: { initialCapital: 100_000 },
    });
    const report = engine.run();
    expect(signals[2]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.42 }]);
    expect(report.trades.map(({ symbol, side }) => [symbol, side])).toEqual([[symbolB, "buy"], [symbolA, "buy"]]);
    expect(report.finalPositions.find((position) => position.symbol === symbolB)?.quantity).toBe(100);
  });

  it("retains the binding after closing a position and later reenters the same stock", () => {
    const snapshots = history([12, 11, 10, 12, 12, 11, 10].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: 100 + index };
      return index === 0 ? [a, b] : [b, a];
    }));
    const report = createRun(snapshots).engine.run();
    // The unchanged [12, 12, 11] window already reaches the lower band at bar 5.
    expect(report.trades.map(({ symbol, side, barIndex }) => [symbol, side, barIndex]))
      .toEqual([[symbolA, "buy", 2], [symbolA, "sell", 3], [symbolA, "buy", 5]]);
  });

  it("clears both history and binding between reused engine and strategy runs", () => {
    const strategy = new BollingerBandsStrategy(3, 1, 0.5, "local Bollinger symbol replay");
    const first = history([12, 11, 10].map((price) => [
      { symbol: symbolA, price }, { symbol: symbolB, price: 100 },
    ]));
    const { engine } = createRun(first, { strategy });
    const report = engine.run();
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 500, barIndex: 2 }]);
    expect(engine.run()).toEqual(report);
    strategy.reset();
    const second = history([22, 21, 20].map((price) => [
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    const next = createRun(second, { strategy }).engine.run();
    expect(next.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 200, barIndex: 2 }]);
    expect(next).toEqual(createRun(second, {
      strategy: new BollingerBandsStrategy(3, 1, 0.5, "local Bollinger symbol replay"),
    }).engine.run());
    expect(next.strategyName).toBe("local Bollinger symbol replay");
  });

  it("preserves complete stable-order reports compared with the same bound stock alone", () => {
    const cycle = [12, 11, 10, 12, 13, 11, 10, 12];
    const multi = history(Array.from({ length: 24 }, (_, index) => [
      { symbol: symbolA, price: cycle[index % cycle.length] },
      { symbol: symbolB, price: 100 + index / 10 },
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
