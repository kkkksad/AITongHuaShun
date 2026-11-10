import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { KairosLowVolTrendStrategy } from "./KairosDefensiveStrategies";

const symbol = "600001";
const rising = [10, 10.1, 10.2, 10.3, 10.4];
const strategy = (weight = 0.5) => new KairosLowVolTrendStrategy(2, 3, 0.022, 0.038, 0.018, weight);

function history(prices: number[], days = prices.map((_, index) => index + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return { mode: "paper", sequence: index + 1, marketTime, quotes: [{
      symbol, name: "deterministic low-vol fixture", tradable: true, price,
      previousClose: prices[Math.max(0, index - 1)], changePercent: 0.3,
      volume: 1_000_000, updatedAt: marketTime,
    }] };
  });
}

function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return { symbol, name: "held low-vol fixture", quantity: 300, availableQuantity: 300,
    averagePrice: 10, currentPrice: 10.4, marketValue: 3_120,
    unrealizedPnl: 120, realizedPnl: 0, weight: 0.312, ...overrides };
}

function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return { snapshot, positions, barIndex, totalBars: 20, equity: 10_000, cash: 10_000,
    account: { accountId: "low-vol-fixture", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime } };
}

function project(instance: KairosLowVolTrendStrategy, snapshots: MarketSnapshot[], positions: PositionSnapshot[] = []) {
  return snapshots.map((snapshot, index) => instance.onBar(context(snapshot, index, positions)));
}

function run(snapshots: MarketSnapshot[], config: Partial<BacktestConfig> = {}, instance = strategy()) {
  const contexts: StrategyContext[] = [], signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, { name: instance.name, reset: () => instance.reset(),
    onBar: (value) => { contexts.push(value); const output = instance.onBar(value); signals.push(output); return output; },
  }, { initialCapital: 10_000, maxOrderNotional: 1_000_000, maxPositionWeight: 1,
    maxDailyLoss: 1, minimumCommission: 5, commissionRate: 0, slippageBps: 0, ...config });
  return { report: engine.run(), engine, contexts, signals };
}

