/** Bounded identities observed by the existing regime-history analysis. */
export interface StockHistoryCoverage {
  scope: "regime-stock-history";
  asOf: string;
  selectedSymbols: string[];
  returnedSymbols: string[];
  acceptedSymbols: string[];
  usableSymbols: string[];
}
