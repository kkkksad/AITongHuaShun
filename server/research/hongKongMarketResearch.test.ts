import { describe, expect, it, vi } from "vitest";
import type { HistoricalBar, HistoricalSeries } from "./marketRegimeResearch";
import {
  analyzeHongKongSeries,
  buildHongKongMarketResearch,
} from "./hongKongMarketResearch";

function bars(count: number, dailyMove: number): HistoricalBar[] {
  const start = dailyMove < 0 ? 120 : 30;
  return Array.from({ length: count }, (_, index) => {
    const close = start + dailyMove * index + Math.sin(index / 5) * 0.08;
    return {
      date: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - dailyMove * 0.2,
      high: close + 0.25,
      low: close - 0.25,
      close,
      volume: 2_000_000 + (index % 6) * 20_000,
      amount: close * 2_000_000,
      changePercent: null,
      turnover: null,
    };
  });
}

function series(symbol: string, values: HistoricalBar[]): HistoricalSeries {
  return {
    symbol,
    name: symbol,
    source: "eastmoney-hk-history",
    adjustment: "qfq",
    bars: values,
  };
}

describe("analyzeHongKongSeries", () => {
  it("classifies an established rising structure and validates it historically", () => {
    const item = analyzeHongKongSeries(
      series("00700", bars(260, 0.18)),
      {
        symbol: "00700",
        name: "腾讯控股",
        price: 576,
        previousClose: 572,
        changePercent: 0.7,
        volume: 20_000_000,
        amount: 11_000_000_000,
        updatedAt: "2026-07-16T08:00:00Z",
        source: "eastmoney-hk-spot",
      },
    );

    expect(item.trend).toBe("uptrend");
    expect(item.score).toBeGreaterThan(65);
    expect(item.validation.samples).toBeGreaterThanOrEqual(20);
    expect(item.validation.upProbability5d).toBeGreaterThan(0.8);
    expect(item.name).toBe("腾讯控股");
  });

  it("classifies a persistent falling structure as downtrend", () => {
    const item = analyzeHongKongSeries(
      series("09988", bars(260, -0.15)),
      {
        symbol: "09988",
        name: "阿里巴巴-W",
        price: 95,
        previousClose: 97,
        changePercent: -2.1,
        volume: 18_000_000,
        amount: 1_700_000_000,
        updatedAt: "2026-07-16T08:00:00Z",
        source: "eastmoney-hk-spot",
      },
    );

    expect(item.trend).toBe("downtrend");
    expect(item.score).toBeLessThan(35);
    expect(item.validation.samples).toBeGreaterThanOrEqual(20);
  });

  it("returns insufficient-data without a fake probability", () => {
    const item = analyzeHongKongSeries(series("00005", bars(40, 0.1)), null);

    expect(item.trend).toBe("insufficient-data");
    expect(item.validation.samples).toBe(0);
    expect(item.validation.upProbability5d).toBeNull();
  });
});

describe("buildHongKongMarketResearch", () => {
  it("returns mock-disabled without calling the bridge", async () => {
    const fetchImpl = vi.fn();
    const report = await buildHongKongMarketResearch({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "mock",
      mode: "mock",
      limit: 8,
      days: 180,
      timeoutMs: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(report.sourceStatus).toBe("mock-disabled");
    expect(report.items).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("combines bounded real quotes and history without order semantics", async () => {
    const history = bars(220, 0.12);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/api/market/hk/quotes")) {
        expect(url.searchParams.get("limit")).toBe("2");
        return new Response(JSON.stringify({
          provider: "akshare",
          source: "eastmoney-hk-spot",
          fetchedAt: "2026-07-16T08:00:00Z",
          items: [
            {
              symbol: "00700",
              name: "腾讯控股",
              price: 576,
              previousClose: 572,
              changePercent: 0.7,
              volume: 20_000_000,
              amount: 11_000_000_000,
              updatedAt: "2026-07-16T08:00:00Z",
              source: "eastmoney-hk-spot",
            },
          ],
          warning: null,
        }), { status: 200 });
      }
      expect(url.pathname).toBe("/api/market/hk/history");
      expect(url.searchParams.get("symbols")).toBe("00700");
      expect(url.searchParams.get("days")).toBe("180");
      return new Response(JSON.stringify({
        provider: "akshare",
        source: "eastmoney-hk-history",
        fetchedAt: "2026-07-16T08:00:01Z",
        series: [{
          symbol: "00700",
          name: "00700",
          source: "eastmoney-hk-history",
          adjustment: "qfq",
          bars: history,
        }],
        warning: null,
      }), { status: 200 });
    });

    const report = await buildHongKongMarketResearch({
      bridgeUrl: "http://127.0.0.1:8800/",
      bridgeToken: "bridge-test-token",
      marketDataProvider: "akshare",
      mode: "paper",
      limit: 2,
      days: 180,
      timeoutMs: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(report.sourceStatus).toBe("live-read-only");
    expect(report.items).toHaveLength(1);
    expect(report.items[0].symbol).toBe("00700");
    expect(report.guardrails.join(" ")).toContain("不会生成港股订单");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
