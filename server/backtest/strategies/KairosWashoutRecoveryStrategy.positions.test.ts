import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { KairosWashoutRecoveryStrategy } from "./KairosRegimeStrategies";

const symbol = "600001", entry = [...Array<number>(34).fill(9.5), 10, 10.5, 10.2, 11, 10.5, 10.7];
const strategy = (weight = 0.5) => new KairosWashoutRecoveryStrategy(4, 4, 0.012, 0.12, 0.8, 0.004, 0.06, 0.025, weight);
function history(prices: number[], days = prices.map((_, index) => index + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return { mode: "paper", sequence: index + 1, marketTime, quotes: [{ symbol, name: "washout recovery fixture",
      tradable: true, price, previousClose: prices[Math.max(0, index - 1)], changePercent: 0.5,
      volume: index < 35 ? 1_000_000 : 600_000, updatedAt: marketTime }] };
  });
}
function position(fields: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return { symbol, name: "held fixture", quantity: 300, availableQuantity: 300, averagePrice: 10,
    currentPrice: 10.7, marketValue: 3_210, unrealizedPnl: 210, realizedPnl: 0, weight: 0.321, ...fields };
}
function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return { snapshot, positions, barIndex, totalBars: 60, equity: 10_000, cash: 10_000,
    account: { accountId: "washout-recovery-fixture", mode: "paper", cash: 10_000, equity: 10_000, marketValue: 0,
      unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime } };
}
function project(instance: KairosWashoutRecoveryStrategy, values: MarketSnapshot[], positions: PositionSnapshot[] = []) {
  return values.map((snapshot, index) => instance.onBar(context(snapshot, index, positions)));
}
function run(values: MarketSnapshot[], config: Partial<BacktestConfig> = {}, instance = strategy()) {
  const contexts: StrategyContext[] = [], signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(values, { name: instance.name, reset: () => instance.reset(),
    onBar: value => { contexts.push(value); const output = instance.onBar(value); signals.push(output); return output; } },
  { initialCapital: 10_000, maxOrderNotional: 1_000_000, maxPositionWeight: 1, maxDailyLoss: 1,
    minimumCommission: 5, commissionRate: 0, slippageBps: 0, ...config });
  return { report: engine.run(), engine, contexts, signals };
}

