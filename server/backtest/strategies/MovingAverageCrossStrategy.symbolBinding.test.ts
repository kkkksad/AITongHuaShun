import { describe, expect, it } from "vitest";
import type { StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketQuote, MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { MovingAverageCrossStrategy } from "./MovingAverageCrossStrategy";

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

function run(snapshots: MarketSnapshot[], strategy = new MovingAverageCrossStrategy(1, 2, 0.5)) {
  const contexts: StrategyContext[] = [];
  const signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, {
    name: strategy.name,
    reset: () => strategy.reset(),
    onBar(context) {
      contexts.push(context);
      const output = strategy.onBar(context);
      signals.push(output);
      return output;
    },
  }, {
    initialCapital: 10_000, maxOrderNotional: 1_000_000,
    maxPositionWeight: 1, maxDailyLoss: 1, minimumCommission: 5, slippageBps: 0,
  });
  return { engine, contexts, signals, report: engine.run() };
}

function decliningPair(defaultPeriods: boolean) {
  const length = defaultPeriods ? 21 : 3;
  return history(Array.from({ length }, (_, index) => [
    { symbol: symbolA, price: defaultPeriods ? 2 - index / 100 : 1 - index / 10 },
    { symbol: symbolB, price: defaultPeriods ? 12 - index / 10 : 12 - index },
  ]));
}

function strategyFor(defaultPeriods: boolean) {
  return defaultPeriods ? new MovingAverageCrossStrategy() : new MovingAverageCrossStrategy(1, 2, 0.5);
}

