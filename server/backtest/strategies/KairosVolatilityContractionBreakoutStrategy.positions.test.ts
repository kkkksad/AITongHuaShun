import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { KairosVolatilityContractionBreakoutStrategy } from "./KairosBreakoutQualityStrategies";

const symbol = "600001";
const prefix = [...Array.from({ length: 10 }, (_, i) => 9.8 + i * 0.01), 9.9, 9.91, 9.92, 9.93, 9.94];
const rising = [...prefix, 10];
const strategy = (weight = 0.5) => new KairosVolatilityContractionBreakoutStrategy(5, 10, 0.62, 5, 1.4, 8, 4.8, 0.08, 0.035, weight);

function history(prices = rising, days = prices.map((_, index) => index + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return { mode: "paper", sequence: index + 1, marketTime, quotes: [{
      symbol, name: "deterministic contraction fixture", tradable: true, price,
      previousClose: prices[Math.max(0, index - 1)], changePercent: 0.3,
      high: price + (index < 10 ? 0.35 : 0.03), low: price - (index < 10 ? 0.35 : 0.03),
      volume: index < 15 ? 1_000_000 : 2_000_000 * 2 ** (index - 15), updatedAt: marketTime,
    }] };
  });
}

function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return { symbol, name: "held contraction fixture", quantity: 300, availableQuantity: 300,
    averagePrice: 9.2, currentPrice: 10, marketValue: 3_000,
    unrealizedPnl: 240, realizedPnl: 0, weight: 0.3, ...overrides };
}

function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return { snapshot, positions, barIndex, totalBars: 30, equity: 10_000, cash: 10_000,
    account: { accountId: "contraction-fixture", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime } };
}

function project(instance: KairosVolatilityContractionBreakoutStrategy, snapshots: MarketSnapshot[], positions: PositionSnapshot[] = []) {
  return snapshots.map((snapshot, index) => instance.onBar(context(snapshot, index, positions)));
}

function run(snapshots: MarketSnapshot[], config: Partial<BacktestConfig> = {}, instance = strategy()) {
  const contexts: StrategyContext[] = [], signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, { name: instance.name, reset: () => instance.reset(),
    onBar: value => { contexts.push(value); const output = instance.onBar(value); signals.push(output); return output; },
  }, { initialCapital: 10_000, maxOrderNotional: 1_000_000, maxPositionWeight: 1,
    maxDailyLoss: 1, minimumCommission: 5, commissionRate: 0, slippageBps: 0, ...config });
  return { report: engine.run(), engine, contexts, signals };
}

