import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBridgeRequestCache } from "./bridgeRequest";
import { analyzeMarketRegimeData, buildMarketRegimeResearch, type AnalyzeMarketRegimeInput,
  type HistoricalBar, type HistoricalSeries } from "./marketRegimeResearch";

const asOf = new Date("2026-08-24T06:59:59.999Z");
const names = ["行业甲", "行业乙", "行业丙"];
function bars(count = 80): HistoricalBar[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2026, 4, 1 + i)).toISOString().slice(0, 10), open: 10 + i * 0.03,
    high: 10.1 + i * 0.03, low: 9.9 + i * 0.03, close: 10 + i * 0.03,
    volume: 100_000, amount: null, changePercent: null, turnover: null,
  }));
}
function sector(index = 0, values = bars(), fields: Partial<HistoricalSeries> = {}): HistoricalSeries {
  return { symbol: `BK${index}`, name: names[index], source: "actual-sector-history", adjustment: "none", bars: values, ...fields };
}
function input(values = [sector(0), sector(1)]): AnalyzeMarketRegimeInput {
  const history = { provider: "akshare", source: "wrapper-source", fetchedAt: asOf.toISOString(), series: values, warning: null };
  return { asOf, mode: "paper", provider: "akshare", days: 180, stockNames: new Map([["600010", "请求甲"]]),
    stockHistory: { ...history, series: [{ ...sector(), symbol: "600010", name: "请求甲", adjustment: "qfq" }] },
    sectorHistory: history,
    sectorResponse: { provider: "akshare", source: "sector-snapshot", fetchedAt: asOf.toISOString(), warning: null,
      sectors: names.slice(0, 2).map((name, i) => ({ symbol: `BK${i}`, name, price: 12, changePercent: 1,
        amount: null, turnover: null, advancers: 5, decliners: 2, leaderName: null, leaderChangePercent: null,
        mainNetInflow: null, updatedAt: asOf.toISOString() })) } };
}
function extra(date: string, fields: Partial<HistoricalBar> = {}): HistoricalBar { return { ...bars(1)[0], date, ...fields }; }
afterEach(() => { clearBridgeRequestCache(); vi.useRealTimers(); });

