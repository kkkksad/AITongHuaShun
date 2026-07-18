import { describe, expect, it, vi } from "vitest";
import type { HistoricalBar, HistoricalSeries } from "./marketRegimeResearch";
import {
  STRATEGY_ROBUSTNESS_PROFILES,
  buildAlignedHistoricalSnapshots,
  buildStrategyRobustnessReport,
  evaluateFixedStrategyProfiles,
  splitChronologicalWindows,
} from "./strategyRobustness";

function bars(count: number, dailyMove: number): HistoricalBar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 20 + index * dailyMove + Math.sin(index / 7) * 0.15;
    return {
      date: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - dailyMove * 0.2,
      high: close + 0.25,
      low: close - 0.25,
      close,
      volume: 1_200_000 + (index % 8) * 30_000,
      amount: close * 1_200_000,
      changePercent: null,
      turnover: null,
    };
  });
}

function series(symbol: string, values: HistoricalBar[]): HistoricalSeries {
  return {
    symbol,
    name: symbol,
    source: "tencent-stock-history",
    adjustment: "qfq",
    bars: values,
  };
}

describe("buildAlignedHistoricalSnapshots", () => {
  it("uses only dates available for every series and preserves real closes", () => {
    const snapshots = buildAlignedHistoricalSnapshots([
      series("600001", bars(380, 0.03)),
      series("600002", bars(380, -0.005)),
    ], "paper");

    expect(snapshots).toHaveLength(380);
    expect(snapshots[0].quotes).toHaveLength(2);
    expect(snapshots[0].quotes[0]).toMatchObject({
      symbol: "600001",
      price: 20,
      previousClose: 20,
      tradable: true,
    });
    expect(snapshots.at(-1)?.marketTime.startsWith("2025-01-14")).toBe(true);
  });
});

describe("splitChronologicalWindows", () => {
  it("creates three non-overlapping windows with stable chronological boundaries", () => {
    const snapshots = buildAlignedHistoricalSnapshots([
      series("600001", bars(390, 0.02)),
    ], "paper");

    const windows = splitChronologicalWindows(snapshots, 3);

    expect(windows).toHaveLength(3);
    expect(windows.every((window) => window.length === 130)).toBe(true);
    expect(windows[0].at(-1)!.marketTime < windows[1][0]!.marketTime).toBe(true);
    expect(windows[1].at(-1)!.marketTime < windows[2][0]!.marketTime).toBe(true);
  });
});

describe("evaluateFixedStrategyProfiles", () => {
  it("covers fourteen distinct strategy logics with fixed parameters", () => {
    const keys = STRATEGY_ROBUSTNESS_PROFILES.map((profile) => profile.strategyKey);

    expect(keys).toHaveLength(14);
    expect(new Set(keys).size).toBe(14);
    expect(keys).toEqual(expect.arrayContaining([
      "macd",
      "aSharePullback",
      "gridTrading",
      "dca",
    ]));
  });

  it("reports real multi-window metrics without searching parameters", async () => {
    const snapshots = buildAlignedHistoricalSnapshots([
      series("600001", bars(420, 0.025)),
      series("600002", bars(420, 0.015)),
    ], "paper");
    const movingAverage = STRATEGY_ROBUSTNESS_PROFILES.find(
      (profile) => profile.strategyKey === "movingAverageCross",
    );
    expect(movingAverage).toBeDefined();

    const entries = await evaluateFixedStrategyProfiles(
      snapshots,
      [movingAverage!],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      strategyKey: "movingAverageCross",
      windows: 3,
    });
    expect(entries[0].fixedParams).toEqual(movingAverage!.fixedParams);
    expect(entries[0].totalTrades).toBeGreaterThanOrEqual(0);
    expect(entries[0].worstMaxDrawdown).toBeGreaterThanOrEqual(0);
  });
});

describe("buildStrategyRobustnessReport", () => {
  it("returns mock-disabled without fabricating real history", async () => {
    const fetchImpl = vi.fn();
    const report = await buildStrategyRobustnessReport({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "mock",
      mode: "mock",
      snapshot: {
        mode: "mock",
        sequence: 1,
        marketTime: "2026-07-16T07:00:00.000Z",
        quotes: [],
      },
      limit: 12,
      days: 500,
      timeoutMs: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(report.sourceStatus).toBe("mock-disabled");
    expect(report.entries).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
