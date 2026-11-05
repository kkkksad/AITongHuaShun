import { describe, expect, it } from "vitest";
import type { StrategyContext } from "../../../shared/backtest";
import type { MarketQuote, MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { RSIStrategy } from "./RSIStrategy";

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

function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return {
    snapshot,
    account: {
      accountId: "RSI-symbol-fixture", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime,
    },
    positions, equity: 10_000, cash: 10_000, barIndex, totalBars: 20,
  };
}

function position(symbol: string, quantity = 300, availableQuantity = quantity): PositionSnapshot {
  return {
    symbol, name: symbol, quantity, availableQuantity,
    averagePrice: 10, currentPrice: 10, marketValue: quantity * 10,
    unrealizedPnl: 0, realizedPnl: 0, weight: quantity / 1_000,
  };
}

function project(strategy: RSIStrategy, snapshots: MarketSnapshot[], positions: PositionSnapshot[] = []) {
  return snapshots.map((snapshot, index) => strategy.onBar(context(snapshot, index, positions)));
}

function createEngine(snapshots: MarketSnapshot[], strategy = new RSIStrategy(2, 30, 70, 0.5)) {
  return new BacktestEngine(snapshots, strategy, {
    initialCapital: 10_000, maxOrderNotional: 1_000_000,
    maxPositionWeight: 1, maxDailyLoss: 1, minimumCommission: 5, slippageBps: 0,
  });
}

function risingPair(reordered = false, unavailable = false) {
  return history([0, 1, 2].map((index) => {
    const a = { symbol: symbolA, price: 100 + index, tradable: !(unavailable && index > 0) };
    const b = { symbol: symbolB, price: 8 + index };
    return reordered && index > 0 ? [b, a] : [a, b];
  }));
}