describe("market routing sector history evidence", () => {
  it("prevents unfinished or future daily data from changing sector state and validation", () => {
    const baseline = analyzeMarketRegimeData(input());
    const result = analyzeMarketRegimeData(input([sector(0, [...bars(),
      extra("2026-08-24", { open: 1, high: 2, low: 0.5, close: 1 }), extra("2099-01-01"),
    ]), sector(1)]));
    expect(result.sectorOutlooks).toEqual(baseline.sectorOutlooks);
    expect(result.warnings.join(" ")).toContain("行业历史证据校验");
  });

  it("uses the exact daily close completion instant", () => {
    const result = analyzeMarketRegimeData({ ...input([sector(0, [...bars(), extra("2026-08-24")]), sector(1)]),
      asOf: new Date("2026-08-24T07:00:00Z") });
    expect(result.sectorOutlooks.find(s => s.symbol === "BK0")).toMatchObject({ latestDate: "2026-08-24", barCount: 81 });
  });

  it("cannot use future observations to complete the 61-bar sector threshold", () => {
    const result = analyzeMarketRegimeData(input([sector(0, [...bars(60), extra("2099-01-01")]), sector(1)]));
    expect(result.sectorOutlooks.map(s => s.symbol)).toEqual(["BK1"]);
    expect(result.sourceStatus).toBe("degraded");
  });

  it.each([
    { adjustment: "qfq" }, { source: " " }, { name: "请求外行业", symbol: "请求外行业" },
    { symbol: "错误代码" }, { symbol: "BK1", name: "行业甲" },
  ])("rejects mismatched identity/source/adjustment while retaining a valid sector: %j", fields => {
    const result = analyzeMarketRegimeData(input([sector(0, bars(), fields), sector(1)]));
    expect(result.sectorOutlooks.map(s => s.symbol)).toEqual(["BK1"]);
    expect(result.stockRegimes).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("行业历史证据校验");
  });

  it("rejects duplicate sector aliases instead of allowing last-write-wins", () => {
    const result = analyzeMarketRegimeData(input([sector(0), sector(0, bars(), { symbol: "行业甲" }), sector(1)]));
    expect(result.sectorOutlooks.map(s => s.symbol)).toEqual(["BK1"]);
    expect(result.warnings.join(" ")).toContain("重复");
  });

  it("accepts actual bridge name identifiers and reports actual source metadata", () => {
    const value = input([sector(0, bars(), { symbol: "行业甲" }), sector(1, bars(), { symbol: "行业乙", source: "other-sector-history" })]);
    const result = analyzeMarketRegimeData(value);
    expect(result.sectorOutlooks).toHaveLength(2);
    expect(result.sourceStatus).toBe("live-read-only");
    expect(result.source.sectorHistorySource).toBe("actual-sector-history + other-sector-history");
  });

  it("does not let ambiguous selected sector identities reuse a history series twice", () => {
    const value = input();
    value.sectorResponse.sectors.push({ ...value.sectorResponse.sectors[0], symbol: "BK-other" });
    const result = analyzeMarketRegimeData(value);
    expect(result.sectorOutlooks.map(s => s.symbol)).toEqual(["BK1"]);
    expect(result.warnings.join(" ")).toContain("行业历史证据校验");
  });

  it.each([{ date: "2026-02-30" }, { high: 1 }, { low: 20 }, { volume: -1 }, { amount: -1 }, { open: Number.NaN }])(
    "excludes invalid sector daily fields before scoring: %j", fields => {
      const result = analyzeMarketRegimeData(input([sector(0, [...bars(), extra("2026-08-21", fields)]), sector(1)]));
      expect(result.sectorOutlooks.find(s => s.symbol === "BK0")?.barCount).toBe(80);
      expect(result.warnings.join(" ")).toContain("无效日线");
    },
  );

  it("excludes both conflicting dates without mutating or selecting one close", () => {
    const values = bars(), original = JSON.stringify(values);
    const result = analyzeMarketRegimeData(input([sector(0, [...values, { ...values[0], close: values[0].close + 0.05 }]), sector(1)]));
    expect(result.sectorOutlooks.find(s => s.symbol === "BK0")?.barCount).toBe(79);
    expect(JSON.stringify(values)).toBe(original);
    expect(result.warnings.join(" ")).toContain("重复日期日线");
  });

  it("sorts and bounds valid sector observations using the requested budget", () => {
    const result = analyzeMarketRegimeData({ ...input([sector(0, bars().reverse()), sector(1)]), days: 65 });
    expect(result.sectorOutlooks.every(s => s.barCount === 65)).toBe(true);
    expect(result.sectorOutlooks.find(s => s.symbol === "BK0")?.latestDate).toBe(bars().at(-1)!.date);
    expect(result.warnings.join(" ")).toContain("请求预算");
  });

  it("does not treat mock sector history as real market routing evidence", () => {
    const value = input(); value.sectorHistory.provider = "mock";
    const result = analyzeMarketRegimeData(value);
    expect(result.sectorOutlooks).toEqual([]);
    expect(result.stockRegimes).toHaveLength(1);
    expect(result.source.sectorHistorySource).toBe("unavailable");
    expect(result.warnings.join(" ")).toContain("供应方不是AkShare");
  });

  it("degrades malformed sector history without losing valid stock analysis", () => {
    const value = input(); value.sectorHistory.series = null as unknown as HistoricalSeries[];
    const result = analyzeMarketRegimeData(value);
    expect(result.sectorOutlooks).toEqual([]);
    expect(result.stockRegimes).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("行业历史证据校验");
  });

  it("retains source warnings even when valid partial sectors remain", () => {
    const value = input(); value.sectorHistory.warning = "部分行业历史更新中";
    expect(analyzeMarketRegimeData(value).warnings).toContain("部分行业历史更新中");
  });
});

it("only consumes the sectors actually requested by the selected bounded universe", async () => {
  const value = input([sector(0), sector(1), sector(2)]);
  value.sectorResponse.sectors.push({ ...value.sectorResponse.sectors[0], symbol: "BK2", name: "行业丙" });
  const fetchImpl = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(
    String(url).includes("/sectors?") ? value.sectorResponse
      : String(url).includes("/sector-history?") ? value.sectorHistory : value.stockHistory,
  )));
  const result = await buildMarketRegimeResearch({ now: asOf, bridgeUrl: "http://sector-evidence.test",
    marketDataProvider: "akshare", mode: "paper", days: 180, sectorLimit: 2, stockLimit: 1, timeoutMs: 1000, fetchImpl,
    snapshot: { mode: "paper", sequence: 1, marketTime: asOf.toISOString(), quotes: [{
      symbol: "600010", name: "请求甲", tradable: true, price: 10, previousClose: 10, changePercent: 0,
      volume: 100_000, updatedAt: asOf.toISOString(),
    }] } });
  expect(result.sectorOutlooks.map(s => s.name).sort()).toEqual(["行业丙", "行业甲"].sort());
  expect(result.warnings.join(" ")).toContain("行业历史证据校验");
});
