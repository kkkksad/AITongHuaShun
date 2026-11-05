import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import * as paperPlans from "../research/paperTradingPlanService";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { PaperAutoExecutor } from "./paperAutoExecutor";

afterEach(() => vi.restoreAllMocks());

async function executeBuy(input: {
  startingCash?: number;
  seedHolding?: boolean;
  maxPositionWeight?: number;
  legacyPlanReserveRatio?: number;
} = {}) {
  const now = new Date("2026-08-21T14:30:00+08:00");
  const config = createTestConfig({
    MARKET_MODE: "paper",
    TRADING_STARTING_CASH: input.startingCash ?? 10_000,
    TRADING_SEED_PORTFOLIO: false,
    MAX_ORDER_NOTIONAL: 10_000,
    MAX_POSITION_WEIGHT: input.maxPositionWeight ?? 0.8,
    SLIPPAGE_BPS: 10,
    PAPER_AUTO_EXECUTION_ENABLED: true,
    PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO: 0,
  });
  const system = createTradingSystem(config, () => now);
  const snapshot: MarketSnapshot = {
    mode: "paper",
    sequence: 1,
    marketTime: now.toISOString(),
    quotes: ["600001", "600002"].map((symbol) => ({
      symbol,
      name: symbol,
      tradable: true,
      price: 10,
      previousClose: 10,
      changePercent: 0,
      volume: 10_000_000,
      updatedAt: now.toISOString(),
    })),
  };
  vi.spyOn(system.market, "getSnapshot").mockReturnValue(snapshot);
  vi.spyOn(system.market, "getQuote").mockImplementation((symbol) =>
    snapshot.quotes.find((quote) => quote.symbol === symbol),
  );
  system.store.setStrategyProfile("growth");
  if (input.seedHolding) {
    expect(system.broker.submitOrder({
      symbol: "600001",
      side: "buy",
      type: "market",
      quantity: 800,
    }).status).toBe("filled");
  }

  // Supply a deterministic candidate to exercise the real executor and broker,
  // independently of whether today's research rules select this test symbol.
  const research = await paperPlans.buildCurrentPaperTradingPlan({ system, config, now });
  vi.spyOn(paperPlans, "buildCurrentPaperTradingPlan").mockResolvedValue({
    ...research,
    plan: {
      ...research.plan,
      capitalPlan: {
        ...research.plan.capitalPlan,
        cashReserveRatio: input.legacyPlanReserveRatio ?? 0,
      },
      operations: [{
        timestamp: now.toISOString(),
        symbol: "600002",
        name: "600002",
        action: "paper-buy-plan",
        strategy: "deterministic cash-policy fixture",
        quantity: 100,
        price: 10,
        estimatedNotional: 1_000,
        reason: "qualified paper test candidate",
        ruleChecks: ["paper-only", "cash-check: pass"],
      }],
    },
  });
  const executor = new PaperAutoExecutor({
    system,
    config,
    enabled: true,
    intervalMs: 60_000,
    tradeWindowOnly: true,
    maxOrdersPerRun: 2,
    maxDailyOrders: 4,
    targetDailyOrders: 2,
    clock: () => now,
  });
  const result = await executor.runOnce();
  return { result, account: system.broker.getAccount(), orders: system.broker.getOrders() };
}

describe("paper execution without fixed portfolio reserves", () => {
  it("can exceed the former 85% portfolio cap while preserving cash for fees and slippage", async () => {
    const { result, account } = await executeBuy({
      seedHolding: true,
      legacyPlanReserveRatio: 0.5,
    });

    expect(result.phaseMaxInvestedRatio).toBe(1);
    expect(result.submittedOrders).toEqual([
      expect.objectContaining({ symbol: "600002", status: "filled" }),
    ]);
    expect(account.marketValue / account.equity).toBeGreaterThan(0.85);
    expect(account.cash).toBeGreaterThanOrEqual(0);
    expect(account.cash).toBe(981);
  });

  it("does not create an order when cash cannot cover the slipped fill and commission", async () => {
    const { result, account, orders } = await executeBuy({ startingCash: 1_000 });

    expect(result.submittedOrders).toEqual([]);
    expect(result.skippedOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringContaining("累计订单后可用资金不足") }),
    ]));
    expect(orders).toEqual([]);
    expect(account.cash).toBe(1_000);
  });

  it("still rejects a buy that exceeds the hard single-stock limit", async () => {
    const { result, account } = await executeBuy({ maxPositionWeight: 0.05 });

    expect(result.submittedOrders).toEqual([
      expect.objectContaining({
        status: "rejected",
        rejectionReason: expect.stringContaining("单标的上限"),
      }),
    ]);
    expect(account.cash).toBe(10_000);
    expect(account.marketValue).toBe(0);
  });
});
