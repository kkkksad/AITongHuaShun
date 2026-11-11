import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { KairosTrendHealthStrategy } from "./KairosRegimeStrategies";

const symbol = "600001";
const rising = Array.from({ length: 65 }, (_, i) => Number((10 + i * 0.01).toFixed(2)));
const strategy = (weight = 0.5) => new KairosTrendHealthStrategy(2, 3, 1.3, 0.08, 0.035, 3, weight);
const history = (prices: number[], days = prices.map((_, i) => i + 1)): MarketSnapshot[] => prices.map((price, i) => {
  const marketTime = new Date(Date.UTC(2026, 8, days[i], 6, i % 60)).toISOString();
  return { mode: "paper", sequence: i + 1, marketTime, quotes: [{
    symbol, name: "deterministic trend-health fixture", tradable: true, price,
    previousClose: prices[Math.max(0, i - 1)], changePercent: 0.3,
    volume: 1_000_000, updatedAt: marketTime,
  }] };
});
const position = (changes: Partial<PositionSnapshot> = {}): PositionSnapshot => ({
  symbol, name: "held trend fixture", quantity: 300, availableQuantity: 300,
  averagePrice: 10.64, currentPrice: 10.64, marketValue: 3192,
  unrealizedPnl: 0, realizedPnl: 0, weight: 0.3192, ...changes,
});
const context = (snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext => ({
  snapshot, positions, barIndex, totalBars: 100, equity: 10_000, cash: 10_000,
  account: { accountId: "trend-fixture", mode: "paper", cash: 10_000, equity: 10_000,
    marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0,
    riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime },
});
const project = (instance: KairosTrendHealthStrategy, snapshots: MarketSnapshot[], positions: PositionSnapshot[] = []) =>
  snapshots.map((snapshot, i) => instance.onBar(context(snapshot, i, positions)));
const run = (snapshots: MarketSnapshot[], config: Partial<BacktestConfig> = {}, instance = strategy()) => {
  const contexts: StrategyContext[] = [], signals: StrategySignal[][] = [];
  const engine = new BacktestEngine(snapshots, { name: instance.name, reset: () => instance.reset(),
    onBar: value => { contexts.push(value); const output = instance.onBar(value); signals.push(output); return output; },
  }, { initialCapital: 10_000, maxOrderNotional: 1_000_000, maxPositionWeight: 1,
    maxDailyLoss: 1, minimumCommission: 5, commissionRate: 0, slippageBps: 0, ...config });
  return { report: engine.run(), contexts, signals };
};

describe("trend-health actual position contract", () => {
  it("retains the 65-bar minimum warmup and controlled trend entry", () => {
    const snapshots = history(rising), output = project(strategy(0.42), snapshots);
    expect(output.slice(0, 64)).toEqual(Array.from({ length: 64 }, () => []));
    expect(output[64]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
    const hot = snapshots.map(s => ({ ...s, quotes: s.quotes.map(q => ({ ...q, changePercent: 5 })) }));
    expect(project(strategy(), hot).every(s => s.length === 0)).toBe(true);
  });

  it("retries rejected entries without inventing a position", () => {
    const { report, signals } = run(history([...rising, 10.65, 10.66]), { maxOrderNotional: 500 });
    expect(signals.slice(64).map(s => s[0]?.side)).toEqual(["buy", "buy", "buy"]);
    expect(report.orders).toHaveLength(3);
    expect(report.orders.every(o => o.status === "rejected")).toBe(true);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("can enter after a fee rejection when the next lot is affordable", () => {
    const { report, contexts } = run(history([...rising, 10.67]), { initialCapital: 2132 }, strategy(1));
    expect(contexts[65].positions).toEqual([]);
    expect([...report.orders].reverse()).toMatchObject([
      { status: "rejected", quantity: 200, rejectionReason: "可用资金不足" },
      { status: "filled", quantity: 100, filledPrice: 10.67, commission: 5 },
    ]);
    expect(report.finalAccount.cash).toBe(1060);
  });

  it("waits for T+1 and exits actual shares after they unlock", () => {
    const { report, signals, contexts } = run(history([...rising, 11.5, 11.6], [...Array(66).fill(1), 2]));
    expect(contexts[65].positions).toMatchObject([{ quantity: 400, availableQuantity: 0 }]);
    expect(signals[65]).toEqual([]);
    expect(signals[66]).toEqual([{ symbol, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades.map(t => [t.barIndex, t.side, t.quantity])).toEqual([[64, "buy", 400], [66, "sell", 400]]);
    expect(report.finalAccount.cash).toBe(10_374);
  });

  it("does not clear actual holdings or start cooldown after a rejected exit", () => {
    const { report, signals } = run(history([...rising, 11.5, 11.6]), { maxOrderNotional: 4500 });
    expect(signals.slice(65)).toEqual(Array.from({ length: 2 }, () => [{ symbol, side: "sell", type: "market", quantity: 400 }]));
    expect([...report.orders].reverse()).toMatchObject([
      { status: "filled", side: "buy" }, { status: "rejected", side: "sell" }, { status: "rejected", side: "sell" },
    ]);
    expect(report.finalPositions).toMatchObject([{ quantity: 400 }]);
  });

  it("uses slipped average price for the original take-profit threshold", () => {
    const { report, signals, contexts } = run(history([...rising, 11.5, 11.7]), { slippageBps: 100 });
    expect(contexts[65].positions).toMatchObject([{ averagePrice: 10.75 }]);
    expect(signals[65]).toEqual([]);
    expect(report.trades.map(t => [t.barIndex, t.side])).toEqual([[64, "buy"], [66, "sell"]]);
  });

  it.each([9.5, 11.1])("evaluates a pre-existing position against actual average %s", averagePrice => {
    expect(project(strategy(), history(rising), [position({ averagePrice })])[64])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("does not add to an existing healthy position", () => {
    expect(project(strategy(), history(rising), [position()])[64]).toEqual([]);
  });

  it("retains structural breakdown exits before the price-return stop", () => {
    expect(project(strategy(), history([...rising, 10.52]), [position()])[65])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("retains high-volume breakdown when fast trend has not turned down", () => {
    const snapshots = history([...rising.slice(0, -1), 11, 10.2]);
    snapshots[65].quotes[0].volume = 5_000_000;
    const instance = new KairosTrendHealthStrategy(2, 3, 1.3, 0.5, 0.2, 3, 0.5);
    const output = project(instance, snapshots, [position({ averagePrice: 10.6 })]);
    expect(output[65]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it.each([[300, 200, 200], [300, 350, 300], [350, undefined, 300], [300, 0, 0], [300, 99, 0]])(
    "aligns actual quantity %s and availability %s to %s", (quantity, availableQuantity, expected) => {
      expect(project(strategy(), history(rising), [position({ quantity, availableQuantity, averagePrice: 9.5 })])[64])
        .toEqual(expected ? [{ symbol, side: "sell", type: "market", quantity: expected }] : []);
    });

  it("starts cooldown only after full exit is observed and honors its boundary", () => {
    const instance = strategy(), snapshots = history([...rising, 10.65, 10.66, 10.67, 10.68]);
    snapshots.slice(0, 65).forEach((s, i) => instance.onBar(context(s, i, [position({ averagePrice: 9.5 })])));
    expect(snapshots.slice(65).map((s, i) => instance.onBar(context(s, i + 65))))
      .toEqual([[], [], [], [{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]]);
  });

  it("does not enter cooldown while residual actual shares remain", () => {
    const instance = strategy(), snapshots = history([...rising, 11.5, 11.6]);
    snapshots.slice(0, 65).forEach((s, i) => instance.onBar(context(s, i, [position()])));
    expect(instance.onBar(context(snapshots[65], 65, [position({ quantity: 200, availableQuantity: 100 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect(instance.onBar(context(snapshots[66], 66, [position({ quantity: 100, availableQuantity: 100 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
  });

  it("keeps bound price and volume history when quotes reorder or disappear", () => {
    const instance = strategy(), snapshots = history(rising);
    snapshots.slice(0, 64).forEach((s, i) => instance.onBar(context(s, i)));
    const other = { ...snapshots[64].quotes[0], symbol: "600002", price: 50, volume: 100 };
    expect(instance.onBar(context({ ...snapshots[64], quotes: [other] }, 64))).toEqual([]);
    expect(instance.onBar(context({ ...snapshots[64], quotes: [other, ...snapshots[64].quotes] }, 65)))
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
  });

  it("ignores invalid initial quotes and other-symbol positions", () => {
    const snapshots = history(rising).map(s => ({ ...s, quotes: [
      { ...s.quotes[0], symbol: "zero", price: 0 }, { ...s.quotes[0], symbol: "locked", tradable: false }, ...s.quotes,
    ] }));
    expect(project(strategy(), snapshots, [position({ symbol: "600002" })])[64])
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
  });

  it("resets binding, both histories and cooldown for independent replay", () => {
    const instance = strategy();
    project(instance, history(rising), [position()]);
    project(instance, history([...rising, 10.65]));
    instance.reset();
    const other = history(rising).map(s => ({ ...s, quotes: s.quotes.map(q => ({ ...q, symbol: "600002" })) }));
    expect(project(instance, other)).toEqual(project(strategy(), other));
  });
});
