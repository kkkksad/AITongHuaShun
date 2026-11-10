import { describe, expect, it } from "vitest";
import type { BacktestConfig, StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketSnapshot, PositionSnapshot } from "../../../shared/trading";
import { BacktestEngine } from "../backtestEngine";
import { KairosVolumePriceBreakoutStrategy } from "./KairosBreakoutQualityStrategies";

const symbol = "600001";
const rising = [10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8];
const strategy = (weight = 0.5) => new KairosVolumePriceBreakoutStrategy(2, 2, 3, 1.5, 0.58, 4.5, 0.075, 0.03, weight);

function history(prices: number[], days = prices.map((_, index) => index + 2)): MarketSnapshot[] {
  return prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, days[index], 6, index)).toISOString();
    return { mode: "paper", sequence: index + 1, marketTime, quotes: [{
      symbol, name: "deterministic volume-price fixture", tradable: true, price,
      previousClose: prices[Math.max(0, index - 1)], changePercent: 0.3,
      high: price + 0.01, low: price - 0.09,
      volume: index < 8 ? 1_000_000 : 2_000_000 * 2 ** (index - 8), updatedAt: marketTime,
    }] };
  });
}

function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return { symbol, name: "held volume-price fixture", quantity: 300, availableQuantity: 300,
    averagePrice: 10, currentPrice: 10.4, marketValue: 3_120,
    unrealizedPnl: 120, realizedPnl: 0, weight: 0.312, ...overrides };
}

function context(snapshot: MarketSnapshot, barIndex: number, positions: PositionSnapshot[] = []): StrategyContext {
  return { snapshot, positions, barIndex, totalBars: 20, equity: 10_000, cash: 10_000,
    account: { accountId: "volume-price-fixture", mode: "paper", cash: 10_000, equity: 10_000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
      dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: snapshot.marketTime } };
}

