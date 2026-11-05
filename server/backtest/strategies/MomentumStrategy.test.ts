import { describe, expect, it } from "vitest";
import type { StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { MomentumStrategy } from "./MomentumStrategy";

const symbol = "600001";
const buy = { symbol, side: "buy", type: "market", targetWeight: 0.42 };
const sell = { symbol, side: "sell", type: "market", quantity: 100 };

function snapshots(prices: number[]): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, index + 2, 6)).toISOString();
    return {
      mode: "paper",
      sequence: index + 1,
      marketTime,
      quotes: [{
        symbol, name: "deterministic momentum fixture", tradable: true, price,
        previousClose: prices[index - 1] ?? price, changePercent: 0,
        volume: 1_000_000, updatedAt: marketTime,
      }],
    };
  });
}

function context(snapshot: MarketSnapshot, barIndex: number, totalBars: number): StrategyContext {
  return {
    snapshot,
    account: {
      accountId: "momentum-fixture", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime,
    },
    positions: [],
    equity: 10_000,
    cash: 10_000,
    barIndex,
    totalBars,
  };
}

// Controlled holdings supply 100 settled shares after an entry and remove them
// after an exit, isolating channel boundaries. Only engine tests assert real fills.
function replay(strategy: MomentumStrategy, prices: number[]): StrategySignal[][] {
  const history = snapshots(prices);
  let heldQuantity = 0;
  let averagePrice = 0;
  return history.map((market, index) => {
    const price = market.quotes[0].price;
    const current = context(market, index, history.length);
    current.positions = heldQuantity > 0 ? [{
      symbol, name: "controlled channel holding", quantity: heldQuantity,
      availableQuantity: heldQuantity, averagePrice, currentPrice: price,
      marketValue: heldQuantity * price, unrealizedPnl: heldQuantity * (price - averagePrice),
      realizedPnl: 0, weight: heldQuantity * price / current.equity,
    }] : [];
    const output = strategy.onBar(current);
    for (const signal of output) {
      if (signal.side === "buy") {
        heldQuantity = 100;
        averagePrice = price;
      } else {
        heldQuantity = Math.max(0, heldQuantity - (signal.quantity ?? heldQuantity));
      }
    }
    return output;
  });
}

function run(prices: number[], entry = 3, exit = 3) {
  return new BacktestEngine(snapshots(prices), new MomentumStrategy(entry, exit, 0.5), {
    initialCapital: 10_000,
    maxOrderNotional: 1_000_000,
    maxPositionWeight: 1,
    maxDailyLoss: 1,
  });
}