describe("low-vol trend actual position contract", () => {
  it("retries rejected entries without inventing a filled position", () => {
    const { report, signals } = run(history([...rising, 10.5, 10.6]), { maxOrderNotional: 500 });
    expect(signals.slice(4).map((output) => output[0]?.side)).toEqual(["buy", "buy", "buy"]);
    expect(report.orders).toHaveLength(3);
    expect(report.orders.every((order) => order.status === "rejected")).toBe(true);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("retries after fees reject two lots and a later quote makes one lot affordable", () => {
    const { report, contexts } = run(history([9.97, 9.98, 9.99, 10, 10.01, 10.03]), { initialCapital: 2_005 }, strategy(1));
    expect(contexts[5].positions).toEqual([]);
    expect([...report.orders].reverse()).toMatchObject([
      { status: "rejected", quantity: 200, rejectionReason: "可用资金不足" },
      { status: "filled", quantity: 100, filledPrice: 10.03, commission: 5 },
    ]);
    expect(report.finalAccount.cash).toBeCloseTo(997, 10);
  });

  it("waits for T+1 and exits the actual shares when they unlock", () => {
    const { report, signals, contexts } = run(history([...rising, 10.9, 11], [2, 2, 2, 2, 2, 2, 3]));
    expect(contexts[5].positions).toMatchObject([{ quantity: 400, availableQuantity: 0 }]);
    expect(signals[5]).toEqual([]);
    expect(signals[6]).toEqual([{ symbol, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[4, "buy", 400], [6, "sell", 400]]);
    expect(report.finalAccount.cash).toBe(10_230);
  });

  it("rechecks real holdings after a rejected exit instead of clearing the position", () => {
    const { report, signals } = run(history([...rising, 11.3, 11.4]), { maxOrderNotional: 4_500 });
    expect(signals.slice(5)).toEqual([
      [{ symbol, side: "sell", type: "market", quantity: 400 }],
      [{ symbol, side: "sell", type: "market", quantity: 400 }],
    ]);
    expect([...report.orders].reverse()).toMatchObject([{ status: "filled", side: "buy" },
      { status: "rejected", side: "sell" }, { status: "rejected", side: "sell" }]);
    expect(report.finalPositions).toMatchObject([{ quantity: 400 }]);
  });

  it("uses the actual slipped average price for the price-return take-profit threshold", () => {
    const { report, signals, contexts } = run(history([...rising, 10.8, 10.9]), { slippageBps: 100 });
    expect(contexts[5].positions).toMatchObject([{ averagePrice: 10.5, quantity: 400 }]);
    expect(signals[5]).toEqual([]);
    expect(report.trades.map(({ barIndex, side }) => [barIndex, side])).toEqual([[4, "buy"], [6, "sell"]]);
  });

  it("does not add to an already held healthy position", () => {
    expect(project(strategy(), history(rising), [position({ averagePrice: 10.4 })])[4]).toEqual([]);
  });

  it("can exit a position held before this strategy started", () => {
    expect(project(strategy(), history(rising), [position()])[4])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("keeps structural trend exits even before a price-return stop is reached", () => {
    const output = project(strategy(), history([...rising, 10.3]), [position({ averagePrice: 10.4 })]);
    expect(output[4]).toEqual([]);
    expect(output[5]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("keeps the volatility exit when the actual entry return is still within its limits", () => {
    const instance = strategy(), snapshots = history([...rising, 11.3]);
    snapshots.slice(0, 5).forEach((snapshot, index) => instance.onBar(context(snapshot, index)));
    expect(instance.onBar(context(snapshots[5], 5, [position({ averagePrice: 11.2 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("keeps the price-return stop against the actual average even in a healthy rising window", () => {
    expect(project(strategy(), history(rising), [position({ averagePrice: 11 })])[4])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("selects the first tradable positive quote and ignores another symbol's holdings", () => {
    const snapshots = history(rising).map((snapshot) => ({ ...snapshot, quotes: [
      { ...snapshot.quotes[0], symbol: "zero", price: 0 },
      { ...snapshot.quotes[0], symbol: "locked", tradable: false }, ...snapshot.quotes,
    ] }));
    expect(project(strategy(0.42), snapshots, [position({ symbol: "600002" })])[4])
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it.each([
    { quantity: 350, availableQuantity: 199, expected: 100 },
    { quantity: 250, availableQuantity: 500, expected: 200 },
    { quantity: 300, availableQuantity: undefined, expected: 300 },
    { quantity: 300, availableQuantity: 0, expected: 0 },
    { quantity: 300, availableQuantity: 99, expected: 0 },
  ])("uses actual sellable lots: %j", ({ quantity, availableQuantity, expected }) => {
    const output = project(strategy(), history(rising), [position({ quantity, availableQuantity })])[4];
    expect(output).toEqual(expected ? [{ symbol, side: "sell", type: "market", quantity: expected }] : []);
  });

  it("reads remaining and unlocked shares after partial exits", () => {
    const instance = strategy(), snapshots = history([...rising, 10.5, 10.6]);
    snapshots.slice(0, 4).forEach((snapshot, index) => instance.onBar(context(snapshot, index)));
    expect(instance.onBar(context(snapshots[4], 4, [position({ availableQuantity: 100 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect(instance.onBar(context(snapshots[5], 5, [position({ quantity: 200, availableQuantity: 0 })]))).toEqual([]);
    expect(instance.onBar(context(snapshots[6], 6, [position({ quantity: 200, availableQuantity: 200 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 200 }]);
  });

  it("binds to the first valid tradable symbol even if quote ordering changes", () => {
    const stable = history([...rising, 10.5]);
    const reordered = stable.map((snapshot, index) => ({ ...snapshot,
      quotes: index ? [{ ...snapshot.quotes[0], symbol: "600002", price: 100 + index }, ...snapshot.quotes] : snapshot.quotes }));
    expect(project(strategy(), reordered)).toEqual(project(strategy(), stable));
    const expected = run(stable).report;
    const actual = run(reordered).report;
    expect(actual.trades).toEqual(expected.trades);
    expect(actual.orders).toEqual(expected.orders);
    expect(actual.finalAccount).toEqual(expected.finalAccount);
  });

  it.each(["missing", "untradable"])("waits for a %s bound quote instead of switching stocks", (reason) => {
    const stable = history([10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6]);
    const changed = stable.map((snapshot, index) => index === 2 ? { ...snapshot, quotes: [
      ...(reason === "untradable" ? [{ ...snapshot.quotes[0], tradable: false }] : []),
      { ...snapshot.quotes[0], symbol: "600002", price: 100 },
    ] } : snapshot);
    const output = project(strategy(), changed);
    const expected = project(strategy(), stable.filter((_, index) => index !== 2));
    expect(output[2]).toEqual([]);
    expect(output.filter((_, index) => index !== 2)).toEqual(expected);
  });

  it("resets binding/history and reproduces complete reports on reuse", () => {
    const instance = strategy(), snapshots = history([...rising, 10.9]);
    const { report, engine } = run(snapshots, {}, instance);
    expect(engine.run()).toEqual(report);
    instance.reset();
    const other = history(rising).map((snapshot) => ({ ...snapshot, quotes: snapshot.quotes.map((quote) => ({ ...quote, symbol: "600002" })) }));
    expect(project(instance, other)).toEqual(project(strategy(), other));
    expect(project(strategy(), history(rising)).slice(0, 4)).toEqual([[], [], [], []]);
  });
});
