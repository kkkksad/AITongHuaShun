import { describe, expect, it } from "vitest";
import type { AccountSnapshot, MarketQuote, RiskLimits } from "../../shared/trading";
import { RiskEngine } from "./riskEngine";

const limits: RiskLimits = {
  maxOrderNotional: 100_000, maxPositionWeight: 0.25, maxDailyLoss: 0.05,
  lotSize: 100, realTradingEnabled: false,
};
const quote: MarketQuote = {
  symbol: "600001", name: "position fixture", tradable: true, price: 10,
  previousClose: 10, changePercent: 0, volume: 1_000_000, updatedAt: "2026-11-05T02:00:00Z",
};
const account: AccountSnapshot = {
  accountId: "position-fixture", mode: "paper", cash: 10_000, equity: 10_000,
  marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
  dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: quote.updatedAt,
};
const input = {
  request: { symbol: quote.symbol, side: "buy" as const, type: "market" as const, quantity: 100 },
  quote, account, mode: "paper" as const,
};

describe("RiskEngine optional pending buy exposure", () => {
  it("retains the original evaluation when pending exposure is omitted or zero", () => {
    const risk = new RiskEngine(limits);
    expect(risk.evaluate(input)).toEqual({ allowed: true, code: "APPROVED", message: "风险检查通过" });
    expect(risk.evaluate({ ...input, reservedBuyNotional: 0 })).toEqual(risk.evaluate(input));
  });

  it("adds reserved buy notional without treating it as cash spent", () => {
    const risk = new RiskEngine(limits);
    expect(risk.evaluate({ ...input, reservedBuyNotional: 2_000 }).code).toBe("POSITION_WEIGHT_LIMIT");
    expect(risk.evaluate({ ...input, reservedBuyNotional: 1_500 }).allowed).toBe(true);
    expect(account.cash).toBe(10_000);
  });

  it("preserves pause, quantity, order cap, daily loss and complete cash decision priority", () => {
    const risk = new RiskEngine(limits);
    const reserved = { ...input, reservedBuyNotional: 20_000, requiredCash: 20_000 };
    expect(risk.evaluate({ ...reserved, account: { ...account, paused: true } }).code).toBe("TRADING_PAUSED");
    expect(risk.evaluate({ ...reserved, request: { ...input.request, quantity: 1 } }).code).toBe("INVALID_LOT_SIZE");
    expect(new RiskEngine({ ...limits, maxOrderNotional: 999 }).evaluate(reserved).code).toBe("ORDER_NOTIONAL_LIMIT");
    expect(risk.evaluate({ ...reserved, account: { ...account, dailyPnlPercent: -0.05 } }).code).toBe("DAILY_LOSS_LIMIT");
    expect(risk.evaluate(reserved).code).toBe("INSUFFICIENT_CASH");
  });

  it("does not apply pending buy exposure to a valid sell", () => {
    const risk = new RiskEngine(limits);
    const decision = risk.evaluate({
      ...input, reservedBuyNotional: 20_000,
      request: { ...input.request, side: "sell" },
      position: {
        symbol: quote.symbol, name: quote.name, quantity: 100, availableQuantity: 100,
        averagePrice: 10, currentPrice: 10, marketValue: 1_000,
        unrealizedPnl: 0, realizedPnl: 0, weight: 0.1,
      },
    });
    expect(decision.allowed).toBe(true);
  });
});
