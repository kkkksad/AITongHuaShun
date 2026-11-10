import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { clearBridgeRequestCache } from "./bridgeRequest";
import {
  analyzeMarketRegimeData, buildMarketRegimeResearch, classifyStockRegime,
  type AnalyzeMarketRegimeInput, type HistoricalBar, type HistoricalSeries,
} from "./marketRegimeResearch";

const asOf = new Date("2026-08-24T06:59:59.999Z");
const stocks = new Map([["600010", "请求甲"], ["600011", "请求乙"]]);
function bars(count = 80): HistoricalBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 10 + i * 0.03;
    return { date: new Date(Date.UTC(2026, 4, 1 + i)).toISOString().slice(0, 10),
      open: close, high: close + 0.1, low: close - 0.1, close, volume: 100_000,
      amount: close * 100_000, changePercent: null, turnover: null };
  });
}
function series(values = bars(), fields: Partial<HistoricalSeries> = {}): HistoricalSeries {
  return { symbol: "600010", name: "供应商名称", source: "tencent-stock-history",
    adjustment: "qfq", bars: values, ...fields };
}
function input(values = [series()]): AnalyzeMarketRegimeInput {
  const history = { provider: "akshare", source: "wrapper-source", fetchedAt: asOf.toISOString(),
    series: values, warning: null };
  return { asOf, mode: "paper", provider: "akshare", days: 180, stockNames: stocks,
    stockHistory: history,
    sectorHistory: { ...history, series: ["行业甲", "行业乙"].map((name, i) =>
      series(bars(), { symbol: `BK${i}`, name, source: "sector-history", adjustment: "none" })) },
    sectorResponse: { provider: "akshare", source: "sector-snapshot", fetchedAt: asOf.toISOString(), warning: null,
      sectors: ["行业甲", "行业乙"].map((name, i) => ({ symbol: `BK${i}`, name, price: 12,
        changePercent: 1, amount: null, turnover: null, advancers: 5, decliners: 2,
        leaderName: null, leaderChangePercent: null, mainNetInflow: null, updatedAt: asOf.toISOString() })) } };
}
function withDate(date: string, fields: Partial<HistoricalBar> = {}): HistoricalBar {
  return { ...bars(1)[0], date, ...fields };
}

afterEach(() => { clearBridgeRequestCache(); vi.useRealTimers(); });

describe("trading stock regime history evidence", () => {
  it("does not let unfinished or future daily bars change stock shape or validation", () => {
    const baseline = analyzeMarketRegimeData(input());
    const result = analyzeMarketRegimeData(input([series([...bars(),
      withDate("2026-08-24", { open: 90, high: 100, low: 80, close: 95 }),
      withDate("2099-01-01", { open: 1, high: 2, low: 0.5, close: 1 }),
    ])]));
    expect(result.stockRegimes).toEqual(baseline.stockRegimes);
    expect(result.warnings.join(" ")).toContain("尚未完成或未来日线");
  });

  it("accepts the exact completed close without silently extending the cutoff", () => {
    const result = analyzeMarketRegimeData({ ...input([series([...bars(), withDate("2026-08-24")])]),
      asOf: new Date("2026-08-24T07:00:00Z") });
    expect(result.stockRegimes[0]).toMatchObject({ barCount: 81, latestDate: "2026-08-24" });
    expect(result.generatedAt).toBe("2026-08-24T07:00:00.000Z");
  });

  it("cannot fill the 61-bar shape threshold using a future bar", () => {
    const result = analyzeMarketRegimeData(input([series([...bars(60), withDate("2099-01-01")])]));
    expect(result.stockRegimes[0]).toMatchObject({ regime: "insufficient-data", barCount: 60, confidence: 0 });
    expect(result.sourceStatus).toBe("degraded");
  });

  it.each([
    { adjustment: "hfq" }, { source: " " }, { symbol: "000001" }, { symbol: "bad" },
  ])("excludes unrequested or incorrectly described stock series: %j", fields => {
    const result = analyzeMarketRegimeData(input([series(bars(), fields)]));
    expect(result.stockRegimes).toEqual([]);
    expect(result.warnings.join(" ")).toContain("历史证据校验");
    expect(result.sourceStatus).toBe("degraded");
  });

  it("excludes both copies of an ambiguous stock while preserving another requested stock", () => {
    const result = analyzeMarketRegimeData(input([series(), series(), series(bars(), { symbol: "600011" })]));
    expect(result.stockRegimes.map(s => s.symbol)).toEqual(["600011"]);
    expect(result.sourceStatus).toBe("live-read-only");
    expect(result.warnings.join(" ")).toContain("重复股票");
  });

  it("does not choose one of conflicting daily closes or count either copy", () => {
    const values = bars();
    const result = analyzeMarketRegimeData(input([series([...values, { ...values[0], close: values[0].close + 0.05 }])]));
    expect(result.stockRegimes[0].barCount).toBe(79);
    expect(result.warnings.join(" ")).toContain("重复日期日线");
  });

  it.each([
    { date: "2026-02-30" }, { high: 1 }, { low: 20 }, { open: -1 },
    { volume: -1 }, { amount: -1 }, { close: Number.NaN },
  ])("does not turn invalid daily data into stock evidence: %j", fields => {
    const result = analyzeMarketRegimeData(input([series([...bars(), withDate("2026-08-21", fields)])]));
    expect(result.stockRegimes[0].barCount).toBe(80);
    expect(result.warnings.join(" ")).toContain("无效日线");
  });

  it("keeps valid zero-volume observation bars and normalizes order without mutating the payload", () => {
    const values = bars().map(b => ({ ...b, volume: 0, amount: null })).reverse();
    const before = JSON.stringify(values);
    const result = analyzeMarketRegimeData(input([series(values)]));
    const expected = classifyStockRegime("600010", "请求甲", [...values].reverse());
    expect(result.stockRegimes[0]).toEqual({ rank: 1, ...expected });
    expect(JSON.stringify(values)).toBe(before);
  });

  it("caps validated daily observations to the requested budget and reports the actual series source", () => {
    const result = analyzeMarketRegimeData({ ...input(), days: 65 });
    expect(result.stockRegimes[0].barCount).toBe(65);
    expect(result.source.stockHistorySource).toBe("tencent-stock-history");
    expect(result.warnings.join(" ")).toContain("请求预算");
  });

  it("preserves valid shape fields and upstream warnings alongside excluded series", () => {
    const value = input([series(), series(bars(), { symbol: "000001" })]);
    value.stockHistory.warning = "保留真实上游警告";
    const result = analyzeMarketRegimeData(value);
    expect(result.stockRegimes[0]).toEqual({ rank: 1, ...classifyStockRegime("600010", "请求甲", bars()) });
    expect(result.warnings).toContain("保留真实上游警告");
  });

  it("does not call mock-provider stock payloads real stock history", () => {
    const value = input(); value.stockHistory.provider = "mock";
    const result = analyzeMarketRegimeData(value);
    expect(result.stockRegimes).toEqual([]);
    expect(result.source.stockHistorySource).toBe("unavailable");
    expect(result.warnings.join(" ")).toContain("返回供应方不是AkShare");
  });

  it("degrades malformed stock history independently of valid sector research", () => {
    const value = input(); value.stockHistory.series = null as unknown as HistoricalSeries[];
    const result = analyzeMarketRegimeData(value);
    expect(result.stockRegimes).toEqual([]);
    expect(result.sectorOutlooks).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("历史证据校验");
  });
});

