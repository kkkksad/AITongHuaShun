import { describe, expect, it } from "vitest";
import type { AccountSnapshot, MarketSnapshot } from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import { buildPaperTradingPlan } from "./paperTradingPlan";
import type { StrategyLeaderboardReport } from "./strategyLeaderboard";

describe("buildPaperTradingPlan cash reservation", () => {
  it("does not let multiple buy plans reuse the same cash", () => {
    const snapshot: MarketSnapshot = {
      mode: "paper",
      sequence: 1,
      marketTime: "2026-07-14T01:33:00.000Z",
      quotes: [
        {
          symbol: "600010",
          name: "包钢股份",
          tradable: true,
          price: 2.12,
          previousClose: 2.1,
          changePercent: 0.95,
          volume: 20_000_000,
          amount: 42_400_000,
          turnover: 2.1,
          amplitude: 2.8,
          open: 2.1,
          high: 2.14,
          low: 2.08,
          updatedAt: "2026-07-14T01:33:00.000Z",
        },
        {
          symbol: "601988",
          name: "中国银行",
          tradable: true,
          price: 5.88,
          previousClose: 5.84,
          changePercent: 0.68,
          volume: 20_000_000,
          amount: 117_600_000,
          turnover: 1.2,
          amplitude: 2.2,
          open: 5.84,
          high: 5.9,
          low: 5.8,
          updatedAt: "2026-07-14T01:33:00.000Z",
        },
      ],
    };
    const account: AccountSnapshot = {
      accountId: "PAPER-CN-01",
      mode: "paper",
      cash: 1_265,
      equity: 10_000,
      marketValue: 8_735,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      riskUtilization: 0.87,
      paused: false,
      updatedAt: snapshot.marketTime,
    };
    const leaderboard = {
      entries: [],
    } as unknown as StrategyLeaderboardReport;
    const candidates = {
      strategyName: "A股强势回踩确认",
      candidates: [],
    } as unknown as DailyCandidateReport;
    const qualityStocks = {
      stocks: [
        {
          symbol: "600010",
          name: "包钢股份",
          price: 2.12,
          score: 90,
          action: "focus",
          reasons: ["流动性充足", "波动受控"],
        },
        {
          symbol: "601988",
          name: "中国银行",
          price: 5.88,
          score: 90,
          action: "focus",
          reasons: ["流动性充足", "波动受控"],
        },
      ],
    } as unknown as DailyQualityStockReport;

    const plan = buildPaperTradingPlan({
      snapshot,
      provider: "akshare",
      account,
      positions: [],
      leaderboard,
      candidates,
      qualityStocks,
      initialCapital: 10_000,
      lotSize: 100,
      maxPositionWeight: 1,
      maxSingleOrderNotional: 6_000,
      commissionRate: 0.0003,
      minimumCommission: 5,
      cashReserveRatio: 0,
    });

    const buyPlans = plan.operations.filter(
      (operation) => operation.action === "paper-buy-plan",
    );
    const requiredCash = buyPlans.reduce(
      (total, operation) => total + operation.estimatedNotional + 5,
      0,
    );

    expect(buyPlans).toHaveLength(1);
    expect(buyPlans[0].symbol).toBe("600010");
    expect(requiredCash).toBeLessThanOrEqual(account.cash);
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "601988",
        action: "blocked",
        ruleChecks: expect.arrayContaining(["cash-reservation: blocked"]),
      }),
    ]));
  });
});
