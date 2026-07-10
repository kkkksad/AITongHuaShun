import { describe, expect, it } from "vitest";
import type {
  AccountSnapshot,
  MarketQuote,
  PositionSnapshot,
  RiskLimits,
} from "../../shared/trading";
import { RiskEngine } from "./riskEngine";

const limits: RiskLimits = {
  maxOrderNotional: 100_000,
  maxPositionWeight: 0.25,
  maxDailyLoss: 0.05,
  lotSize: 100,
  realTradingEnabled: false,
};

const account: AccountSnapshot = {
  accountId: "PAPER-CN-01",
  mode: "mock",
  cash: 500_000,
  equity: 1_000_000,
  marketValue: 500_000,
  unrealizedPnl: 0,
  realizedPnl: 0,
  dailyPnl: 0,
  dailyPnlPercent: 0,
  riskUtilization: 0.5,
  paused: false,
  updatedAt: "2026-07-11T00:00:00.000Z",
};

const quote: MarketQuote = {
  symbol: "300750",
  name: "宁德时代",
  tradable: true,
  price: 250,
  previousClose: 248,
  changePercent: 0.8,
  volume: 1_000_000,
  updatedAt: "2026-07-11T00:00:00.000Z",
};

const position: PositionSnapshot = {
  symbol: quote.symbol,
  name: quote.name,
  quantity: 100,
  averagePrice: 245,
  currentPrice: quote.price,
  marketValue: 25_000,
  unrealizedPnl: 500,
  realizedPnl: 0,
  weight: 0.025,
};

describe("RiskEngine", () => {
  const risk = new RiskEngine(limits);

  it("approves a valid paper order", () => {
    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: 100,
      },
      quote,
      account,
      position,
      mode: "mock",
    });

    expect(result).toEqual({
      allowed: true,
      code: "APPROVED",
      message: "风险检查通过",
    });
  });

  it("rejects display-only indices", () => {
    const result = risk.evaluate({
      request: {
        symbol: "000001",
        side: "buy",
        type: "market",
        quantity: 100,
      },
      quote: { ...quote, symbol: "000001", tradable: false },
      account,
      mode: "mock",
    });

    expect(result.code).toBe("NON_TRADABLE_SYMBOL");
  });

  it("rejects orders while trading is paused", () => {
    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: 100,
      },
      quote,
      account: { ...account, paused: true },
      mode: "mock",
    });

    expect(result.code).toBe("TRADING_PAUSED");
  });

  it("rejects quantities outside the board lot", () => {
    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: 50,
      },
      quote,
      account,
      mode: "mock",
    });

    expect(result.code).toBe("INVALID_LOT_SIZE");
  });
});