const snapshot: MarketSnapshot = { mode: "paper", sequence: 1, marketTime: asOf.toISOString(),
  quotes: [{ symbol: "600010", name: "请求甲", tradable: true, price: 10, previousClose: 10,
    changePercent: 0, volume: 100_000, updatedAt: asOf.toISOString() }] };
function buildInput(fetchImpl: typeof fetch) {
  return { now: asOf, bridgeUrl: "http://stock-shape-evidence.test", marketDataProvider: "akshare",
    mode: "paper" as const, snapshot, sectorLimit: 2, stockLimit: 1, days: 180, timeoutMs: 1000, fetchImpl };
}

describe("stock regime acquisition time boundary", () => {
  it.each(["invalid", "2026-08-24T07:00:06Z"])("does not fetch a bad or clearly future snapshot: %s", async marketTime => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await buildMarketRegimeResearch({ ...buildInput(fetchImpl), snapshot: { ...snapshot, marketTime } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.sourceStatus).toBe("degraded");
    expect(result.warnings.join(" ")).toContain("历史证据校验");
    expect(result.generatedAt).toBe(asOf.toISOString());
  });

  it("keeps the earlier snapshot cutoff when the report clock is later", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).includes("/sectors?")
      ? { ...input().sectorResponse, sectors: [] }
      : { ...input().stockHistory, series: [series([...bars(), withDate("2026-08-24")])] })));
    const result = await buildMarketRegimeResearch({ ...buildInput(fetchImpl), now: new Date("2026-08-24T08:00:00Z") });
    expect(result.stockRegimes[0].barCount).toBe(80);
    expect(result.generatedAt).toBe("2026-08-24T08:00:00.000Z");
  });

  it("freezes the report clock before awaiting external sources", async () => {
    const mutableClock = new Date(asOf);
    const fetchImpl = vi.fn<typeof fetch>(async url => {
      mutableClock.setTime(Date.parse("2026-08-24T08:00:00Z"));
      return new Response(JSON.stringify(String(url).includes("/sectors?")
        ? { ...input().sectorResponse, sectors: [] }
        : { ...input().stockHistory, series: [series([...bars(), withDate("2026-08-24")])] }));
    });
    const result = await buildMarketRegimeResearch({ ...buildInput(fetchImpl), now: mutableClock });
    expect(result.stockRegimes[0].barCount).toBe(80);
    expect(result.generatedAt).toBe(asOf.toISOString());
  });
});
