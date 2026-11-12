import { describe, expect, it } from "vitest";
import { completedDailyQuoteVolumeShares, evaluateCompletedEntryHypothesis } from "./completedEntryHypothesis";
import type { HistoricalSeries } from "./marketRegimeResearch";

function history(): HistoricalSeries {
  return { symbol: "600001", name: "fixture", source: "frozen-test", adjustment: "qfq",
    bars: Array.from({ length: 62 }, (_, index) => ({ date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: 10, high: index < 41 ? 10.5 : 10.05, low: index < 41 ? 9.5 : 9.95,
      close: 10, volume: 100, amount: 1000, turnover: null, changePercent: null })) };
}
const asOf = new Date("2025-04-01T00:00:00Z");
function breakout() { const input = history(); Object.assign(input.bars.at(-1)!, { high: 10.3, close: 10.2, volume: 150 }); return input; }
describe("completed daily entry hypotheses (offline only)", () => {
  it("converts verified Eastmoney daily lots to quote shares once without changing raw history", () => {
    expect(completedDailyQuoteVolumeShares("eastmoney-stock-history", 50000)).toBe(5000000);
    expect(completedDailyQuoteVolumeShares("eastmoney-stock-history", 0)).toBe(0);
  });
  it.each(["unknown", "tencent-stock-history"])("rejects an unverified or version-dependent %s volume contract", source => {
    expect(() => completedDailyQuoteVolumeShares(source, 50000)).toThrow();
  });
  it("rejects invalid or overflowing daily volume rather than fabricating liquidity", () => {
    for (const volume of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER, 0.001]) {
      expect(() => completedDailyQuoteVolumeShares("eastmoney-stock-history", volume)).toThrow();
    }
  });
  it("requires a closing breakout rather than a high-only excursion or equality", () => {
    const input = breakout(); input.bars.at(-1)!.close = 10;
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolumePriceBreakout", asOf).state).toBe("not-confirmed");
    input.bars.at(-1)!.close = 10.05;
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolumePriceBreakout", asOf).state).toBe("not-confirmed");
    input.bars.at(-1)!.close = 10.2;
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolumePriceBreakout", asOf).state).toBe("confirmed");
  });
  it("uses relative completed volume and keeps its inclusive threshold", () => {
    const input = breakout(); input.bars.at(-1)!.volume = 149.99;
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolumePriceBreakout", asOf).state).toBe("not-confirmed");
    input.bars.at(-1)!.volume = 150;
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolumePriceBreakout", asOf).state).toBe("confirmed");
  });
  it("requires contraction as well as price and relative volume", () => {
    const input = breakout(); input.bars.at(-1)!.volume = 140;
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolatilityContractionBreakout", asOf).state).toBe("confirmed");
    for (const bar of input.bars.slice(-21, -1)) { bar.high = 10.5; bar.low = 9.5; }
    Object.assign(input.bars.at(-1)!, { high: 10.7, close: 10.6 });
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolatilityContractionBreakout", asOf).state).toBe("not-confirmed");
  });
  it.each(["short", "bad", "duplicate", "source", "adjustment"])("keeps %s history unknown", kind => {
    const input = breakout();
    if (kind === "short") input.bars = input.bars.slice(-60);
    if (kind === "bad") input.bars[2].low = -1;
    if (kind === "duplicate") input.bars[2].date = input.bars[1].date;
    if (kind === "source") input.source = "";
    if (kind === "adjustment") input.adjustment = "none";
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolumePriceBreakout", asOf).state).toBe("unknown");
  });
  it("does not borrow an unfinished or future breakout", () => {
    const input = breakout(), date = input.bars.at(-1)!.date;
    const beforeClose = new Date(`${date}T14:59:59+08:00`);
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolumePriceBreakout", beforeClose).state).toBe("not-confirmed");
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolumePriceBreakout", new Date(`${date}T15:00:00+08:00`)).state).toBe("confirmed");
  });
  it("keeps zero-volume baselines unknown and never mutates observations", () => {
    const input = breakout(); for (const bar of input.bars.slice(0, -1)) bar.volume = 0;
    const before = structuredClone(input);
    expect(evaluateCompletedEntryHypothesis(input, "kairosVolumePriceBreakout", asOf).state).toBe("unknown");
    expect(input).toEqual(before);
  });
  it("requires a prior low, recovery above yesterday's high and quiet-low relative volume", () => {
    const input = history();
    for (const bar of input.bars) { bar.high = 10.5; bar.low = 10; bar.open = bar.close = 10.2; }
    Object.assign(input.bars.at(-3)!, { low: 9.9, volume: 80 });
    Object.assign(input.bars.at(-2)!, { high: 10.2, low: 10, open: 10.1, close: 10.1 });
    Object.assign(input.bars.at(-1)!, { high: 10.5, low: 10, open: 10.1, close: 10.3, volume: 120 });
    expect(evaluateCompletedEntryHypothesis(input, "aSharePullback", asOf).state).toBe("confirmed");
    input.bars.at(-1)!.close = 10.2;
    expect(evaluateCompletedEntryHypothesis(input, "aSharePullback", asOf).state).toBe("not-confirmed");
    input.bars.at(-1)!.close = 10.3; input.bars.at(-3)!.volume = 110;
    expect(evaluateCompletedEntryHypothesis(input, "aSharePullback", asOf).state).toBe("not-confirmed");
  });
  it("rejects an unsupported hypothesis or invalid cutoff", () => {
    expect(() => evaluateCompletedEntryHypothesis(history(), "rsi" as never, asOf)).toThrow();
    expect(() => evaluateCompletedEntryHypothesis(history(), "aSharePullback", new Date(NaN))).toThrow();
  });
});
