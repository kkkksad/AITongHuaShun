import { describe, expect, it } from "vitest";
import type { StrategyContext } from "../../shared/backtest";
import type { PositionSnapshot } from "../../shared/trading";
import { createCompletedEntryResearchStrategy, type CompletedEntryObservation } from "./completedEntryHypothesis";
import { runNextOpenPortfolioResearch } from "./nextOpenPortfolioResearch";

const asOf = new Date("2025-12-31T08:00:00Z");
const time = (day: number) => `2025-06-${String(day).padStart(2, "0")}T15:00:00+08:00`;
function context(day = 2, price = 10, positions: PositionSnapshot[] = []): StrategyContext {
  return { snapshot: { mode: "paper", sequence: day, marketTime: time(day), quotes: [{ symbol: "600001", name: "fixture",
    tradable: true, price, previousClose: 10, volume: 10000, changePercent: 0, updatedAt: time(day), open: price, high: price, low: price }] },
    positions, barIndex: day - 2, totalBars: 20, equity: 20000, cash: 20000,
    account: { mode: "paper", accountId: "test", equity: 20000, cash: 20000, marketValue: 0, unrealizedPnl: 0,
      realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: time(day) } };
}
function position(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return { symbol: "600001", name: "fixture", quantity: 100, availableQuantity: 100, t1LockedQuantity: 0,
    averagePrice: 10, currentPrice: 10, marketValue: 1000, unrealizedPnl: 0, realizedPnl: 0, weight: 0.05,
    paperEntry: { openedAt: "2025-06-02T09:30:00+08:00", strategy: { status: "unknown" } }, ...overrides };
}
const observations = (state: CompletedEntryObservation["structure"] = "confirmed", proxyEligible = true) =>
  Array.from({ length: 20 }, (_, i) => ({symbol:"600001",closeTime:time(i+2),proxyEligible,structure:state}));
const make = (mode: "proxy" | "structure" = "structure", rows = observations()) =>
  createCompletedEntryResearchStrategy("600001", "aSharePullback", mode, rows, asOf);

describe("offline completed-entry execution semantics", () => {
  it.each(["unknown", "not-confirmed"] as const)("never creates a structure entry from %s evidence", state => {
    expect(make("structure", observations(state)).strategy.onBar(context())).toEqual([]);
    expect(make("proxy", observations(state)).strategy.onBar(context())).toMatchObject([{ side: "buy", targetWeight: 0.2 }]);
  });
  it("does not create entries absent from the unchanged proxy", () => {
    for (const mode of ["proxy", "structure"] as const) expect(make(mode, observations("confirmed", false)).strategy.onBar(context())).toEqual([]);
  });
  it("continues evaluating when a preceding intent did not fill", () => {
    const child = make();
    expect(child.strategy.onBar(context(2))).toHaveLength(1);
    expect(child.strategy.onBar(context(3))).toHaveLength(1);
    expect(child.getDiagnostics().generatedBuys).toBe(2);
  });
  it("does not add to actual holdings and uses their fill cost for exits", () => {
    const child = make();
    expect(child.strategy.onBar(context(2, 10.2, [position()]))).toEqual([]);
    expect(child.strategy.onBar(context(3, 9.7, [position()]))).toMatchObject([{ side: "sell", quantity: 100 }]);
    expect(child.getDiagnostics().generatedStopExits).toBe(1);
  });
  it.each([{ availableQuantity: 0, t1LockedQuantity: 100 }, { availableQuantity: 99 }, { t1LockedQuantity: 1 }])("respects whole sellable inventory %j", overrides => {
    expect(make().strategy.onBar(context(2, 9, [position(overrides)]))).toEqual([]);
  });
  it("does not treat a sell intent as a fill or erase the holding lifecycle", () => {
    const child = make();
    expect(child.strategy.onBar(context(2, 10.5, [position()]))).toHaveLength(1);
    expect(child.strategy.onBar(context(3, 10.5, [position()]))).toMatchObject([{side:"sell"}]);
  });
  it("counts ten completed closes only from an observed actual fill", () => {
    const child = make();
    for (let day = 2; day <= 10; day++) expect(child.strategy.onBar(context(day, 10, [position()]))).toEqual([]);
    expect(child.strategy.onBar(context(11, 10, [position()]))).toMatchObject([{side:"sell"}]);
    expect(child.getDiagnostics().generatedTimeoutExits).toBe(1);
  });
  it("keeps missing or old holding age unknown rather than inferring calendar days", () => {
    for (const paperEntry of [undefined, {openedAt:"2025-05-01T09:30:00+08:00",strategy:{status:"unknown" as const}}]) {
      const child = make();
      for (let day = 2; day < 20; day++) expect(child.strategy.onBar(context(day, 10, [position({paperEntry})]))).toEqual([]);
      expect(child.getDiagnostics().unknownHoldingAgeCloses).toBe(18);
    }
  });
  it("copies entry observations and does not mutate account/holding inputs", () => {
    const rows = observations(); const child = make("structure", rows); rows[0].proxyEligible = false;
    const input = context(), before = structuredClone(input);
    expect(child.strategy.onBar(input)).toHaveLength(1); expect(input).toEqual(before);
    child.strategy.reset?.(); expect(child.strategy.onBar(input)).toHaveLength(1);
  });
  it.each(["open", "future", "duplicate", "missing", "bad-cost"])("rejects invalid %s observations instead of calling them no signal", kind => {
    const child = make(), input = context(2, 10, kind === "bad-cost" ? [position({averagePrice:NaN})] : []);
    if (kind === "open") input.snapshot.marketTime = input.snapshot.quotes[0].updatedAt = "2025-06-02T09:30:00+08:00";
    if (kind === "future") input.snapshot.marketTime = input.snapshot.quotes[0].updatedAt = "2026-06-02T15:00:00+08:00";
    if (kind === "duplicate") child.strategy.onBar(input);
    if (kind === "missing") input.snapshot.quotes = [];
    expect(() => child.strategy.onBar(input)).toThrow();
  });
  it("rejects duplicate or foreign precomputed identities", () => {
    expect(() => make("proxy", [observations()[0], observations()[0]])).toThrow();
    expect(() => make("proxy", [{...observations()[0],symbol:"600002"}])).toThrow();
  });
  it("lets the original broker fill only at the following observed open, deterministically", () => {
    const daily = [context(2), context(3), context(4), context(5)].map(c => c.snapshot);
    daily[1].quotes[0].open = 11; daily[1].quotes[0].high = 11;
    const run = () => runNextOpenPortfolioResearch(daily, new Map([["600001",make().strategy]]),
      {commissionRate:0.0003,minimumCommission:5,slippageBps:0},asOf);
    const result = run(); expect(result).toEqual(run());
    expect(result.report.trades).toMatchObject([{side:"buy",price:11,time:"2025-06-03T09:30:00+08:00"},
      {side:"sell",price:10,time:"2025-06-05T09:30:00+08:00"}]);
  });
});
