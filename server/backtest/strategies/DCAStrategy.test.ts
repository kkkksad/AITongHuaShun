import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { DCAStrategy } from "./DCAStrategy";

const symbol = "600001";

function snapshots(prices: number[], days = prices.map((_, index) => index + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return {
      mode: "paper",
      sequence: index + 1,
      marketTime,
      quotes: [{
        symbol,
        name: "deterministic DCA fixture",
        tradable: true,
        price,
        previousClose: prices[Math.max(0, index - 1)],
        changePercent: 0,
        volume: 1_000_000,
        updatedAt: marketTime,
      }],
    };
  });
}

function createRun(
  strategy: DCAStrategy,
  history: MarketSnapshot[],
  config: Partial<BacktestConfig> = {},
) {
  const contexts: StrategyContext[] = [];
  const signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(history, {
    name: strategy.name,
    reset: () => strategy.reset(),
    onStart: () => strategy.onStart(),
    onBar: (context) => {
      contexts.push(context);
      const output = strategy.onBar(context);
      signals.push(output);
      return output;
    },
  }, {
    initialCapital: 10_000,
    maxOrderNotional: 10_000,
    maxPositionWeight: 0.15,
    maxDailyLoss: 1,
    slippageBps: 0,
    ...config,
  });
  return { engine, contexts, signals };
}

function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    symbol,
    name: "existing DCA position",
    quantity: 200,
    availableQuantity: 200,
    averagePrice: 10,
    currentPrice: 12,
    marketValue: 2_400,
    unrealizedPnl: 400,
    realizedPnl: 0,
    weight: 0.24,
    ...overrides,
  };
}

function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return {
    snapshot,
    account: {
      accountId: "DCA-fixture",
      mode: "paper",
      cash: 0,
      equity: 10_000,
      marketValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      riskUtilization: 0,
      paused: false,
      updatedAt: snapshot.marketTime,
    },
    positions,
    equity: 10_000,
    cash: 0,
    barIndex,
    totalBars: 10,
  };
}

