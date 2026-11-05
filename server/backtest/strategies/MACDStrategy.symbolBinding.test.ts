import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketQuote, MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { MACDStrategy } from "./MACDStrategy";

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
  strategy?: MACDStrategy;
  seed?: StrategySignal;
  config?: Partial<BacktestConfig>;
} = {}) {
  const strategy = input.strategy ?? new MACDStrategy(1, 2, 2, 0.5);
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
      // Fixture holdings are filled by the broker, separately from MACD's
      // existing signal-intent lifecycle.
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

function reordered(prices: number[]) {
  return history(prices.map((price, index) => {
    const a = { symbol: symbolA, price };
    const b = { symbol: symbolB, price: 100 + index };
    return index === 0 ? [a, b] : [b, a];
  }));
}

describe.each([
  { label: "small 1/2/2", bars: 5, strategy: () => new MACDStrategy(1, 2, 2) },
  { label: "default 12/26/9", bars: 36, strategy: () => new MACDStrategy() },
])("MACD $label single-symbol history", ({ bars, strategy }) => {
  it.each(["reorder", "untradable"] as const)("does not buy an independently declining stock after %s", (change) => {
    const stable = history(Array.from({ length: bars }, (_, index) => {
      const progress = index / (bars - 1);
      return [
        { symbol: symbolA, price: 1 - progress * 0.4 },
        { symbol: symbolB, price: 14 - progress * 4 },
      ];
    }));
    const changed = stable.map((snapshot, index) => ({
      ...snapshot,
      quotes: index !== bars - 1 ? snapshot.quotes
        : change === "reorder" ? [...snapshot.quotes].reverse()
          : snapshot.quotes.map((quote) => ({ ...quote, tradable: quote.symbol !== symbolA })),
    }));
    const run = (snapshots: MarketSnapshot[]) => createRun(snapshots, { strategy: strategy() }).engine.run();
    const report = run(changed);
    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
    expect(report).toEqual(run(stable));
    for (const symbol of [symbolA, symbolB]) {
      const single = stable.map((snapshot) => ({
        ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbol),
      }));
      expect(run(single).orders).toEqual([]);
    }
  });
});

