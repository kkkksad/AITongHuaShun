export interface HistoricalReturnInterval {
  startDate: string;
  endDate: string;
}

export interface HistoricalCorrelationPair {
  left: string;
  right: string;
  samples: number;
  correlation: number | null;
  status: "observed" | "insufficient-history" | "undefined-variance";
  firstInterval: HistoricalReturnInterval | null;
  lastInterval: HistoricalReturnInterval | null;
  maxCalendarSpanDays: number | null;
}

export interface HistoricalCorrelationReport {
  methodology: {
    asOf: string;
    sampleLimit: number;
    minimumSamples: number;
    alignment: string;
    returns: string;
    calendar: string;
    interpretation: string;
  };
  validationWarnings: string[];
  series: Array<{ symbol: string; barCount: number; excludedIntervals: number; returnIntervals: number }>;
  pairs: HistoricalCorrelationPair[];
}

/** At most twelve identities from an already requested regime history response. */
export interface StockCorrelationEvidence extends HistoricalCorrelationReport {
  scope: "regime-stock-history";
  requestedSymbols: string[];
  omittedRequestedCount: number;
  sources: Array<{ symbol: string; source: string; adjustment: "qfq" }>;
}

export interface PaperPortfolioRiskEvidence {
  scope: "current-filled-holdings";
  valuationAsOf: string;
  historyAsOf: string | null;
  holdingsMarketValue: number | null;
  investedRatio: number | null;
  valuationStatus: "available" | "invalid";
  holdingCount: number;
  omittedHoldingCount: number;
  historyAvailableHoldingCount: number;
  totalPairCount: number;
  observedPairCount: number;
  holdings: Array<{
    symbol: string;
    name: string;
    marketValue: number | null;
    accountWeight: number | null;
    stockWeight: number | null;
    historyBarCount: number | null;
    historySource: string | null;
  }>;
  pairs: Array<Omit<HistoricalCorrelationPair, "status"> & {
    status: HistoricalCorrelationPair["status"] | "missing-history";
  }>;
  /** These diagnostics do not include pending/proposed orders or activate hard limits. */
  industryClassification: "unknown";
  industryHardLimitEnabled: false;
  correlationHardLimitEnabled: false;
}