describe("MovingAverageCrossStrategy single-symbol history binding", () => {
  it.each([false, true])("does not mix declining stocks into a filled golden cross when the final quote order changes (default periods: %s)", (defaults) => {
    const stable = decliningPair(defaults);
    const reordered = stable.map((snapshot, index) => ({
      ...snapshot, quotes: index === stable.length - 1 ? [...snapshot.quotes].reverse() : snapshot.quotes,
    }));
    const { report, signals } = run(reordered, strategyFor(defaults));
    expect(signals.flat()).toEqual([]);
    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
    expect(report).toEqual(run(stable, strategyFor(defaults)).report);
    for (const symbol of [symbolA, symbolB]) {
      const single = stable.map((snapshot) => ({ ...snapshot,
        quotes: snapshot.quotes.filter((quote) => quote.symbol === symbol) }));
      expect(run(single, strategyFor(defaults)).report.orders).toEqual([]);
    }
  });

  it.each([false, true])("does not fall back to another stock when the bound quote becomes non-tradable (default periods: %s)", (defaults) => {
    const stable = decliningPair(defaults);
    const unavailable = stable.map((snapshot, index) => ({
      ...snapshot, quotes: snapshot.quotes.map((quote) => ({
        ...quote, tradable: !(index === stable.length - 1 && quote.symbol === symbolA),
      })),
    }));
    const { report, signals } = run(unavailable, strategyFor(defaults));
    expect(signals.flat()).toEqual([]);
    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("buys the bound stock's real golden cross when another stock moves first", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolB, price: 99 }, { symbol: symbolA, price: 9 }],
      [{ symbol: symbolB, price: 98 }, { symbol: symbolA, price: 10 }],
    ]);
    const { report, signals } = run(snapshots, new MovingAverageCrossStrategy(1, 2, 0.42));
    expect(signals).toEqual([[], [], [{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.42 }]]);
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", barIndex: 2, quantity: 400, price: 10, commission: 5 }]);
    expect(report.finalAccount.cash).toBe(5_995);
  });

  it("sells the actual bound stock on its death cross after quote reordering", () => {
    const snapshots = history([10, 9, 10, 9].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: index === 3 ? 200 : 100 };
      return index === 3 ? [b, a] : [a, b];
    }));
    const { report, contexts, signals } = run(snapshots);
    expect(contexts[3].positions).toMatchObject([{ symbol: symbolA, quantity: 500, availableQuantity: 500 }]);
    expect(signals[3]).toEqual([{ symbol: symbolA, side: "sell", type: "market", targetWeight: 1 }]);
    expect(report.trades).toMatchObject([
      { symbol: symbolA, side: "buy", barIndex: 2, quantity: 500, price: 10, commission: 5 },
      { symbol: symbolA, side: "sell", barIndex: 3, quantity: 500, price: 9, commission: 5 },
    ]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(9_490);
    expect(report.metrics.totalCommission).toBe(10);
  });

  it("excludes missing and non-tradable observations and resumes the bound stock's own warmup", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolB, price: 200 }],
      [{ symbol: symbolA, price: 1_000, tradable: false }, { symbol: symbolB, price: 5 }],
      [{ symbol: symbolB, price: 6 }, { symbol: symbolA, price: 9 }],
      [{ symbol: symbolB, price: 7 }, { symbol: symbolA, price: 10 }],
    ]);
    const { report, signals } = run(snapshots);
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(signals[4]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.5 }]);
    expect(report.orders).toHaveLength(1);
    expect(report.trades).toMatchObject([{ symbol: symbolA, barIndex: 4, side: "buy", quantity: 500, price: 10, commission: 5 }]);
  });

  it("preserves its bound state while missing and later exits the actual holding on that stock's cross", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolA, price: 9 }, { symbol: symbolB, price: 99 }],
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 98 }],
      [{ symbol: symbolB, price: 9 }],
      [{ symbol: symbolB, price: 8 }, { symbol: symbolA, price: 9 }],
    ]);
    const { report, signals, contexts } = run(snapshots);
    expect(signals[3]).toEqual([]);
    expect(contexts[4].positions).toMatchObject([{ symbol: symbolA, quantity: 500, availableQuantity: 500 }]);
    expect(signals[4]).toEqual([{ symbol: symbolA, side: "sell", type: "market", targetWeight: 1 }]);
    expect(report.trades.map(({ symbol, side, barIndex }) => [symbol, side, barIndex]))
      .toEqual([[symbolA, "buy", 2], [symbolA, "sell", 4]]);
    expect(report.finalPositions).toEqual([]);
  });

  it("waits through empty snapshots and binds the first later tradable stock with its full warmup", () => {
    const snapshots = history([
      [],
      [{ symbol: symbolA, price: 999, tradable: false }],
      [{ symbol: symbolA, price: 999, tradable: false }, { symbol: symbolB, price: 10 }],
      [{ symbol: symbolA, price: 1 }, { symbol: symbolB, price: 9 }],
      [{ symbol: symbolA, price: 2 }, { symbol: symbolB, price: 10 }],
    ]);
    const { report, signals } = run(snapshots);
    expect(signals.slice(0, 4)).toEqual([[], [], [], []]);
    expect(signals[4]).toEqual([{ symbol: symbolB, side: "buy", type: "market", targetWeight: 0.5 }]);
    expect(report.trades).toMatchObject([{ symbol: symbolB, side: "buy", barIndex: 4, quantity: 500, price: 10, commission: 5 }]);
  });

  it("keeps strict current-line crossing comparisons when the averages are equal", () => {
    const snapshots = history([10, 10, 10].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: 100 + index };
      return index === 0 ? [a, b] : [b, a];
    }));
    const { report, signals } = run(snapshots);
    expect(signals).toEqual([[], [], []]);
    expect(report.orders).toEqual([]);
  });

  it("clears binding, history and original intent state on reset before choosing a new first stock", () => {
    const strategy = new MovingAverageCrossStrategy(1, 2, 0.42, "local MA replay");
    const first = history([10, 9, 10].map((price) => [{ symbol: symbolA, price }]));
    const firstRun = run(first, strategy);
    expect(firstRun.report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 400 }]);
    strategy.reset();
    const second = history([20, 19, 20].map((price) => [
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    const secondRun = run(second, strategy);
    expect(secondRun.signals).toEqual([[], [], [{ symbol: symbolB, side: "buy", type: "market", targetWeight: 0.42 }]]);
    expect(secondRun.report.trades).toMatchObject([{ symbol: symbolB, side: "buy", barIndex: 2, quantity: 200, price: 20, commission: 5 }]);
    expect(strategy.name).toBe("local MA replay");
  });

  it("replays an engine deterministically and rebinds a reused strategy identically to a fresh instance", () => {
    const strategy = new MovingAverageCrossStrategy(1, 2, 0.5, "local MA replay");
    const first = history([10, 9, 10, 9].map((price) => [
      { symbol: symbolA, price }, { symbol: symbolB, price: 100 },
    ]));
    const { report, engine } = run(first, strategy);
    expect(report.trades).toHaveLength(2);
    expect(engine.run()).toEqual(report);
    const second = history([20, 19, 20].map((price) => [
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    const next = run(second, strategy).report;
    expect(next.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 200 }]);
    expect(next).toEqual(run(second, new MovingAverageCrossStrategy(1, 2, 0.5, "local MA replay")).report);
  });
});
