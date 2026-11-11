import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { KairosCapitalShieldStrategy } from "./KairosDefensiveStrategies";

const symbol = "600001";
const rising = [10, 10.01, 10.02, 10.03, 10.04];
const strategy = (weight = 0.5) => new KairosCapitalShieldStrategy(3, 2, 0.055, 0.03, 0.015, 3, weight);
const history = (prices: number[], days = prices.map((_, index) => index + 2)): MarketSnapshot[] =>
  prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return { mode: "paper", sequence: index + 1, marketTime, quotes: [{
      symbol, name: "deterministic capital-shield fixture", tradable: true, price,
      previousClose: prices[Math.max(0, index - 1)], changePercent: 0.3,
      volume: 1_000_000, updatedAt: marketTime,
    }] };
  });
const position = (changes: Partial<PositionSnapshot> = {}): PositionSnapshot => ({
  symbol, name: "held shield fixture", quantity: 300, availableQuantity: 300,
  averagePrice: 10.04, currentPrice: 10.04, marketValue: 3012,
  unrealizedPnl: 0, realizedPnl: 0, weight: 0.3012, ...changes,
});
const context = (snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext => ({
  snapshot, positions, barIndex, totalBars: 20, equity: 10_000, cash: 10_000,
  account: { accountId: "shield-fixture", mode: "paper", cash: 10_000, equity: 10_000,
    marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0,
    riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime },
});
const project = (instance: KairosCapitalShieldStrategy, snapshots: MarketSnapshot[], positions: PositionSnapshot[] = []) =>
  snapshots.map((snapshot, index) => instance.onBar(context(snapshot, index, positions)));
const run = (snapshots: MarketSnapshot[], config: Partial<BacktestConfig> = {}, instance = strategy()) => {
  const contexts: StrategyContext[] = [], signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, { name: instance.name, reset: () => instance.reset(),
    onBar: value => { contexts.push(value); const output = instance.onBar(value); signals.push(output); return output; },
  }, { initialCapital: 10_000, maxOrderNotional: 1_000_000, maxPositionWeight: 1,
    maxDailyLoss: 1, minimumCommission: 5, commissionRate: 0, slippageBps: 0, ...config });
  return { report: engine.run(), contexts, signals };
};

