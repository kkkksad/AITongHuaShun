import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { MACDStrategy } from "./MACDStrategy";

const symbol = "600001";

function snapshots(prices: number[], days = prices.map((_, index) => index + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return {
      mode: "paper", sequence: index + 1, marketTime,
      quotes: [{
        symbol, name: "deterministic MACD holdings fixture", tradable: true, price,
        previousClose: prices[index - 1] ?? price, changePercent: 0,
        volume: 1_000_000, updatedAt: marketTime,
      }],
    };
  });
}

function createRun(history: MarketSnapshot[], input: {
  strategy?: MACDStrategy;
  config?: Partial<BacktestConfig>;
  seed?: (context: StrategyContext) => StrategySignal[];
} = {}) {
  const strategy = input.strategy ?? new MACDStrategy(1, 2, 2, 0.5);
  const contexts: StrategyContext[] = [];
  const signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(history, {
    name: strategy.name,
    reset() {
      strategy.reset();
      contexts.length = 0;
      signals.length = 0;
    },
    onBar(context) {
      contexts.push(context);
      const output = strategy.onBar(context);
      signals.push(output);
      // Extra fixture shares use actual orders and the broker's T+1 accounting.
      return [...(input.seed?.(context) ?? []), ...output];
    },
  }, {
    initialCapital: 10_000, maxOrderNotional: 1_000_000,
    maxPositionWeight: 1, maxDailyLoss: 1,
    commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0,
    ...input.config,
  });
  return { engine, contexts, signals };
}

function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    symbol, name: "existing MACD position", quantity: 300, availableQuantity: 300,
    averagePrice: 10, currentPrice: 10, marketValue: 3_000,
    unrealizedPnl: 0, realizedPnl: 0, weight: 0.3,
    ...overrides,
  };
}

function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return {
    snapshot,
    account: {
      accountId: "MACD-holdings-fixture", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime,
    },
    positions, equity: 10_000, cash: 10_000, barIndex, totalBars: 20,
  };
}

// Controlled account snapshots test quantity boundaries without claiming fills.
function feed(strategy: MACDStrategy, prices: number[], positions: PositionSnapshot[] = []) {
  return snapshots(prices).map((market, index) => strategy.onBar(context(market, index, positions)));
}

