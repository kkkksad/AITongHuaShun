import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { ASharePullbackConfirmationStrategy } from "./ASharePullbackConfirmationStrategy";

const symbol = "600001", entry = [9, 9.5, 10, 11, 10.5, 10.7];
const strategy = (weight = 0.5) => new ASharePullbackConfirmationStrategy(4, 3, 0.08, 0.006, 1.05, 0.045, 0.03, weight);
function history(prices: number[], days = prices.map((_, i) => i + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return { mode: "paper", sequence: index + 1, marketTime, quotes: [{ symbol, name: "pullback position fixture",
      tradable: true, price, previousClose: prices[Math.max(0, index - 1)], changePercent: 0.5,
      volume: 1_000_000 + Math.max(0, index - 4) * 250_000, updatedAt: marketTime }] };
  });
}
function position(fields: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return { symbol, name: "held fixture", quantity: 300, availableQuantity: 300, averagePrice: 10,
    currentPrice: 10.7, marketValue: 3_210, unrealizedPnl: 210, realizedPnl: 0, weight: 0.321, ...fields };
}
function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return { snapshot, positions, barIndex, totalBars: 20, equity: 10_000, cash: 10_000,
    account: { accountId: "pullback-fixture", mode: "paper", cash: 10_000, equity: 10_000, marketValue: 0,
      unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime } };
}
function project(instance: ASharePullbackConfirmationStrategy, snapshots: MarketSnapshot[], positions: PositionSnapshot[] = []) {
  return snapshots.map((snapshot, index) => instance.onBar(context(snapshot, index, positions)));
}
function run(snapshots: MarketSnapshot[], config: Partial<BacktestConfig> = {}, instance = strategy()) {
  const contexts: StrategyContext[] = [], signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, { name: instance.name, reset: () => instance.reset(),
    onBar: value => { contexts.push(value); const output = instance.onBar(value); signals.push(output); return output; } },
  { initialCapital: 10_000, maxOrderNotional: 1_000_000, maxPositionWeight: 1, maxDailyLoss: 1,
    minimumCommission: 5, commissionRate: 0, slippageBps: 0, ...config });
  return { report: engine.run(), engine, contexts, signals };
}

