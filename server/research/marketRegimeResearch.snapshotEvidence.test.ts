import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBridgeRequestCache } from "./bridgeRequest";
import { analyzeMarketRegimeData, buildMarketRegimeResearch, type AnalyzeMarketRegimeInput,
  type HistoricalBar, type SectorSnapshotResponse } from "./marketRegimeResearch";

const asOf = new Date("2026-08-24T06:59:59.999Z");
function fixture(): AnalyzeMarketRegimeInput {
  const bars: HistoricalBar[] = Array.from({ length: 80 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 4, 1 + i)).toISOString().slice(0, 10),
    open: 10 + i * 0.03, close: 10 + i * 0.03, high: 10.1 + i * 0.03, low: 9.9 + i * 0.03,
    volume: 100_000, amount: null, changePercent: null, turnover: null,
  }));
  const history = { provider: "akshare", source: "actual-history", fetchedAt: asOf.toISOString(), warning: null };
  return { asOf, mode: "paper", provider: "akshare", days: 180, stockNames: new Map([["600010", "股票甲"]]),
    sectorResponse: { provider: "akshare", source: "actual-sectors", fetchedAt: asOf.toISOString(), warning: null,
      sectors: ["行业甲", "行业乙", "行业丙"].map((name, i) => ({ symbol: `BK${i}`, name, price: 10,
        changePercent: 1, updatedAt: asOf.toISOString(), amount: null, turnover: null,
        advancers: 5, decliners: 2, leaderName: null, leaderChangePercent: null, mainNetInflow: null })) },
    sectorHistory: { ...history, series: ["行业甲", "行业乙", "行业丙"].map((name, i) =>
      ({ symbol: `BK${i}`, name, source: "actual-sector-history", adjustment: "none", bars })) },
    stockHistory: { ...history, series: [{ symbol: "600010", name: "股票甲", source: "actual-stock-history", adjustment: "qfq", bars }] } };
}
afterEach(() => clearBridgeRequestCache());

