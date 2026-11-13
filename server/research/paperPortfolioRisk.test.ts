import { describe, expect, it } from "vitest";
import type { PositionSnapshot } from "../../shared/trading";
import type { HistoricalSeries } from "./marketRegimeResearch";
import { buildStockCorrelationEvidence } from "./stockCorrelationEvidence";
import { buildPaperPortfolioRisk } from "./paperPortfolioRisk";

const asOf = new Date("2026-04-01T07:00:00Z");
function position(symbol: string, marketValue = 1000): PositionSnapshot {
  return { symbol, name: symbol, quantity: 100, averagePrice: 10, currentPrice: marketValue / 100,
    marketValue, weight: 0.99, unrealizedPnl: 0, realizedPnl: 0 };
}
function series(symbol: string, count = 80, constant = false): HistoricalSeries {
  let close = 10;
  return { symbol, name: symbol, source: "frozen-test", adjustment: "qfq", bars:
    Array.from({ length: count }, (_, i) => {
      if (!constant) close *= 1 + (i % 5 - 2) * 0.002;
      return { date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
        open: close, high: close, low: close, close, volume: 10000, amount: 100000,
        changePercent: null, turnover: null };
    }) };
}
function evidence(values = [series("600010"), series("600011")]) {
  return buildStockCorrelationEvidence({ history: { provider: "akshare", source: "wrapper",
    fetchedAt: asOf.toISOString(), series: values, warning: null },
    selectedSymbols: ["600010", "600011"], asOf, maxBars: 180 });
}
function input() {
  return { positions: [position("600010"), position("600011")], equity: 20000,
    valuationAsOf: asOf.toISOString(), asOf, correlations: evidence() };
}

