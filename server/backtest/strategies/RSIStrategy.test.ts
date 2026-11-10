import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { RSIStrategy } from "./RSIStrategy";

const symbol = "600001";

function snapshots(prices: number[], days = prices.map((_, index) => index + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return {
      mode: "paper",
      sequence: index + 1,
      marketTime,
      quotes: [{
        symbol, name: "deterministic RSI fixture", tradable: true, price,
        previousClose: prices[Math.max(0, index - 1)], changePercent: 0,
        volume: 1_000_000, updatedAt: marketTime,
      }],
    };
  });
}

function createRun(strategy: RSIStrategy, history: MarketSnapshot[], config: Partial<BacktestConfig> = {}) {
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
    initialCapital: 10_000,
    maxOrderNotional: 1_000_000,
    maxPositionWeight: 1,
    maxDailyLoss: 1,
    commissionRate: 0.0003,
    minimumCommission: 5,
    slippageBps: 0,
    ...config,
  });
  return { engine, contexts, signals };
}

function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    symbol, name: "existing RSI position", quantity: 300, availableQuantity: 300,
    averagePrice: 10, currentPrice: 12, marketValue: 3_600,
    unrealizedPnl: 600, realizedPnl: 0, weight: 0.36,
    ...overrides,
  };
}

function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return {
    snapshot,
    account: {
      accountId: "RSI-fixture", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime,
    },
    positions,
    equity: 10_000,
    cash: 10_000,
    barIndex,
    totalBars: 20,
  };
}

function feed(strategy: RSIStrategy, prices: number[], positions: PositionSnapshot[] = []) {
  return snapshots(prices).map((snapshot, index) => strategy.onBar(context(snapshot, index, positions)));
}