describe("RSIStrategy single-symbol history binding", () => {
  it("does not create a mixed-symbol oversold fill when rising quotes change order", () => {
    const snapshots = risingPair(true);
    const report = createEngine(snapshots).run();

    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
    expect(report).toEqual(createEngine(risingPair()).run());
    for (const symbol of [symbolA, symbolB]) {
      const single = snapshots.map((snapshot) => ({
        ...snapshot, quotes: snapshot.quotes.filter((quote) => quote.symbol === symbol),
      }));
      expect(createEngine(single).run().trades).toEqual([]);
    }
  });

  it("waits when the bound stock becomes untradable instead of buying another rising stock", () => {
    const report = createEngine(risingPair(false, true)).run();
    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("continues tracking the bound stock's decline after the other stock moves first", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 12 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolB, price: 101 }, { symbol: symbolA, price: 11 }],
      [{ symbol: symbolB, price: 102 }, { symbol: symbolA, price: 10 }],
    ]);
    const output = project(new RSIStrategy(2, 30, 70, 0.42), snapshots);
    expect(output).toEqual([[], [], [{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.42 }]]);
    const report = createEngine(snapshots).run();
    expect(report.trades).toMatchObject([{ symbol: symbolA, barIndex: 2, side: "buy", quantity: 500, price: 10, commission: 5 }]);
  });

  it("does not append other stocks during missing or untradable bars and resumes the same warmup", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 1 }],
      [{ symbol: symbolB, price: 500 }],
      [{ symbol: symbolA, price: 1_000, tradable: false }, { symbol: symbolB, price: 0.1 }],
      [{ symbol: symbolB, price: 600 }, { symbol: symbolA, price: 9.9 }],
      [{ symbol: symbolB, price: 700 }, { symbol: symbolA, price: 9.8 }],
    ]);
    const output = project(new RSIStrategy(2), snapshots);
    expect(output.slice(0, 4)).toEqual([[], [], [], []]);
    expect(output[4]).toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.5 }]);
    const report = createEngine(snapshots).run();
    expect(report.orders).toHaveLength(1);
    expect(report.trades).toMatchObject([{ symbol: symbolA, barIndex: 4, side: "buy", quantity: 500, price: 9.8, commission: 5 }]);
  });

  it("does not bind during empty or entirely untradable snapshots", () => {
    const snapshots = history([
      [],
      [{ symbol: symbolA, price: 900, tradable: false }],
      [{ symbol: symbolA, price: 900, tradable: false }, { symbol: symbolB, price: 12 }],
      [{ symbol: symbolA, price: 1 }, { symbol: symbolB, price: 11 }],
      [{ symbol: symbolA, price: 2 }, { symbol: symbolB, price: 10 }],
    ]);
    const output = project(new RSIStrategy(2), snapshots);
    expect(output.slice(0, 4)).toEqual([[], [], [], []]);
    expect(output[4]).toEqual([{ symbol: symbolB, side: "buy", type: "market", targetWeight: 0.5 }]);
  });

  it("uses the first tradable symbol at binding even when it has an existing actual holding", () => {
    const snapshots = history([10, 11, 12].map((price) => [
      { symbol: "display-only", price: 1_000, tradable: false },
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    expect(project(new RSIStrategy(2), snapshots, [position(symbolB)])[2])
      .toEqual([{ symbol: symbolB, side: "sell", type: "market", quantity: 300 }]);
  });

  it("does not sell another stock's actual holding after quote order changes", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolB, price: 101 }, { symbol: symbolA, price: 9 }],
      [{ symbol: symbolB, price: 102 }, { symbol: symbolA, price: 8 }],
    ]);
    const other = position(symbolB);
    const before = structuredClone(other);
    expect(project(new RSIStrategy(2, 30, 70, 0.42), snapshots, [other])[2])
      .toEqual([{ symbol: symbolA, side: "buy", type: "market", targetWeight: 0.42 }]);
    expect(other).toEqual(before);
  });

  it("uses the bound stock's actual sellable whole lots after reordering", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolB, price: 99 }, { symbol: symbolA, price: 11 }],
      [{ symbol: symbolB, price: 98 }, { symbol: symbolA, price: 12 }],
    ]);
    expect(project(new RSIStrategy(2), snapshots, [position(symbolB, 900), position(symbolA, 350, 199)])[2])
      .toEqual([{ symbol: symbolA, side: "sell", type: "market", quantity: 100 }]);
    expect(project(new RSIStrategy(2), snapshots, [position(symbolA, 350, 0)])[2]).toEqual([]);
  });

  it("waits without selling another holding while the bound stock is missing", () => {
    const snapshots = history([
      [{ symbol: symbolA, price: 10 }, { symbol: symbolB, price: 100 }],
      [{ symbol: symbolB, price: 101 }],
      [{ symbol: symbolB, price: 102 }],
    ]);
    expect(project(new RSIStrategy(2), snapshots, [position(symbolA), position(symbolB)]))
      .toEqual([[], [], []]);
  });

  it("keeps the bound stock through every reordered snapshot until reset", () => {
    const snapshots = history([12, 11, 10, 9].map((price, index) => {
      const a = { symbol: symbolA, price };
      const b = { symbol: symbolB, price: 100 + index };
      return index === 0 ? [a, b] : [b, a];
    }));
    const output = project(new RSIStrategy(2), snapshots);
    expect(output[2][0]?.symbol).toBe(symbolA);
    expect(output[3][0]?.symbol).toBe(symbolA); // No fill was asserted: actual holdings remain empty.
  });

  it("clears binding and history on reset so a new first symbol gets its own full warmup", () => {
    const strategy = new RSIStrategy(2, 30, 70, 0.42, "local RSI symbol replay");
    const first = history([12, 11, 10].map((price) => [{ symbol: symbolA, price }]));
    expect(project(strategy, first)[2][0]?.symbol).toBe(symbolA);
    strategy.reset();
    const second = history([22, 21, 20].map((price) => [
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    expect(project(strategy, second)).toEqual([[], [], [{ symbol: symbolB, side: "buy", type: "market", targetWeight: 0.42 }]]);
    expect(strategy.name).toBe("local RSI symbol replay");
  });

  it("reuses an engine deterministically and permits a reused strategy to bind a new run's first stock", () => {
    const strategy = new RSIStrategy(2, 30, 70, 0.5, "local RSI symbol replay");
    const first = history([12, 11, 10].map((price) => [
      { symbol: symbolA, price }, { symbol: symbolB, price: 100 },
    ]));
    const engine = createEngine(first, strategy);
    const report = engine.run();
    expect(report.trades).toMatchObject([{ symbol: symbolA, side: "buy", quantity: 500, commission: 5 }]);
    expect(engine.run()).toEqual(report);
    const second = history([22, 21, 20].map((price) => [
      { symbol: symbolB, price }, { symbol: symbolA, price: 100 },
    ]));
    const next = createEngine(second, strategy).run();
    expect(next.trades).toMatchObject([{ symbol: symbolB, side: "buy", quantity: 200, commission: 5 }]);
    expect(next).toEqual(createEngine(second, new RSIStrategy(2, 30, 70, 0.5, "local RSI symbol replay")).run());
  });
});
