import { describe, expect, it, vi } from "vitest";
import type { HistoricalBar, HistoricalSeries } from "./marketRegimeResearch";
import {
  analyzeStockTrendBars,
  buildStockTrendForecast,
  type StockSearchMatch,
} from "./stockTrendForecast";
import { clearBridgeRequestCache } from "./bridgeRequest";

function makeBars(count: number, dailyDrift: number): HistoricalBar[] {
  let close = 100;
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const previous = close;
    close = previous * (1 + dailyDrift);
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    return {
      date,
      open: previous,
      high: Math.max(previous, close) * 1.005,
      low: Math.min(previous, close) * 0.995,
      close,
      volume: 1_000_000 + index * 1_000,
      amount: close * (1_000_000 + index * 1_000),
      changePercent: dailyDrift * 100,
      turnover: 1.2,
    };
  });
}

function selected(overrides: Partial<StockSearchMatch> = {}): StockSearchMatch {
  return {
    symbol: "600519",
    name: "贵州茅台",
    price: 1500,
    changePercent: 1.2,
    updatedAt: "2026-07-16T07:00:00.000Z",
    ...overrides,
  };
}

function series(bars: HistoricalBar[]): HistoricalSeries {
  return {
    symbol: "600519",
    name: "600519",
    source: "tencent-stock-history",
    adjustment: "qfq",
    bars,
  };
}

describe("analyzeStockTrendBars", () => {
  it("classifies a persistent uptrend and validates later closes only", () => {
    const report = analyzeStockTrendBars({
      query: "600519",
      mode: "paper",
      provider: "akshare",
      selected: selected(),
      series: series(makeBars(240, 0.003)),
      fetchedAt: "2026-07-16T12:00:00Z",
      requestedDays: 360,
    });

    expect(report.resolution).toBe("resolved");
    expect(report.sourceStatus).toBe("live-read-only");
    expect(report.horizons).toHaveLength(3);
    expect(report.horizons.every((item) =>
      ["bullish", "slightly-bullish"].includes(item.direction)
    )).toBe(true);
    expect(report.horizons.every((item) => item.validation.samples > 20)).toBe(true);
    expect(report.horizons.every((item) => item.validation.directionalHitRate === 1)).toBe(true);
    expect(report.horizons.every((item) => item.validation.empiricalUpProbability === 1)).toBe(true);
    expect(report.horizons.every((item) => item.validation.empiricalDownProbability === 0)).toBe(true);
    expect(report.horizons.every((item) => item.validation.empiricalFlatProbability === 0)).toBe(true);
    expect(report.horizons.every((item) =>
      item.validation.medianPeakTradingDay === item.horizon
    )).toBe(true);
    expect(report.horizons.every((item) => item.validation.medianTroughTradingDay === 1)).toBe(true);
    expect(report.horizons.every((item) => (item.validation.medianPeakReturn ?? 0) > 0)).toBe(true);
    expect(report.horizons.every((item) =>
      item.validation.lastOutcomeDate! <= report.latest!.date
    )).toBe(true);
    expect(report.chart).toHaveLength(90);
    expect(report.chart.at(-1)?.ma60).toBeTypeOf("number");
  });

  it("classifies persistent deterioration as bearish", () => {
    const report = analyzeStockTrendBars({
      query: "贵州茅台",
      mode: "paper",
      provider: "akshare",
      selected: selected({ changePercent: -1.5 }),
      series: series(makeBars(240, -0.003)),
      fetchedAt: "2026-07-16T12:00:00Z",
      requestedDays: 360,
    });

    expect(report.horizons.every((item) =>
      ["bearish", "slightly-bearish"].includes(item.direction)
    )).toBe(true);
    expect(report.horizons.every((item) => item.validation.directionalHitRate === 1)).toBe(true);
    expect(report.horizons.every((item) => item.validation.empiricalDownProbability === 1)).toBe(true);
    expect(report.horizons.every((item) =>
      item.validation.medianTroughTradingDay === item.horizon
    )).toBe(true);
    expect(report.horizons.every((item) => item.validation.medianPeakTradingDay === 1)).toBe(true);
    expect(report.horizons.every((item) => (item.validation.medianTroughReturn ?? 0) < 0)).toBe(true);
    expect(report.evidence.join(" ")).toContain("均线");
  });

  it("keeps a flat series sideways without inventing directional conviction", () => {
    const report = analyzeStockTrendBars({
      query: "600519",
      mode: "paper",
      provider: "akshare",
      selected: selected({ changePercent: 0 }),
      series: series(makeBars(180, 0)),
      fetchedAt: "2026-07-16T12:00:00Z",
      requestedDays: 360,
    });

    expect(report.horizons.every((item) => item.direction === "sideways")).toBe(true);
    expect(report.horizons.every((item) => item.signalStrength === 0)).toBe(true);
    expect(report.horizons.every((item) => item.validation.empiricalFlatProbability === 1)).toBe(true);
    expect(report.horizons.every((item) => item.validation.medianPeakReturn === 0)).toBe(true);
    expect(report.horizons.every((item) => item.validation.medianTroughReturn === 0)).toBe(true);
    expect(report.supportResistance).toMatchObject({ support20: 99.5, resistance20: 100.5 });
  });

  it("returns explicit insufficient-data horizons below the minimum bar count", () => {
    const report = analyzeStockTrendBars({
      query: "600519",
      mode: "paper",
      provider: "akshare",
      selected: selected(),
      series: series(makeBars(40, 0.003)),
      fetchedAt: "2026-07-16T12:00:00Z",
      requestedDays: 360,
    });

    expect(report.sourceStatus).toBe("degraded");
    expect(report.horizons.every((item) => item.direction === "insufficient-data")).toBe(true);
    expect(report.horizons.every((item) =>
      item.validation.empiricalUpProbability === null &&
      item.validation.empiricalDownProbability === null &&
      item.validation.empiricalFlatProbability === null &&
      item.validation.medianPeakTradingDay === null &&
      item.validation.medianTroughTradingDay === null
    )).toBe(true);
    expect(report.factors).toBeNull();
    expect(report.warnings.join(" ")).toContain("至少");
  });
});

