import type { HistoricalSeries } from "./marketRegimeResearch";
import { validateStrategyHistory } from "./strategyHistoryEvidence";

const SAMPLE_LIMIT = 120;
const MINIMUM_SAMPLES = 60;

interface ReturnInterval {
  startDate: string;
  endDate: string;
  value: number;
}

function pearson(left: number[], right: number[]): number | null {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const a = mean(left), b = mean(right);
  const covariance = left.reduce((sum, value, index) => sum + (value - a) * (right[index] - b), 0);
  const variance = Math.sqrt(left.reduce((sum, value) => sum + (value - a) ** 2, 0) *
    right.reduce((sum, value) => sum + (value - b) ** 2, 0));
  if (!Number.isFinite(variance) || variance <= 0) return null;
  const result = covariance / variance;
  return Number.isFinite(result) ? Math.max(-1, Math.min(1, result)) : null;
}

/** Read-only historical evidence, never a trade permission or a diversification guarantee. */
export function buildHistoricalCorrelations(input: HistoricalSeries[], asOf: Date) {
  const checked = validateStrategyHistory(input, { asOf, maxBars: 500 });
  const histories = checked.series.map(item => {
    const validDates = new Set(item.bars.map(bar => bar.date));
    // Preserve known rejected dates so removal cannot manufacture a longer return sample.
    const rejectedDates = [...new Set(input.find(source => source && source.symbol === item.symbol)!.bars
      .filter(bar => bar && typeof bar.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && !validDates.has(bar.date))
      .map(bar => bar.date))];
    const intervals = new Map<string, ReturnInterval>();
    let excludedIntervals = 0;
    for (let index = 1; index < item.bars.length; index++) {
      const previous = item.bars[index - 1], current = item.bars[index];
      const value = current.close / previous.close - 1;
      if (previous.volume <= 0 || current.volume <= 0 || !Number.isFinite(value) ||
        rejectedDates.some(date => previous.date < date && date < current.date)) {
        excludedIntervals++;
        continue;
      }
      intervals.set(current.date, { startDate: previous.date, endDate: current.date, value });
    }
    return { symbol: item.symbol, barCount: item.bars.length, excludedIntervals, intervals };
  });
  const pairs = histories.flatMap((left, index) => histories.slice(index + 1).map(right => {
    const matched = [...left.intervals.values()].filter(interval =>
      right.intervals.get(interval.endDate)?.startDate === interval.startDate).slice(-SAMPLE_LIMIT);
    const correlation = matched.length < MINIMUM_SAMPLES ? null : pearson(
      matched.map(interval => interval.value), matched.map(interval => right.intervals.get(interval.endDate)!.value));
    const boundary = (interval: ReturnInterval | undefined) => interval ?
      { startDate: interval.startDate, endDate: interval.endDate } : null;
    return { left: left.symbol, right: right.symbol, samples: matched.length, correlation,
      status: matched.length < MINIMUM_SAMPLES ? "insufficient-history" as const :
        correlation === null ? "undefined-variance" as const : "observed" as const,
      firstInterval: boundary(matched[0]), lastInterval: boundary(matched.at(-1)),
      maxCalendarSpanDays: matched.length ? Math.max(...matched.map(interval =>
        (Date.parse(interval.endDate) - Date.parse(interval.startDate)) / 86_400_000)) : null };
  }));
  return { methodology: { asOf: asOf.toISOString(), sampleLimit: SAMPLE_LIMIT, minimumSamples: MINIMUM_SAMPLES,
    alignment: "pairwise-identical-start-and-end-dates", returns: "qfq-close-to-close-positive-volume-endpoints",
    calendar: "observed-intervals-no-exchange-calendar-or-joint-missing-day-guarantee",
    interpretation: "historical-diagnostic-not-trade-permission-or-independent-risk-guarantee" },
    validationWarnings: checked.warnings,
    series: histories.map(({ symbol, barCount, excludedIntervals, intervals }) =>
      ({ symbol, barCount, excludedIntervals, returnIntervals: intervals.size })), pairs };
}