describe("DCAStrategy actual filled positions", () => {
  it("sells only the filled 100 shares after two buys are rejected by the position limit", () => {
    const { engine, contexts, signals } = createRun(
      new DCAStrategy(1, 1_000, "", 20),
      snapshots([10, 10, 10, 12]),
    );
    const report = engine.run();

    expect(contexts[3].positions).toMatchObject([{ quantity: 100, averagePrice: 10 }]);
    expect(signals[3]).toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect([...report.orders].reverse()).toMatchObject([
      { side: "buy", quantity: 100, status: "filled" },
      { side: "buy", quantity: 100, status: "rejected", rejectionReason: expect.stringContaining("仓位权重") },
      { side: "buy", quantity: 100, status: "rejected", rejectionReason: expect.stringContaining("仓位权重") },
      { side: "sell", quantity: 100, status: "filled" },
    ]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[0, "buy", 100], [3, "sell", 100]]);
    expect(report.finalPositions).toEqual([]);
    expect(report.metrics.totalCommission).toBe(10);
    expect(report.finalAccount.cash).toBe(10_190);
  });

  it("waits without another buy while T+1 locks a profitable position, then exits next day", () => {
    const { engine, contexts, signals } = createRun(
      new DCAStrategy(1, 1_500, "", 20),
      snapshots([10, 12, 12], [2, 2, 3]),
    );
    const report = engine.run();

    expect(contexts[1].positions).toMatchObject([{ quantity: 100, availableQuantity: 0 }]);
    expect(signals[1]).toEqual([]);
    expect(contexts[2].positions).toMatchObject([{ quantity: 100, availableQuantity: 100 }]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[0, "buy", 100], [2, "sell", 100]]);
    expect(report.orders).toHaveLength(2);
    expect(report.finalPositions).toEqual([]);
  });

  it("retries a rejected take-profit sale from the unchanged account on the next bar", () => {
    const { engine, signals } = createRun(
      new DCAStrategy(1, 1_000, "", 10),
      snapshots([10, 12, 11]),
      { maxOrderNotional: 1_100 },
    );
    const report = engine.run();

    expect(signals.slice(1)).toEqual([
      [{ symbol, side: "sell", type: "market", quantity: 100 }],
      [{ symbol, side: "sell", type: "market", quantity: 100 }],
    ]);
    expect([...report.orders].reverse()).toMatchObject([
      { side: "buy", status: "filled" },
      { side: "sell", quantity: 100, status: "rejected", rejectionReason: expect.stringContaining("金额") },
      { side: "sell", quantity: 100, status: "filled" },
    ]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_090);
  });

  it("uses the slipped fill average, excluding commission, for its price-based threshold", () => {
    const { engine, contexts, signals } = createRun(
      new DCAStrategy(1, 2_000, "", 20),
      snapshots([20, 24, 24.02]),
      { maxPositionWeight: 1, slippageBps: 5 },
    );
    const report = engine.run();

    expect(contexts[1].positions).toMatchObject([{ quantity: 100, averagePrice: 20.01 }]);
    expect(contexts[1].cash).toBe(7_994);
    expect(signals[1]).toEqual([]);
    expect(report.trades.map(({ barIndex, side, quantity, price }) => [barIndex, side, quantity, price]))
      .toEqual([[0, "buy", 100, 20.01], [2, "sell", 100, 24.01]]);
    expect(report.metrics.totalCommission).toBe(10);
    expect(report.finalAccount.cash).toBe(10_390);
  });

  it("sells the available part and exits the remaining T+1 lot after it unlocks", () => {
    const { engine, contexts, signals } = createRun(
      new DCAStrategy(1, 1_000, "", 20),
      snapshots([10, 10, 12, 12], [2, 3, 3, 4]),
      { maxPositionWeight: 1 },
    );
    const report = engine.run();

    expect(contexts[2].positions).toMatchObject([{ quantity: 200, availableQuantity: 100 }]);
    expect(signals[2]).toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect(contexts[3].positions).toMatchObject([{ quantity: 100, availableQuantity: 100 }]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[0, "buy", 100], [1, "buy", 100], [2, "sell", 100], [3, "sell", 100]]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_380);
  });

  it.each([
    { quantity: 300, availableQuantity: 150, expected: 100 },
    { quantity: 250, availableQuantity: undefined, expected: 200 },
    { quantity: 200, availableQuantity: 400, expected: 200 },
  ])("bounds and lot-aligns a legacy position with quantity=$quantity and available=$availableQuantity", ({
    quantity, availableQuantity, expected,
  }) => {
    const strategy = new DCAStrategy(1, 1_000, "", 20);
    const held = position({ quantity, availableQuantity });
    if (availableQuantity === undefined) delete held.availableQuantity;

    expect(strategy.onBar(context(snapshots([12])[0], 0, [held])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: expected }]);
  });

  it("finds the configured symbol's actual position even when another holding is listed first", () => {
    const otherSymbol = "600002";
    const snapshot = snapshots([12])[0];
    snapshot.quotes.push({ ...snapshot.quotes[0], symbol: otherSymbol });
    const strategy = new DCAStrategy(1, 1_000, otherSymbol, 20);

    expect(strategy.onBar(context(snapshot, 0, [
      position({ quantity: 500, averagePrice: 1 }),
      position({ symbol: otherSymbol, quantity: 200, availableQuantity: 100 }),
    ]))).toEqual([{ symbol: otherSymbol, side: "sell", type: "market", quantity: 100 }]);
  });

  it("does not transfer one symbol's filled position to a newly selected tradable quote", () => {
    const history = snapshots([10, 12]);
    for (const snapshot of history) {
      snapshot.quotes.push({ ...snapshot.quotes[0], symbol: "600002" });
    }
    history[1].quotes[0].tradable = false;
    const { engine, signals } = createRun(new DCAStrategy(1, 1_000, "", 20), history);
    const report = engine.run();

    expect(signals[1]).toEqual([]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 100 }]);
  });

  it("retains the first attempt and interval after rejected buys, with repeatable engine resets", () => {
    const history = snapshots([10, 10, 10, 10, 10]);
    const { engine, signals } = createRun(new DCAStrategy(2, 1_000, "", 20), history, {
      maxOrderNotional: 500,
    });
    const report = engine.run();

    expect(signals.map((output) => output.length)).toEqual([0, 1, 0, 1, 0]);
    expect([...report.orders].reverse()).toMatchObject([
      { createdAt: history[1].marketTime, status: "rejected" },
      { createdAt: history[3].marketTime, status: "rejected" },
    ]);
    expect(report.trades).toEqual([]);
    expect(engine.run()).toEqual(report);
  });

  it("keeps the default first attempt at bar four and clears attempt cadence on reset or start", () => {
    const strategy = new DCAStrategy();
    const history = snapshots([10, 10, 10, 10, 10, 10]);
    const replay = () => history.map((snapshot, index) => {
      const input = context(snapshot, index);
      input.cash = input.account.cash = 100_000;
      return strategy.onBar(input);
    });
    const first = replay();

    expect(first.map((output) => output.length)).toEqual([0, 0, 0, 0, 1, 0]);
    expect(first[4]).toEqual([{ symbol, side: "buy", type: "market", quantity: 1_000 }]);
    strategy.reset();
    expect(replay()).toEqual(first);
    strategy.onStart();
    expect(replay()).toEqual(first);
  });

  it("keeps take-profit disabled at zero without changing the filled position", () => {
    const { engine } = createRun(new DCAStrategy(1, 1_000, "", 0), snapshots([10, 10, 12]));
    const report = engine.run();

    expect(report.trades.map(({ side, quantity }) => [side, quantity])).toEqual([["buy", 100]]);
    expect(report.finalPositions).toMatchObject([{ quantity: 100 }]);
  });
});