describe("buildStockTrendForecast", () => {
  it("returns choices without fetching history for an ambiguous fuzzy name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: "akshare",
      source: "a-share-spot-cache",
      fetchedAt: "2026-07-16T12:00:00Z",
      items: [
        selected({ symbol: "600519", name: "贵州茅台" }),
        selected({ symbol: "600199", name: "金种子酒" }),
      ],
      warning: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const report = await buildStockTrendForecast({
      query: "酒",
      days: 360,
      bridgeUrl: "http://bridge.test",
      bridgeToken: "bridge-token",
      marketDataProvider: "akshare",
      mode: "paper",
      timeoutMs: 1000,
      fetchImpl: fetchMock,
    });

    expect(report.resolution).toBe("ambiguous");
    expect(report.matches).toHaveLength(2);
    expect(report.selected).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves an exact Chinese name and fetches only its real history", async () => {
    const match = selected();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        provider: "akshare",
        source: "a-share-spot-cache",
        fetchedAt: "2026-07-16T12:00:00Z",
        items: [match],
        warning: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        provider: "akshare",
        source: "tencent-stock-history",
        fetchedAt: "2026-07-16T12:00:01Z",
        series: [series(makeBars(180, 0.002))],
        warning: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const report = await buildStockTrendForecast({
      query: "贵州茅台",
      days: 360,
      bridgeUrl: "http://bridge.test/",
      bridgeToken: "bridge-token",
      marketDataProvider: "akshare",
      mode: "paper",
      timeoutMs: 1000,
      fetchImpl: fetchMock,
    });

    expect(report.resolution).toBe("resolved");
    expect(report.selected).toMatchObject({ symbol: "600519", name: "贵州茅台" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/market/stock-history?symbols=600519&days=360"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer bridge-token" }) }),
    );
  });

  it("reuses identical search and history reads but isolates a different history window", async () => {
    clearBridgeRequestCache();
    const match = selected();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/api/market/stock-search")) {
        return new Response(JSON.stringify({
          provider: "akshare",
          source: "a-share-spot-cache",
          fetchedAt: "2026-08-08T02:00:00Z",
          items: [match],
          warning: null,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const requestedDays = Number(url.searchParams.get("days"));
      return new Response(JSON.stringify({
        provider: "akshare",
        source: "tencent-stock-history",
        fetchedAt: "2026-08-08T02:00:01Z",
        series: [series(makeBars(Math.min(requestedDays, 240), 0.002))],
        warning: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const baseInput = {
      query: "贵州茅台",
      bridgeUrl: "http://bridge-window-cache.test",
      bridgeToken: "bridge-token",
      marketDataProvider: "akshare",
      mode: "paper" as const,
      timeoutMs: 1_000,
      fetchImpl: fetchMock,
    };

    const first = await buildStockTrendForecast({ ...baseInput, days: 360 });
    const second = await buildStockTrendForecast({ ...baseInput, days: 360 });
    const wider = await buildStockTrendForecast({ ...baseInput, days: 500 });

    expect(first.resolution).toBe("resolved");
    expect(second.resolution).toBe("resolved");
    expect(wider.resolution).toBe("resolved");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/api/market/stock-search")
    )).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/api/market/stock-history")
    )).toHaveLength(2);
  });

  it("does not substitute mock history when AkShare is disabled", async () => {
    const fetchMock = vi.fn();
    const report = await buildStockTrendForecast({
      query: "600519",
      days: 360,
      bridgeUrl: "http://bridge.test",
      marketDataProvider: "mock",
      mode: "paper",
      timeoutMs: 1000,
      fetchImpl: fetchMock,
    });

    expect(report).toMatchObject({
      sourceStatus: "mock-disabled",
      resolution: "mock-disabled",
      selected: null,
      matches: [],
      chart: [],
      horizons: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