describe("MomentumStrategy complete historical windows", () => {
  it.each([1, 3, 5])("requires %i complete previous prices and evaluates the next bar", (period) => {
    const prices = Array.from({ length: period + 1 }, (_, index) => 10 + index);
    const output = replay(new MomentumStrategy(period, 2, 0.42), prices);

    expect(output.slice(0, period)).toEqual(Array.from({ length: period }, () => []));
    expect(output[period]).toEqual([buy]);
  });

  it("keeps the oldest high in the full prior entry window until it expires", () => {
    const output = replay(new MomentumStrategy(3, 3, 0.42), [20, 10, 11, 12, 13]);

    expect(output[3]).toEqual([]); // Previous three prices are 20, 10, 11.
    expect(output[4]).toEqual([buy]); // The old 20 has now left the window.
  });

  it("keeps the inclusive entry comparison at the oldest historical high", () => {
    const output = replay(new MomentumStrategy(3, 3, 0.42), [15, 14, 13, 15]);
    expect(output[3]).toEqual([buy]);
  });

  it("does not exit when the oldest prior low still lies below the current price", () => {
    const output = replay(new MomentumStrategy(3, 3, 0.42), [8, 9, 10, 11, 12, 10.5]);

    expect(output[5]).toEqual([]); // Previous three prices are 10, 11, 12.
  });

  it("exits after that oldest low expires from the historical window", () => {
    const output = replay(new MomentumStrategy(3, 3, 0.42), [8, 9, 10, 11, 12, 10.5, 10.5]);

    expect(output[5]).toEqual([]);
    expect(output[6]).toEqual([sell]); // Previous low is now 10.5, with equality allowed.
  });

  it("waits for a complete exit history when its period exceeds the entry period", () => {
    const output = replay(new MomentumStrategy(2, 5, 0.42), [10, 11, 12, 8, 7, 6]);

    expect(output[2]).toEqual([buy]);
    expect(output[3]).toEqual([]);
    expect(output[4]).toEqual([]);
    expect(output[5]).toEqual([sell]);
  });

  it("keeps the inclusive exit comparison at the oldest historical low", () => {
    const output = replay(new MomentumStrategy(3, 3, 0.42), [8, 9, 10, 11, 12, 10]);
    expect(output[5]).toEqual([sell]);
  });

  it("retains the buy target weight and exits the controlled actual holding", () => {
    const output = replay(new MomentumStrategy(3, 2, 0.42), [8, 9, 10, 11, 12, 10, 9, 10, 11]);

    expect(output[3]).toEqual([buy]);
    expect(output[4]).toEqual([]);
    expect(output[5]).toEqual([sell]);
    expect(output[8]).toEqual([buy]);
  });

  it("counts only selected tradable observations and preserves first-tradable selection", () => {
    const strategy = new MomentumStrategy(3, 2, 0.42);
    const output = snapshots([10, 999, 11, 12, 13]).map((market, index, history) => {
      const quote = market.quotes[0];
      const selected = index === 1
        ? { ...market, quotes: [{ ...quote, tradable: false }] }
        : { ...market, quotes: [
          { ...quote, symbol: "untradable", tradable: false, price: 999 },
          quote,
          { ...quote, symbol: "600002", price: 1 },
        ] };
      return strategy.onBar(context(selected, index, history.length));
    });

    expect(output.slice(0, 4)).toEqual([[], [], [], []]);
    expect(output[4]).toEqual([buy]);
  });

  it("keeps prefix signals independent of unseen prices and the total bar count", () => {
    const prefix = [20, 10, 11, 12, 13, 14, 9];
    const expected = replay(new MomentumStrategy(3, 2, 0.42), prefix);
    expect(expected.flat().map((signal) => signal.side)).toEqual(["buy", "sell"]);

    for (const suffix of [[100, 200, 300], [1, 0.5, 0.1]]) {
      expect(replay(new MomentumStrategy(3, 2, 0.42), [...prefix, ...suffix]).slice(0, prefix.length))
        .toEqual(expected);
    }
  });

  it("resets price history for an identical controlled-holdings replay", () => {
    const strategy = new MomentumStrategy(3, 2, 0.42, "local momentum replay");
    const prices = [20, 10, 11, 12, 13]; // Ends with a controlled open holding.
    const expected = replay(strategy, prices);
    expect(expected.flat()).toEqual([buy]);

    strategy.reset();
    expect(replay(strategy, prices)).toEqual(expected);
    expect(strategy.name).toBe("local momentum replay");
  });

  it("delays the real filled buy until the full entry high has expired and preserves paid costs", () => {
    const engine = run([20, 10, 11, 12, 13]);
    const report = engine.run();

    expect(report.trades).toMatchObject([
      { symbol, side: "buy", barIndex: 4, quantity: 300, price: 13.01, commission: 5 },
    ]);
    expect(report.orders).toHaveLength(1);
    expect(report.orders[0].status).toBe("filled");
    expect(report.finalPositions).toMatchObject([{ symbol, quantity: 300, averagePrice: 13.01 }]);
    expect(report.finalAccount.cash).toBe(6_092);
    expect(report.metrics.totalCommission).toBe(5);
    expect(engine.run()).toEqual(report);
  });

  it("delays the real filled exit until the full historical low leaves the window", () => {
    const report = run([8, 9, 10, 11, 12, 10.5, 10.5]).run();

    expect(report.trades).toMatchObject([
      { symbol, side: "buy", barIndex: 3, quantity: 400, price: 11.01, commission: 5 },
      { symbol, side: "sell", barIndex: 6, quantity: 400, price: 10.49, commission: 5 },
    ]);
    expect(report.orders).toHaveLength(2);
    expect(report.orders.every((order) => order.status === "filled")).toBe(true);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(9_782);
    expect(report.metrics.totalCommission).toBe(10);
  });
});
