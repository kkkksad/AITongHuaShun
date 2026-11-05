import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { MovingAverageCrossStrategy } from "./MovingAverageCrossStrategy";

const symbol = "600001";
const otherSymbol = "600002";
type Operation = { barIndex: number; signal: StrategySignal };

function history(prices: number[], input: { days?: number[]; firstSymbol?: string } = {}): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, input.days?.[index] ?? index + 2, 6, index)).toISOString();
    const firstSymbol = input.firstSymbol ?? symbol;
    const quote = (stock: string, value: number) => ({
      symbol: stock, name: stock, price: value, tradable: true,
      previousClose: value, changePercent: 0, volume: 1_000_000, updatedAt: marketTime,
    });
    return { mode: "paper", sequence: index + 1, marketTime,
      quotes: [quote(firstSymbol, price), quote(firstSymbol === symbol ? otherSymbol : symbol, 20)] };
  });
}

function createRun(snapshots: MarketSnapshot[], input: {
  strategy?: MovingAverageCrossStrategy;
  config?: Partial<BacktestConfig>;
  operations?: Operation[];
} = {}) {
  const strategy = input.strategy ?? new MovingAverageCrossStrategy(1, 2, 0.5);
  const contexts: StrategyContext[] = [];
  const signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, {
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
      // Explicit fixture operations run through the real Broker after strategy
      // evaluation, so subsequent contexts contain actual fills and T+1 locks.
      const operations = input.operations?.filter((operation) => operation.barIndex === context.barIndex)
        .map((operation) => operation.signal) ?? [];
      return [...output, ...operations];
    },
  }, {
    initialCapital: 10_000, maxOrderNotional: 1_000_000,
    maxPositionWeight: 1, maxDailyLoss: 1,
    commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0,
    ...input.config,
  });
  return { engine, contexts, signals };
}

function fixtureBuy(barIndex: number, quantity: number, stock = symbol): Operation {
  return { barIndex, signal: { symbol: stock, side: "buy", type: "market", quantity } };
}

