import { describe, expect, it, vi } from "vitest";
import type { HistoricalBar, HistoricalSeries } from "./marketRegimeResearch";
import { buildAlignedHistoricalSnapshots, buildStrategyRobustnessReport } from "./strategyRobustness";
import { BacktestEngine } from "../backtest/backtestEngine";

const asOf = new Date("2026-08-24T06:59:59.999Z");
function bar(date = "2026-08-21", fields: Partial<HistoricalBar> = {}): HistoricalBar {
  return { date, open: 10, high: 11, low: 9, close: 10, volume: 100000,
    amount: 1000000, changePercent: null, turnover: null, ...fields };
}
function series(bars: HistoricalBar[], fields: Partial<HistoricalSeries> = {}): HistoricalSeries {
  return { symbol: "600010", name: "真实字段夹具", source: "tencent-stock-history", adjustment: "qfq", bars, ...fields };
}
function histories(count: number): HistoricalBar[] {
  return Array.from({ length: count }, (_, i) => bar(new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)));
}
const snapshot = { mode: "paper" as const, sequence: 1, marketTime: asOf.toISOString(),
  quotes: ["600010", "600011"].map((symbol) => ({ symbol, name: symbol, tradable: true,
    price: 10, previousClose: 10, changePercent: 0, volume: 100000, updatedAt: asOf.toISOString() })) };
async function report(payload: HistoricalSeries[], provider = "akshare") {
  return buildStrategyRobustnessReport({ bridgeUrl: "http://history-evidence.test", marketDataProvider: "akshare",
    mode: "paper", snapshot, limit: 2, days: 500, timeoutMs: 1000,
    fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ provider, source: "declared-wrapper-source",
      fetchedAt: asOf.toISOString(), series: payload, warning: null }), { status: 200 })) });
}

