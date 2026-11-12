import { describe, expect, it } from "vitest";
import type { BacktestStrategy, StrategyContext, StrategySignal } from "../../shared/backtest";
import type { PositionSnapshot } from "../../shared/trading";
import { runNextOpenPortfolioResearch } from "./nextOpenPortfolioResearch";
import { createStrategyExitResearch } from "./strategyExitResearch";

const symbol = "600001";
const buy: StrategySignal = { symbol, side: "buy", type: "market", quantity: 100 };
const sell: StrategySignal = { ...buy, side: "sell" };
const asOf = new Date("2025-12-31T23:59:00Z");
const base = (onBar: BacktestStrategy["onBar"] = () => []): BacktestStrategy => ({ name: "fixed base", onBar });
const time = (index: number) => new Date(Date.UTC(2025, 5, 2 + index, 7)).toISOString();
const opened = (index = 0) => new Date(Date.UTC(2025, 5, 2 + index, 1, 30)).toISOString();
const position = (changes: Partial<PositionSnapshot> = {}): PositionSnapshot => ({ symbol, name: "held",
  quantity: 300, availableQuantity: 300, t1LockedQuantity: 0, averagePrice: 10,
  currentPrice: 10, marketValue: 3000, unrealizedPnl: 0, realizedPnl: 0, weight: 0.15,
  paperEntry: { openedAt: opened(), strategy: { status: "unknown" } }, ...changes });
const context = (index: number, price = 10, positions: PositionSnapshot[] = []): StrategyContext => ({
  snapshot: { mode: "paper", sequence: index + 1, marketTime: time(index), quotes: [{ symbol, name: "fixture",
    tradable: true, price, open: price, high: price, low: price, previousClose: price,
    changePercent: 0, volume: 10000, updatedAt: time(index) }] }, positions,
  barIndex: index, totalBars: 200, cash: 17000, equity: 20000,
  account: { accountId: "exit-fixture", mode: "paper", cash: 17000, equity: 20000, marketValue: 3000,
    unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0, riskUtilization: 0,
    paused: false, updatedAt: time(index) },
});
const wrapper = (family: "trend" | "mean-reversion" = "trend", onBar = base().onBar,
  mode: "family-exit" | "common-price-stop" = "family-exit") =>
  createStrategyExitResearch(base(onBar), symbol, family, mode, asOf);

