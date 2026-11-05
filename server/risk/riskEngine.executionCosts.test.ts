import { describe, expect, it } from "vitest";
import type { AccountSnapshot, MarketQuote, RiskLimits } from "../../shared/trading";
import { RiskEngine } from "./riskEngine";

const limits: RiskLimits = {
  maxOrderNotional: 1_000_000, maxPositionWeight: 1, maxDailyLoss: 1,
  lotSize: 100, realTradingEnabled: false,
};
const quote: MarketQuote = {
  symbol: "600001", name: "cost fixture", tradable: true, price: 10,
  previousClose: 10, changePercent: 0, volume: 1_000_000, updatedAt: "2026-11-05T03:00:00Z",
};
const account: AccountSnapshot = {
  accountId: "cost-fixture", mode: "paper", cash: 1_000, equity: 1_000,
  marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
  dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: quote.updatedAt,
};
const input = {
  request: { symbol: quote.symbol, side: "buy" as const, type: "market" as const, quantity: 100 },
  quote, account, mode: "paper" as const,
};

describe("RiskEngine optional execution funding", () => {
  it("retains principal-only compatibility when no complete cost was supplied", () => {
    expect(new RiskEngine(limits).evaluate(input).allowed).toBe(true);
  });

  it("requires a supplied complete cash cost in addition to principal", () => {
    const complete = { ...input, requiredCash: 1_005 };
    expect(new RiskEngine(limits).evaluate(complete).code).toBe("INSUFFICIENT_CASH");
  });

  it("cannot use a smaller supplied cost to bypass the original principal requirement", () => {
    const smaller = { ...input, account: { ...account, cash: 999 }, requiredCash: 1 };
    expect(new RiskEngine(limits).evaluate(smaller).code).toBe("INSUFFICIENT_CASH");
  });

  it("keeps pause and notional-limit decisions ahead of complete funding", () => {
    const paused = { ...input, account: { ...account, paused: true }, requiredCash: 1_005 };
    expect(new RiskEngine(limits).evaluate(paused).code).toBe("TRADING_PAUSED");
    const large = { ...input, requiredCash: 1_005 };
    expect(new RiskEngine({ ...limits, maxOrderNotional: 999 }).evaluate(large).code).toBe("ORDER_NOTIONAL_LIMIT");
  });
});
