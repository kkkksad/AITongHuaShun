import { describe, expect, it } from "vitest";
import { evaluateFiveDayObservation, observeAdaptivePrefix, researchAdaptiveCoverage } from "../../scripts/research-adaptive-coverage-history";
import type { HistoricalBar } from "../research/marketRegimeResearch";

function bars(): HistoricalBar[] {
  return Array.from({ length: 140 }, (_, index) => {
    const close = 10 + index * 0.01;
    return { date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      open: close, high: close + 0.1, low: close - 0.1, close, volume: 10_000_000,
      amount: 120_000_000, turnover: 1, changePercent: null };
  });
}
const cost = { commissionRate: 0.0003, minimumCommission: 5, slippageBps: 5 };

describe("offline adaptive prefix evidence", () => {
  it("does not use current or future candles to classify the prior-history setup", () => {
    const original = bars();
    const changed = original.map((bar, index) => index < 125 ? bar : { ...bar, close: 100, high: 120 });
    const before = observeAdaptivePrefix("600001", "sample", original, 125);
    const after = observeAdaptivePrefix("600001", "sample", changed, 125);
    expect(after.stock).toEqual(before.stock);
    expect(before.stock.latestDate).toBe(original[124].date);
    expect(before.quote.price).toBe(original[125].close);
    expect(after.quote.price).toBe(100);
  });

  it("prices a fixed 100-share observation from the following open, including both costs", () => {
    const sample = bars();
    sample[126] = { ...sample[126], open: 10 };
    sample[130] = { ...sample[130], close: 11 };
    expect(evaluateFiveDayObservation(sample, 125, cost)).toEqual({
      state: "observed", entryDate: sample[126].date, exitDate: sample[130].date,
      buyPrice: 10, sellPrice: 10.99, cashRequired: 1005, fees: 10, netPnl: 89,
      netReturn: 89 / 1005,
    });
  });

  it("keeps missing outcomes, zero volume, and an unaffordable minimum lot unknown", () => {
    expect(evaluateFiveDayObservation(bars(), 137, cost)).toEqual({ state: "unknown", reason: "tail" });
    const sample = bars(); sample[126].volume = 0;
    expect(evaluateFiveDayObservation(sample, 125, cost)).toEqual({ state: "unknown", reason: "zero-volume" });
    sample[126].volume = 10; sample[126].open = 60;
    expect(evaluateFiveDayObservation(sample, 125, cost)).toEqual({ state: "unknown", reason: "lot-over-5000" });
  });

  it("rejects prefix indexes that cannot represent a prior day and a current candle", () => {
    expect(() => observeAdaptivePrefix("600001", "sample", bars(), 0)).toThrow();
    expect(() => observeAdaptivePrefix("600001", "sample", bars(), 140)).toThrow();
  });

  it("keeps controlled scenarios separate and does not count the unknown tail as a positive outcome", () => {
    const report = researchAdaptiveCoverage(["600001", "600002"].map(symbol => ({
      symbol, name: "sample", source: "test", adjustment: "qfq", bars: bars().map(bar =>
        ({ ...bar, high: bar.close + 0.01, low: bar.close - 0.2 })),
    })));
    expect(report.rows).toHaveLength(40);
    expect(report.windows.early.last! < report.windows.late.first).toBe(true);
    expect(Object.keys(report.rows[0].scenarioSignals)).toHaveLength(14);
    expect(report.rows.at(-1)?.outcomes.base).toEqual({ state: "unknown", reason: "tail" });
    expect(report.rows.every(row => Object.entries(row.scenarioSignals).filter(([scenario]) =>
      !scenario.endsWith("/validation-probe")).every(([, keys]) => !keys.includes("kairosValidationBasket")))).toBe(true);
    expect(report.rows.some(row => row.scenarioSignals["range-low-volatility/validation-probe"]
      .includes("kairosValidationBasket"))).toBe(true);
  });
});
