import { describe, expect, it, vi } from "vitest";
import {
  buildFuturesForecast,
  buildCrossMarketStrategyContext,
  deriveCrossMarketDecision,
  summarizeGlobalMarkets,
  type CrossMarketSignalGroup,
} from "./crossMarketStrategyContext";
import type { HistoricalBar } from "./marketRegimeResearch";

function futuresBars(count: number): HistoricalBar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.035 + Math.sin(index / 9) * 2.4;
    return {
      date: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 0.12,
      high: close + 0.8,
      low: close - 0.7,
      close,
      volume: 100_000 + index * 100,
      amount: null,
      changePercent: null,
      turnover: null,
    };
  });
}

function signal(
  tone: CrossMarketSignalGroup["tone"],
  averageChangePercent: number,
  averageReturn20d: number | null,
): CrossMarketSignalGroup {
  return {
    tone,
    coverage: 4,
    averageChangePercent,
    averageReturn20d,
  };
}

describe("summarizeGlobalMarkets", () => {
  it("uses the bounded real index breadth and average move", () => {
    const summary = summarizeGlobalMarkets([
      { changePercent: 1.2 },
      { changePercent: 0.8 },
      { changePercent: -0.1 },
      { changePercent: 0.6 },
    ]);

    expect(summary).toMatchObject({
      tone: "positive",
      coverage: 4,
      advancerRatio: 0.75,
    });
    expect(summary.averageChangePercent).toBeCloseTo(0.625);
  });
});

describe("deriveCrossMarketDecision", () => {
  it("prioritizes trend, breakout and pullback in a confirmed risk-on context", () => {
    const decision = deriveCrossMarketDecision({
      dataComplete: true,
      global: {
        ...signal("positive", 0.8, null),
        advancerRatio: 0.75,
      },
      equityFutures: signal("positive", 0.7, 0.045),
      industrialFutures: signal("positive", 0.5, 0.03),
      preciousMetals: signal("neutral", 0.1, 0.005),
    });

    expect(decision.riskTone).toBe("risk-on");
    expect(decision.positionPosture).toBe("normal");
    expect(decision.preferredStrategyFamilies).toEqual([
      "trend",
      "breakout",
      "pullback",
    ]);
    expect(decision.preferredStrategyKeys).toContain("kairosLowVolTrend");
  });

  it("uses defensive research when global and equity futures are both weak", () => {
    const decision = deriveCrossMarketDecision({
      dataComplete: true,
      global: {
        ...signal("negative", -1.1, null),
        advancerRatio: 0.15,
      },
      equityFutures: signal("negative", -1.3, -0.06),
      industrialFutures: signal("negative", -0.7, -0.04),
      preciousMetals: signal("positive", 0.8, 0.035),
    });

    expect(decision.riskTone).toBe("risk-off");
    expect(decision.positionPosture).toBe("reduced");
    expect(decision.preferredStrategyFamilies).toEqual(["defensive"]);
    expect(decision.deweightedStrategyFamilies).toContain("breakout");
  });

  it("returns mixed and cash-only when sources conflict or are incomplete", () => {
    const decision = deriveCrossMarketDecision({
      dataComplete: false,
      global: {
        ...signal("positive", 0.9, null),
        advancerRatio: 0.8,
      },
      equityFutures: signal("negative", -0.9, -0.03),
      industrialFutures: signal("neutral", 0, null),
      preciousMetals: signal("neutral", 0, null),
    });

    expect(decision.riskTone).toBe("mixed");
    expect(decision.positionPosture).toBe("cash-only");
    expect(decision.preferredStrategyKeys).toEqual([]);
  });
});

describe("buildFuturesForecast", () => {
  it("builds time-safe five-day conditional frequencies from long history", () => {
    const forecast = buildFuturesForecast(futuresBars(420));

    expect(forecast.horizonDays).toBe(5);
    expect(forecast.sampleSize).toBeGreaterThanOrEqual(20);
    expect(forecast.sampleQuality).not.toBe("insufficient");
    expect(forecast.upFrequency).not.toBeNull();
    expect(forecast.upFrequency! + forecast.downFrequency! + forecast.rangeFrequency!).toBeCloseTo(1, 4);
    expect(forecast.medianMaxFavorableMove).toBeGreaterThanOrEqual(0);
    expect(forecast.medianMaxAdverseMove).toBeLessThanOrEqual(0);
    expect(forecast.evidence.join(" ")).toContain("历史条件样本");
    expect(forecast.invalidation.length).toBeGreaterThan(0);
  });

  it("does not invent frequencies when the history cannot supply 20 samples", () => {
    const forecast = buildFuturesForecast(futuresBars(75));

    expect(forecast.direction).toBe("insufficient");
    expect(forecast.sampleQuality).toBe("insufficient");
    expect(forecast.upFrequency).toBeNull();
    expect(forecast.downFrequency).toBeNull();
    expect(forecast.rangeFrequency).toBeNull();
    expect(forecast.invalidation).toContain("20");
  });
});

describe("buildCrossMarketStrategyContext", () => {
  it("does not fabricate cross-market context when AkShare is disabled", async () => {
    const fetchImpl = vi.fn();
    const report = await buildCrossMarketStrategyContext({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "mock",
      mode: "paper",
      limit: 12,
      days: 180,
      timeoutMs: 100,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      sourceStatus: "mock-disabled",
      riskTone: "mixed",
      positionPosture: "cash-only",
      futures: [],
    });
    expect(report.warnings.join(" ")).toContain("不会使用静态跨市场数据替代");
  });

  it("includes the bridge error detail when futures history is rejected", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/market/global")) {
        return new Response(JSON.stringify({
          provider: "akshare",
          fetchedAt: "2026-07-18T01:00:00Z",
          markets: [],
        }), { status: 200 });
      }
      if (url.includes("/api/market/futures/quotes")) {
        return new Response(JSON.stringify({
          provider: "akshare",
          source: "sina-domestic-futures-realtime",
          fetchedAt: "2026-07-18T01:00:00Z",
          items: [{
            symbol: "IF0",
            name: "沪深300股指",
            category: "股指",
            price: 4000,
            previousSettlement: 3990,
            changePercent: 0.25,
            volume: 88000,
            openInterest: 125000,
            updatedAt: "2026-07-18T01:00:00Z",
            source: "sina-domestic-futures-realtime",
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        detail: "单次最多查询 16 个期货主连",
      }), { status: 400 });
    }) as typeof fetch;

    const report = await buildCrossMarketStrategyContext({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "akshare",
      mode: "paper",
      limit: 16,
      days: 500,
      timeoutMs: 100,
      fetchImpl,
    });

    expect(report.warnings.join(" ")).toContain(
      "HTTP 400: 单次最多查询 16 个期货主连",
    );
  });
});