describe("current filled portfolio common-risk evidence", () => {
  it("separates total-equity exposure from stock-only weights and ignores stale position weights", () => {
    const request = input(); const result = buildPaperPortfolioRisk(request);
    expect(result).toMatchObject({ scope: "current-filled-holdings", holdingsMarketValue: 2000,
      investedRatio: 0.1, holdingCount: 2, historyAvailableHoldingCount: 2, totalPairCount: 1, observedPairCount: 1,
      industryClassification: "unknown", industryHardLimitEnabled: false, correlationHardLimitEnabled: false });
    expect(result.holdings.map(row => [row.accountWeight, row.stockWeight])).toEqual([[0.05, 0.5], [0.05, 0.5]]);
    const withLessCash = buildPaperPortfolioRisk({ ...request, equity: 10000 });
    expect(withLessCash.investedRatio).toBe(0.2);
    expect(withLessCash.holdings.map(row => row.stockWeight)).toEqual([0.5, 0.5]);
    expect(result.pairs[0].correlation).toBeCloseTo(1, 12);
  });

  it("uses every holding in the denominator even when only twelve details are displayed", () => {
    const result = buildPaperPortfolioRisk({ ...input(), positions:
      Array.from({ length: 13 }, (_, i) => position(String(600010 + i), 100)) });
    expect(result).toMatchObject({ holdingCount: 13, omittedHoldingCount: 1, holdingsMarketValue: 1300,
      investedRatio: 0.065, totalPairCount: 78 });
    expect(result.holdings).toHaveLength(12);
    expect(result.pairs).toHaveLength(66);
    expect(result.holdings[0].stockWeight).toBeCloseTo(1 / 13, 12);
  });

  it.each([0, -1, NaN, Infinity])("keeps equity-based proportions unknown with denominator %s", equity => {
    const result = buildPaperPortfolioRisk({ ...input(), equity });
    expect(result.investedRatio).toBeNull();
    expect(result.holdings.every(row => row.accountWeight === null)).toBe(true);
    expect(result.holdings[0].stockWeight).toBe(0.5);
  });

  it.each([-1, NaN, Infinity])("does not fabricate a known portfolio valuation from invalid market value %s", value => {
    const result = buildPaperPortfolioRisk({ ...input(), positions: [position("600010", value), position("600011")] });
    expect(result).toMatchObject({ holdingsMarketValue: null, investedRatio: null, valuationStatus: "invalid" });
    expect(result.holdings.every(row => row.stockWeight === null && row.accountWeight === null)).toBe(true);
    expect(result.holdings.find(row => row.symbol === "600010")!.marketValue).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it("does not count duplicate position identities as independent exposures", () => {
    const result = buildPaperPortfolioRisk({ ...input(), positions: [position("600010"), position("600010")] });
    expect(result).toMatchObject({ valuationStatus: "invalid", holdingsMarketValue: null, investedRatio: null,
      totalPairCount: 0, observedPairCount: 0, omittedHoldingCount: 1 });
    expect(result.holdings).toHaveLength(1);
  });

  it("does not call an empty or zero-valued portfolio diversified", () => {
    const empty = buildPaperPortfolioRisk({ ...input(), positions: [] });
    expect(empty).toMatchObject({ holdingCount: 0, holdingsMarketValue: 0, investedRatio: 0, pairs: [] });
    const zero = buildPaperPortfolioRisk({ ...input(), positions: [position("600010", 0)] });
    expect(zero.holdings[0].stockWeight).toBeNull();
  });

  it("preserves the cached history boundary independently of the newer valuation and projection clock", () => {
    const later = new Date(asOf.getTime() + 60000);
    const result = buildPaperPortfolioRisk({ ...input(), valuationAsOf: later.toISOString(), asOf: later });
    expect(result.historyAsOf).toBe(asOf.toISOString());
    expect(result.valuationAsOf).toBe(later.toISOString());
  });

  it.each(["future", "invalid"])("keeps %s research evidence unknown", kind => {
    const request = input();
    request.correlations.methodology.asOf = kind === "future" ? "2099-01-01T00:00:00Z" : "bad-clock";
    const result = buildPaperPortfolioRisk(request);
    expect(result).toMatchObject({ historyAsOf: null, historyAvailableHoldingCount: 0, observedPairCount: 0 });
    expect(result.pairs[0]).toMatchObject({ status: "missing-history", samples: 0, correlation: null });
  });

  it("keeps missing, short and constant histories distinct instead of zero correlation", () => {
    const request = input();
    const missing = buildPaperPortfolioRisk({ ...request, correlations: evidence([series("600010")]) });
    expect(missing.historyAvailableHoldingCount).toBe(1);
    expect(missing.pairs[0]).toMatchObject({ status: "missing-history", samples: 0, correlation: null });
    const short = buildPaperPortfolioRisk({ ...request, correlations: evidence([series("600010", 60), series("600011", 60)]) });
    expect(short.pairs[0]).toMatchObject({ status: "insufficient-history", samples: 59, correlation: null });
    const constant = buildPaperPortfolioRisk({ ...request, correlations: evidence([series("600010", 80, true), series("600011")]) });
    expect(constant.pairs[0]).toMatchObject({ status: "undefined-variance", samples: 79, correlation: null });
  });

  it("keeps reverse-ordered pair identities correct after value-based position sorting", () => {
    const result = buildPaperPortfolioRisk({ ...input(), positions: [position("600010"), position("600011", 2000)] });
    expect(result.pairs[0]).toMatchObject({ left: "600011", right: "600010", status: "observed" });
    expect(result.holdings[0]).toMatchObject({ symbol: "600011", historySource: "frozen-test", historyBarCount: 80 });
  });

  it("does not mutate inputs or share mutable pair boundaries", () => {
    const request = input(); const before = structuredClone(request);
    const result = buildPaperPortfolioRisk(request);
    expect(request).toEqual(before);
    request.positions[0].name = "changed";
    request.correlations.pairs[0].firstInterval!.endDate = "2099-01-01";
    expect(result.holdings[0].name).toBe("600010");
    expect(result.pairs[0].firstInterval?.endDate).not.toBe("2099-01-01");
  });

  it("keeps the original portfolio values usable with legacy research missing correlations", () => {
    const result = buildPaperPortfolioRisk({ ...input(), correlations: undefined });
    expect(result).toMatchObject({ investedRatio: 0.1, holdingsMarketValue: 2000,
      historyAsOf: null, historyAvailableHoldingCount: 0, observedPairCount: 0 });
    expect(result.holdings[0].historySource).toBeNull();
  });
});
