import type { HistoricalSeries } from "./marketRegimeResearch";
import { validateCompletedDailyBars } from "./strategyHistoryEvidence";

const MINIMUM_BARS = 61;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Completed qfq OHLC structure only. No live comparison, qualification threshold, or order permission. */
export function analyzeHistoricalEntryStructure(series: HistoricalSeries, asOf: Date, maxBars = 500) {
  const checked = validateCompletedDailyBars(series.bars, { asOf, maxBars });
  const bars = checked.bars;
  const base = {
    symbol: series.symbol, source: series.source, adjustment: series.adjustment, asOf: asOf.toISOString(),
    latestDate: bars.at(-1)?.date ?? null, barCount: bars.length, requiredBars: MINIMUM_BARS,
    validation: { invalidBars: checked.invalidBars, duplicateBars: checked.duplicateBars,
      excludedIncompleteOrFutureBars: checked.futureBars, trimmedBars: checked.trimmedBars },
    scope: "completed-qfq-daily-structure-not-live-intraday-signal-or-trade-permission",
  };
  if (!/^\d{6}$/.test(series.symbol) || series.adjustment !== "qfq" || !series.source.trim()) {
    return { ...base, status: "unverified-source-or-adjustment" as const, observed: false as const };
  }
  // Damaged inputs stay unknown instead of connecting across removed prices/dates.
  if (checked.invalidBars || checked.duplicateBars) {
    return { ...base, status: "invalid-observation" as const, observed: false as const };
  }
  if (bars.length < MINIMUM_BARS) {
    return { ...base, status: "insufficient-history" as const, observed: false as const };
  }
  const latest = bars.at(-1)!;
  const preceding20 = bars.slice(-21, -1);
  const priorHigh = preceding20.reduce((best, bar) => bar.high >= best.high ? bar : best);
  const meanVolume20 = mean(preceding20.map(bar => bar.volume));
  const meanRange20 = mean(preceding20.map(bar => (bar.high - bar.low) / bar.close));
  const meanRange40 = mean(bars.slice(-61, -21).map(bar => (bar.high - bar.low) / bar.close));
  const lowOffset = bars.slice(-7, -1).reduce((best, bar, index, group) => bar.low <= group[best].low ? index : best, 0);
  const lowIndex = bars.length - 7 + lowOffset;
  const low = bars[lowIndex];
  const anchorBars = bars.slice(lowIndex - 20, lowIndex);
  const anchor = anchorBars.reduce((best, bar) => bar.high >= best.high ? bar : best);
  const lowBaselineVolume = mean(anchorBars.map(bar => bar.volume));
  const previous = bars.at(-2)!;
  return { ...base, status: "observed" as const, observed: true as const,
    breakout: {
      resistanceWindowBars: 20, priorHigh20: priorHigh.high, priorHighDate: priorHigh.date,
      latestClose: latest.close, latestDayHigh: latest.high, closesAbovePriorHigh20: latest.close > priorHigh.high,
      latestVolume: latest.volume, priorMeanVolume20: meanVolume20 > 0 ? meanVolume20 : null,
      priorPositiveVolumeBars: preceding20.filter(bar => bar.volume > 0).length,
      latestCompletedVolumeRatio20: latest.volume > 0 && meanVolume20 > 0 ? latest.volume / meanVolume20 : null,
      baseline: "20-completed-qfq-daily-bars-before-latest-close",
    },
    contraction: {
      meanDailyRange20: meanRange20, precedingMeanDailyRange40: meanRange40,
      ratio20to40: meanRange40 > 0 ? meanRange20 / meanRange40 : null,
      definition: "mean-(high-low)/close-not-ATR",
    },
    pullback: {
      lookbackBars: 6, lowDate: low.date, low: low.low, priorAnchorHighDate: anchor.date, priorAnchorHigh20: anchor.high,
      pullbackFromPriorAnchor: 1 - low.low / anchor.high,
      recoveredFromLow: latest.close / low.low - 1,
      previousDayHigh: previous.high, latestCloseAbovePreviousDayHigh: latest.close > previous.high,
      recoveryAfterLow: latest.date > low.date,
      lowVolume: low.volume, priorMeanVolume20AtLow: lowBaselineVolume > 0 ? lowBaselineVolume : null,
      lowCompletedVolumeRatio20: low.volume > 0 && lowBaselineVolume > 0 ? low.volume / lowBaselineVolume : null,
      anchor: "20-bars-strictly-before-recent-six-bar-low-most-recent-ties",
    } };
}

export type HistoricalEntryStructure = ReturnType<typeof analyzeHistoricalEntryStructure>;