describe("capital shield actual position contract", () => {
  it("preserves original warmup, target and controlled-breakout qualifications", () => {
    const values = history(rising);
    expect(project(strategy(0.42), values)).toEqual([[], [], [], [], [{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]]);
    const hot = values.map(s => ({ ...s, quotes: s.quotes.map(q => ({ ...q, changePercent: 5 })) }));
    expect(project(strategy(), hot).every(s => s.length === 0)).toBe(true);
    const instance = strategy();
    values.slice(0, 4).forEach((s, i) => instance.onBar(context(s, i)));
    expect(instance.onBar({ ...context(values[4], 4), cash: 1999 })).toEqual([]);
  });

  it("retries rejected entries using actual empty holdings", () => {
    const { report, signals } = run(history([...rising, 10.05, 10.06]), { maxOrderNotional: 500 });
    expect(signals.slice(4).map(s => s[0]?.side)).toEqual(["buy", "buy", "buy"]);
    expect(report.orders).toHaveLength(3);
    expect(report.orders.every(o => o.status === "rejected")).toBe(true);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("can enter after a prior fee-related rejection when one lot becomes affordable", () => {
    const { report, contexts } = run(history([9.97, 9.98, 9.99, 10, 10.01, 10.03]), { initialCapital: 2005 }, strategy(1));
    expect(contexts[5].positions).toEqual([]);
    expect([...report.orders].reverse()).toMatchObject([
      { status: "rejected", quantity: 200, rejectionReason: "可用资金不足" },
      { status: "filled", quantity: 100, filledPrice: 10.03, commission: 5 },
    ]);
    expect(report.finalAccount.cash).toBeCloseTo(997, 10);
  });

  it("waits for T+1 and then exits the actual sellable shares", () => {
    const { report, signals, contexts } = run(history([...rising, 10.4, 10.5], [2, 2, 2, 2, 2, 2, 3]));
    expect(contexts[5].positions).toMatchObject([{ quantity: 400, availableQuantity: 0 }]);
    expect(signals[5]).toEqual([]);
    expect(signals[6]).toEqual([{ symbol, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades.map(t => [t.barIndex, t.side, t.quantity])).toEqual([[4, "buy", 400], [6, "sell", 400]]);
    expect(report.finalAccount.cash).toBeCloseTo(10_174, 10);
  });

  it("keeps checking held shares after rejected sell signals", () => {
    const { report, signals } = run(history([...rising, 11, 11.1]), { maxOrderNotional: 4300 });
    expect(signals.slice(5)).toEqual(Array.from({ length: 2 }, () => [{ symbol, side: "sell", type: "market", quantity: 400 }]));
    expect([...report.orders].reverse()).toMatchObject([
      { status: "filled", side: "buy" }, { status: "rejected", side: "sell" }, { status: "rejected", side: "sell" },
    ]);
    expect(report.finalPositions).toMatchObject([{ quantity: 400 }]);
  });

  it("uses slipped average price rather than the entry quote for take profit", () => {
    const { report, signals, contexts } = run(history([...rising, 10.4, 10.5]), { slippageBps: 100 });
    expect(contexts[5].positions).toMatchObject([{ averagePrice: 10.14 }]);
    expect(signals[5]).toEqual([]);
    expect(report.trades.map(t => [t.barIndex, t.side])).toEqual([[4, "buy"], [6, "sell"]]);
  });

  it.each([9.5, 10.3])("evaluates a pre-existing position against actual average %s", averagePrice => {
    expect(project(strategy(), history(rising), [position({ averagePrice })])[4])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("does not add to a pre-existing healthy position", () => {
    expect(project(strategy(), history(rising), [position()])[4]).toEqual([]);
  });

  it("retains the exit-low trigger when actual return has not reached the stop", () => {
    expect(project(strategy(), history([...rising, 10.03]), [position()])[5])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it.each([[300, 200, 200], [300, 350, 300], [350, undefined, 300], [300, 0, 0], [300, 99, 0]])(
    "aligns actual quantity %s and availability %s to %s", (quantity, availableQuantity, expected) => {
      expect(project(strategy(), history(rising), [position({ quantity, availableQuantity, averagePrice: 9.5 })])[4])
        .toEqual(expected ? [{ symbol, side: "sell", type: "market", quantity: expected }] : []);
    });

  it("starts cooldown only when full exit is observed and respects its boundary", () => {
    const instance = strategy(), snapshots = history([...rising, 10.05, 10.06, 10.07, 10.08]);
    snapshots.slice(0, 5).forEach((s, i) => instance.onBar(context(s, i, [position({ averagePrice: 9.5 })])));
    const output = snapshots.slice(5).map((s, i) => instance.onBar(context(s, i + 5)));
    expect(output).toEqual([[], [], [], [{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]]);
  });

  it("does not restart cooldown while an actual residual position remains", () => {
    const instance = strategy(), snapshots = history([...rising, 10.4, 10.5]);
    snapshots.slice(0, 5).forEach((s, i) => instance.onBar(context(s, i, [position()])));
    expect(instance.onBar(context(snapshots[5], 5, [position({ quantity: 200, availableQuantity: 100 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect(instance.onBar(context(snapshots[6], 6, [position({ quantity: 100, availableQuantity: 100 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
  });

  it("keeps one symbol's history when quotes reorder or disappear", () => {
    const instance = strategy(), snapshots = history(rising);
    snapshots.slice(0, 4).forEach((s, i) => instance.onBar(context(s, i)));
    const other = { ...snapshots[4].quotes[0], symbol: "600002", price: 50 };
    expect(instance.onBar(context({ ...snapshots[4], quotes: [other] }, 4))).toEqual([]);
    expect(instance.onBar(context({ ...snapshots[4], quotes: [other, ...snapshots[4].quotes] }, 5)))
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
  });

  it("ignores invalid initial quotes and another symbol's holdings", () => {
    const snapshots = history(rising).map(s => ({ ...s, quotes: [
      { ...s.quotes[0], symbol: "zero", price: 0 },
      { ...s.quotes[0], symbol: "locked", tradable: false }, ...s.quotes,
    ] }));
    expect(project(strategy(), snapshots, [position({ symbol: "600002" })])[4])
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
  });

  it("resets history, binding and observed-exit cooldown for independent replay", () => {
    const instance = strategy();
    project(instance, history(rising), [position()]);
    project(instance, history([...rising, 10.05]));
    instance.reset();
    const other = history(rising).map(s => ({ ...s, quotes: s.quotes.map(q => ({ ...q, symbol: "600002" })) }));
    expect(project(instance, other)).toEqual(project(strategy(), other));
  });
});
