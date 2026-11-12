import { describe, expect, it } from "vitest";
import { analyzeHistoricalEntryStructure } from "./historicalEntryStructure";
import type { HistoricalSeries } from "./marketRegimeResearch";
import { analyzeMarketRegimeData, classifyStockRegime } from "./marketRegimeResearch";

const asOf = new Date("2025-12-31T08:00:00Z");
function history(length = 80): HistoricalSeries {
  return { symbol: "600001", name: "fixture", source: "frozen-test", adjustment: "qfq",
    bars: Array.from({ length }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      open: 10, high: 10.2, low: 9.8, close: 10, volume: 100,
      amount: 1000, changePercent: null, turnover: null,
    })) };
}

describe("completed daily entry structure", () => {
  it("does not call an intraday high through resistance a closing breakout", () => {
    const input = history(); input.bars[79].high = 12;
    const report = analyzeHistoricalEntryStructure(input, asOf);
    expect(report).toMatchObject({ status: "observed", latestDate: input.bars[79].date,
      breakout: { priorHigh20: 10.2, latestClose: 10, closesAbovePriorHigh20: false } });
  });

  it("excludes the latest candle from the resistance and volume baselines", () => {
    const input = history(); input.bars[79] = { ...input.bars[79], close: 11, high: 12, volume: 200 };
    expect(analyzeHistoricalEntryStructure(input, asOf)).toMatchObject({ status: "observed",
      breakout: { priorHigh20: 10.2, closesAbovePriorHigh20: true,
        latestVolume: 200, priorMeanVolume20: 100, latestCompletedVolumeRatio20: 2 } });
  });

  it.each([60, 61])("requires %i bars according to the fixed 61-bar evidence budget", length => {
    const result = analyzeHistoricalEntryStructure(history(length), asOf);
    expect(result.observed).toBe(length === 61);
    expect(result.status).toBe(length === 61 ? "observed" : "insufficient-history");
    if (!result.observed) expect(result).not.toHaveProperty("breakout");
  });

  it("requires a strict closing break and retains the date of the most recent equal prior high", () => {
    const input = history(); input.bars[79].close = 10.2;
    const result = analyzeHistoricalEntryStructure(input, asOf);
    expect(result).toMatchObject({ breakout: { priorHighDate: input.bars[78].date,
      priorHigh20: 10.2, closesAbovePriorHigh20: false } });
  });

  it("keeps zero latest or zero baseline volume unknown rather than fabricating a ratio", () => {
    const input = history(); input.bars[79].volume = 0;
    expect(analyzeHistoricalEntryStructure(input, asOf)).toMatchObject({
      breakout: { latestVolume: 0, priorMeanVolume20: 100, latestCompletedVolumeRatio20: null } });
    input.bars.forEach(bar => { bar.volume = 0; }); input.bars[79].volume = 100;
    expect(analyzeHistoricalEntryStructure(input, asOf)).toMatchObject({
      breakout: { priorMeanVolume20: null, latestCompletedVolumeRatio20: null, priorPositiveVolumeBars: 0 },
      pullback: { lowCompletedVolumeRatio20: null, priorMeanVolume20AtLow: null } });
  });

  it("compares the twenty preceding ranges against the earlier forty without the current range", () => {
    const input = history(61);
    input.bars.forEach((bar, index) => { bar.high = index < 40 ? 12 : index < 60 ? 11 : 100; bar.low = 8; });
    expect(analyzeHistoricalEntryStructure(input, asOf)).toMatchObject({
      contraction: { meanDailyRange20: expect.closeTo(0.3, 12), precedingMeanDailyRange40: expect.closeTo(0.4, 12), ratio20to40: expect.closeTo(0.75, 12) } });
  });

  it("does not divide by a flat earlier range or substitute an ATR", () => {
    const input = history(61);
    input.bars.slice(0, 40).forEach(bar => { bar.high = bar.low = bar.close; });
    expect(analyzeHistoricalEntryStructure(input, asOf)).toMatchObject({ contraction: {
      precedingMeanDailyRange40: 0, ratio20to40: null, definition: "mean-(high-low)/close-not-ATR" } });
  });

  it("finds the prior low and an anchor strictly before it, excluding later or current highs", () => {
    const input = history(); input.bars[74].low = 9; input.bars[74].volume = 50;
    input.bars[65].high = 12; input.bars[76].high = 50; input.bars[76].volume = 1000;
    input.bars[79].high = 100; input.bars[79].low = 1;
    expect(analyzeHistoricalEntryStructure(input, asOf)).toMatchObject({ pullback: {
      lowDate: input.bars[74].date, low: 9, priorAnchorHighDate: input.bars[65].date, priorAnchorHigh20: 12,
      pullbackFromPriorAnchor: 0.25, recoveredFromLow: expect.closeTo(10 / 9 - 1, 12),
      recoveryAfterLow: true, priorMeanVolume20AtLow: 100, lowCompletedVolumeRatio20: 0.5 } });
  });

  it("uses the most recent equal low and requires closing above the previous high for recovery confirmation", () => {
    const input = history(); input.bars[75].low = input.bars[77].low = 9;
    input.bars[79].close = 10.2;
    expect(analyzeHistoricalEntryStructure(input, asOf)).toMatchObject({ pullback: {
      lowDate: input.bars[77].date, latestCloseAbovePreviousDayHigh: false } });
    input.bars[79] = { ...input.bars[79], close: 10.3, high: 10.3 };
    expect(analyzeHistoricalEntryStructure(input, asOf)).toMatchObject({ pullback: { latestCloseAbovePreviousDayHigh: true } });
  });

  it("excludes an incomplete candle and changes nothing when that future valid candle changes", () => {
    const input = history(), last = input.bars.at(-1)!.date;
    const beforeClose = new Date(`${last}T06:59:59.999Z`);
    const expected = analyzeHistoricalEntryStructure(input, beforeClose);
    expect(expected.latestDate).toBe(input.bars[78].date);
    input.bars[79] = { ...input.bars[79], close: 100, high: 120, volume: 999999 };
    expect(analyzeHistoricalEntryStructure(input, beforeClose)).toEqual(expected);
    expect(analyzeHistoricalEntryStructure(input, new Date(`${last}T07:00:00Z`)).latestDate).toBe(last);
  });

  it.each(["duplicate", "nan", "bad-date", "bad-ohlc"])("keeps %s history unknown instead of connecting across it", problem => {
    const input = history();
    if (problem === "duplicate") input.bars.push({ ...input.bars[74] });
    if (problem === "nan") input.bars[74].volume = NaN;
    if (problem === "bad-date") input.bars[74].date = "2025-02-30";
    if (problem === "bad-ohlc") input.bars[74].high = 1;
    const result = analyzeHistoricalEntryStructure(input, asOf);
    expect(result).toMatchObject({ status: "invalid-observation", observed: false });
    expect(result).not.toHaveProperty("breakout");
    expect(result).not.toHaveProperty("pullback");
  });

  it.each(["adjustment", "source", "symbol"])("does not treat unverified %s as qfq evidence", problem => {
    const input = history();
    if (problem === "adjustment") input.adjustment = "none";
    if (problem === "source") input.source = " ";
    if (problem === "symbol") input.symbol = "other";
    expect(analyzeHistoricalEntryStructure(input, asOf)).toMatchObject({ status: "unverified-source-or-adjustment", observed: false });
  });

  it("sorts copied observations and keeps input unchanged within the 500-bar budget", () => {
    const input = history(510), cutoff = new Date("2027-01-01T00:00:00Z");
    const expected = analyzeHistoricalEntryStructure(input, cutoff);
    input.bars.reverse(); const snapshot = structuredClone(input);
    expect(analyzeHistoricalEntryStructure(input, cutoff)).toEqual(expected);
    expect(input).toEqual(snapshot);
    expect(expected).toMatchObject({ barCount: 500, validation: { trimmedBars: 10 } });
    expect(() => analyzeHistoricalEntryStructure(input, new Date(NaN))).toThrow();
  });
});

