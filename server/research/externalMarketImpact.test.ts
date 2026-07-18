import { describe, expect, it, vi } from "vitest";
import type { HistoricalBar, HistoricalSeries } from "./marketRegimeResearch";
import {
  buildExternalMarketImpact,
  buildExternalValidation,
  deriveAshareImpact,
  latestReturnBefore,
} from "./externalMarketImpact";

function makeSeries(
  symbol: string,
  count: number,
  dailyReturn: number,
): HistoricalSeries {
  let close = 100;
  const bars: HistoricalBar[] = Array.from({ length: count }, (_, index) => {
    close *= 1 + dailyReturn;
    const date = new Date(Date.UTC(2025, 0, 1 + index))
      .toISOString()
      .slice(0, 10);
    return {
      date,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 100_000,
      amount: null,
      changePercent: dailyReturn * 100,
      turnover: null,
    };
  });
  return {
    symbol,
    name: symbol,
    source: "test-history",
    adjustment: "none",
    bars,
  };
}

describe("external market time alignment", () => {
  it("uses only external returns strictly before the A-share trade date", () => {
    const points = [
      { date: "2026-07-16", value: 0.01 },
      { date: "2026-07-17", value: -0.02 },
    ];

    expect(latestReturnBefore(points, "2026-07-17")).toBe(0.01);
    expect(latestReturnBefore(points, "2026-07-18")).toBe(-0.02);
  });

  it("builds descriptive validation from at least 60 aligned samples", () => {
    const globalSeries = [
      makeSeries("DJI", 90, 0.01),
      makeSeries("SPX", 90, 0.01),
      makeSeries("IXIC", 90, 0.01),
      makeSeries("HSI", 90, 0.008),
      makeSeries("N225", 90, 0.008),
      makeSeries("KOSPI", 90, 0.008),
    ];
    const validation = buildExternalValidation(
      globalSeries,
      makeSeries("SH000300", 90, 0.005),
    );

    expect(validation.samples).toBeGreaterThanOrEqual(60);
    expect(validation.windows).toBe(3);
    expect(validation.directionalHitRate).toBe(1);
    expect(validation.averageNextDayReturn).toBeGreaterThan(0);
  });
});

describe("deriveAshareImpact", () => {
  it("does not let crypto alone create a directional A-share bias", () => {
    const impact = deriveAshareImpact({
      usTone: "neutral",
      asiaTone: "neutral",
      cryptoTone: "positive",
      validation: {
        benchmark: "SH000300",
        samples: 0,
        windows: 0,
        directionalHitRate: null,
        averageNextDayReturn: null,
        unconditionalAverageReturn: null,
        incrementalReturn: null,
      },
      coreCoverage: 1,
    });

    expect(impact.bias).toBe("neutral");
    expect(impact.evidenceGrade).toBe("snapshot-only");
    expect(impact.allowPositionIncrease).toBe(false);
    expect(impact.rationale.join(" ")).toContain("不能单独改变");
  });

  it("marks opposing US and Asian signals as conflicted", () => {
    const impact = deriveAshareImpact({
      usTone: "negative",
      asiaTone: "positive",
      cryptoTone: "neutral",
      validation: {
        benchmark: "SH000300",
        samples: 80,
        windows: 3,
        directionalHitRate: 0.56,
        averageNextDayReturn: 0.001,
        unconditionalAverageReturn: 0.0002,
        incrementalReturn: 0.0008,
      },
      coreCoverage: 1,
    });

    expect(impact.bias).toBe("conflicted");
    expect(impact.evidenceGrade).toBe("historically-observed");
    expect(impact.allowPositionIncrease).toBe(false);
  });
});

describe("buildExternalMarketImpact", () => {
  it("does not fetch or fabricate external markets in mock mode", async () => {
    const fetchImpl = vi.fn();
    const report = await buildExternalMarketImpact({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "mock",
      mode: "paper",
      days: 500,
      timeoutMs: 100,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      sourceStatus: "mock-disabled",
      influenceMode: "observation-only",
      markets: [],
      crypto: [],
      aShareImpact: {
        bias: "neutral",
        allowPositionIncrease: false,
      },
    });
    expect(report.warnings.join(" ")).toContain("不会使用静态外盘");
  });
});
