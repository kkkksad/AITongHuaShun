import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { KairosRiskOffRecoveryStrategy } from "./KairosDefensiveStrategies";

const symbol = "600001";
const repair = [11, 10.8, 10.4, 10, 9.7, 9.5, 9.6, 9.9];
const strategy = (weight = 0.5) => new KairosRiskOffRecoveryStrategy(2, 6, 6, 0.06, 0.025, 1.1, 0.04, 0.02, weight);
const history = (prices: number[], days = prices.map((_, i) => i + 2)): MarketSnapshot[] => prices.map((price, i) => {
  const marketTime = new Date(Date.UTC(2026, 10, days[i], 6, i)).toISOString();
  return { mode: "paper", sequence: i + 1, marketTime, quotes: [{
    symbol, name: "deterministic risk-off recovery fixture", tradable: true, price,
    previousClose: prices[Math.max(0, i - 1)], changePercent: 0.8,
    volume: i >= 7 ? 2_000_000 : 1_000_000, updatedAt: marketTime,
  }] };
});
const position = (changes: Partial<PositionSnapshot> = {}): PositionSnapshot => ({
  symbol, name: "held recovery fixture", quantity: 300, availableQuantity: 300,
  averagePrice: 9.9, currentPrice: 9.9, marketValue: 2970,
  unrealizedPnl: 0, realizedPnl: 0, weight: 0.297, ...changes,
});
const context = (snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext => ({
  snapshot, positions, barIndex, totalBars: 20, equity: 10_000, cash: 10_000,
  account: { accountId: "recovery-fixture", mode: "paper", cash: 10_000, equity: 10_000,
    marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0,
    riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime },
});
const project = (instance: KairosRiskOffRecoveryStrategy, snapshots: MarketSnapshot[], positions: PositionSnapshot[] = []) =>
  snapshots.map((snapshot, i) => instance.onBar(context(snapshot, i, positions)));
const run = (snapshots: MarketSnapshot[], config: Partial<BacktestConfig> = {}, instance = strategy()) => {
  const contexts: StrategyContext[] = [], signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, { name: instance.name, reset: () => instance.reset(),
    onBar: value => { contexts.push(value); const output = instance.onBar(value); signals.push(output); return output; },
  }, { initialCapital: 10_000, maxOrderNotional: 1_000_000, maxPositionWeight: 1,
    maxDailyLoss: 1, minimumCommission: 5, commissionRate: 0, slippageBps: 0, ...config });
  return { report: engine.run(), contexts, signals };
};