describe("market regime structure attachment", () => {
  function analyze(stock: HistoricalSeries) {
    return analyzeMarketRegimeData({ asOf, mode: "paper", provider: "akshare", days: 500,
      stockNames: new Map([[stock.symbol, stock.name]]),
      stockHistory: { provider: "akshare", source: "fixture", fetchedAt: asOf.toISOString(), series: [stock], warning: null },
      sectorHistory: { provider: "akshare", source: "fixture", fetchedAt: asOf.toISOString(), series: [], warning: null },
      sectorResponse: { provider: "akshare", source: "fixture", fetchedAt: asOf.toISOString(), sectors: [], warning: null } });
  }

  it("adds completed structure without changing the existing stock classification or confidence", () => {
    const input = history();
    const stock = analyze(input).stockRegimes[0];
    const { rank, historicalEntryStructure, ...legacy } = stock;
    expect(rank).toBe(1);
    expect(legacy).toEqual(classifyStockRegime(input.symbol, input.name, input.bars));
    expect(historicalEntryStructure).toEqual(analyzeHistoricalEntryStructure(input, asOf));
  });

  it("retains original invalid dates for evidence even when legacy classification can use the cleaned history", () => {
    const input = history(); input.bars.push({ ...input.bars[74] });
    const result = analyze(input).stockRegimes[0];
    expect(result.barCount).toBe(79);
    expect(result.historicalEntryStructure).toMatchObject({ status: "invalid-observation", observed: false,
      validation: { duplicateBars: 2 } });
  });
});