describe("MACDStrategy actual holdings and histogram events", () => {
  it("does not add shares on a new golden cross while the actual position is still T+1 locked", () => {
    const { engine, signals, contexts } = createRun(snapshots([10, 9, 8, 7, 10, 7, 10], [2, 2, 2, 2, 2, 2, 2]));
    const report = engine.run();
    expect(contexts[5].positions).toMatchObject([{ symbol, quantity: 500, availableQuantity: 0 }]);
    expect(signals[5]).toEqual([]);
    expect(signals[6]).toEqual([]);
    expect(report.trades).toMatchObject([{ symbol, side: "buy", quantity: 500, price: 10, barIndex: 4 }]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 500, availableQuantity: 0 }]);
    expect(report.finalAccount.cash).toBe(4_995);
    expect(report.metrics.totalCommission).toBe(5);
  });

  it("exits actual shares on the next real death cross after they unlock", () => {
    const { engine, signals, contexts } = createRun(snapshots([10, 9, 8, 7, 10, 7, 10, 7], [2, 2, 2, 2, 2, 2, 2, 3]));
    const report = engine.run();
    expect(signals[5]).toEqual([]);
    expect(signals[6]).toEqual([]);
    expect(contexts[7].positions).toMatchObject([{ symbol, quantity: 500, availableQuantity: 500 }]);
    expect(signals[7]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(report.trades).toMatchObject([
      { symbol, side: "buy", quantity: 500, price: 10, barIndex: 4 },
      { symbol, side: "sell", quantity: 500, price: 7, barIndex: 7 },
    ]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(8_490);
  });

  it("does not backfill a locked exit when histogram stays negative after the shares unlock", () => {
    const { engine, signals } = createRun(snapshots([10, 9, 8, 7, 10, 7, 6, 10, 7], [2, 2, 2, 2, 2, 2, 3, 3, 3]));
    const report = engine.run();
    expect(signals.slice(5, 8)).toEqual([[], [], []]);
    expect(signals[8]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(report.trades.map(({ side, quantity, barIndex }) => [side, quantity, barIndex]))
      .toEqual([["buy", 500, 4], ["sell", 500, 8]]);
    expect(report.orders).toHaveLength(2);
  });

  it("sells only the settled portion of actual holdings on a death cross", () => {
    const { engine, signals, contexts } = createRun(snapshots([10, 9, 8, 7, 10, 11, 7], [2, 2, 2, 2, 2, 3, 3]), {
      seed: (current) => current.barIndex === 5 ? [{ symbol, side: "buy", type: "market", quantity: 100 }] : [],
    });
    const report = engine.run();
    expect(contexts[6].positions).toMatchObject([{ symbol, quantity: 600, availableQuantity: 500 }]);
    expect(signals[6]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(report.trades).toMatchObject([
      { symbol, side: "buy", quantity: 500, price: 10, barIndex: 4 },
      { symbol, side: "buy", quantity: 100, price: 11, barIndex: 5 },
      { symbol, side: "sell", quantity: 500, price: 7, barIndex: 6 },
    ]);
    expect(report.orders.every((order) => order.status === "filled")).toBe(true);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 100, availableQuantity: 0 }]);
    expect(report.finalAccount.cash).toBe(7_385);
    expect(report.metrics.totalCommission).toBe(15);
  });

  it("does not sell the remainder of a partial exit on a later bar without another death cross", () => {
    const { engine, signals, contexts } = createRun(snapshots([10, 9, 8, 7, 10, 11, 7, 6], [2, 2, 2, 2, 2, 3, 3, 4]), {
      seed: (current) => current.barIndex === 5 ? [{ symbol, side: "buy", type: "market", quantity: 100 }] : [],
    });
    const report = engine.run();
    expect(contexts[7].positions).toMatchObject([{ symbol, quantity: 100, availableQuantity: 100 }]);
    expect(signals[7]).toEqual([]);
    expect(report.orders).toHaveLength(3);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 100, availableQuantity: 100 }]);
    expect(report.finalAccount.cash).toBe(7_385);
  });

  it("preserves the existing recovery at the next real golden cross after a fee-rejected buy", () => {
    const { engine, signals } = createRun(snapshots([10, 9, 8, 7, 10.01, 7, 10.2]), {
      strategy: new MACDStrategy(1, 2, 2, 1), config: { initialCapital: 2_005 },
    });
    const report = engine.run();
    expect(signals[4]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 1 }]);
    expect(signals[6]).toEqual(signals[4]);
    expect([...report.orders].reverse()).toMatchObject([
      { side: "buy", quantity: 200, status: "rejected", rejectionReason: "可用资金不足", commission: 0 },
      { side: "buy", quantity: 100, status: "filled", filledPrice: 10.2, commission: 5 },
    ]);
    expect(report.trades).toMatchObject([{ symbol, side: "buy", quantity: 100, price: 10.2, barIndex: 6 }]);
    expect(report.finalAccount.cash).toBe(980);
    expect(report.metrics.totalCommission).toBe(5);
  });

  it("preserves a fresh golden-cross attempt after risk rejects the previous buy", () => {
    const { engine } = createRun(snapshots([10, 9, 8, 7, 10, 7, 10]), { config: { maxOrderNotional: 500 } });
    const report = engine.run();
    expect(report.orders).toHaveLength(2);
    expect(report.orders.every((order) => order.side === "buy" && order.status === "rejected")).toBe(true);
    expect(report.trades).toEqual([]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("does not retry a rejected buy during the same positive-histogram run without a new cross", () => {
    const { engine } = createRun(snapshots([10, 9, 8, 7, 10, 11, 12]), { config: { maxOrderNotional: 500 } });
    const report = engine.run();
    expect(report.orders).toHaveLength(1);
    expect(report.orders[0]).toMatchObject({ side: "buy", status: "rejected" });
    expect(report.trades).toEqual([]);
  });

  it("does not add to an existing actual position at a golden cross", () => {
    const existing = position();
    const before = structuredClone(existing);
    expect(feed(new MACDStrategy(1, 2, 2), [10, 9, 8, 7, 10], [existing])).toEqual([[], [], [], [], []]);
    expect(existing).toEqual(before);
  });

  it("can exit a position held before its first positive histogram without emitting a buy", () => {
    const output = feed(new MACDStrategy(1, 2, 2), [10, 10, 10, 11, 10], [position()]);
    expect(output.slice(0, 4)).toEqual([[], [], [], []]);
    expect(output[4]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it.each([
    { quantity: 350, availableQuantity: 199, expected: 100 },
    { quantity: 250, availableQuantity: 500, expected: 200 },
    { quantity: 300, availableQuantity: undefined, expected: 300 },
    { quantity: 300, availableQuantity: 0, expected: 0 },
    { quantity: 300, availableQuantity: 99, expected: 0 },
    { quantity: 50, availableQuantity: 300, expected: 0 },
  ])("uses sellable whole lots at the death cross for $quantity shares and $availableQuantity available", ({ quantity, availableQuantity, expected }) => {
    const output = feed(new MACDStrategy(1, 2, 2), [10, 10, 10, 11, 10], [position({ quantity, availableQuantity })])[4];
    expect(output).toEqual(expected === 0 ? [] : [{ symbol, side: "sell", type: "market", quantity: expected }]);
  });

  it("waits for a new cross after a partial exit and then reads the remaining actual shares", () => {
    const strategy = new MACDStrategy(1, 2, 2);
    const history = snapshots([10, 10, 10, 11, 10, 9, 11, 9]);
    const output = history.map((market, index) => strategy.onBar(context(market, index, [position({
      quantity: index <= 4 ? 300 : 200, availableQuantity: index <= 4 ? 100 : 200,
    })])));
    expect(output[4]).toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect(output.slice(5, 7)).toEqual([[], []]);
    expect(output[7]).toEqual([{ symbol, side: "sell", type: "market", quantity: 200 }]);
  });

  it("does not issue a phantom sell after an unfilled golden-cross intention", () => {
    const output = feed(new MACDStrategy(1, 2, 2), [10, 9, 8, 7, 10, 7]);
    expect(output[4][0]?.side).toBe("buy");
    expect(output[5]).toEqual([]);
  });

  it("uses only the bound stock's actual position when other quotes move ahead", () => {
    const strategy = new MACDStrategy(1, 2, 2);
    const output = snapshots([10, 10, 10, 11, 10]).map((market, index) => {
      const a = market.quotes[0];
      const b = { ...a, symbol: "600002", price: 500 };
      const mixed = { ...market, quotes: index === 0 ? [a, b] : [b, a] };
      return strategy.onBar(context(mixed, index, [position({ symbol: "600002", quantity: 900 }), position({ quantity: 200 })]));
    });
    expect(output[4]).toEqual([{ symbol, side: "sell", type: "market", quantity: 200 }]);
  });

  it("does not treat another stock's position as the bound stock's position", () => {
    const output = feed(new MACDStrategy(1, 2, 2, 0.42), [10, 9, 8, 7, 10], [position({ symbol: "600002" })]);
    expect(output[4]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it("resets binding and histogram and reproduces economic reports on reused and fresh instances", () => {
    const history = snapshots([10, 9, 8, 7, 10, 7, 10], [2, 2, 2, 2, 2, 2, 2]);
    const strategy = new MACDStrategy(1, 2, 2, 0.5, "local MACD holdings replay");
    const { engine } = createRun(history, { strategy });
    const report = engine.run();
    expect(report.trades).toMatchObject([{ symbol, side: "buy", quantity: 500, barIndex: 4 }]);
    expect(engine.run()).toEqual(report);
    expect(createRun(history, { strategy: new MACDStrategy(1, 2, 2, 0.5, "local MACD holdings replay") }).engine.run()).toEqual(report);
    strategy.reset();
    expect(strategy.onBar(context(history[0], 0, [position()]))).toEqual([]);
  });
});
