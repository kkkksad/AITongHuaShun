import type { StockCorrelationEvidence } from "../../shared/paperPortfolioRisk";
import type { HistoricalBarsResponse } from "./marketRegimeResearch";
import { buildHistoricalCorrelations } from "./historicalCorrelation";

/** Reuses raw response rows so rejected dates cannot become fabricated return intervals. */
export function buildStockCorrelationEvidence(input: {
  history: HistoricalBarsResponse;
  selectedSymbols: string[];
  asOf: Date;
  maxBars: number;
}): StockCorrelationEvidence {
  const requested = [...new Set(input.selectedSymbols.filter(symbol => /^\d{6}$/.test(symbol)))];
  const requestedSymbols = requested.slice(0, 12);
  const selected = new Set(requestedSymbols);
  const raw = input.history?.provider === "akshare" && Array.isArray(input.history.series)
    ? input.history.series.filter(series => series && selected.has(series.symbol)) : [];
  const report = buildHistoricalCorrelations(raw, input.asOf, { requestedSymbols: selected, maxBars: input.maxBars });
  return {
    ...report,
    scope: "regime-stock-history",
    requestedSymbols,
    omittedRequestedCount: Math.max(0, requested.length - requestedSymbols.length),
    sources: report.series.map(series => {
      const source = raw.find(item => item.symbol === series.symbol)!.source.trim();
      return { symbol: series.symbol,
        source: /^[a-zA-Z0-9_.-]{1,80}$/.test(source) ? source : "unclassified-source", adjustment: "qfq" };
    }),
  };
}