describe("RSIStrategy actual holdings", () => {
  it("keeps a real position through unchanged prices without inventing an overbought exit", () => {
    const { engine, signals } = createRun(
      new RSIStrategy(2, 30, 70, 0.5), snapshots([12, 11, 10, 10, 10, 10]),
    );
    const report = engine.run();
    expect(signals.slice(3)).toEqual([[], [], []]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[2, "buy", 500]]);
    expect(report.finalPositions).toMatchObject([{ quantity: 500, availableQuantity: 500 }]);
    expect(report.finalAccount.cash).toBe(4_995);
    expect(report.metrics.totalCommission).toBe(5);
  });

  it("still exits the actual position when a genuine rise follows the neutral flat window", () => {
    const { engine, signals } = createRun(
      new RSIStrategy(2, 30, 70, 0.5), snapshots([12, 11, 10, 10, 10, 10, 11, 12]),
    );
    const report = engine.run();
    expect(signals.slice(3, 6)).toEqual([[], [], []]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[2, "buy", 500], [6, "sell", 500]]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_490);
    expect(report.metrics.totalCommission).toBe(10);
  });

  it("retries an oversold buy after a fee rejection when the next price makes it affordable", () => {
    const { engine, contexts, signals } = createRun(
      new RSIStrategy(2, 30, 70, 1),
      snapshots([12, 11, 10.01, 10, 9.99, 9.98]),
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

  it("keeps rejected buy intentions from creating a position while a risk cap still blocks them", () => {
    const { engine, signals } = createRun(
      new RSIStrategy(2, 30, 70, 0.5), snapshots([12, 11, 10, 9, 8]),
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

  it("waits through T+1 and exits the actual shares on the next overbought day", () => {
    const { engine, contexts, signals } = createRun(
      new RSIStrategy(2, 30, 70, 0.5),
      snapshots([12, 11, 10, 11, 12, 13, 14], [2, 2, 2, 2, 2, 3, 3]),
    );
    const report = engine.run();

    expect(contexts[4].positions).toMatchObject([{ quantity: 500, availableQuantity: 0 }]);
    expect(signals[4]).toEqual([]);
    expect(contexts[5].positions).toMatchObject([{ quantity: 500, availableQuantity: 500 }]);
    expect(signals[5]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(report.orders.every((order) => order.status === "filled")).toBe(true);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[2, "buy", 500], [5, "sell", 500]]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(11_490);
    expect(report.metrics.totalCommission).toBe(10);
  });

  it("retries rejected sells while the real position remains and the overbought condition persists", () => {
    const { engine, contexts, signals } = createRun(
      new RSIStrategy(2, 30, 70, 0.5), snapshots([12, 11, 10, 11, 12, 13]),
      { maxOrderNotional: 5_000 },
    );
    const report = engine.run();

    expect(signals[4]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(signals[5]).toEqual(signals[4]);
    expect(contexts[5].positions).toMatchObject([{ quantity: 500, availableQuantity: 500 }]);
    expect([...report.orders].reverse()).toMatchObject([
      { side: "buy", status: "filled" },
      { side: "sell", status: "rejected", rejectionReason: expect.stringContaining("单笔限额") },
      { side: "sell", status: "rejected", rejectionReason: expect.stringContaining("单笔限额") },
    ]);
    expect(report.finalPositions).toMatchObject([{ quantity: 500 }]);
    expect(report.finalAccount.cash).toBe(4_995);
    expect(report.metrics.totalCommission).toBe(5);
  });

  it("does not buy again when the account already holds the oversold symbol", () => {
    const existing = position();
    const before = structuredClone(existing);
    expect(feed(new RSIStrategy(2), [12, 11, 10], [existing])).toEqual([[], [], []]);
    expect(existing).toEqual(before);
  });

  it("can exit a position that was already held before this strategy instance started", () => {
    const output = feed(new RSIStrategy(2), [10, 11, 12], [position()]);
    expect(output[2]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it.each([
    { quantity: 350, availableQuantity: 199, expected: 100 },
    { quantity: 250, availableQuantity: 500, expected: 200 },
    { quantity: 300, availableQuantity: undefined, expected: 300 },
    { quantity: 300, availableQuantity: 0, expected: 0 },
    { quantity: 300, availableQuantity: 99, expected: 0 },
    { quantity: 50, availableQuantity: 300, expected: 0 },
  ])("uses sellable whole lots for $quantity shares with $availableQuantity available", ({ quantity, availableQuantity, expected }) => {
    const output = feed(new RSIStrategy(2), [10, 11, 12], [position({ quantity, availableQuantity })])[2];
    expect(output).toEqual(expected === 0 ? [] : [{ symbol, side: "sell", type: "market", quantity: expected }]);
  });

  it("reads the remaining position after partial fills and waits for locked shares to unlock", () => {
    const strategy = new RSIStrategy(2);
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

  it("does not issue a phantom sell after an unfilled buy intention", () => {
    const output = feed(new RSIStrategy(2), [12, 11, 10, 11, 12]);
    expect(output[2][0]?.side).toBe("buy");
    expect(output[4]).toEqual([]);
  });

  it("uses only the selected quote's position and preserves first-tradable selection", () => {
    const strategy = new RSIStrategy(2);
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

  it("does not treat another symbol's holding as a reason to skip this oversold buy", () => {
    const output = feed(new RSIStrategy(2, 30, 70, 0.42), [12, 11, 10], [position({ symbol: "600002" })]);
    expect(output[2]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it("keeps strict threshold comparisons and the original period-plus-one warmup", () => {
    const strategy = new RSIStrategy(2, 50, 50, 0.42);
    const history = snapshots([10, 9, 10]);
    expect(history.map((market, index) => strategy.onBar(context(market, index)))).toEqual([[], [], []]);
    strategy.reset();
    expect(history.map((market, index) => strategy.onBar(context(market, index, [position()])))).toEqual([[], [], []]);
    strategy.reset();
    const declining = snapshots([12, 11, 10]);
    expect(declining.slice(0, 2).map((market, index) => strategy.onBar(context(market, index)))).toEqual([[], []]);
    expect(strategy.onBar(context(declining[2], 2)))
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it("resets price history and reproduces real reports across reused and fresh instances", () => {
    const history = snapshots([12, 11, 10.01, 10, 9.99, 9.98]);
    const strategy = new RSIStrategy(2, 30, 70, 1, "local RSI replay");
    const { engine } = createRun(strategy, history, { initialCapital: 1_005 });
    const first = engine.run();
    expect(engine.run()).toEqual(first);
    expect(createRun(new RSIStrategy(2, 30, 70, 1, "local RSI replay"), history, { initialCapital: 1_005 }).engine.run()).toEqual(first);
    strategy.reset();
    expect(strategy.onBar(context(history[0], 0, [position()]))).toEqual([]);
  });
});
