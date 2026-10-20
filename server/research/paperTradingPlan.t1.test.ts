import { describe, expect, it } from "vitest";
import type {
  AccountSnapshot,
  MarketSnapshot,
  PositionSnapshot,
} from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import { buildPaperTradingPlan } from "./paperTradingPlan";
import type { StrategyLeaderboardReport } from "./strategyLeaderboard";

function buildT1Plan(
  positionInput: Pick<
    PositionSnapshot,
    "quantity" | "t1LockedQuantity" | "availableQuantity"
  >,
) {
  const marketTime = "2026-07-21T02:00:00.000Z";
  const snapshot: MarketSnapshot = {
    mode: "paper",
    sequence: 1,
    marketTime,
    quotes: [{
      symbol: "600010",
      name: "包钢股份",
      tradable: true,
      price: 9,
      previousClose: 9,
      changePercent: 0,
      volume: 20_000_000,
      amount: 180_000_000,
      updatedAt: marketTime,
    }],
  };
  const account: AccountSnapshot = {
    accountId: "PAPER-CN-01",
    mode: "paper",
    cash: 1_000,
    equity: 10_000,
    marketValue: 9_000,
    unrealizedPnl: -3_000,
    realizedPnl: 0,
    dailyPnl: -3_000,
    dailyPnlPercent: -0.3,
    riskUtilization: 0.9,
    paused: false,
    updatedAt: marketTime,
  };
  const position: PositionSnapshot = {
    symbol: "600010",
    name: "包钢股份",
    quantity: positionInput.quantity,
    availableQuantity: positionInput.availableQuantity,
    t1LockedQuantity: positionInput.t1LockedQuantity,
    averagePrice: 12,
    currentPrice: 9,
    marketValue: 9_000,
    unrealizedPnl: -3_000,
    realizedPnl: 0,
    weight: 0.9,
  };

  return buildPaperTradingPlan({
    snapshot,
    provider: "akshare",
    account,
    positions: [position],
    leaderboard: { entries: [] } as unknown as StrategyLeaderboardReport,
    candidates: { candidates: [] } as unknown as DailyCandidateReport,
    qualityStocks: { stocks: [] } as unknown as DailyQualityStockReport,
    initialCapital: 10_000,
    lotSize: 100,
    maxPositionWeight: 0.5,
    maxSingleOrderNotional: 2_000,
    commissionRate: 0.0003,
    minimumCommission: 5,
    cashReserveRatio: 0,
    strategyProfile: "growth",
  });
}

describe("buildPaperTradingPlan T+1 compatibility", () => {
  it("derives sellable quantity from quantity minus t1 lock when availableQuantity is missing", () => {
    const plan = buildT1Plan({
      quantity: 1_000,
      t1LockedQuantity: 500,
      availableQuantity: undefined,
    });

    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "600010",
        action: "paper-sell-plan",
        quantity: 500,
        ruleChecks: expect.arrayContaining(["T+1: pass"]),
      }),
    ]));
  });

  it("blocks a hard stop when all shares are T+1 locked and availableQuantity is missing", () => {
    const plan = buildT1Plan({
      quantity: 1_000,
      t1LockedQuantity: 1_000,
      availableQuantity: undefined,
    });

    expect(plan.operations.some((operation) => operation.action === "paper-sell-plan")).toBe(false);
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "blocked",
        quantity: 1_000,
        ruleChecks: expect.arrayContaining(["T+1: blocked"]),
      }),
    ]));
  });

  it("keeps an explicit zero available quantity locked even when a lock field is absent", () => {
    const plan = buildT1Plan({
      quantity: 1_000,
      t1LockedQuantity: undefined,
      availableQuantity: 0,
    });

    expect(plan.operations.some((operation) => operation.action === "paper-sell-plan")).toBe(false);
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "CASH",
      }),
    ]));
  });
});