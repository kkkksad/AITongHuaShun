import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { MomentumStrategy } from "./MomentumStrategy";

const symbol = "600001";

function snapshots(prices: number[], days = prices.map((_, index) => index + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return {
      mode: "paper", sequence: index + 1, marketTime,
      quotes: [{
        symbol, name: "deterministic momentum holdings fixture", tradable: true, price,
        previousClose: prices[index - 1] ?? price, changePercent: 0,
        volume: 1_000_000, updatedAt: marketTime,
      }],
    };
  });
}

function createRun(strategy: MomentumStrategy, history: MarketSnapshot[], config: Partial<BacktestConfig> = {}) {
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
    symbol, name: "existing momentum position", quantity: 300, availableQuantity: 300,
    averagePrice: 10, currentPrice: 8, marketValue: 2_400,
    unrealizedPnl: -600, realizedPnl: 0, weight: 0.24,
    ...overrides,
  };
}

function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return {
    snapshot,
    account: {
      accountId: "momentum-holdings-fixture", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime,
    },
    positions, equity: 10_000, cash: 10_000, barIndex, totalBars: 20,
  };
}

function feed(strategy: MomentumStrategy, prices: number[], positions: PositionSnapshot[] = []) {
  return snapshots(prices).map((market, index) => strategy.onBar(context(market, index, positions)));
}

describe("MomentumStrategy actual holdings", () => {
  it("retries a fee-rejected buy when the next breakout can fund a smaller whole lot", () => {
    const { engine, contexts, signals } = createRun(
      new MomentumStrategy(2, 2, 1), snapshots([9, 10, 10.01, 10.03, 10.04]),
      { initialCapital: 2_005 },
    );
    const report = engine.run();

    expect(signals.map((output) => output.map((signal) => signal.side)))
      .toEqual([[], [], ["buy"], ["buy"], []]);
    expect(contexts[3].positions).toEqual([]);
    expect(contexts[4].positions).toMatchObject([{ quantity: 100, averagePrice: 10.03 }]);
    expect([...report.orders].reverse()).toMatchObject([
      { side: "buy", quantity: 200, status: "rejected", rejectionReason: "可用资金不足", commission: 0 },
      { side: "buy", quantity: 100, status: "filled", filledPrice: 10.03, commission: 5 },
    ]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[3, "buy", 100]]);
    expect(report.finalAccount.cash).toBeCloseTo(997, 8);
    expect(report.metrics.totalCommission).toBe(5);
  });

  it("keeps rejected buy intentions from becoming holdings while the risk cap still blocks them", () => {
    const { engine, signals } = createRun(
      new MomentumStrategy(2, 2, 0.5), snapshots([8, 9, 10, 11, 12]),
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

  it("waits through T+1 and exits the actual shares on the next qualifying day", () => {
    const { engine, contexts, signals } = createRun(
      new MomentumStrategy(2, 1, 0.5), snapshots([8, 9, 10, 9, 8, 7], [2, 2, 2, 2, 3, 3]),
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
    expect(report.finalAccount.cash).toBe(8_990);
    expect(report.metrics.totalCommission).toBe(10);
  });

  it("retries rejected sells while the actual position and exit condition remain", () => {
    const { engine, contexts, signals } = createRun(
      new MomentumStrategy(2, 1, 0.5), snapshots([8, 9, 10, 12, 11, 10.5]),
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

  it("does not buy again when the account already holds the breakout symbol", () => {
    const existing = position();
    const before = structuredClone(existing);
    expect(feed(new MomentumStrategy(2, 1), [8, 9, 10], [existing])).toEqual([[], [], []]);
    expect(existing).toEqual(before);
  });

  it("can exit a position already held before this strategy instance started", () => {
    const output = feed(new MomentumStrategy(2, 1), [10, 9, 8], [position()]);
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
    const output = feed(new MomentumStrategy(2, 1), [10, 9, 8], [position({ quantity, availableQuantity })])[2];
    expect(output).toEqual(expected === 0 ? [] : [{ symbol, side: "sell", type: "market", quantity: expected }]);
  });

  it("reads remaining shares after a partial exit and waits for the rest to unlock", () => {
    const strategy = new MomentumStrategy(2, 1);
    const history = snapshots([10, 9, 8, 7, 6]);
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
    const output = feed(new MomentumStrategy(2, 1), [8, 9, 10, 9, 8]);
    expect(output[2][0]?.side).toBe("buy");
    expect(output[3]).toEqual([]);
    expect(output[4]).toEqual([]);
  });

  it("uses only the selected quote's actual position and preserves first-tradable selection", () => {
    const strategy = new MomentumStrategy(2, 1);
    const output = snapshots([10, 9, 8]).map((market, index) => {
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

  it("does not treat another symbol's position as a reason to skip this breakout buy", () => {
    const output = feed(new MomentumStrategy(2, 1, 0.42), [8, 9, 10], [position({ symbol: "600002" })]);
    expect(output[2]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it("retains complete prior windows, inclusive comparisons and the configured buy weight", () => {
    expect(feed(new MomentumStrategy(3, 1, 0.42), [15, 14, 13, 15]))
      .toEqual([[], [], [], [{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]]);
    expect(feed(new MomentumStrategy(2, 1), [10, 9, 9], [position()])[2])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("resets history and reproduces reports across reused and fresh instances", () => {
    const history = snapshots([9, 10, 10.01, 10.03]);
    const strategy = new MomentumStrategy(2, 2, 1, "local momentum replay");
    const { engine } = createRun(strategy, history, { initialCapital: 2_005 });
    const report = engine.run();
    expect(report.trades).toMatchObject([{ barIndex: 3, side: "buy", quantity: 100 }]);
    expect(engine.run()).toEqual(report);
    expect(createRun(new MomentumStrategy(2, 2, 1, "local momentum replay"), history, { initialCapital: 2_005 }).engine.run()).toEqual(report);
    strategy.reset();
    expect(strategy.onBar(context(history[0], 0, [position()]))).toEqual([]);
  });
});
