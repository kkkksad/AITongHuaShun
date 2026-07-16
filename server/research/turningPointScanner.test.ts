import { describe, expect, it } from "vitest";
import type { HistoricalBar, HistoricalSeries } from "./marketRegimeResearch";
import {
  analyzeTurningPointSeries,
  classifyTurningOutcome,
  deriveTurningBias,
  type TurningPointCandidate,
} from "./turningPointScanner";

function bar(
  index: number,
  close: number,
  volume = 1_000_000,
  spread = 0.2,
): HistoricalBar {
  return {
    date: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
    open: close - spread * 0.2,
    high: close + spread,
    low: close - spread,
    close,
    volume,
    amount: close * volume,
    changePercent: null,
    turnover: null,
  };
}

function trendBars(count: number, dailyMove: number): HistoricalBar[] {
  const startingPrice = dailyMove < 0 ? 100 : 20;
  return Array.from({ length: count }, (_, index) =>
    bar(index, startingPrice + index * dailyMove, 1_000_000 + (index % 5) * 10_000),
  );
}

function flatBars(count: number): HistoricalBar[] {
  return Array.from({ length: count }, (_, index) =>
    bar(index, 30 + Math.sin(index / 4) * 0.02, 900_000 + (index % 3) * 5_000, 0.08),
  );
}

function alternatingBars(count: number): HistoricalBar[] {
  return Array.from({ length: count }, (_, index) => {
    const block = Math.floor(index / 15);
    const within = index % 15;
    const direction = block % 2 === 0 ? 1 : -1;
    const quiet = within < 10;
    const move = quiet ? Math.sin(within) * 0.02 : direction * (within - 9) * 0.45;
    return bar(index, 40 + move, quiet ? 700_000 : 1_500_000, quiet ? 0.08 : 0.25);
  });
}

function series(symbol: string, bars: HistoricalBar[]): HistoricalSeries {
  return {
    symbol,
    name: symbol,
    source: "synthetic-history",
    adjustment: "qfq",
    bars,
  };
}

function expectProbabilitySum(candidate: TurningPointCandidate): void {
  const values = [
    candidate.validation.upProbability,
    candidate.validation.downProbability,
    candidate.validation.noBreakProbability,
  ];
  expect(values.every((value) => value !== null)).toBe(true);
  expect(values.reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBeCloseTo(1, 4);
}

describe("classifyTurningOutcome", () => {
  it("uses the frozen decision-time range and records the first upward break", () => {
    const bars = [...flatBars(125)];
    bars.push(bar(125, 30.8, 1_800_000, 0.1));
    bars.push(bar(126, 31.2, 1_900_000, 0.1));

    const outcome = classifyTurningOutcome(bars, 124, 5);

    expect(outcome.direction).toBe("up");
    expect(outcome.tradingDay).toBe(1);
    expect(outcome.return).toBeGreaterThan(0);
  });

  it("records the first downward break without looking beyond the horizon", () => {
    const bars = [...flatBars(125)];
    bars.push(bar(125, 29.1, 1_800_000, 0.1));
    bars.push(bar(126, 28.8, 1_900_000, 0.1));

    const outcome = classifyTurningOutcome(bars, 124, 5);

    expect(outcome.direction).toBe("down");
    expect(outcome.tradingDay).toBe(1);
    expect(outcome.return).toBeLessThan(0);
  });
});

describe("analyzeTurningPointSeries", () => {
  it("finds a high empirical upward-break frequency in a steady rising series", () => {
    const candidate = analyzeTurningPointSeries(series("600001", trendBars(360, 0.12)), "上行样本");

    expect(candidate.bias).toBe("up");
    expect(candidate.validation.samples).toBeGreaterThanOrEqual(20);
    expect(candidate.validation.breakProbability).toBeGreaterThan(0.8);
    expect(candidate.validation.upProbability).toBeGreaterThan(0.8);
    expect(candidate.validation.medianUpTradingDay).toBeGreaterThanOrEqual(1);
    expect(candidate.validation.medianUpTradingDay).toBeLessThanOrEqual(5);
    expectProbabilitySum(candidate);
  });

  it("finds a high empirical downward-break frequency in a steady falling series", () => {
    const candidate = analyzeTurningPointSeries(series("600002", trendBars(360, -0.12)), "下行样本");

    expect(candidate.bias).toBe("down");
    expect(candidate.validation.samples).toBeGreaterThanOrEqual(20);
    expect(candidate.validation.breakProbability).toBeGreaterThan(0.8);
    expect(candidate.validation.downProbability).toBeGreaterThan(0.8);
    expect(candidate.validation.medianDownTradingDay).toBeGreaterThanOrEqual(1);
    expect(candidate.validation.medianDownTradingDay).toBeLessThanOrEqual(5);
    expectProbabilitySum(candidate);
  });

  it("keeps a compressed flat series as no-break instead of forcing a direction", () => {
    const candidate = analyzeTurningPointSeries(series("600003", flatBars(360)), "横盘样本");

    expect(candidate.bias).toBe("none");
    expect(candidate.validation.samples).toBeGreaterThanOrEqual(20);
    expect(candidate.validation.noBreakProbability).toBeGreaterThan(0.8);
    expect(candidate.validation.medianUpTradingDay).toBeNull();
    expect(candidate.validation.medianDownTradingDay).toBeNull();
    expectProbabilitySum(candidate);
  });

  it("keeps probabilities normalized for an alternating direction series", () => {
    const candidate = analyzeTurningPointSeries(
      series("600004", alternatingBars(420)),
      "双向样本",
    );

    expect(candidate.validation.samples).toBeGreaterThanOrEqual(20);
    expectProbabilitySum(candidate);
  });

  it("expresses two-way uncertainty when up and down break frequencies are close", () => {
    expect(deriveTurningBias(0.36, 0.32, 0.32)).toBe("two-way");
    expect(deriveTurningBias(0.58, 0.18, 0.24)).toBe("up");
    expect(deriveTurningBias(0.16, 0.56, 0.28)).toBe("down");
    expect(deriveTurningBias(0.18, 0.16, 0.66)).toBe("none");
  });

  it("returns insufficient-data for fewer than the required feature bars", () => {
    const candidate = analyzeTurningPointSeries(series("600005", flatBars(100)), "历史不足");

    expect(candidate.bias).toBe("insufficient-data");
    expect(candidate.latestDate).toBe("2024-04-09");
    expect(candidate.validation.samples).toBe(0);
    expect(candidate.validation.breakProbability).toBeNull();
  });

  it("does not fabricate probabilities when fewer than 20 matching samples exist", () => {
    const candidate = analyzeTurningPointSeries(series("600006", flatBars(145)), "样本不足");

    expect(candidate.bias).toBe("insufficient-data");
    expect(candidate.validation.samples).toBeLessThan(20);
    expect(candidate.validation.breakProbability).toBeNull();
    expect(candidate.validation.upProbability).toBeNull();
    expect(candidate.validation.downProbability).toBeNull();
    expect(candidate.validation.noBreakProbability).toBeNull();
  });
});
