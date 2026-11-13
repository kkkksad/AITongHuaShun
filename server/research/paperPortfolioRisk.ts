import type { PositionSnapshot } from "../../shared/trading";
import type { PaperPortfolioRiskEvidence, StockCorrelationEvidence } from "../../shared/paperPortfolioRisk";

const validValue = (value: number) => Number.isFinite(value) && value >= 0;

/** Current filled holdings only. This function never changes an action or a budget. */
export function buildPaperPortfolioRisk(input: {
  positions: PositionSnapshot[];
  equity: number;
  valuationAsOf: string;
  asOf: Date;
  correlations?: StockCorrelationEvidence;
}): PaperPortfolioRiskEvidence {
  const symbols = input.positions.map(position => position.symbol);
  const unique = new Map(input.positions.map(position => [position.symbol, position]));
  const sum = input.positions.reduce((total, position) => total + position.marketValue, 0);
  const valuationValid = unique.size === symbols.length && input.positions.every(position => validValue(position.marketValue)) && validValue(sum);
  const holdingsMarketValue = valuationValid ? sum : null;
  const equityValid = Number.isFinite(input.equity) && input.equity > 0;
  const cutoff = input.asOf.getTime();
  const historyTime = Date.parse(input.correlations?.methodology.asOf ?? "");
  const correlations = Number.isFinite(cutoff) && Number.isFinite(historyTime) && historyTime <= cutoff &&
    input.correlations?.scope === "regime-stock-history" ? input.correlations : undefined;
  const history = new Map(correlations?.series.map(row => [row.symbol, row]));
  const sources = new Map(correlations?.sources.map(row => [row.symbol, row.source]));
  const selected = [...unique.values()].sort((left, right) =>
    (validValue(right.marketValue) ? right.marketValue : -1) - (validValue(left.marketValue) ? left.marketValue : -1) ||
    left.symbol.localeCompare(right.symbol)).slice(0, 12);
  const holdings = selected.map(position => ({
    symbol: position.symbol, name: position.name,
    marketValue: validValue(position.marketValue) ? position.marketValue : null,
    accountWeight: valuationValid && equityValid ? position.marketValue / input.equity : null,
    stockWeight: valuationValid && sum > 0 ? position.marketValue / sum : null,
    historyBarCount: history.get(position.symbol)?.barCount ?? null,
    historySource: sources.get(position.symbol) ?? null,
  }));
  const pairs = holdings.flatMap((left, index) => holdings.slice(index + 1).map(right => {
    const found = correlations?.pairs.find(pair =>
      pair.left === left.symbol && pair.right === right.symbol || pair.left === right.symbol && pair.right === left.symbol);
    if (!found) return { left: left.symbol, right: right.symbol, samples: 0, correlation: null,
      status: "missing-history" as const, firstInterval: null, lastInterval: null, maxCalendarSpanDays: null };
    return { ...found, left: left.symbol, right: right.symbol,
      firstInterval: found.firstInterval ? { ...found.firstInterval } : null,
      lastInterval: found.lastInterval ? { ...found.lastInterval } : null };
  }));
  return {
    scope: "current-filled-holdings", valuationAsOf: input.valuationAsOf,
    historyAsOf: correlations?.methodology.asOf ?? null,
    holdingsMarketValue, investedRatio: holdingsMarketValue !== null && equityValid ? holdingsMarketValue / input.equity : null,
    valuationStatus: valuationValid ? "available" : "invalid",
    holdingCount: input.positions.length, omittedHoldingCount: input.positions.length - selected.length,
    historyAvailableHoldingCount: [...unique.keys()].filter(symbol => (history.get(symbol)?.barCount ?? 0) > 0).length,
    totalPairCount: unique.size * (unique.size - 1) / 2,
    observedPairCount: pairs.filter(pair => pair.status === "observed").length,
    holdings, pairs, industryClassification: "unknown", industryHardLimitEnabled: false, correlationHardLimitEnabled: false,
  };
}