describe("real strategy history evidence boundaries", () => {
  it("excludes unfinished current-day and future daily bars at the report cutoff", () => {
    const snapshots = buildAlignedHistoricalSnapshots([series([bar(), bar("2026-08-24"), bar("2099-01-01")])], "paper", asOf);
    expect(snapshots.map((item) => item.marketTime)).toEqual(["2026-08-21T15:00:00+08:00"]);
  });

  it("accepts the daily close at the exact completed instant", () => {
    const snapshots = buildAlignedHistoricalSnapshots([series([bar("2026-08-24")])], "paper", new Date("2026-08-24T07:00:00Z"));
    expect(snapshots).toHaveLength(1);
  });

  it.each(["2026-02-30", "2026-8-21", "not-a-date"])("rejects invalid or noncanonical civil date %s", (date) => {
    expect(buildAlignedHistoricalSnapshots([series([bar(date)])], "paper", asOf)).toEqual([]);
  });

  it.each([
    { open: NaN }, { open: -1 }, { close: Infinity }, { high: Infinity }, { low: NaN },
    { high: 9.5 }, { low: 10.5 }, { open: 12 }, { volume: -1 }, { volume: NaN },
    { amount: -1 }, { amount: Infinity },
  ])("rejects invalid candle fields %j", (fields) => {
    expect(buildAlignedHistoricalSnapshots([series([bar("2026-08-21", fields)])], "paper", asOf)).toEqual([]);
  });

  it("does not choose a winning version of conflicting bars for the same date", () => {
    const snapshots = buildAlignedHistoricalSnapshots([series([bar(), bar("2026-08-21", { close: 11 }), bar("2026-08-20")])], "paper", asOf);
    expect(snapshots.map((item) => item.marketTime)).toEqual(["2026-08-20T15:00:00+08:00"]);
  });

  it("does not duplicate one stock in a historical portfolio", () => {
    expect(buildAlignedHistoricalSnapshots([series([bar()]), series([bar()])], "paper", asOf)).toEqual([]);
  });

  it("does not label another adjustment as qfq", () => {
    expect(buildAlignedHistoricalSnapshots([series([bar()], { adjustment: "hfq" })], "paper", asOf)).toEqual([]);
  });

  it("retains valid zero volume and nullable amount without fabricating turnover", () => {
    const snapshots = buildAlignedHistoricalSnapshots([series([bar("2026-08-21", { volume: 0, amount: null })])], "paper", asOf);
    expect(snapshots[0].quotes[0]).toMatchObject({ price: 10, volume: 0, tradable: false });
    expect(snapshots[0].quotes[0].amount).toBeUndefined();
  });

  it("does not fill a strategy's buy on a zero-volume daily candle", () => {
    const snapshots = buildAlignedHistoricalSnapshots([series([
      bar("2026-08-19"), bar("2026-08-20", { volume: 0, amount: 0 }), bar("2026-08-21"),
    ])], "paper", asOf);
    const result = new BacktestEngine(snapshots, { name: "zero-volume fixture",
      onBar: ({ barIndex }) => barIndex === 1 ? [{ symbol: "600010", side: "buy", type: "market", quantity: 100 }] : [],
    }, { initialCapital: 20000, maxOrderNotional: 20000, maxPositionWeight: 1 }).run();
    expect(result.orders.filter((order) => order.status === "filled")).toEqual([]);
    expect(result.finalPositions).toEqual([]);
    expect(result.finalAccount.cash).toBe(20000);
  });

  it("does not fill the 300-day evidence threshold with future bars", async () => {
    const values = [...histories(299), bar("2099-01-01"), bar("2099-01-02")];
    const result = await report([series(values), series(values, { symbol: "600011" })]);
    expect(result.entries).toEqual([]);
    expect(result.source.alignedTradingDays).toBeLessThan(300);
    expect(result.warnings.join(" ")).toContain("历史证据校验");
  });

  it("does not consume unrequested stocks returned by a source", async () => {
    const values = histories(360);
    const result = await report([series(values, { symbol: "000001" }), series(values, { symbol: "600036" })]);
    expect(result.entries).toEqual([]);
    expect(result.source.historySymbols).toBe(0);
    expect(result.warnings.join(" ")).toContain("历史证据校验");
  });

  it("counts only complete validated bars toward the evidence threshold", async () => {
    const values = histories(301).map((value, index) => index < 3 ? { ...value, volume: -1 } : value);
    const result = await report([series(values), series(values, { symbol: "600011" })]);
    expect(result.entries).toEqual([]);
    expect(result.source.historySymbols).toBe(0);
    expect(result.warnings.join(" ")).toContain("历史证据校验");
  });

  it("does not label a mock provider payload as real history", async () => {
    const values = histories(360);
    const result = await report([series(values), series(values, { symbol: "600011" })], "mock");
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(" ")).toContain("返回供应方不是AkShare");
  });

  it("preserves seventeen fixed profiles and reports the sources of actual validated series", async () => {
    const values = histories(360);
    const result = await report([series(values), series(values, { symbol: "600011", source: "eastmoney-stock-history" })]);
    expect(result.source).toMatchObject({ historySymbols: 2, alignedTradingDays: 360,
      historySource: "eastmoney-stock-history + tencent-stock-history", windowCount: 3 });
    expect(result.entries).toHaveLength(17);
    expect(result.entries.every((entry) => entry.windows === 3)).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("does not let a stale snapshot use daily bars observed after its own market time", async () => {
    const values = [...histories(299), bar("2026-08-24")];
    const result = await report([series(values), series(values, { symbol: "600011" })]);
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(" ")).toContain("尚未完成或未来日线");
  });

  it("keeps only the most recent five hundred complete daily bars", () => {
    const snapshots = buildAlignedHistoricalSnapshots([series(histories(510))], "paper", asOf);
    expect(snapshots).toHaveLength(500);
    expect(snapshots[0].marketTime).toBe("2025-01-11T15:00:00+08:00");
  });

  it.each(["invalid", "2026-08-24T07:00:06Z"])("does not fetch history for an invalid or future snapshot: %s", async (marketTime) => {
    const fetchImpl = vi.fn();
    const result = await buildStrategyRobustnessReport({ now: asOf,
      bridgeUrl: "http://history-evidence.test", marketDataProvider: "akshare", mode: "paper",
      snapshot: { ...snapshot, marketTime }, limit: 2, days: 500, timeoutMs: 1000, fetchImpl });
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(" ")).toContain("历史证据校验");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.generatedAt).toBe(asOf.toISOString());
  });
});