function project(instance: KairosVolumePriceBreakoutStrategy, snapshots: MarketSnapshot[], positions: PositionSnapshot[] = []) {
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

describe("volume-price breakout actual position contract", () => {
  it("requires the original prior-volume baseline and keeps the trend warmup", () => {
    const values = history(rising), output = project(strategy(), values);
    expect(output.slice(0, 8)).toEqual(Array.from({ length: 8 }, () => []));
    expect(output[8]).toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.5 }]);
    const insufficientVolume = values.map(snapshot => ({ ...snapshot, quotes: snapshot.quotes.map(quote => ({ ...quote, volume: 1_000_000 })) }));
    expect(project(strategy(), insufficientVolume).every(signals => signals.length === 0)).toBe(true);
    // Even a volume-confirmed early bar cannot bypass the five-bar prior trend comparison.
    const early = history(rising.slice(0, 6)).map(snapshot => ({ ...snapshot, quotes: snapshot.quotes.map(quote => ({ ...quote, volume: 2 ** snapshot.sequence * 1_000_000 })) }));
    expect(project(strategy(), early).every(signals => signals.length === 0)).toBe(true);
  });

  it.each(["weak-close", "overheated", "negative-change", "flat-price"])("keeps the original %s entry filter", reason => {
    const snapshots = history(rising).map(snapshot => ({ ...snapshot, quotes: snapshot.quotes.map(quote => ({ ...quote,
      ...(reason === "weak-close" ? { high: quote.price + 1, low: quote.price - 0.01 } : {}),
      ...(reason === "overheated" ? { changePercent: 4.6 } : {}),
      ...(reason === "negative-change" ? { changePercent: -0.1 } : {}),
      ...(reason === "flat-price" ? { price: 10 } : {}),
    })) }));
    expect(project(strategy(), snapshots).every(signals => signals.length === 0)).toBe(true);
  });

  it("retries rejected entries without inventing a filled position", () => {
    const { report, signals } = run(history([...rising, 10.9, 11]), { maxOrderNotional: 500 });
    expect(signals.slice(8).map(output => output[0]?.side)).toEqual(["buy", "buy", "buy"]);
    expect(report.orders).toHaveLength(3);
    expect(report.orders.every(order => order.status === "rejected")).toBe(true);
    expect(report.finalPositions).toEqual([]);
    expect(report.finalAccount.cash).toBe(10_000);
  });

  it("retries after fees reject two lots and a later quote makes one lot affordable", () => {
    const { report, contexts } = run(history([9.93, 9.94, 9.95, 9.96, 9.97, 9.98, 9.99, 10, 10.01, 10.03]), { initialCapital: 2_005 }, strategy(1));
    expect(contexts[9].positions).toEqual([]);
    expect([...report.orders].reverse()).toMatchObject([
      { status: "rejected", quantity: 200, rejectionReason: "可用资金不足" },
      { status: "filled", quantity: 100, filledPrice: 10.03, commission: 5 },
    ]);
    expect(report.finalAccount.cash).toBeCloseTo(997, 10);
  });

  it("waits for T+1 and exits the actual shares when they unlock", () => {
    const { report, signals, contexts } = run(history([...rising, 11.7, 11.8], [...Array<number>(10).fill(2), 3]));
    expect(contexts[9].positions).toMatchObject([{ quantity: 400, availableQuantity: 0 }]);
    expect(signals[9]).toEqual([]);
    expect(signals[10]).toEqual([{ symbol, side: "sell", type: "market", quantity: 400 }]);
    expect(report.trades.map(({ barIndex, side, quantity }) => [barIndex, side, quantity]))
      .toEqual([[8, "buy", 400], [10, "sell", 400]]);
    expect(report.finalAccount.cash).toBe(10_390);
  });

  it("rechecks actual holdings after rejected exits", () => {
    const { report, signals } = run(history([...rising, 11.7, 11.8]), { maxOrderNotional: 4_500 });
    expect(signals.slice(9)).toEqual([
      [{ symbol, side: "sell", type: "market", quantity: 400 }],
      [{ symbol, side: "sell", type: "market", quantity: 400 }],
    ]);
    expect([...report.orders].reverse()).toMatchObject([{ status: "filled", side: "buy" },
      { status: "rejected", side: "sell" }, { status: "rejected", side: "sell" }]);
    expect(report.finalPositions).toMatchObject([{ quantity: 400 }]);
  });

  it("uses the actual slipped average price for price-return exits", () => {
    const { report, signals, contexts } = run(history([...rising, 11.7, 11.8]), { slippageBps: 100 });
    expect(contexts[9].positions).toMatchObject([{ averagePrice: 10.91, quantity: 400 }]);
    expect(signals[9]).toEqual([]);
    expect(report.trades.map(({ barIndex, side }) => [barIndex, side])).toEqual([[8, "buy"], [10, "sell"]]);
  });

  it("does not add to an already held healthy position", () => {
    expect(project(strategy(), history(rising), [position({ averagePrice: 10.8 })])[8]).toEqual([]);
  });

  it("can exit a position held before this strategy started", () => {
    expect(project(strategy(), history(rising), [position()])[8])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("keeps structural exits before the price-return stop is reached", () => {
    const output = project(strategy(), history([...rising, 10.1]), [position({ averagePrice: 10.3 })]);
    expect(output[8]).toEqual([]);
    expect(output[9]).toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("keeps the price-return stop against actual average in a rising window", () => {
    expect(project(strategy(), history(rising), [position({ averagePrice: 11.2 })])[8])
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 300 }]);
  });

  it("selects the first tradable positive quote and ignores another stock's holdings", () => {
    const snapshots = history(rising).map(snapshot => ({ ...snapshot, quotes: [
      { ...snapshot.quotes[0], symbol: "zero", price: 0 },
      { ...snapshot.quotes[0], symbol: "locked", tradable: false }, ...snapshot.quotes,
    ] }));
    expect(project(strategy(0.42), snapshots, [position({ symbol: "600002" })])[8])
      .toEqual([{ symbol, side: "buy", type: "market", targetWeight: 0.42 }]);
  });

  it.each([
    { quantity: 350, availableQuantity: 199, expected: 100 },
    { quantity: 250, availableQuantity: 500, expected: 200 },
    { quantity: 300, availableQuantity: undefined, expected: 300 },
    { quantity: 300, availableQuantity: 0, expected: 0 },
    { quantity: 300, availableQuantity: 99, expected: 0 },
  ])("uses actual sellable lots: %j", ({ quantity, availableQuantity, expected }) => {
    const output = project(strategy(), history(rising), [position({ quantity, availableQuantity })])[8];
    expect(output).toEqual(expected ? [{ symbol, side: "sell", type: "market", quantity: expected }] : []);
  });

  it("reads remaining and unlocked shares after partial exits", () => {
    const instance = strategy(), snapshots = history([...rising, 10.9, 11]);
    snapshots.slice(0, 8).forEach((snapshot, index) => instance.onBar(context(snapshot, index)));
    expect(instance.onBar(context(snapshots[8], 8, [position({ availableQuantity: 100 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 100 }]);
    expect(instance.onBar(context(snapshots[9], 9, [position({ quantity: 200, availableQuantity: 0 })]))).toEqual([]);
    expect(instance.onBar(context(snapshots[10], 10, [position({ quantity: 200, availableQuantity: 200 })])))
      .toEqual([{ symbol, side: "sell", type: "market", quantity: 200 }]);
  });

  it("binds the first valid stock even if quote ordering changes", () => {
    const stable = history([...rising, 11.7]);
    const reordered = stable.map((snapshot, index) => ({ ...snapshot,
      quotes: index ? [{ ...snapshot.quotes[0], symbol: "600002", price: 100 + index }, ...snapshot.quotes] : snapshot.quotes }));
    expect(project(strategy(), reordered)).toEqual(project(strategy(), stable));
    const expected = run(stable).report;
    const actual = run(reordered).report;
    expect(actual.trades).toEqual(expected.trades);
    expect(actual.orders).toEqual(expected.orders);
    expect(actual.finalAccount).toEqual(expected.finalAccount);
  });

  it.each(["missing", "untradable"])("waits for a %s bound quote", reason => {
    const stable = history([...rising, 10.9, 11]);
    const changed = stable.map((snapshot, index) => index === 2 ? { ...snapshot, quotes: [
      ...(reason === "untradable" ? [{ ...snapshot.quotes[0], tradable: false }] : []),
      { ...snapshot.quotes[0], symbol: "600002", price: 100 },
    ] } : snapshot);
    const output = project(strategy(), changed);
    const expected = project(strategy(), stable.filter((_, index) => index !== 2));
    expect(output[2]).toEqual([]);
    expect(output.filter((_, index) => index !== 2)).toEqual(expected);
  });

  it("resets binding/history and reproduces reports on reuse", () => {
    const instance = strategy(), snapshots = history([...rising, 11.7]);
    const { report, engine } = run(snapshots, {}, instance);
    expect(engine.run()).toEqual(report);
    instance.reset();
    const other = history(rising).map(snapshot => ({ ...snapshot, quotes: snapshot.quotes.map(quote => ({ ...quote, symbol: "600002" })) }));
    expect(project(instance, other)).toEqual(project(strategy(), other));
  });
});
