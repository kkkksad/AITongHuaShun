import { describe, expect, it } from "vitest";
import { executionCosts, hasSufficientCash, limitBuyBudget } from "./executionCosts";

const options = { commissionRate: 0.0003, minimumCommission: 5, slippageBps: 50 };

describe("executionCosts", () => {
  it("retains slipped price and minimum commission rounding", () => {
    const costs = executionCosts({ symbol: "600001", side: "buy", type: "market", quantity: 100 }, 10, options);
    expect(costs).toMatchObject({ fillPrice: 10.05, commission: 5 });
    expect(costs.notional).toBeCloseTo(1_005, 10);
    expect(costs.cashDebit).toBeCloseTo(1_010, 10);
    expect(hasSufficientCash(1_010, costs.cashDebit)).toBe(true);
    expect(hasSufficientCash(1_009.99, costs.cashDebit)).toBe(false);
  });

  it("clamps before rounding and charges proportional commission on the rounded fill", () => {
    const costs = executionCosts({ symbol: "600001", side: "buy", type: "limit", quantity: 100, limitPrice: 10.005 },
      11, { ...options, commissionRate: 0.01 });
    expect(costs).toMatchObject({ fillPrice: 10.01, commission: 10.01 });
    expect(costs.notional).toBeCloseTo(1_001, 10);
    expect(costs.cashDebit).toBeCloseTo(1_011.01, 10);
  });

  it("budgets rounded-up and rounded-down caps without a separate buffer", () => {
    const order = { symbol: "600001", side: "buy" as const, type: "limit" as const, quantity: 100 };
    expect(limitBuyBudget({ ...order, limitPrice: 10.005 }, options)).toBe(1_006);
    expect(limitBuyBudget({ ...order, limitPrice: 10.004 }, options)).toBe(1_005);
    expect(limitBuyBudget({ ...order, limitPrice: 10.004 }, { ...options, minimumCommission: 0, commissionRate: 0 }))
      .toBe(10.004 * 100);
  });

  it("only needs extra sell cash when commission exceeds the proceeds", () => {
    const order = { symbol: "600001", side: "sell" as const, type: "market" as const, quantity: 100 };
    expect(executionCosts(order, 0.01, { ...options, slippageBps: 0 }).cashDebit).toBe(4);
    expect(executionCosts(order, 1, { ...options, slippageBps: 0 }).cashDebit).toBe(0);
  });

  it("rejects non-finite funding comparisons", () => {
    expect(hasSufficientCash(Number.NaN, 1)).toBe(false);
    expect(hasSufficientCash(1, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it.each([
    { available: 1_004.99, required: 1_005 },
    { available: 1_004.9999, required: 1_005 },
    { available: 1e15, required: 1e15 + 1 },
  ])("does not forgive a real funding shortfall from $available to $required", ({ available, required }) => {
    expect(hasSufficientCash(available, required)).toBe(false);
  });
});