describe("sector snapshot structure isolation", () => {
  it.each([null, [], {}, { sectors: null }, { provider: "akshare", source: "actual", sectors: {} },
    { provider: "mock", source: "mock", sectors: [] }, { provider: "akshare", source: " ", sectors: [] }])(
    "retains valid stocks when a successful HTTP body has an invalid shape: %j", async payload => {
      const value = fixture();
      const fetchImpl = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(
        String(url).includes("/sectors?") ? payload : value.stockHistory,
      )));
      const result = await buildMarketRegimeResearch({ now: asOf, bridgeUrl: "http://snapshot-evidence.test",
        marketDataProvider: "akshare", mode: "paper", days: 180, sectorLimit: 3, stockLimit: 1, timeoutMs: 1000, fetchImpl,
        snapshot: { mode: "paper", sequence: 1, marketTime: asOf.toISOString(), quotes: [{
          symbol: "600010", name: "股票甲", tradable: true, price: 10, previousClose: 10,
          changePercent: 0, volume: 100_000, updatedAt: asOf.toISOString(),
        }] } });
      expect(result.stockRegimes).toEqual(analyzeMarketRegimeData(value).stockRegimes);
      expect(result.sectorOutlooks).toEqual([]);
      expect(result.sourceStatus).toBe("degraded");
      expect(result.warnings.join(" ")).toContain("行业快照校验");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/stock-history?"))).toBe(true);
    },
  );

  it.each([null, 1, {}, { name: 5 }, { name: " " }, { symbol: null }, { price: 0 },
    { changePercent: "1" }, { price: Number.NaN }, { updatedAt: 123 }])(
    "excludes malformed individual sectors and preserves valid independent results: %j", fields => {
      const value = fixture();
      const baseline = analyzeMarketRegimeData(value);
      const invalid = fields && typeof fields === "object" && Object.keys(fields).length > 0
        ? { ...value.sectorResponse.sectors[0], ...fields } : fields;
      value.sectorResponse.sectors = [invalid, ...value.sectorResponse.sectors.slice(1)] as typeof value.sectorResponse.sectors;
      const result = analyzeMarketRegimeData(value);
      expect(result.sectorOutlooks).toEqual(baseline.sectorOutlooks.filter(s => s.symbol !== "BK0").map((s, i) => ({ ...s, rank: i + 1 })));
      expect(result.stockRegimes).toEqual(baseline.stockRegimes);
      expect(result.warnings.join(" ")).toContain("行业快照校验");
    },
  );

  it("normalizes optional malformed fields to unknown, preserving real zero and negative signed values", () => {
    const value = fixture(), sector = value.sectorResponse.sectors[0];
    Object.assign(sector, { advancers: "5", decliners: -2, mainNetInflow: -100, leaderName: 4, amount: -1, turnover: 0 });
    const result = analyzeMarketRegimeData(value);
    const changed = result.sectorOutlooks.find(s => s.symbol === "BK0")!;
    expect(changed.current).toMatchObject({ advancers: null, decliners: null, leaderName: null, mainNetInflow: -100 });
    expect(changed.factors.breadthRatio).toBeNull();
    expect(result.warnings.join(" ")).toContain("行业快照校验");
  });

  it("accepts omitted optional fields without inventing zero values or warnings", () => {
    const value = fixture();
    value.sectorResponse.sectors = value.sectorResponse.sectors.map(({ symbol, name, price, changePercent, updatedAt }) =>
      ({ symbol, name, price, changePercent, updatedAt }) as typeof value.sectorResponse.sectors[number]);
    const result = analyzeMarketRegimeData(value);
    expect(result.sectorOutlooks).toHaveLength(3);
    expect(result.sectorOutlooks[0].current).toMatchObject({ mainNetInflow: null, advancers: null, decliners: null, leaderName: null });
    expect(result.warnings).toEqual([]);
  });

  it("uses the same protection in direct analysis and retains source warnings without leaking bad bodies", () => {
    const value = fixture();
    value.sectorResponse = { provider: "akshare", source: "actual", sectors: null, warning: "上游暂不可用", detail: "private unexpected body" } as unknown as SectorSnapshotResponse;
    const result = analyzeMarketRegimeData(value);
    expect(result.stockRegimes).toHaveLength(1);
    expect(result.source.sectorSource).toBe("unavailable");
    expect(result.warnings.join(" ")).toContain("上游暂不可用");
    expect(result.warnings.join(" ")).not.toContain("private");
    expect(result.warnings.join(" ")).toContain("行业快照校验");
  });

  it("does not mutate valid source objects or change legal sector/stock economic evidence", () => {
    const value = fixture(), before = JSON.stringify(value);
    expect(analyzeMarketRegimeData(value).sourceStatus).toBe("live-read-only");
    expect(JSON.stringify(value)).toBe(before);
  });

  it("filters individual bad records before bounded selection and still requests valid sector history", async () => {
    const value = fixture(), malformed = { ...value.sectorResponse,
      sectors: [null, ...value.sectorResponse.sectors], warning: "部分板块待更新" };
    const fetchImpl = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(
      String(url).includes("/sectors?") ? malformed
        : String(url).includes("/sector-history?") ? value.sectorHistory : value.stockHistory,
    )));
    const result = await buildMarketRegimeResearch({ now: asOf, bridgeUrl: "http://snapshot-partial.test",
      marketDataProvider: "akshare", mode: "paper", days: 180, sectorLimit: 3, stockLimit: 1, timeoutMs: 1000, fetchImpl,
      preferredStocks: [{ symbol: "600010", name: "股票甲" }],
      snapshot: { mode: "paper", sequence: 1, marketTime: asOf.toISOString(), quotes: [] } });
    expect(result.sectorOutlooks).toEqual(analyzeMarketRegimeData(value).sectorOutlooks);
    expect(result.stockRegimes).toEqual(analyzeMarketRegimeData(value).stockRegimes);
    expect(result.warnings.join(" ")).toContain("部分板块待更新");
    expect(result.warnings.join(" ")).toContain("行业快照校验");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("protects an explicit malformed selected universe without discarding valid stocks", () => {
    const value = fixture();
    value.requestedSectors = [null, ...value.sectorResponse.sectors.slice(1)] as unknown as typeof value.sectorResponse.sectors;
    const result = analyzeMarketRegimeData(value);
    expect(result.sectorOutlooks.map(s => s.symbol)).toEqual(["BK1", "BK2"]);
    expect(result.stockRegimes).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("行业快照校验");
  });
});