describe("washout recovery actual position contract", () => {
  it("requires the full volume baseline and the original quiet-volume gate", () => {
    const values = history(entry);
    const output = project(strategy(), values);
    expect(output.slice(0, 39)).toEqual(Array.from({ length: 39 }, () => []));
    expect(output[39]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
    const loud = values.map(snapshot => ({ ...snapshot, quotes: snapshot.quotes.map(quote => ({ ...quote, volume: 1_000_000 })) }));
    expect(project(strategy(), loud).every(signals => signals.length === 0)).toBe(true);
  });
  it("retries a rejected entry while the actual position remains empty", () => {
    const { report, signals } = run(history([...entry, 10.8]), { maxOrderNotional: 500 });
    expect(signals.slice(39).map(output => output[0]?.side)).toEqual(["buy", "buy"]);
    expect(report.orders).toHaveLength(2);
    expect(report.orders.every(order => order.status === "rejected")).toBe(true);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });
  it("retries after necessary fees reject two lots and one lot becomes affordable", () => {
    const { report } = run(history([...entry, 10.8]), { initialCapital: 2_140 }, strategy(1));
    expect([...report.orders].reverse()).toMatchObject([
      { status: "rejected", quantity: 200, rejectionReason: "可用资金不足" },
      { status: "filled", quantity: 100, filledPrice: 10.8, commission: 5 },
    ]);
    expect(report.finalAccount.cash).toBe(1_055);
  });
  it("waits for T+1 and exits actual shares once they unlock", () => {
    const { report, signals, contexts } = run(history([...entry, 11.4, 11.5], [...Array<number>(41).fill(2), 3]));
    expect(contexts[40].positions).toMatchObject([{ quantity: 400, availableQuantity: 0 }]);
    expect(signals[40]).toEqual([]);
    expect(signals[41]).toEqual([{ symbol, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades.map(trade => [trade.barIndex, trade.side, trade.quantity]))
      .toEqual([[39, "buy", 400], [41, "sell", 400]]);
  });
  it("keeps evaluating actual holdings after an exit is rejected", () => {
    const { report, signals } = run(history([...entry, 11.4, 11.5]), { maxOrderNotional: 4_500 });
    expect(signals.slice(40)).toEqual([[{ symbol, side: "sell", type: "market", quantity: 400 }],
      [{ symbol, side: "sell", type: "market", quantity: 400 }]]);
    expect([...report.orders].reverse()).toMatchObject([{ side: "buy", status: "filled" },
      { side: "sell", status: "rejected" }, { side: "sell", status: "rejected" }]);
    expect(report.finalPositions).toMatchObject([{ quantity: 400 }]);
  });
  it("uses the actual slipped entry average for take-profit", () => {
    const { report, signals, contexts } = run(history([...entry, 11.4, 11.5]), { slippageBps: 100 });
    expect(contexts[40].positions).toMatchObject([{ averagePrice: 10.81 }]);
    expect(signals[40]).toEqual([]);
    expect(report.trades.map(trade => [trade.barIndex, trade.side])).toEqual([[39, "buy"], [41, "sell"]]);
  });
  it("does not buy again when a healthy position already exists", () => {
    expect(project(strategy(), history(entry), [position({ averagePrice: 10.7 })])[39]).toEqual([]);
  });
  it("can take profit on a position held before this strategy started", () => {
    expect(project(strategy(), history(entry), [position()])[39])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });
  it("uses the actual average for a stop even with a constructive entry pattern", () => {
    expect(project(strategy(), history(entry), [position({ averagePrice: 11 })])[39])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });
  it("keeps a structural trend exit without waiting for a price-return stop", () => {
    const output = project(strategy(), history([...entry, 10.3]), [position({ averagePrice: 10.5 })]);
    expect(output[39]).toEqual([]);
    expect(output[40]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });
  it.each([{ quantity: 350, availableQuantity: 199, expected: 100 }, { quantity: 250, availableQuantity: 500, expected: 200 },
    { quantity: 300, availableQuantity: undefined, expected: 300 }, { quantity: 300, availableQuantity: 0, expected: 0 },
    { quantity: 300, availableQuantity: 99, expected: 0 }])("uses actual sellable lots: %j", ({ quantity, availableQuantity, expected }) => {
    expect(project(strategy(), history(entry), [position({ quantity, availableQuantity })])[39])
      .toEqual(expected ? [{ symbol, side: "sell", type: "market", quantity: expected }] : []);
  });
  it("binds its first valid stock across quote-order changes", () => {
    const stable = history([...entry, 10.8]), changed = stable.map((snapshot, index) => ({ ...snapshot,
      quotes: index ? [{ ...snapshot.quotes[0], symbol: "600002", price: 100 + index }, ...snapshot.quotes] : snapshot.quotes }));
    expect(project(strategy(), changed)).toEqual(project(strategy(), stable));
    expect(run(changed).report.trades).toEqual(run(stable).report.trades);
  });
  it.each(["missing", "untradable"])("waits for a %s bound quote instead of switching stocks", reason => {
    const stable = history([...entry.slice(0, 3), 9.5, ...entry.slice(3)]);
    const changed = stable.map((snapshot, index) => index === 3 ? { ...snapshot, quotes: [
      ...(reason === "untradable" ? [{ ...snapshot.quotes[0], tradable: false }] : []),
      { ...snapshot.quotes[0], symbol: "600002", price: 100 }] } : snapshot);
    const output = project(strategy(), changed);
    expect(output[3]).toEqual([]);
    expect(output.filter((_, index) => index !== 3)).toEqual(project(strategy(), stable.filter((_, index) => index !== 3)));
  });
  it("chooses the first positive tradable stock and ignores another stock's holdings", () => {
    const values = history(entry).map(snapshot => ({ ...snapshot, quotes: [
      { ...snapshot.quotes[0], symbol: "zero", price: 0 },
      { ...snapshot.quotes[0], symbol: "locked", tradable: false }, ...snapshot.quotes] }));
    expect(project(strategy(0.42), values, [position({ symbol: "600002" })])[39])
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });
  it("resets history and binding and reproduces reports on engine reuse", () => {
    const instance = strategy(), { report, engine } = run(history([...entry, 11.3]), {}, instance);
    expect(engine.run()).toEqual(report);
    instance.reset();
    const other = history(entry).map(snapshot => ({ ...snapshot, quotes: snapshot.quotes.map(quote => ({ ...quote, symbol: "600002" })) }));
    expect(project(instance, other)).toEqual(project(strategy(), other));
    expect(project(strategy(), history(entry)).slice(0, 39)).toEqual(Array.from({ length: 39 }, () => []));
  });
});
