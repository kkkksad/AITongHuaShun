import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { BollingerBandsStrategy } from "./BollingerBandsStrategy";

const symbol = "600001";

function snapshots(prices: number[], days = prices.map((_, index) => index + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return {
      mode: "paper", sequence: index + 1, marketTime,
      quotes: [{
        symbol, name: "deterministic Bollinger fixture", tradable: true, price,
        previousClose: prices[Math.max(0, index - 1)], changePercent: 0,
        volume: 1_000_000, updatedAt: marketTime,
      }],
    };
  });
}

function createRun(strategy: BollingerBandsStrategy, history: MarketSnapshot[], config: Partial<BacktestConfig> = {}) {
  const contexts: StrategyContext[] = [];
  const signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(history, {
    name: strategy.name,
    reset: () => strategy.reset(),
    onBar: (context) => {
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

function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    symbol, name: "existing Bollinger position", quantity: 300, availableQuantity: 300,
    averagePrice: 10, currentPrice: 12, marketValue: 3_600,
    unrealizedPnl: 600, realizedPnl: 0, weight: 0.36,
    ...overrides,
  };
}

function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return {
    snapshot,
    account: {
      accountId: "Bollinger-fixture", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime,
    },
    positions, equity: 10_000, cash: 10_000, barIndex, totalBars: 20,
  };
}

function feed(strategy: BollingerBandsStrategy, prices: number[], positions: PositionSnapshot[] = []) {
  return snapshots(prices).map((snapshot, index) => strategy.onBar(context(snapshot, index, positions)));
}

describe("BollingerBandsStrategy actual holdings", () => {
  it("does not churn a real account on a fully unchanged price series", () => {
    const { engine, signals } = createRun(new BollingerBandsStrategy(3, 1, 0.5), snapshots(Array(12).fill(10)));
    const report = engine.run();
    expect(signals.every((output) => output.length === 0)).toBe(true);
    expect(report.orders).toEqual([]);
    expect(report.trades).toEqual([]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
    expect(report.metrics.totalCommission).toBe(0);
  });

  it.each([0.1, 10.1, 10.01])("does not treat decimal rounding as a range at price %s", (price) => {
    const output = feed(new BollingerBandsStrategy(20, 0.5), Array(25).fill(price));
    expect(output.every((signals) => signals.length === 0)).toBe(true);
  });

  it("keeps the existing-position middle-band exit available in a flat window", () => {
    expect(feed(new BollingerBandsStrategy(3, 1), [10, 10, 10], [position()])[2])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("can enter again when genuine variation resumes after a flat window", () => {
    const output = feed(new BollingerBandsStrategy(3, 1, 0.42), [10, 10, 10, 9]);
    expect(output.slice(0, 3)).toEqual([[], [], []]);
    expect(output[3]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it("preserves a real small range without an arbitrary minimum-volatility cutoff", () => {
    expect(feed(new BollingerBandsStrategy(2, 1, 0.42), [10 + 1e-8, 10])[1])
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it("retries a lower-band buy after a fee rejection when the next price becomes affordable", () => {
    const { engine, contexts, signals } = createRun(
      new BollingerBandsStrategy(3, 1, 1),
      snapshots([10.05, 10.03, 10.01, 10, 9.99, 9.98]),
      { initialCapital: 1_005 },
    );
    const report = engine.run();

    expect(signals.map((output) => output.map((signal) => signal.side))).toEqual([[], [], ["buy"], ["buy"], [], []]);
    expect(contexts[3].positions).toEqual([]);
    expect(contexts[4].positions).toMatchObject([{ quantity: 100, averagePrice: 10 }]);
    expect([...report.orders].reverse()).toMatchObject([
      { side: "buy", quantity: 100, status: "rejected", rejectionReason: "可用资金不足", commission: 0 },
      { side: "buy", quantity: 100, status: "filled", filledPrice: 10, commission: 5 },
    ]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity])).toEqual([[3, "buy", 100]]);
    expect(report.finalAccount.cash).toBe(0);
    expect(report.metrics.totalCommission).toBe(5);
  });

  it("retries qualifying buys without bypassing the order notional limit", () => {
    const { engine, signals } = createRun(
      new BollingerBandsStrategy(3, 1, 0.5), snapshots([12, 11, 10, 9, 8]),
      { maxOrderNotional: 500 },
    );
    const report = engine.run();

    expect(signals.slice(2).map((output) => output[0]?.side)).toEqual(["buy", "buy", "buy"]);
    expect(report.orders).toHaveLength(3);
    expect(report.orders.every((order) => order.status === "rejected" && order.rejectionReason?.includes("单笔限额"))).toBe(true);
    expect(report.trades).toEqual([]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("waits through T+1 and sells the real position above the middle band next day", () => {
    const { engine, contexts, signals } = createRun(
      new BollingerBandsStrategy(3, 1, 0.5),
      snapshots([12, 11, 10, 12, 13], [2, 2, 2, 2, 3]),
    );
    const report = engine.run();

    expect(contexts[3].positions).toMatchObject([{ quantity: 500, availableQuantity: 0 }]);
    expect(signals[3]).toEqual([]);
    expect(contexts[4].positions).toMatchObject([{ quantity: 500, availableQuantity: 500 }]);
    expect(signals[4]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(report.orders.every((order) => order.status === "filled")).toBe(true);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[2, "buy", 500], [4, "sell", 500]]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(11_490);
    expect(report.metrics.totalCommission).toBe(10);
  });

  it("retries a rejected sell while the account still holds shares above the middle band", () => {
    const { engine, contexts, signals } = createRun(
      new BollingerBandsStrategy(3, 1, 0.5), snapshots([12, 11, 10, 12, 13]),
      { maxOrderNotional: 5_000 },
    );
    const report = engine.run();

    expect(signals[3]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(signals[4]).toEqual(signals[3]);
    expect(contexts[4].positions).toMatchObject([{ quantity: 500, availableQuantity: 500 }]);
    expect([...report.orders].reverse()).toMatchObject([
      { side: "buy", status: "filled" },
      { side: "sell", status: "rejected", rejectionReason: expect.stringContaining("单笔限额") },
      { side: "sell", status: "rejected", rejectionReason: expect.stringContaining("单笔限额") },
    ]);
    expect(report.finalPositions).toMatchObject([{ quantity: 500 }]);
    expect(report.finalAccount.cash).toBe(4_995);
    expect(report.metrics.totalCommission).toBe(5);
  });

  it("does not add another buy just because an existing position is below the lower band", () => {
    const existing = position();
    const before = structuredClone(existing);
    expect(feed(new BollingerBandsStrategy(3, 1), [12, 11, 10], [existing])).toEqual([[], [], []]);
    expect(existing).toEqual(before);
  });

  it("recognizes shares already held before the strategy instance starts", () => {
    const output = feed(new BollingerBandsStrategy(3, 1), [10, 11, 12], [position()]);
    expect(output[2]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it.each([
    { quantity: 350, availableQuantity: 199, expected: 100 },
    { quantity: 250, availableQuantity: 500, expected: 200 },
    { quantity: 300, availableQuantity: undefined, expected: 300 },
    { quantity: 300, availableQuantity: 0, expected: 0 },
    { quantity: 300, availableQuantity: 99, expected: 0 },
    { quantity: 50, availableQuantity: 300, expected: 0 },
  ])("sells whole available lots from $quantity shares with $availableQuantity available", ({ quantity, availableQuantity, expected }) => {
    const output = feed(new BollingerBandsStrategy(3, 1), [10, 11, 12], [position({ quantity, availableQuantity })])[2];
    expect(output).toEqual(expected === 0 ? [] : [{ symbol, side: "sell", type: "market", quantity: expected }]);
  });

  it("follows remaining holdings and availability after partial sales", () => {
    const strategy = new BollingerBandsStrategy(3, 1);
    const history = snapshots([10, 11, 12, 13, 14]);
    strategy.onBar(context(history[0], 0));
    strategy.onBar(context(history[1], 1));
    const partial = strategy.onBar(context(history[2], 2, [position({ quantity: 300, availableQuantity: 100 })]));
    const locked = strategy.onBar(context(history[3], 3, [position({ quantity: 200, availableQuantity: 0 })]));
    const unlocked = strategy.onBar(context(history[4], 4, [position({ quantity: 200, availableQuantity: 200 })]));

    expect(partial).toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect(locked).toEqual([]);
    expect(unlocked).toEqual([{ symbol, side: "sell", type: "market", quantity: 200 }]);
  });

  it("does not emit a phantom sell after a buy intention leaves no actual holdings", () => {
    const output = feed(new BollingerBandsStrategy(3, 1), [12, 11, 10, 12]);
    expect(output[2][0]?.side).toBe("buy");
    expect(output[3]).toEqual([]);
  });

  it("uses the matching position and preserves selection of the first tradable quote", () => {
    const strategy = new BollingerBandsStrategy(3, 1);
    const output = snapshots([10, 11, 12]).map((market, index) => {
      const quote = market.quotes[0];
      const mixed = { ...market, quotes: [
        { ...quote, symbol: "untradable", tradable: false, price: 1_000 },
        quote,
        { ...quote, symbol: "600002", price: 500 },
      ] };
      return strategy.onBar(context(mixed, index, [position({ symbol: "600002", quantity: 900 }), position({ quantity: 200 })]));
    });
    expect(output[2]).toEqual([{ symbol, side: "sell", type: "market", quantity: 200 }]);
  });

  it("does not treat another symbol's position as a holding of this lower-band candidate", () => {
    const output = feed(new BollingerBandsStrategy(3, 1, 0.42), [12, 11, 10], [position({ symbol: "600002" })]);
    expect(output[2]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it("keeps the period warmup, lower-band equality and middle-band equality", () => {
    const strategy = new BollingerBandsStrategy(2, 1, 0.42);
    expect(feed(strategy, [11, 9]))
      .toEqual([[], [{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]]);
    expect(feed(new BollingerBandsStrategy(3, 1, 0.42), [9, 11, 10], [position()]))
      .toEqual([[], [], [{ symbol, side: "sell", type: "market", quantity: 300 }]]);
  });

  it("retains the configured standard deviation multiplier", () => {
    expect(feed(new BollingerBandsStrategy(3, 3, 0.42), [12, 11, 10])).toEqual([[], [], []]);
    expect(feed(new BollingerBandsStrategy(3, 1, 0.42), [12, 11, 10])[2])
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it("resets price history and reproduces reports across reused and fresh instances", () => {
    const history = snapshots([10.05, 10.03, 10.01, 10, 9.99, 9.98]);
    const strategy = new BollingerBandsStrategy(3, 1, 1, "local Bollinger replay");
    const { engine } = createRun(strategy, history, { initialCapital: 1_005 });
    const first = engine.run();
    expect(engine.run()).toEqual(first);
    expect(createRun(new BollingerBandsStrategy(3, 1, 1, "local Bollinger replay"), history, { initialCapital: 1_005 }).engine.run()).toEqual(first);
    strategy.reset();
    expect(strategy.onBar(context(history[0], 0, [position()]))).toEqual([]);
  });
});
