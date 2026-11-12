import { describe, expect, it } from "vitest";
import { buildHistoricalCorrelations } from "./historicalCorrelation";
import type { HistoricalSeries } from "./marketRegimeResearch";

const asOf = new Date("2025-12-31T08:00:00Z");
function series(symbol: string, length = 80, sign = 1): HistoricalSeries {
  let close = 10;
  return { symbol, name: "sample", source: "frozen-test", adjustment: "qfq",
    bars: Array.from({ length }, (_, index) => {
      close *= 1 + sign * ((index % 5) - 2) * 0.002;
      return { date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
        open: close, high: close, low: close, close, volume: 100, amount: 1000,
        changePercent: null, turnover: null };
    }) };
}

describe("historical correlation evidence", () => {
  it("uses the latest 120 matched intervals independently for each pair", () => {
    const left = series("600001", 200), right = series("600002", 200, -1);
    const third = series("600003", 200); third.bars = third.bars.slice(150);
    const report = buildHistoricalCorrelations([left, right, third], asOf);
    expect(report.pairs[0]).toMatchObject({ samples: 120, status: "observed",
      firstInterval: { startDate: left.bars[79].date, endDate: left.bars[80].date },
      lastInterval: { startDate: left.bars[198].date, endDate: left.bars[199].date } });
    expect(report.pairs[0].correlation).toBeCloseTo(-1, 12);
    expect(report.pairs[1]).toMatchObject({ samples: 49, correlation: null, status: "insufficient-history" });
  });

  it.each([2, 60, 61])("reports sample sufficiency explicitly for %i bars", length => {
    const pair = buildHistoricalCorrelations([series("600001", length), series("600002", length)], asOf).pairs[0];
    expect(pair.samples).toBe(length - 1);
    expect(pair.status).toBe(length < 61 ? "insufficient-history" : "observed");
    if (length < 61) expect(pair.correlation).toBeNull();
    else expect(pair.correlation).toBeCloseTo(1, 12);
  });

  it("keeps zero variance unknown instead of claiming zero correlation", () => {
    const left = series("600001");
    left.bars = left.bars.map(bar => ({ ...bar, open: 10, high: 10, low: 10, close: 10 }));
    expect(buildHistoricalCorrelations([left, series("600002")], asOf).pairs[0])
      .toMatchObject({ samples: 79, correlation: null, status: "undefined-variance" });
  });

  it("does not match returns whose start date differs across a missing candle", () => {
    const left = series("600001"), right = series("600002");
    right.bars.splice(40, 1);
    const pair = buildHistoricalCorrelations([left, right], asOf).pairs[0];
    expect(pair).toMatchObject({ samples: 77, status: "observed", maxCalendarSpanDays: 1 });
    expect(pair.correlation).toBeCloseTo(1, 12);
  });

  it("exposes a joint gap as an observed longer interval without inventing a trading calendar", () => {
    const left = series("600001"), right = series("600002");
    left.bars.splice(40, 1); right.bars.splice(40, 1);
    const report = buildHistoricalCorrelations([left, right], asOf);
    expect(report.pairs[0]).toMatchObject({ samples: 78, maxCalendarSpanDays: 2 });
    expect(report.methodology.calendar).toContain("no-exchange-calendar");
  });

  it("does not use zero-volume endpoints or bridge across them", () => {
    const left = series("600001"), right = series("600002");
    left.bars[40].volume = 0;
    const report = buildHistoricalCorrelations([left, right], asOf);
    expect(report.pairs[0].samples).toBe(77);
    expect(report.series[0]).toMatchObject({ returnIntervals: 77, excludedIntervals: 2 });
  });

  it.each(["invalid-price", "duplicate-date"])("does not manufacture a return across a rejected %s candle", problem => {
    const left = series("600001"), right = series("600002");
    for (const item of [left, right]) {
      if (problem === "duplicate-date") item.bars.push({ ...item.bars[40] });
      else item.bars[40].close = Number.NaN;
    }
    const report = buildHistoricalCorrelations([left, right], asOf);
    expect(report.pairs[0].samples).toBe(77);
    expect(report.series[0]).toMatchObject({ barCount: 79, returnIntervals: 77, excludedIntervals: 1 });
    expect(report.validationWarnings).toHaveLength(1);
  });

  it("includes a daily candle only after its actual completion boundary", () => {
    const input = [series("600001"), series("600002")];
    const last = input[0].bars.at(-1)!.date;
    const before = buildHistoricalCorrelations(input, new Date(`${last}T06:59:59.999Z`));
    const after = buildHistoricalCorrelations(input, new Date(`${last}T07:00:00.000Z`));
    expect(before.pairs[0].samples).toBe(78);
    expect(after.pairs[0].samples).toBe(79);
    expect(before.pairs[0].lastInterval?.endDate).toBe(input[0].bars.at(-2)!.date);
    expect(after.pairs[0].lastInterval?.endDate).toBe(last);
  });

  it("does not let future candle changes affect an earlier report", () => {
    const input = [series("600001"), series("600002")];
    const cutoff = new Date(`${input[0].bars[65].date}T07:00:00Z`);
    const before = buildHistoricalCorrelations(input, cutoff);
    input[1].bars = input[1].bars.map((bar, index) => index <= 65 ? bar :
      { ...bar, open: 1000, high: 1000, low: 1000, close: 1000 });
    expect(buildHistoricalCorrelations(input, cutoff)).toEqual(before);
  });

  it("rejects missing or invalid asOf instead of using a wall-clock default", () => {
    expect(() => buildHistoricalCorrelations([series("600001")], new Date(NaN))).toThrow();
  });

  it("does not fabricate pairs from duplicate identities or unverified adjustment/source", () => {
    const badAdjustment = { ...series("600002"), adjustment: "none" };
    const badSource = { ...series("600003"), source: " " };
    const report = buildHistoricalCorrelations([series("600001"), series("600001"), badAdjustment, badSource,
      series("600004")], asOf);
    expect(report.series.map(item => item.symbol)).toEqual(["600004"]);
    expect(report.pairs).toEqual([]);
    expect(report.validationWarnings).toHaveLength(1);
  });

  it("keeps no overlapping returns unknown with null dates and no fabricated zero", () => {
    const left = series("600001", 200), right = series("600002", 200);
    left.bars = left.bars.slice(0, 80); right.bars = right.bars.slice(100);
    expect(buildHistoricalCorrelations([left, right], asOf).pairs[0]).toMatchObject({
      samples: 0, correlation: null, status: "insufficient-history", firstInterval: null,
      lastInterval: null, maxCalendarSpanDays: null });
  });

  it("sorts input observations without mutating caller data", () => {
    const input = [series("600001"), series("600002")];
    const expected = buildHistoricalCorrelations(input, asOf);
    input[0].bars.reverse(); input[1].bars.reverse();
    const snapshot = structuredClone(input);
    expect(buildHistoricalCorrelations(input, asOf)).toEqual(expected);
    expect(input).toEqual(snapshot);
    expect(buildHistoricalCorrelations([], asOf).pairs).toEqual([]);
  });
});