describe("risk-off recovery actual position contract", () => {
  it("retains original warmup and volume-backed controlled repair qualification", () => {
    const snapshots = history(repair), output = project(strategy(0.42), snapshots);
    expect(output.slice(0, 7)).toEqual(Array.from({ length: 7 }, () => []));
    expect(output[7]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
    for (const changes of [{ volume: 1_000_000 }, { changePercent: 0.4 }, { changePercent: 6.1 }]) {
      const filtered = snapshots.map(s => ({ ...s, quotes: s.quotes.map(q => ({ ...q, ...changes })) }));
      expect(project(strategy(), filtered).every(s => s.length === 0)).toBe(true);
    }
  });

  it("retries rejected entries without inventing a filled position", () => {
    const { report, signals } = run(history([...repair, 10]), { maxOrderNotional: 500 });
    expect(signals.slice(7).map(s => s[0]?.side)).toEqual(["buy", "buy"]);
    expect(report.orders).toHaveLength(2);
    expect(report.orders.every(o => o.status === "rejected")).toBe(true);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("can enter after a fee-related rejection when a later lot becomes affordable", () => {
    const { report, contexts } = run(history([...repair, 10]), { initialCapital: 1984 }, strategy(1));
    expect(contexts[8].positions).toEqual([]);
    expect([...report.orders].reverse()).toMatchObject([
      { status: "rejected", quantity: 200, rejectionReason: "可用资金不足" },
      { status: "filled", quantity: 100, filledPrice: 10, commission: 5 },
    ]);
    expect(report.finalAccount.cash).toBe(979);
  });

  it("waits for T+1 and then exits the actual shares", () => {
    const { report, signals, contexts } = run(history([...repair, 10.4, 10.5], [...Array(9).fill(2), 3]));
    expect(contexts[8].positions).toMatchObject([{ quantity: 500, availableQuantity: 0 }]);
    expect(signals[8]).toEqual([]);
    expect(signals[9]).toEqual([{ symbol, side: "sell", type: "market", quantity: 500 }]);
    expect(report.trades.map(t => [t.barIndex, t.side, t.quantity])).toEqual([[7, "buy", 500], [9, "sell", 500]]);
    expect(report.finalAccount.cash).toBe(10_290);
  });

  it("continues evaluating actual holdings after a rejected exit", () => {
    const { report, signals } = run(history([...repair, 10.4, 10.5]), { maxOrderNotional: 5100 });
    expect(signals.slice(8)).toEqual(Array.from({ length: 2 }, () => [{ symbol, side: "sell", type: "market", quantity: 500 }]));
    expect([...report.orders].reverse()).toMatchObject([
      { status: "filled", side: "buy" }, { status: "rejected", side: "sell" }, { status: "rejected", side: "sell" },
    ]);
    expect(report.finalPositions).toMatchObject([{ quantity: 500 }]);
  });

  it("uses slipped average price for the original take-profit threshold", () => {
    const { report, signals, contexts } = run(history([...repair, 10.3, 10.5]), { slippageBps: 100 });
    expect(contexts[8].positions).toMatchObject([{ averagePrice: 10 }]);
    expect(signals[8]).toEqual([]);
    expect(report.trades.map(t => [t.barIndex, t.side])).toEqual([[7, "buy"], [9, "sell"]]);
  });

  it.each([9.4, 10.2])("can exit a pre-existing position at actual average %s", averagePrice => {
    expect(project(strategy(), history(repair), [position({ averagePrice })])[7])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("does not add to an existing repaired position", () => {
    expect(project(strategy(), history(repair), [position()])[7]).toEqual([]);
  });

  it("retains confirmation failure exits before the price-return stop", () => {
    expect(project(strategy(), history([...repair, 9.7]), [position()])[8])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it.each([[300, 200, 200], [300, 350, 300], [350, undefined, 300], [300, 0, 0], [300, 99, 0]])(
    "aligns actual quantity %s and availability %s to %s", (quantity, availableQuantity, expected) => {
      expect(project(strategy(), history(repair), [position({ quantity, availableQuantity, averagePrice: 9.4 })])[7])
        .toEqual(expected ? [{ symbol, side: "sell", type: "market", quantity: expected }] : []);
    });

  it("binds price and volume history while quotes reorder or disappear", () => {
    const instance = strategy(), snapshots = history(repair);
    snapshots.slice(0, 7).forEach((s, i) => instance.onBar(context(s, i)));
    const other = { ...snapshots[7].quotes[0], symbol: "600002", price: 50, volume: 100 };
    expect(instance.onBar(context({ ...snapshots[7], quotes: [other] }, 7))).toEqual([]);
    expect(instance.onBar(context({ ...snapshots[7], quotes: [other, ...snapshots[7].quotes] }, 8)))
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
  });

  it("ignores invalid initial quotes and other-symbol positions", () => {
    const snapshots = history(repair).map(s => ({ ...s, quotes: [
      { ...s.quotes[0], symbol: "zero", price: 0 }, { ...s.quotes[0], symbol: "locked", tradable: false }, ...s.quotes,
    ] }));
    expect(project(strategy(), snapshots, [position({ symbol: "600002" })])[7])
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
  });

  it("reset clears both historical series and symbol binding for independent replay", () => {
    const instance = strategy();
    project(instance, history(repair), [position()]);
    instance.reset();
    const other = history(repair).map(s => ({ ...s, quotes: s.quotes.map(q => ({ ...q, symbol: "600002" })) }));
    expect(project(instance, other)).toEqual(project(strategy(), other));
  });
});
