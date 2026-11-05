import { describe, expect, it } from "vitest";
import type { StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { TurtleStrategy } from "./TurtleStrategy";

function snapshots(prices: number[]): MarketSnapshot[] {
  return prices.map((price, index) => {
    const timestamp = new Date(Date.UTC(2026, 7, index + 3, 7)).toISOString();
    return {
      mode: "paper",
      sequence: index + 1,
      marketTime: timestamp,
      quotes: [{
        symbol: "600001",
        name: "deterministic turtle fixture",
        tradable: true,
        price,
        previousClose: prices[index - 1] ?? price,
        changePercent: 0,
        volume: 1_000_000,
        updatedAt: timestamp,
      }],
    };
  });
}

function context(snapshot: MarketSnapshot, index: number, totalBars: number): StrategyContext {
  return {
    snapshot,
    account: {
      accountId: "turtle-fixture",
      mode: "paper",
      cash: 100_000,
      equity: 100_000,
      marketValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      riskUtilization: 0,
      paused: false,
      updatedAt: snapshot.marketTime,
    },
    positions: [],
    equity: 100_000,
    cash: 100_000,
    barIndex: index,
    totalBars,
  };
}

function replay(strategy: TurtleStrategy, prices: number[]): StrategySignal[][] {
  const history = snapshots(prices);
  return history.map((snapshot, index) => strategy.onBar(context(snapshot, index, history.length)));
}

const buy = { symbol: "600001", side: "buy", type: "market", targetWeight: 0.2 };
const sell = { symbol: "600001", side: "sell", type: "market", targetWeight: 1 };

describe("TurtleStrategy historical channel boundaries", () => {
  it("requires N complete prior observations before evaluating a breakout", () => {
    const output = replay(new TurtleStrategy(3, 2, 0, 0.2), [100, 110, 120, 130]);

    expect(output.slice(0, 3)).toEqual([[], [], []]);
    expect(output[3]).toEqual([buy]);
  });

  it("buys above the prior channel while preserving the estimated high buffer", () => {
    const output = replay(new TurtleStrategy(3, 2, 0, 0.2), [100, 100, 100, 100.5, 110]);

    // The existing estimate is prior close * 1.01, not an unbuffered close high.
    expect(output[3]).toEqual([]);
    expect(output[4]).toEqual([buy]);
  });

  it("sells below the preceding M observations without including the current low", () => {
    const output = replay(new TurtleStrategy(3, 2, 0, 0.2), [100, 100, 100, 110, 120, 90]);

    expect(output[3]).toEqual([buy]);
    expect(output[4]).toEqual([]);
    expect(output[5]).toEqual([sell]);
  });

  it("uses the same historical exit boundary below the trend filter", () => {
    const output = replay(new TurtleStrategy(3, 2, 3, 0.2), [100, 100, 100, 110, 90]);

    expect(output[3]).toEqual([buy]);
    expect(output[4]).toEqual([sell]);
  });

  it("waits for a complete M-observation exit window when it exceeds entry warmup", () => {
    const output = replay(new TurtleStrategy(2, 5, 0, 0.2), [100, 100, 110, 80, 79, 70]);

    expect(output[2]).toEqual([buy]);
    expect(output[3]).toEqual([]);
    expect(output[4]).toEqual([]);
    expect(output[5]).toEqual([sell]);
  });

  it("retains the trend moving-average warmup and entry filter", () => {
    const output = replay(new TurtleStrategy(2, 2, 5, 0.2), [100, 110, 120, 130, 140]);

    expect(output.slice(0, 4)).toEqual([[], [], [], []]);
    expect(output[4]).toEqual([buy]);
  });

  it("keeps blocking a historical breakout below the trend moving average", () => {
    const output = replay(new TurtleStrategy(2, 2, 5, 0.2), [200, 200, 100, 100, 110, 120, 150]);

    expect(output[4]).toEqual([]);
    expect(output[5]).toEqual([]);
    expect(output[6]).toEqual([buy]);
  });

  it("keeps prefix signals independent of unseen later prices and total bar count", () => {
    const prefix = [100, 100, 100, 110, 120, 90];
    const expected = replay(new TurtleStrategy(3, 2, 0, 0.2), prefix);

    expect(expected[3]).toEqual([buy]);
    expect(expected[5]).toEqual([sell]);
    for (const suffix of [[200, 300, 400], [1, 0.5, 0.1]]) {
      expect(replay(new TurtleStrategy(3, 2, 0, 0.2), [...prefix, ...suffix]).slice(0, prefix.length))
        .toEqual(expected);
    }
  });

  it("resets both channels and position state for a deterministic second replay", () => {
    const strategy = new TurtleStrategy(3, 2, 0, 0.2);
    const prices = [100, 100, 100, 110, 120, 90];
    const first = replay(strategy, prices);

    expect(first[3]).toEqual([buy]);
    expect(first[5]).toEqual([sell]);
    strategy.reset();
    expect(replay(strategy, prices)).toEqual(first);
    strategy.reset();
    expect(replay(strategy, [300, 400, 500])).toEqual([[], [], []]);
  });

  it("produces real filled entry and exit orders with the existing engine and fees", () => {
    const report = new BacktestEngine(
      snapshots([100, 100, 100, 110, 120, 90]),
      new TurtleStrategy(3, 2, 0, 0.2),
      { initialCapital: 100_000, maxOrderNotional: 100_000, maxPositionWeight: 1 },
    ).run();

    expect(report.trades).toEqual([
      expect.objectContaining({ symbol: "600001", side: "buy", barIndex: 3, quantity: 100 }),
      expect.objectContaining({ symbol: "600001", side: "sell", barIndex: 5, quantity: 100 }),
    ]);
    expect(report.orders.every((order) => order.status === "filled")).toBe(true);
    expect(report.trades.every((trade) => trade.commission >= 5)).toBe(true);
    expect(report.finalPositions).toEqual([]);
  });
});
