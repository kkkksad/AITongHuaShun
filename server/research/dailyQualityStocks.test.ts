import { describe, expect, it } from "vitest";
import type { MarketQuote, MarketSnapshot } from "../../shared/trading";
import { buildDailyQualityStocks } from "./dailyQualityStocks";

function quote(symbol: string, turnover?: number): MarketQuote {
  return {
    symbol,
    name: `测试${symbol}`,
    tradable: true,
    price: 20,
    previousClose: 19.8,
    changePercent: 1.01,
    volume: 20_000_000,
    amount: 400_000_000,
    open: 19.9,
    high: 20.2,
    low: 19.7,
    amplitude: 2.5,
    turnover,
    updatedAt: "2026-08-08T10:30:00+08:00",
  };
}

function report(...quotes: MarketQuote[]) {
  const snapshot: MarketSnapshot = {
    mode: "paper",
    sequence: 8,
    marketTime: "2026-08-08T10:30:00+08:00",
    quotes,
  };
  return buildDailyQualityStocks(snapshot, "akshare", quotes.length);
}

describe("buildDailyQualityStocks", () => {
  it("prefers the bounded healthy turnover zone over thin or overheated trading", () => {
    const result = report(
      quote("600001", 4),
      quote("600002", 0.2),
      quote("600003", 12),
      quote("600004", 20),
    );
    const bySymbol = new Map(result.stocks.map((stock) => [stock.symbol, stock]));

    expect(bySymbol.get("600001")!.factors.turnover).toBeGreaterThan(
      bySymbol.get("600002")!.factors.turnover,
    );
    expect(bySymbol.get("600001")!.factors.turnover).toBeGreaterThan(
      bySymbol.get("600003")!.factors.turnover,
    );
    expect(bySymbol.get("600003")!.factors.turnover).toBeGreaterThan(
      bySymbol.get("600004")!.factors.turnover,
    );
    expect(bySymbol.get("600001")!.reasons.join("")).toContain("健康换手甜蜜区");
    expect(bySymbol.get("600002")!.riskFlags.join("")).toContain("换手不足");
    expect(bySymbol.get("600003")!.riskFlags.join("")).toContain("换手偏热");
    expect(bySymbol.get("600004")!.riskFlags.join("")).toContain("情绪化交易");
  });

  it("marks missing turnover as neutral evidence instead of a healthy signal", () => {
    const result = report(quote("600005"));
    const stock = result.stocks[0];

    expect(result.methodology.version).toBe("0.2.0");
    expect(stock.factors.turnover).toBe(50);
    expect(stock.reasons.join("")).toContain("换手率字段缺失");
    expect(stock.reasons.join("")).not.toContain("健康换手甜蜜区");
  });
});