describe("A-share pullback actual position contract", () => {
  it("retries a rejected entry while its real position remains empty", () => {
    const { report, signals } = run(history([...entry, 10.8]), { maxOrderNotional: 500 });
    expect(signals.slice(5).map(s => s[0]?.side)).toEqual(["buy", "buy"]);
    expect(report.orders).toHaveLength(2);
    expect(report.orders.every(o => o.status === "rejected")).toBe(true);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });
  it("retries after the necessary fee rejects two lots and later one lot is affordable", () => {
    const { report } = run(history([...entry, 10.8]), { initialCapital: 2_140 }, strategy(1));
    expect([...report.orders].reverse()).toMatchObject([{ status: "rejected", quantity: 200, rejectionReason: "可用资金不足" },
      { status: "filled", quantity: 100, filledPrice: 10.8, commission: 5 }]);
    expect(report.finalAccount.cash).toBe(1_055);
  });
  it("keeps T+1-locked holdings and exits actual shares after unlocking", () => {
    const { report, signals, contexts } = run(history([...entry, 11.3, 11.4], [2, 2, 2, 2, 2, 2, 2, 3]));
    expect(contexts[6].positions).toMatchObject([{ quantity: 400, availableQuantity: 0 }]);
    expect(signals[6]).toEqual([]);
    expect(signals[7]).toEqual([{ symbol, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades.map(t => [t.barIndex, t.side, t.quantity])).toEqual([[5, "buy", 400], [7, "sell", 400]]);
  });
  it("rechecks held shares after the broker rejects an exit", () => {
    const { report, signals } = run(history([...entry, 11.3, 11.4]), { maxOrderNotional: 4_500 });
    expect(signals.slice(6)).toEqual([[{ symbol, side: "sell", type: "market", quantity: 400 }],
      [{ symbol, side: "sell", type: "market", quantity: 400 }]]);
    expect([...report.orders].reverse()).toMatchObject([{ side: "buy", status: "filled" }, { side: "sell", status: "rejected" }, { side: "sell", status: "rejected" }]);
    expect(report.finalPositions).toMatchObject([{ quantity: 400 }]);
  });
  it("uses actual slipped average price for the take-profit threshold", () => {
    const { report, signals, contexts } = run(history([...entry, 11.2, 11.3]), { slippageBps: 100 });
    expect(contexts[6].positions).toMatchObject([{ averagePrice: 10.81 }]);
    expect(signals[6]).toEqual([]);
    expect(report.trades.map(t => [t.barIndex, t.side])).toEqual([[5, "buy"], [7, "sell"]]);
  });
  it("does not add to a position already held before the strategy started", () => {
    expect(project(strategy(), history(entry), [position({ averagePrice: 10.7 })])[5]).toEqual([]);
  });
  it("can take profit on a preexisting actual holding", () => {
    expect(project(strategy(), history(entry), [position()])[5]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });
  it("uses the actual average for a stop even when the entry shape is constructive", () => {
    expect(project(strategy(), history(entry), [position({ averagePrice: 11.2 })])[5]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });
  it.each([{ quantity: 350, availableQuantity: 199, expected: 100 }, { quantity: 250, availableQuantity: 500, expected: 200 },
    { quantity: 300, availableQuantity: undefined, expected: 300 }, { quantity: 300, availableQuantity: 0, expected: 0 },
    { quantity: 300, availableQuantity: 99, expected: 0 }])("uses actual sellable lots: %j", ({ quantity, availableQuantity, expected }) => {
    expect(project(strategy(), history(entry), [position({ quantity, availableQuantity })])[5])
      .toEqual(expected ? [{ symbol, side: "sell", type: "market", quantity: expected }] : []);
  });
  it("binds its first valid stock and ignores quote-order changes", () => {
    const stable = history([...entry, 10.8]), reordered = stable.map((snapshot, index) => ({ ...snapshot,
      quotes: index ? [{ ...snapshot.quotes[0], symbol: "600002", price: 100 + index }, ...snapshot.quotes] : snapshot.quotes }));
    expect(project(strategy(), reordered)).toEqual(project(strategy(), stable));
    expect(run(reordered).report.trades).toEqual(run(stable).report.trades);
  });
  it.each(["missing", "untradable"])("waits for a %s bound quote", reason => {
    const stable = history([...entry.slice(0, 3), 10.25, ...entry.slice(3)]);
    const changed = stable.map((snapshot, index) => index === 3 ? { ...snapshot, quotes: [
      ...(reason === "untradable" ? [{ ...snapshot.quotes[0], tradable: false }] : []),
      { ...snapshot.quotes[0], symbol: "600002", price: 100 }] } : snapshot);
    const output = project(strategy(), changed);
    expect(output[3]).toEqual([]);
    expect(output.filter((_, i) => i !== 3)).toEqual(project(strategy(), stable.filter((_, i) => i !== 3)));
  });
  it("chooses the first positive tradable quote and ignores other holdings", () => {
    const values = history(entry).map(snapshot => ({ ...snapshot, quotes: [{ ...snapshot.quotes[0], symbol: "zero", price: 0 },
      { ...snapshot.quotes[0], symbol: "locked", tradable: false }, ...snapshot.quotes] }));
    expect(project(strategy(0.42), values, [position({ symbol: "600002" })])[5])
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });
  it("resets binding/history and reproduces reports on engine reuse", () => {
    const instance = strategy(), { report, engine } = run(history([...entry, 11.3]), {}, instance);
    expect(engine.run()).toEqual(report);
    instance.reset();
    const other = history(entry).map(snapshot => ({ ...snapshot, quotes: snapshot.quotes.map(q => ({ ...q, symbol: "600002" })) }));
    expect(project(instance, other)).toEqual(project(strategy(), other));
    expect(project(strategy(), history(entry)).slice(0, 5)).toEqual([[], [], [], [], []]);
  });
});
