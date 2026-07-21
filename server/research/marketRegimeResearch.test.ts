import { describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import {
  analyzeMarketRegimeData,
  buildMarketRegimeResearch,
  classifyStockRegime,
  scoreSectorOutlook,
  selectSectorUniverse,
  validateDirectionalSignals,
  type HistoricalBar,
} from "./marketRegimeResearch";

function makeBars(
  closes: number[],
  volumeAt: (index: number) => number = () => 1_000_000,
): HistoricalBar[] {
  return closes.map((close, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: close * 0.995,
    high: close * 1.012,
    low: close * 0.988,
    close,
    volume: volumeAt(index),
    amount: close * volumeAt(index),
    changePercent:
      index === 0 ? 0 : (close / closes[index - 1] - 1) * 100,
    turnover: 2,
  }));
}

function increasingBars(length = 140): HistoricalBar[] {
  return makeBars(
    Array.from({ length }, (_, index) => 100 + index * 0.35),
    (index) => 900_000 + index * 2_000,
  );
}

const snapshot: MarketSnapshot = {
  mode: "paper",
  sequence: 12,
  marketTime: "2026-07-14T06:00:00.000Z",
  quotes: [],
};

describe("market regime research", () => {
  it("scores a persistent sector uptrend as constructive", () => {
    const result = scoreSectorOutlook(
      {
        symbol: "BK1036",
        name: "半导体",
        price: 1500,
        changePercent: 1.8,
        amount: 50_000_000_000,
        turnover: 3.2,
        advancers: 80,
        decliners: 20,
        leaderName: "测试股份",
        leaderChangePercent: 6.2,
        mainNetInflow: 2_800_000_000,
        updatedAt: "2026-07-14T06:00:00Z",
      },
      increasingBars(),
    );

    expect(result.direction).toBe("constructive");
    expect(result.growthProbability3d).toBeGreaterThanOrEqual(60);
    expect(result.growthProbability5d).toBeGreaterThanOrEqual(60);
    expect(result.validation.horizon5.samples).toBeGreaterThan(20);
    expect(result.validation.horizon5.directionalHitRate).toBeGreaterThan(0.8);
  });

  it("classifies an intact uptrend with a quiet pullback as a washout candidate", () => {
    const trend = Array.from({ length: 75 }, (_, index) => 80 + index * 0.7);
    const closes = [...trend, 131, 129.5, 128.8, 129.2, 130.1];
    const bars = makeBars(closes, (index) => (index >= 75 ? 420_000 : 1_100_000));

    const result = classifyStockRegime("600519", "测试股票", bars);

    expect(result.regime).toBe("washout-candidate");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.features.volumeRatio).toBeLessThan(0.85);
    expect(result.features.pullbackFrom20DayHigh).toBeGreaterThan(0.02);
  });

  it("classifies a high-volume moving-average breakdown as trend deterioration", () => {
    const stable = Array.from({ length: 65 }, (_, index) => 120 + index * 0.15);
    const decline = Array.from({ length: 20 }, (_, index) => 129 - index * 1.35);
    const bars = makeBars([...stable, ...decline], (index) =>
      index >= 65 ? 2_200_000 : 900_000,
    );

    const result = classifyStockRegime("000001", "测试银行", bars);

    expect(result.regime).toBe("trend-deterioration");
    expect(result.features.volumeRatio).toBeGreaterThan(1.2);
    expect(result.features.return20d).toBeLessThan(0);
    expect(result.evidence.join(" ")).toContain("均线");
  });

  it("walk-forward validation does not evaluate a score without future bars", () => {
    const bars = increasingBars(90);
    const validation = validateDirectionalSignals(bars, 5);

    expect(validation.samples).toBe(25);
    expect(validation.lastSignalDate).toBe(bars[84].date);
    expect(validation.lastOutcomeDate).toBe(bars[89].date);
  });

  it("returns insufficient data instead of fabricating confidence", () => {
    const result = classifyStockRegime(
      "600000",
      "浦发银行",
      increasingBars(30),
    );

    expect(result.regime).toBe("insufficient-data");
    expect(result.confidence).toBe(0);
    expect(result.riskFlags.join(" ")).toContain("61");
  });

  it("keeps a degraded report when only part of the real history is available", () => {
    const report = analyzeMarketRegimeData({
      mode: "paper",
      provider: "akshare",
      days: 180,
      sectorResponse: {
        provider: "akshare",
        source: "eastmoney-industry-board",
        fetchedAt: "2026-07-14T06:00:00Z",
        sectors: [],
        warning: "fund flow unavailable",
      },
      sectorHistory: {
        provider: "akshare",
        source: "eastmoney-industry-history",
        fetchedAt: "2026-07-14T06:00:00Z",
        series: [],
        warning: "history unavailable",
      },
      stockHistory: {
        provider: "akshare",
        source: "eastmoney-stock-history",
        fetchedAt: "2026-07-14T06:00:00Z",
        series: [],
        warning: null,
      },
      stockNames: new Map(),
    });

    expect(report.sourceStatus).toBe("degraded");
    expect(report.sectorOutlooks).toEqual([]);
    expect(report.warnings).toContain("fund flow unavailable");
    expect(report.warnings).toContain("history unavailable");
  });

  it("does not call real sources when AkShare is disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const report = await buildMarketRegimeResearch({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "mock",
      mode: "paper",
      snapshot,
      sectorLimit: 10,
      stockLimit: 8,
      days: 180,
      timeoutMs: 1_000,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report.sourceStatus).toBe("mock-disabled");
    expect(report.guardrails.join(" ")).toContain("不会使用静态板块数据替代");
  });

  it("samples strong, middle and weak sectors instead of only current leaders", () => {
    const sectors = Array.from({ length: 8 }, (_, index) => ({
      symbol: `BK${index}`,
      name: `行业${index}`,
      price: 100,
      changePercent: 8 - index,
      amount: null,
      turnover: null,
      advancers: null,
      decliners: null,
      leaderName: null,
      leaderChangePercent: null,
      mainNetInflow: null,
      updatedAt: "2026-07-14T06:00:00Z",
    }));

    expect(selectSectorUniverse(sectors, 4).map((sector) => sector.name)).toEqual([
      "行业0",
      "行业2",
      "行业5",
      "行业7",
    ]);
  });

  it("keeps a bounded technology sector in the sample after it falls from the leaders", () => {
    const sectors = Array.from({ length: 12 }, (_, index) => ({
      symbol: `BK${index}`,
      name: index === 9 ? "半导体" : `行业${index}`,
      price: 100,
      changePercent: 12 - index,
      amount: null,
      turnover: null,
      advancers: null,
      decliners: null,
      leaderName: null,
      leaderChangePercent: null,
      mainNetInflow: null,
      updatedAt: "2026-07-21T06:00:00Z",
    }));

    const selected = selectSectorUniverse(sectors, 4);

    expect(selected).toHaveLength(4);
    expect(selected.map((sector) => sector.name)).toEqual([
      "行业0",
      "行业4",
      "半导体",
      "行业11",
    ]);
  });

  it("puts preferred held stocks before snapshot candidates within the bridge limit", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/api/market/sectors")) {
        return new Response(JSON.stringify({
          provider: "akshare",
          source: "ths-industry-summary",
          fetchedAt: "2026-07-15T01:00:00Z",
          sectors: [
            {
              symbol: "BK0001",
              name: "测试行业",
              price: 100,
              changePercent: 1,
              amount: null,
              turnover: null,
              advancers: null,
              decliners: null,
              leaderName: null,
              leaderChangePercent: null,
              mainNetInflow: null,
              updatedAt: "2026-07-15T01:00:00Z",
            },
          ],
          warning: null,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        provider: "akshare",
        source: "test-history",
        fetchedAt: "2026-07-15T01:00:00Z",
        series: [],
        warning: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await buildMarketRegimeResearch({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "akshare",
      mode: "paper",
      snapshot: {
        mode: "paper",
        sequence: 1,
        marketTime: "2026-07-15T01:00:00Z",
        quotes: [
          {
            symbol: "000001",
            name: "平安银行",
            price: 10,
            previousClose: 9.9,
            changePercent: 1,
            volume: 10_000_000,
            amount: 100_000_000,
            tradable: true,
            updatedAt: "2026-07-15T01:00:00Z",
          },
          {
            symbol: "000002",
            name: "万科A",
            price: 8,
            previousClose: 8,
            changePercent: 0,
            volume: 5_000_000,
            amount: 40_000_000,
            tradable: true,
            updatedAt: "2026-07-15T01:00:00Z",
          },
        ],
      },
      preferredStocks: [
        { symbol: "600519", name: "贵州茅台" },
        { symbol: "601398", name: "工商银行" },
        { symbol: "600519", name: "重复持仓" },
      ],
      sectorLimit: 1,
      stockLimit: 3,
      days: 180,
      timeoutMs: 1_000,
      fetchImpl,
    });

    const stockRequest = requestedUrls.find((url) =>
      url.includes("/api/market/stock-history"),
    );
    expect(stockRequest).toBeDefined();
    expect(new URL(stockRequest!).searchParams.get("symbols")).toBe(
      "600519,601398,000001",
    );
  });
});