describe("MACD bound-symbol histogram, warmup and reset", () => {
  it.each(["reorder", "untradable"] as const)("does not sell another rising stock's actual holding after %s", (change) => {
    const stable = history([10, 9, 8, 7, 10, 13, 16].map((price, index) => [
      { symbol: symbolA, price }, { symbol: symbolB, price: 1 + index / 10 },
    ]));
    const changed = stable.map((snapshot, index) => ({
      ...snapshot,
      quotes: index !== stable.length - 1 ? snapshot.quotes
        : change === "reorder" ? [...snapshot.quotes].reverse()
          : snapshot.quotes.map((quote) => ({ ...quote, tradable: quote.symbol !== symbolA })),
    }));
    const run = (snapshots: MarketSnapshot[]) => createRun(snapshots, {
      strategy: new MACDStrategy(1, 2, 2, 0.42),
      seed: { symbol: symbolB, side: "buy", type: "market", quantity: 100 },
    }).engine.run();
    const report = run(changed);
    expect(report.trades).toMatchObject([
      { symbol: symbolB, side: "buy", quantity: 100, price: 1, barIndex: 0 },
      { symbol: symbolA, side: "buy", quantity: 400, price: 10, barIndex: 4 },
    ]);
    expect(report.orders).toHaveLength(2);
    expect(report.finalPositions.find((position) => position.symbol === symbolB)?.quantity).toBe(100);
    expect(report.finalAccount.cash).toBe(5_890);
    expect(report).toEqual(run(stable));
  });

  it("uses the same stock's golden and death crosses after quote reordering", () => {
    const { engine, signals } = createRun(reordered([10, 9, 8, 7, 10, 11, 6]), {
      strategy: new MACDStrategy(1, 2, 2, 0.42),
    });
    const report = engine.run();
    expect(signals[4]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.42 }]);
    expect(signals[6]).toEqual([{ symbol: symbolA, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 400, price: 10, commission: 5, barIndex: 4 },
      { symbol: symbolA, side: "sell", quantity: 400, price: 6, commission: 5, barIndex: 6 },
    ]);
    expect(report.finalAccount.cash).toBe(8_390);
    expect(report.finalPositions).toEqual([]);
  });

  it("does not warm up EMA or the previous histogram from other stocks while its quote is unavailable", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 999 }],
      [{ symbol: symbolA, price: 999, tradable: false }, { symbol: symbolB, price: 0.1 }],
      [{ symbol: symbolB, price: 600 }, { symbol: symbolA, price: 9 }],
      [{ symbol: symbolB, price: 700 }, { symbol: symbolA, price: 8 }],
      [{ symbol: symbolB, price: 800 }, { symbol: symbolA, price: 7 }],
      [{ symbol: symbolB, price: 900 }, { symbol: symbolA, price: 10 }],
    ]);
    const { engine, signals } = createRun(snapshots);
    const report = engine.run();
    expect(signals.slice(0, 6)).toEqual([[], [], [], [], [], []]);
    expect(signals[6]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.5 }]);
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 500, price: 10, barIndex: 6 }]);
    expect(report.orders).toHaveLength(1);
  });

  it("initializes its first histogram after slow plus signal observations without treating it as a cross", () => {
    const { engine, signals } = createRun(reordered([10, 9, 8, 10]));
    const report = engine.run();
    expect(signals).toEqual([[], [], [], []]);
    expect(report.orders).toEqual([]);
  });

  it("retains zero as the previous histogram boundary and strict positive and negative current crosses", () => {
    const { engine, signals } = createRun(reordered([10, 10, 10, 10, 11, 10]));
    const report = engine.run();
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(signals[4]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.5 }]);
    expect(signals[5]).toEqual([{ symbol: symbolA, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 400, price: 11, barIndex: 4 },
      { symbol: symbolA, side: "sell", quantity: 400, price: 10, barIndex: 5 },
    ]);
  });

  it("preserves its bound intent and last histogram through missing and untradable quotes before the real exit", () => {
    const snapshots = history([
      ...[10, 9, 8, 7, 10].map((price) => [
        { symbol: symbolA, price }, { symbol: symbolB, price: 100 },
      ]),
      [{ symbol: symbolB, price: 1 }],
      [{ symbol: symbolA, price: 1_000, tradable: false }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 1 }, { symbol: symbolA, price: 7 }],
    ]);
    const { engine, signals, contexts } = createRun(snapshots);
    const report = engine.run();
    expect(contexts[5].positions).toMatchObject([{ symbol: symbolA, quantity: 500, availableQuantity: 500 }]);
    expect(signals[5]).toEqual([]);
    expect(signals[6]).toEqual([]);
    expect(signals[7]).toEqual([{ symbol: symbolA, side: "sell", type: "market", quantity: 500 }]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", quantity: 500, price: 10, barIndex: 4 },
      { symbol: symbolA, side: "sell", quantity: 500, price: 7, barIndex: 7 },
    ]);
    expect(report.orders).toHaveLength(2);
    expect(report.finalAccount.cash).toBe(8_490);
    expect(report.finalPositions).toEqual([]);
  });

  it("waits for the first tradable stock after empty snapshots and binds its entire warmup", () => {
    const snapshots = history([
      [],
      [{ symbol: symbolA, price: 999, tradable: false }],
      [{ symbol: symbolA, price: 999, tradable: false }, { symbol: symbolB, price: 10 }],
      ...[9, 8, 7, 10].map((price, index) => [
        { symbol: symbolA, price: index + 1 }, { symbol: symbolB, price },
      ]),
    ]);
    const { engine, signals } = createRun(snapshots);
    const report = engine.run();
    expect(signals.slice(0, 6)).toEqual([[], [], [], [], [], []]);
    expect(signals[6]).toEqual([{ symbol: symbolB, side: "buy", type: "market", targetWeight: 0.5 }]);
    expect(report.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 500, price: 10, barIndex: 6 }]);
  });

  it("keeps the original binding after a flat exit for subsequent entries", () => {
    const report = createRun(reordered([10, 9, 8, 7, 10, 7, 10, 7])).engine.run();
    expect(report.trades.map(({ symbol, side, barIndex }) => [symbol, side, barIndex]))
      .toEqual([[symbolA, "buy", 4], [symbolA, "sell", 5], [symbolA, "buy", 6], [symbolA, "sell", 7]]);
  });

  it("clears binding, prices, histogram and original intent on reset for reused engines and new stocks", () => {
    const strategy = new MACDStrategy(1, 2, 2, 0.5, "local MACD symbol replay");
    const first = history([10, 9, 8, 7, 10].map((price) => [
      { symbol: symbolA, price }, { symbol: symbolB, price: 100 },
    ]));
    const { engine } = createRun(first, { strategy });
    const report = engine.run();
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 500, barIndex: 4 }]);
    expect(engine.run()).toEqual(report);
    strategy.reset();
    const second = history([20, 19, 18, 17, 20].map((price) => [
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    const next = createRun(second, { strategy }).engine.run();
    expect(next.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 200, barIndex: 4 }]);
    expect(next).toEqual(createRun(second, {
      strategy: new MACDStrategy(1, 2, 2, 0.5, "local MACD symbol replay"),
    }).engine.run());
    expect(next.strategyName).toBe("local MACD symbol replay");
  });

  it("preserves the entire stable-order report against the same stock alone with execution costs", () => {
    const prices = [10, 9, 8, 7, 10, 7, 10, 7];
    const multi = history(Array.from({ length: 24 }, (_, index) => [
      { symbol: symbolA, price: prices[index % prices.length] },
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
