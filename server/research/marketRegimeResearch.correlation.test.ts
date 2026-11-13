import { describe, expect, it } from "vitest";
import { analyzeMarketRegimeData, buildUnavailableMarketRegimeResearch, type AnalyzeMarketRegimeInput, type HistoricalSeries } from "./marketRegimeResearch";

const asOf = new Date("2026-04-01T07:00:00Z");
function series(symbol: string, length = 80): HistoricalSeries {
  let close = 10;
  return { symbol, name: symbol, source: "tencent-stock-history", adjustment: "qfq", bars:
    Array.from({ length }, (_, i) => {
      close *= 1 + (i % 5 - 2) * 0.002;
      return { date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
        open: close, high: close, low: close, close, volume: 10000, amount: 100000,
        changePercent: null, turnover: null };
    }) };
}
function input(values = [series("600010"), series("600011")]): AnalyzeMarketRegimeInput {
  const history = { provider: "akshare", source: "wrapper", fetchedAt: asOf.toISOString(), series: values, warning: null };
  return { asOf, mode: "paper", provider: "akshare", days: 180,
    stockNames: new Map([["600010", "甲"], ["600011", "乙"]]), stockHistory: history,
    sectorHistory: { ...history, series: [] },
    sectorResponse: { provider: "akshare", source: "fixture", fetchedAt: asOf.toISOString(), sectors: [], warning: null } };
}

describe("actual market analysis common-risk evidence", () => {
  it("exposes bounded aligned completed histories without changing existing stock classification", () => {
    const report = analyzeMarketRegimeData(input());
    expect(report).toHaveProperty("stockCorrelations");
    const evidence = report.stockCorrelations!;
    expect(evidence.requestedSymbols).toEqual(["600010", "600011"]);
    expect(evidence.methodology.asOf).toBe(asOf.toISOString());
    expect(evidence.sources).toEqual(["600010", "600011"].map(symbol => ({ symbol, source: "tencent-stock-history", adjustment: "qfq" })));
    expect(evidence.pairs[0]).toMatchObject({ left: "600010", right: "600011", samples: 79, status: "observed" });
    expect(evidence.pairs[0].correlation).toBeCloseTo(1, 12);
  });

  it.each(["invalid-candle", "duplicate-date", "zero-volume"])("does not bridge across %s in the actual raw response", kind => {
    const values = [series("600010"), series("600011")];
    for (const value of values) {
      if (kind === "duplicate-date") value.bars.push({ ...value.bars[40] });
      else if (kind === "invalid-candle") value.bars[40].close = NaN;
      else value.bars[40].volume = 0;
    }
    const evidence = analyzeMarketRegimeData(input(values)).stockCorrelations!;
    expect(evidence.pairs[0]).toMatchObject({ samples: 77, maxCalendarSpanDays: 1 });
    expect(evidence.pairs[0].correlation).toBeCloseTo(1, 12);
  });

  it("honors the request day budget instead of using extra returned history", () => {
    const report = analyzeMarketRegimeData({ ...input(), days: 60 }).stockCorrelations!;
    expect(report.series.map(row => row.barCount)).toEqual([60, 60]);
    expect(report.pairs[0]).toMatchObject({ samples: 59, correlation: null, status: "insufficient-history" });
  });

  it("does not include an unfinished daily observation before 15:00 Beijing", () => {
    const values = [series("600010"), series("600011")];
    for (const value of values) value.bars.push({ ...value.bars.at(-1)!, date: "2026-04-01" });
    const before = analyzeMarketRegimeData({ ...input(values), asOf: new Date("2026-04-01T06:59:59.999Z") });
    const after = analyzeMarketRegimeData(input(values));
    expect(before.stockCorrelations!.pairs[0].samples).toBe(79);
    expect(after.stockCorrelations!.pairs[0].samples).toBe(80);
    expect(after.stockCorrelations!.pairs[0].lastInterval?.endDate).toBe("2026-04-01");
  });

  it("ignores request-external and duplicate identities without inventing sources", () => {
    const request = input([series("600010"), series("600010"), series("600011"), series("000001")]);
    const report = analyzeMarketRegimeData(request).stockCorrelations!;
    expect(report.series.map(row => row.symbol)).toEqual(["600011"]);
    expect(report.sources.map(row => row.symbol)).toEqual(["600011"]);
    expect(report.pairs).toEqual([]);
  });

  it("bounds thirteen requested histories to twelve identities and sixty-six pairs explicitly", () => {
    const values = Array.from({ length: 13 }, (_, i) => series(String(600010 + i)));
    const request = { ...input(values), stockNames: new Map(values.map(value => [value.symbol, value.name])) };
    const report = analyzeMarketRegimeData(request).stockCorrelations!;
    expect(report.requestedSymbols).toHaveLength(12);
    expect(report.omittedRequestedCount).toBe(1);
    expect(report.pairs).toHaveLength(66);
    expect(report.series.map(row => row.symbol)).not.toContain("600022");
  });

  it.each(["wrong-provider", "malformed-series"])("keeps missing response data unknown for %s", kind => {
    const request = input();
    if (kind === "wrong-provider") request.stockHistory.provider = "mock";
    else request.stockHistory.series = null as unknown as HistoricalSeries[];
    expect(analyzeMarketRegimeData(request).stockCorrelations).toMatchObject({
      requestedSymbols: ["600010", "600011"], series: [], sources: [], pairs: [],
    });
  });

  it("does not echo a URL or credentials through a malformed source label", () => {
    const values = [series("600010"), series("600011")];
    values[0].source = "https://source.invalid/?token=SECRET";
    const report = analyzeMarketRegimeData(input(values)).stockCorrelations!;
    expect(report.sources[0].source).toBe("unclassified-source");
    expect(JSON.stringify(report)).not.toMatch(/SECRET|source\.invalid/);
  });

  it("leaves selection and correlation evidence absent on outer timeout or mock fallback", () => {
    for (const marketDataProvider of ["mock", "akshare"]) {
      const report = buildUnavailableMarketRegimeResearch({ now: asOf, marketDataProvider, mode: "paper",
        bridgeUrl: "http://unused.invalid", timeoutMs: 1000, days: 180, stockLimit: 12, sectorLimit: 6,
        snapshot: { mode: "paper", sequence: 1, marketTime: asOf.toISOString(), quotes: [] } }, "timed out");
      expect(report).not.toHaveProperty("stockCorrelations");
    }
    expect(analyzeMarketRegimeData({ ...input(), provider: "mock" })).not.toHaveProperty("stockCorrelations");
  });
  it("does not mutate the response or retain mutable arrays", () => {
    const request = input(); const before = structuredClone(request.stockHistory);
    const report = analyzeMarketRegimeData(request).stockCorrelations!;
    expect(request.stockHistory).toEqual(before);
    request.stockNames.clear(); request.stockHistory.series.length = 0;
    expect(report.requestedSymbols).toEqual(["600010", "600011"]);
    expect(report.pairs[0].samples).toBe(79);
  });
});