describe("volatility contraction breakout actual position contract", () => {
  it("requires a complete prior baseline and contraction before entry", () => {
    const output = project(strategy(), history());
    expect(output.slice(0, 15)).toEqual(Array.from({ length: 15 }, () => []));
    expect(output[15]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
    // Only the current confirmation bar changes: it cannot define its own historical contraction.
    const wideCurrent = history().map((snapshot, index) => index === 15 ? { ...snapshot,
      quotes: snapshot.quotes.map(quote => ({ ...quote, high: quote.price + 2, low: quote.price - 2 })) } : snapshot);
    expect(project(strategy(), wideCurrent)).toEqual(output);
  });

  it.each(["no-contraction", "weak-volume", "overheated", "negative-change", "no-breakout"])("keeps the original %s entry gate", reason => {
    const snapshots = history().map((snapshot, index) => ({ ...snapshot, quotes: snapshot.quotes.map(quote => ({ ...quote,
      ...(reason === "no-contraction" ? { high: quote.price + 0.35, low: quote.price - 0.35 } : {}),
      ...(reason === "weak-volume" ? { volume: 1_000_000 } : {}),
      ...(reason === "overheated" ? { changePercent: 4.9 } : {}),
      ...(reason === "negative-change" ? { changePercent: -0.1 } : {}),
      ...(reason === "no-breakout" && index === 15 ? { price: 9.93 } : {}),
    })) }));
    expect(project(strategy(), snapshots).every(output => output.length === 0)).toBe(true);
  });

  it("retries rejected buys without inventing a filled position", () => {
    const { report, signals } = run(history([...rising, 10.1, 10.2]), { maxOrderNotional: 500 });
    expect(signals.slice(15).map(output => output[0]?.side)).toEqual(["buy", "buy", "buy"]);
    expect(report.orders).toHaveLength(3);
    expect(report.orders.every(order => order.status === "rejected")).toBe(true);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("retries after necessary fees reject two lots and a later quote fits one lot", () => {
    const { report, contexts } = run(history([...prefix, 10.01, 10.03]), { initialCapital: 2_005 }, strategy(1));
    expect(contexts[16].positions).toEqual([]);
    expect([...report.orders].reverse()).toMatchObject([
      { status: "rejected", quantity: 200, rejectionReason: "可用资金不足" },
      { status: "filled", quantity: 100, filledPrice: 10.03, commission: 5 },
    ]);
    expect(report.finalAccount.cash).toBeCloseTo(997, 10);
  });

  it("waits for T+1 and exits the actual unlocked shares", () => {
    const { report, signals, contexts } = run(history([...rising, 10.9, 11], [...Array<number>(17).fill(2), 3]));
    expect(contexts[16].positions).toMatchObject([{ quantity: 500, availableQuantity: 0 }]);
    expect(signals[16]).toEqual([]);
    expect(signals[17]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[15, "buy", 500], [17, "sell", 500]]);
    expect(report.finalAccount.cash).toBe(10_490);
  });

  it("rechecks actual holdings after rejected exits", () => {
    const { report, signals } = run(history([...rising, 10.9, 11]), { maxOrderNotional: 5_300 });
    expect(signals.slice(16)).toEqual([
      [{ symbol, side: "sell", type: "market", quantity: 500 }],
      [{ symbol, side: "sell", type: "market", quantity: 500 }],
    ]);
    expect([...report.orders].reverse()).toMatchObject([{ status: "filled", side: "buy" },
      { status: "rejected", side: "sell" }, { status: "rejected", side: "sell" }]);
    expect(report.finalPositions).toMatchObject([{ quantity: 500 }]);
  });

  it("uses actual slipped average price for the original price-return exits", () => {
    const { report, signals, contexts } = run(history([...rising, 10.9, 11]), { slippageBps: 100 });
    expect(contexts[16].positions).toMatchObject([{ averagePrice: 10.1, quantity: 500 }]);
    expect(signals[16]).toEqual([]);
    expect(report.trades.map(({ barIndex, side }) => [barIndex, side])).toEqual([[15, "buy"], [17, "sell"]]);
  });

  it("does not add to an existing healthy position", () => {
    expect(project(strategy(), history(), [position({ averagePrice: 10 })])[15]).toEqual([]);
  });

  it("can exit shares held before the strategy started", () => {
    expect(project(strategy(), history(), [position()])[15])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("keeps its moving-average failed-breakout exit before a price stop is reached", () => {
    const output = project(strategy(), history([...rising, 9.5]), [position({ averagePrice: 9.6 })]);
    expect(output[15]).toEqual([]);
    expect(output[16]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("keeps the actual-average stop even during a rising trend", () => {
    expect(project(strategy(), history(), [position({ averagePrice: 10.5 })])[15])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it.each([
    { quantity: 350, availableQuantity: 199, expected: 100 },
    { quantity: 250, availableQuantity: 500, expected: 200 },
    { quantity: 300, availableQuantity: undefined, expected: 300 },
    { quantity: 300, availableQuantity: 0, expected: 0 },
    { quantity: 300, availableQuantity: 99, expected: 0 },
  ])("uses actual sellable lots: %j", ({ quantity, availableQuantity, expected }) => {
    expect(project(strategy(), history(), [position({ quantity, availableQuantity })])[15])
      .toEqual(expected ? [{ symbol, side: "sell", type: "market", quantity: expected }] : []);
  });

  it("reads remaining shares after a partial exit and waits while they are locked", () => {
    const instance = strategy(), snapshots = history([...rising, 10.1, 10.2]);
    snapshots.slice(0, 15).forEach((snapshot, index) => instance.onBar(context(snapshot, index)));
    expect(instance.onBar(context(snapshots[15], 15, [position({ availableQuantity: 100 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect(instance.onBar(context(snapshots[16], 16, [position({ quantity: 200, availableQuantity: 0 })]))).toEqual([]);
    expect(instance.onBar(context(snapshots[17], 17, [position({ quantity: 200, availableQuantity: 200 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 200 }]);
  });

  it("binds the first valid stock and ignores unrelated holdings and reordered quotes", () => {
    const stable = history([...rising, 10.9]);
    const reordered = stable.map((snapshot, index) => ({ ...snapshot, quotes: index
      ? [{ ...snapshot.quotes[0], symbol: "600002", price: 100 + index }, ...snapshot.quotes]
      : [{ ...snapshot.quotes[0], symbol: "zero", price: 0 }, { ...snapshot.quotes[0], symbol: "locked", tradable: false }, ...snapshot.quotes] }));
    expect(project(strategy(), reordered, [position({ symbol: "600002" })])).toEqual(project(strategy(), stable));
    const before = run(stable).report, after = run(reordered).report;
    expect(after.trades).toEqual(before.trades);
    expect(after.orders).toEqual(before.orders);
    expect(after.finalAccount).toEqual(before.finalAccount);
  });

  it.each(["missing", "untradable"])("waits for a %s bound stock instead of switching", reason => {
    const snapshots = history([...rising, 10.1, 10.2]);
    const changed = snapshots.map((snapshot, index) => index === 2 ? { ...snapshot, quotes: [
      ...(reason === "untradable" ? [{ ...snapshot.quotes[0], tradable: false }] : []),
      { ...snapshot.quotes[0], symbol: "600002", price: 100 },
    ] } : snapshot);
    const output = project(strategy(), changed);
    expect(output[2]).toEqual([]);
    expect(output.filter((_, index) => index !== 2)).toEqual(project(strategy(), snapshots.filter((_, index) => index !== 2)));
  });

  it("resets binding and all history and reproduces a reused engine report", () => {
    const instance = strategy(), { report, engine } = run(history([...rising, 10.9]), {}, instance);
    expect(engine.run()).toEqual(report);
    instance.reset();
    const other = history().map(snapshot => ({ ...snapshot, quotes: snapshot.quotes.map(quote => ({ ...quote, symbol: "600002" })) }));
    expect(project(instance, other)).toEqual(project(strategy(), other));
  });
});