describe("offline fixed exit lifecycle policy", () => {
  it("returns the exact native instance without changing callbacks or signals", () => {
    const original = base(() => [buy, sell]);
    const result = createStrategyExitResearch(original, symbol, "trend", "native", asOf);
    expect(result.strategy).toBe(original);
    expect(result.strategy.onBar(context(0))).toEqual([buy, sell]);
  });

  it("keeps real buy intentions and advances the original class on every observation", () => {
    let calls = 0; const result = wrapper("trend", () => { calls++; return [buy, sell]; });
    expect(result.strategy.onBar(context(0))).toEqual([buy]);
    expect(result.strategy.onBar(context(1))).toEqual([buy]);
    expect(calls).toBe(2);
    expect(result.getDiagnostics().replacedNativeSellSignals).toBe(2);
  });

  it("uses the actual slipped average fill cost, even when no buy signal was observed", () => {
    const result = wrapper();
    expect(result.strategy.onBar(context(0, 10, [position({ averagePrice: 10.4 })])))
      .toEqual([{ ...sell, quantity: 300 }]);
    expect(result.getDiagnostics().generatedStopExits).toBe(1);
  });

  it("does not invent holdings after a rejected buy", () => {
    const result = wrapper("trend", () => [buy]);
    expect(result.strategy.onBar(context(0, 10))).toEqual([buy]);
    expect(result.strategy.onBar(context(1, 9))).toEqual([buy]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("does not invent a cost-based stop from bad cost %s", averagePrice => {
    const result = wrapper();
    expect(result.strategy.onBar(context(0, 1, [position({ averagePrice })]))).toEqual([]);
    expect(result.getDiagnostics().invalidCostObservations).toBe(1);
  });

  it("gives the 3% floor priority and suppresses same-close buys", () => {
    const result = wrapper("trend", () => [buy]);
    for (let i = 0; i < 19; i++) result.strategy.onBar(context(i, 10, [position()]));
    expect(result.strategy.onBar(context(19, 9.7, [position()]))).toEqual([{ ...sell, quantity: 300 }]);
    expect(result.getDiagnostics()).toMatchObject({ generatedStopExits: 1, generatedTimeoutExits: 0, suppressedBuySignals: 1 });
  });

  it("waits for T+1, caps available shares and rounds down to whole lots", () => {
    const result = wrapper("trend", () => [buy]);
    expect(result.strategy.onBar(context(0, 9, [position({ availableQuantity: 0, t1LockedQuantity: 300 })]))).toEqual([]);
    expect(result.strategy.onBar(context(1, 9, [position({ availableQuantity: 260, t1LockedQuantity: 40 })])))
      .toEqual([{ ...sell, quantity: 200 }]);
    expect(result.getDiagnostics().blockedExitObservations).toBe(1);
  });

  it("falls back to quantity minus locked shares when availability is absent", () => {
    expect(wrapper().strategy.onBar(context(0, 9, [position({ availableQuantity: undefined, t1LockedQuantity: 100 })])))
      .toEqual([{ ...sell, quantity: 200 }]);
  });

  it("requires two completed below-MA20 closes and does not count warmup as a break", () => {
    const result = wrapper();
    for (let i = 0; i < 19; i++) expect(result.strategy.onBar(context(i, 10))).toEqual([]);
    const held = position({ paperEntry: { openedAt: opened(19), strategy: { status: "unknown" } } });
    expect(result.strategy.onBar(context(19, 9.9, [held]))).toEqual([]);
    expect(result.strategy.onBar(context(20, 9.9, [held]))).toEqual([{ ...sell, quantity: 300 }]);
    expect(result.getDiagnostics().generatedTrendBreakExits).toBe(1);
  });

  it("resets the below-MA streak after a recovered completed close", () => {
    const result = wrapper();
    for (let i = 0; i < 19; i++) result.strategy.onBar(context(i));
    const held = position({ paperEntry: { openedAt: opened(19), strategy: { status: "unknown" } } });
    expect(result.strategy.onBar(context(19, 9.9, [held]))).toEqual([]);
    expect(result.strategy.onBar(context(20, 10.2, [held]))).toEqual([]);
    expect(result.strategy.onBar(context(21, 9.9, [held]))).toEqual([]);
  });

  it("counts actual holding observations across weekends, not elapsed calendar days", () => {
    const result = wrapper("mean-reversion");
    for (let i = 0; i < 9; i++) {
      const value = context(i * 2, 10, [position()]);
      expect(result.strategy.onBar(value)).toEqual([]);
    }
    expect(result.strategy.onBar(context(18, 10, [position()]))).toEqual([{ ...sell, quantity: 300 }]);
    expect(result.getDiagnostics().generatedTimeoutExits).toBe(1);
  });

  it("does not reset timeout for additions or partial exits within the actual cycle", () => {
    const result = wrapper("mean-reversion");
    for (let i = 0; i < 9; i++) result.strategy.onBar(context(i, 10, [position({ quantity: i < 4 ? 100 : 300 })]));
    expect(result.strategy.onBar(context(9, 10, [position({ quantity: 200, availableQuantity: 200 })])))
      .toEqual([{ ...sell, quantity: 200 }]);
  });

  it("resets timeout only when observed flat or a new actual cycle begins", () => {
    const result = wrapper("mean-reversion");
    for (let i = 0; i < 9; i++) result.strategy.onBar(context(i, 10, [position()]));
    result.strategy.onBar(context(9));
    const held = position({ paperEntry: { openedAt: opened(10), strategy: { status: "unknown" } } });
    expect(result.strategy.onBar(context(10, 10, [held]))).toEqual([]);
    expect(result.getDiagnostics().generatedTimeoutExits).toBe(0);
  });

  it("detects a new actual cycle even without an intermediate flat close", () => {
    const result = wrapper("mean-reversion");
    for (let i = 0; i < 9; i++) result.strategy.onBar(context(i, 10, [position()]));
    const held = position({ paperEntry: { openedAt: opened(9), strategy: { status: "unknown" } } });
    expect(result.strategy.onBar(context(9, 10, [held]))).toEqual([]);
  });

  it("uses the predeclared 20 actual holding observations for trend timeout", () => {
    const result = wrapper();
    for (let i = 0; i < 19; i++) expect(result.strategy.onBar(context(i, 10, [position()]))).toEqual([]);
    expect(result.strategy.onBar(context(19, 10, [position()]))).toEqual([{ ...sell, quantity: 300 }]);
    expect(result.getDiagnostics().generatedTimeoutExits).toBe(1);
  });

  it("does not reconstruct a lost holding count after missing entry evidence", () => {
    const result = wrapper("mean-reversion");
    for (let i = 0; i < 8; i++) result.strategy.onBar(context(i, 10, [position()]));
    result.strategy.onBar(context(8, 10, [position({ paperEntry: undefined })]));
    for (let i = 9; i < 15; i++) expect(result.strategy.onBar(context(i, 10, [position()]))).toEqual([]);
    expect(result.getDiagnostics().unknownHoldingAgeObservations).toBe(7);
  });

  it("requires both MA20 recovery and 1.5% actual price recovery", () => {
    const result = wrapper("mean-reversion");
    for (let i = 0; i < 19; i++) result.strategy.onBar(context(i, 11));
    const held = position({ paperEntry: { openedAt: opened(19), strategy: { status: "unknown" } } });
    expect(result.strategy.onBar(context(19, 10.2, [held]))).toEqual([]);
    expect(result.strategy.onBar(context(20, 11.1, [held]))).toEqual([{ ...sell, quantity: 300 }]);
    expect(result.getDiagnostics().generatedMeanRecoveryExits).toBe(1);
  });

  it("does not interpret a price recovery below 1.5% as a completed mean reversion", () => {
    const result = wrapper("mean-reversion");
    for (let i = 0; i < 19; i++) result.strategy.onBar(context(i, 10));
    const held = position({ paperEntry: { openedAt: opened(19), strategy: { status: "unknown" } } });
    expect(result.strategy.onBar(context(19, 10.14, [held]))).toEqual([]);
    expect(result.strategy.onBar(context(20, 10.15, [held]))).toEqual([{ ...sell, quantity: 300 }]);
  });

  it.each([undefined, { openedAt: null, strategy: { status: "unknown" as const } },
    { openedAt: "2026-01-01T01:30:00Z", strategy: { status: "unknown" as const } }])(
    "does not guess timeout from missing or future actual entry evidence", paperEntry => {
      const result = wrapper("mean-reversion");
      for (let i = 0; i < 15; i++) expect(result.strategy.onBar(context(i, 10, [position({ paperEntry })]))).toEqual([]);
      expect(result.getDiagnostics().unknownHoldingAgeObservations).toBe(15);
      expect(result.strategy.onBar(context(15, 9, [position({ paperEntry })]))).toEqual([{ ...sell, quantity: 300 }]);
    });

  it("does not guess a pre-existing holding age when research starts after its actual fill", () => {
    const result = wrapper("mean-reversion");
    for (let i = 5; i < 20; i++) expect(result.strategy.onBar(context(i, 10, [position()]))).toEqual([]);
    expect(result.getDiagnostics().unknownHoldingAgeObservations).toBe(15);
  });

  it("keeps common-price-stop free of family timeout and mean-recovery rules", () => {
    const result = wrapper("mean-reversion", () => [sell], "common-price-stop");
    for (let i = 0; i < 25; i++) expect(result.strategy.onBar(context(i, 10.2, [position()]))).toEqual([]);
    expect(result.strategy.onBar(context(25, 9, [position()]))).toEqual([{ ...sell, quantity: 300 }]);
  });

  it.each(["intraday", "future", "stale-quote", "duplicate", "reversed"])("does not count %s as another completed observation", kind => {
    const result = wrapper("mean-reversion");
    for (let i = 0; i < 9; i++) result.strategy.onBar(context(i, 10, [position()]));
    const bad = context(9, 10, [position()]);
    if (kind === "intraday") bad.snapshot.marketTime = bad.snapshot.quotes[0].updatedAt = "2025-06-11T14:59:00+08:00";
    if (kind === "future") bad.snapshot.marketTime = bad.snapshot.quotes[0].updatedAt = "2026-01-01T15:00:00+08:00";
    if (kind === "stale-quote") bad.snapshot.quotes[0].updatedAt = time(0);
    if (kind === "duplicate" || kind === "reversed") bad.snapshot.marketTime = bad.snapshot.quotes[0].updatedAt = time(kind === "duplicate" ? 8 : 7);
    expect(result.strategy.onBar(bad)).toEqual([]);
    expect(result.strategy.onBar(context(10, 10, [position()]))).toEqual([{ ...sell, quantity: 300 }]);
  });

  it.each([null, [{ ...sell, side: "wrong" }], [{ ...sell, symbol: "600002" }],
    [{ ...sell, quantity: Number.NaN }], [{ ...sell, type: "limit" }], [{ ...buy, quantity: undefined, targetWeight: 2 }]])(
    "rejects malformed native intent before filtering sells", signals => {
      const result = wrapper("trend", () => signals as StrategySignal[]);
      expect(() => result.strategy.onBar(context(0))).toThrow(/意图/);
    });

  it("isolates base callback edits and retained references from policy inputs and caller", () => {
    const input = context(0, 9, [position()]), expected = structuredClone(input);
    let retained: StrategyContext | undefined;
    const result = wrapper("trend", value => {
      retained = value; value.snapshot.quotes[0].price = 100; value.positions[0].averagePrice = 0;
      value.positions[0].paperEntry!.openedAt = null; value.positions[0].paperEntry!.strategy.status = "mixed";
      return [];
    });
    expect(result.strategy.onBar(input)).toEqual([{ ...sell, quantity: 300 }]);
    retained!.positions.length = 0;
    expect(input).toEqual(expected);
  });

  it("isolates native start/end callback mutations from the caller", () => {
    const original = base();
    original.onStart = value => { value.positions[0].paperEntry!.strategy.status = "mixed"; value.account.cash = 0; };
    original.onEnd = value => { value.positions[0].paperEntry!.openedAt = null; value.snapshot.quotes.length = 0; };
    const result = createStrategyExitResearch(original, symbol, "trend", "family-exit", asOf);
    const input = context(0, 10, [position()]), expected = structuredClone(input);
    result.strategy.onStart!(input); result.strategy.onEnd!(input);
    expect(input).toEqual(expected);
  });

  it("does not use totalBars to trigger an artificial terminal exit", () => {
    const value = context(0, 10, [position()]); value.totalBars = 1;
    expect(wrapper().strategy.onBar(value)).toEqual([]);
  });

  it("cannot read an externally changed earlier quote as a later MA feature", () => {
    const result = wrapper();
    const old = context(0, 10); result.strategy.onBar(old); old.snapshot.quotes[0].price = 1_000_000;
    for (let i = 1; i < 19; i++) result.strategy.onBar(context(i));
    const held = position({ paperEntry: { openedAt: opened(19), strategy: { status: "unknown" } } });
    expect(result.strategy.onBar(context(19, 10, [held]))).toEqual([]);
    expect(result.strategy.onBar(context(20, 10, [held]))).toEqual([]);
  });

  it("does not issue exits on nontradable completed quotes", () => {
    const value = context(0, 9, [position()]); value.snapshot.quotes[0].tradable = false;
    const result = wrapper(); expect(result.strategy.onBar(value)).toEqual([]);
    expect(result.getDiagnostics().blockedExitObservations).toBe(1);
  });

  it.each(["missing", "duplicate", "bad-price"])("rejects %s bound quote evidence without inventing observations", kind => {
    const value = context(0, 10, [position()]);
    if (kind === "missing") value.snapshot.quotes = [];
    if (kind === "duplicate") value.snapshot.quotes.push({ ...value.snapshot.quotes[0] });
    if (kind === "bad-price") value.snapshot.quotes[0].price = Number.NaN;
    const result = wrapper(); expect(result.strategy.onBar(value)).toEqual([]);
    expect(result.getDiagnostics()).toMatchObject({ completedCloseObservations: 0, invalidCloseObservations: 1 });
  });

  it("resets child state, counters and close history for deterministic engine reuse", () => {
    let calls = 0; const original = base(() => { calls++; return []; }); original.reset = () => { calls = 0; };
    const result = createStrategyExitResearch(original, symbol, "mean-reversion", "family-exit", asOf);
    for (let i = 0; i < 9; i++) result.strategy.onBar(context(i, 10, [position()]));
    result.strategy.reset!();
    expect(calls).toBe(0);
    expect(result.getDiagnostics().completedCloseObservations).toBe(0);
    expect(result.strategy.onBar(context(0, 10, [position()]))).toEqual([]);
    const external = result.getDiagnostics(); external.completedCloseObservations = 900;
    expect(result.getDiagnostics().completedCloseObservations).toBe(1);
  });

  it("executes stop at the next real open and keeps same-day locking conservative", () => {
    const prices = [10, 9, 8, 7];
    const snapshots = prices.map((price, i) => context(i, price).snapshot);
    const result = wrapper("trend", value => value.barIndex === 0 ? [buy] : []);
    const report = runNextOpenPortfolioResearch(snapshots, new Map([[symbol, result.strategy]]),
      { commissionRate: 0, minimumCommission: 5, slippageBps: 0 }, asOf).report;
    expect(report.trades.map(trade => [trade.side, trade.price])).toEqual([["buy", 9], ["sell", 7]]);
    expect(report.metrics.totalCommission).toBe(10);
    expect(report.finalPositions).toEqual([]);
    expect(report.metrics.winningTrades + report.metrics.losingTrades).toBe(1);
  });
});