describe("MovingAverageCrossStrategy actual holdings with crossing events", () => {
  it("does not add another position after a same-day death cross cannot sell T+1 locked shares", () => {
    const { engine, contexts, signals } = createRun(history([10, 9, 10, 9, 10], { days: [2, 2, 2, 2, 2] }));
    const report = engine.run();
    expect(contexts[3].positions).toMatchObject([{ symbol, quantity: 500, availableQuantity: 0 }]);
    expect(signals[3]).toEqual([]);
    expect(contexts[4].positions).toMatchObject([{ symbol, quantity: 500, availableQuantity: 0 }]);
    expect(signals[4]).toEqual([]);
    expect(report.orders).toHaveLength(1);
    expect(report.trades).toMatchObject([{ side: "buy", barIndex: 2, quantity: 500, price: 10, commission: 5 }]);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 500, availableQuantity: 0 }]);
    expect(report.finalAccount.cash).toBe(4_995);
    expect(report.metrics.totalCommission).toBe(5);
  });

  it("waits after shares unlock without a new death cross and exits on the next real crossing", () => {
    const { engine, contexts, signals } = createRun(history([10, 9, 10, 9, 8, 10, 9], {
      days: [2, 2, 2, 2, 3, 3, 3],
    }));
    const report = engine.run();
    expect(contexts[4].positions).toMatchObject([{ symbol, quantity: 500, availableQuantity: 500 }]);
    expect(signals.slice(3, 6)).toEqual([[], [], []]);
    expect(signals[6]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[2, "buy", 500], [6, "sell", 500]]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(9_490);
    expect(report.metrics.totalCommission).toBe(10);
  });

  it("waits for a fresh golden cross after a fee-rejected buy and never sells the unfilled intention", () => {
    const { engine, contexts, signals } = createRun(history([10, 9, 10.01, 11, 9, 10.2]), {
      strategy: new MovingAverageCrossStrategy(1, 2, 1), config: { initialCapital: 2_005 },
    });
    const report = engine.run();
    expect(contexts[3].positions).toEqual([]);
    expect(signals[3]).toEqual([]); // Still above the slow line, but no new crossing.
    expect(signals[4]).toEqual([]); // The rejected intention is not an actual position.
    expect(signals[5]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 1 }]);
    expect([...report.orders].reverse()).toMatchObject([
      { side: "buy", quantity: 200, status: "rejected", rejectionReason: "可用资金不足", commission: 0 },
      { side: "buy", quantity: 100, status: "filled", filledPrice: 10.2, commission: 5 },
    ]);
    expect(report.trades).toMatchObject([{ side: "buy", barIndex: 5, quantity: 100, price: 10.2 }]);
    expect(report.finalAccount.cash).toBe(980);
  });

  it("keeps risk-rejected buys as intentions and evaluates only the next actual crossing", () => {
    const { engine, signals } = createRun(history([10, 9, 10, 9, 11]), {
      config: { maxOrderNotional: 500 },
    });
    const report = engine.run();
    expect(signals[2][0]?.side).toBe("buy");
    expect(signals[3]).toEqual([]);
    expect(signals[4][0]?.side).toBe("buy");
    expect(report.orders).toHaveLength(2);
    expect(report.orders.every((order) => order.status === "rejected" && order.rejectionReason?.includes("单笔限额"))).toBe(true);
    expect(report.trades).toEqual([]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("does not buy again on a golden cross when an independent real fill already owns that stock", () => {
    const { engine, contexts, signals } = createRun(history([10, 9, 10]), {
      operations: [fixtureBuy(0, 300)],
    });
    const report = engine.run();
    expect(contexts[2].positions).toMatchObject([{ symbol, quantity: 300, availableQuantity: 300 }]);
    expect(signals[2]).toEqual([]);
    expect(report.trades).toMatchObject([{ symbol, side: "buy", barIndex: 0, quantity: 300 }]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 300 }]);
  });

  it("can exit a separately acquired actual holding on its death cross", () => {
    const { engine, signals } = createRun(history([10, 11, 10]), {
      operations: [fixtureBuy(0, 300)],
    });
    const report = engine.run();
    expect(signals[2]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[0, "buy", 300], [2, "sell", 300]]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(9_990);
  });

  it("sells the 500 actual settled shares and retains the separately bought 100 T+1 shares", () => {
    const { engine, contexts, signals } = createRun(history([10, 9, 10, 11, 9], {
      days: [2, 2, 2, 3, 3],
    }), { operations: [fixtureBuy(3, 100)] });
    const report = engine.run();
    expect(contexts[4].positions).toMatchObject([{ symbol, quantity: 600, availableQuantity: 500 }]);
    expect(signals[4]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(report.orders.every((order) => order.status === "filled")).toBe(true);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[2, "buy", 500], [3, "buy", 100], [4, "sell", 500]]);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 100, availableQuantity: 0, t1LockedQuantity: 100 }]);
    expect(report.finalAccount.cash).toBe(8_385);
    expect(report.metrics.totalCommission).toBe(15);
  });

  it("keeps the remaining actual shares through a golden cross and sells them on the next death cross after unlocking", () => {
    const { engine, contexts, signals } = createRun(history([10, 9, 10, 11, 9, 10, 9], {
      days: [2, 2, 2, 3, 3, 4, 4],
    }), { operations: [fixtureBuy(3, 100)] });
    const report = engine.run();
    expect(signals[4]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(contexts[5].positions).toMatchObject([{ symbol, quantity: 100, availableQuantity: 100 }]);
    expect(signals[5]).toEqual([]);
    expect(signals[6]).toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[2, "buy", 500], [3, "buy", 100], [4, "sell", 500], [6, "sell", 100]]);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(9_280);
  });

  it("does not let another stock's holding block a new golden-cross entry", () => {
    const { engine, signals } = createRun(history([10, 9, 10]), {
      strategy: new MovingAverageCrossStrategy(1, 2, 0.42),
      operations: [fixtureBuy(0, 100, otherSymbol)],
    });
    const report = engine.run();
    expect(signals[2]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
    expect(report.trades.map(({ symbol, side }) => [symbol, side])).toEqual([[otherSymbol, "buy"], [symbol, "buy"]]);
    expect(report.finalPositions.find((position) => position.symbol === otherSymbol)?.quantity).toBe(100);
  });

  it("does not sell another actual holding when the bound stock crosses down without a position", () => {
    const { engine, signals } = createRun(history([10, 11, 10]), {
      operations: [fixtureBuy(0, 100, otherSymbol)],
    });
    const report = engine.run();
    expect(signals[2]).toEqual([]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol: otherSymbol, quantity: 100 }]);
  });

  it("selects only the bound stock's actual quantity when both stocks have settled positions", () => {
    const { engine, contexts, signals } = createRun(history([10, 11, 10]), {
      operations: [fixtureBuy(0, 300), fixtureBuy(0, 100, otherSymbol)],
    });
    const report = engine.run();
    expect(contexts[2].positions).toMatchObject([
      { symbol, quantity: 300, availableQuantity: 300 },
      { symbol: otherSymbol, quantity: 100, availableQuantity: 100 },
    ]);
    expect(signals[2]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
    expect(report.finalPositions).toMatchObject([{ symbol: otherSymbol, quantity: 100 }]);
    expect(report.trades.filter((trade) => trade.side === "sell")).toMatchObject([{ symbol, quantity: 300 }]);
  });

  it("does not issue a phantom sell after an independent full liquidation and can enter the next real golden cross", () => {
    const { engine, contexts, signals } = createRun(history([10, 9, 10, 11, 10, 11]), {
      operations: [{ barIndex: 3, signal: { symbol, side: "sell", type: "market", quantity: 500 } }],
    });
    const report = engine.run();
    expect(contexts[4].positions).toEqual([]);
    expect(signals[4]).toEqual([]);
    expect(signals[5]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[2, "buy", 500], [3, "sell", 500], [5, "buy", 400]]);
  });

  it("keeps risk-rejected sell shares and does not retry until another actual death cross", () => {
    const { engine, contexts, signals } = createRun(history([10, 9, 10, 12, 11, 10.5, 12, 11]), {
      config: { maxOrderNotional: 5_000 },
    });
    const report = engine.run();
    expect(signals[4]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(signals[5]).toEqual([]);
    expect(signals[6]).toEqual([]);
    expect(contexts[7].positions).toMatchObject([{ symbol, quantity: 500, availableQuantity: 500 }]);
    expect(signals[7]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect([...report.orders].reverse()).toMatchObject([
      { side: "buy", status: "filled", quantity: 500 },
      { side: "sell", status: "rejected", quantity: 500 },
      { side: "sell", status: "rejected", quantity: 500 },
    ]);
    expect(report.trades).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 500 }]);
    expect(report.finalAccount.cash).toBe(4_995);
  });

  it("keeps current-line equality from becoming a crossing even with an actual position", () => {
    const { engine, signals } = createRun(history([10, 10, 10]), { operations: [fixtureBuy(0, 300)] });
    const report = engine.run();
    expect(signals).toEqual([[], [], []]);
    expect(report.orders).toHaveLength(1);
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 300 }]);
  });

  it("preserves slow-period warmup when an independent actual position already exists", () => {
    const { engine, signals } = createRun(history([10, 9]), { operations: [fixtureBuy(0, 300)] });
    const report = engine.run();
    expect(signals).toEqual([[], []]);
    expect(report.orders).toHaveLength(1);
  });

  it("resets history and binding between deterministic engine and strategy replays", () => {
    const strategy = new MovingAverageCrossStrategy(1, 2, 0.42, "local actual MA replay");
    const first = createRun(history([10, 9, 10, 9]), { strategy });
    const report = first.engine.run();
    expect(report.trades.map(({ side, quantity }) => [side, quantity])).toEqual([["buy", 400], ["sell", 400]]);
    expect(first.engine.run()).toEqual(report);
    strategy.reset();
    const second = history([20, 19, 20, 19], { firstSymbol: otherSymbol });
    const next = createRun(second, { strategy }).engine.run();
    expect(next.trades.map(({ symbol, side, quantity }) => [symbol, side, quantity]))
      .toEqual([[otherSymbol, "buy", 200], [otherSymbol, "sell", 200]]);
    expect(next).toEqual(createRun(second, { strategy: new MovingAverageCrossStrategy(1, 2, 0.42, "local actual MA replay") }).engine.run());
  });

  it("retains a normal stable multi-stock report with actual costs compared with that stock alone", () => {
    const snapshots = history([10, 9, 10, 11, 10, 9, 10, 9]);
    const config = { slippageBps: 5 };
    const { engine } = createRun(snapshots, { config });
    const report = engine.run();
    expect(report.trades).toHaveLength(4);
    expect(report.metrics.totalCommission).toBe(20);
    expect(report.finalAccount.cash).toBe(9_580);
    expect(report.finalPositions).toEqual([]);
    const single = snapshots.map((snapshot) => ({ ...snapshot,
      quotes: snapshot.quotes.filter((quote) => quote.symbol === symbol) }));
    expect(report).toEqual(createRun(single, { config }).engine.run());
    expect(engine.run()).toEqual(report);
  });
});
