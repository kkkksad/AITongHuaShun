import { describe, expect, it } from "vitest";
import type { AccountSnapshot, MarketSnapshot, OrderRecord } from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import type { MarketRegimeResearchReport, StockRegime } from "./marketRegimeResearch";
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
      cash: 1_500,
      equity: 1_500,
      marketValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      riskUtilization: 0,
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
      strategyProfile: "growth",
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

  it("uses the market snapshot time for plan and operation timestamps", () => {
    const marketTime = "2026-07-16T16:30:00.000Z";
    const snapshot: MarketSnapshot = {
      mode: "paper",
      sequence: 1,
      marketTime,
      quotes: [],
    };
    const account: AccountSnapshot = {
      accountId: "PAPER-CN-01",
      mode: "paper",
      cash: 10_000,
      equity: 10_000,
      marketValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      riskUtilization: 0,
      paused: false,
      updatedAt: marketTime,
    };

    const plan = buildPaperTradingPlan({
      snapshot,
      provider: "akshare",
      account,
      positions: [],
      leaderboard: { entries: [] } as unknown as StrategyLeaderboardReport,
      candidates: { candidates: [] } as unknown as DailyCandidateReport,
      qualityStocks: { stocks: [] } as unknown as DailyQualityStockReport,
      initialCapital: 10_000,
      lotSize: 100,
      maxPositionWeight: 0.5,
      maxSingleOrderNotional: 2_000,
      commissionRate: 0.0003,
      minimumCommission: 5,
      cashReserveRatio: 0.1,
      strategyProfile: "balanced",
    });

    expect(plan.generatedAt).toBe(marketTime);
    expect(plan.tradingDate).toBe("2026-07-17");
    expect(plan.operations.every((operation) => operation.timestamp === marketTime)).toBe(true);
  });

  it("keeps capital preservation in cash even when candidates are available", () => {
    const marketTime = "2026-07-21T02:00:00.000Z";
    const snapshot: MarketSnapshot = {
      mode: "paper",
      sequence: 1,
      marketTime,
      quotes: [{
        symbol: "600010",
        name: "包钢股份",
        tradable: true,
        price: 2.1,
        previousClose: 2.08,
        changePercent: 0.96,
        volume: 30_000_000,
        amount: 63_000_000,
        turnover: 2,
        amplitude: 2.5,
        open: 2.08,
        high: 2.12,
        low: 2.06,
        updatedAt: marketTime,
      }],
    };
    const account: AccountSnapshot = {
      accountId: "PAPER-CN-01",
      mode: "paper",
      cash: 10_000,
      equity: 10_000,
      marketValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      riskUtilization: 0,
      paused: false,
      updatedAt: marketTime,
    };

    const plan = buildPaperTradingPlan({
      snapshot,
      provider: "akshare",
      account,
      positions: [],
      leaderboard: { entries: [] } as unknown as StrategyLeaderboardReport,
      candidates: { candidates: [] } as unknown as DailyCandidateReport,
      qualityStocks: {
        stocks: [{
          symbol: "600010",
          name: "包钢股份",
          price: 2.1,
          score: 96,
          action: "focus",
          reasons: ["流动性充足"],
        }],
      } as unknown as DailyQualityStockReport,
      initialCapital: 10_000,
      lotSize: 100,
      maxPositionWeight: 0.5,
      maxSingleOrderNotional: 5_000,
      commissionRate: 0.0003,
      minimumCommission: 5,
      cashReserveRatio: 0,
      strategyProfile: "capital-preservation",
    });

    expect(plan.strategyProfile.key).toBe("capital-preservation");
    expect(plan.strategyProfile.allowNewPositions).toBe(false);
    expect(plan.operations.some((operation) => operation.action === "paper-buy-plan")).toBe(false);
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "CASH",
        ruleChecks: expect.arrayContaining([
          "strategy-profile: blocked (capital-preservation)",
        ]),
      }),
    ]));
  });

  it("does not let growth override an adaptive market buy block", () => {
    const marketTime = "2026-07-21T02:00:00.000Z";
    const snapshot: MarketSnapshot = {
      mode: "paper",
      sequence: 1,
      marketTime,
      quotes: [],
    };
    const account: AccountSnapshot = {
      accountId: "PAPER-CN-01",
      mode: "paper",
      cash: 10_000,
      equity: 10_000,
      marketValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      riskUtilization: 0,
      paused: false,
      updatedAt: marketTime,
    };

    const plan = buildPaperTradingPlan({
      snapshot,
      provider: "akshare",
      account,
      positions: [],
      leaderboard: { entries: [] } as unknown as StrategyLeaderboardReport,
      candidates: { candidates: [] } as unknown as DailyCandidateReport,
      qualityStocks: { stocks: [] } as unknown as DailyQualityStockReport,
      adaptiveRouting: {
        allowNewPositions: false,
        cashReserveRatio: 0.75,
        newPositionScale: 0,
      } as unknown as NonNullable<Parameters<typeof buildPaperTradingPlan>[0]["adaptiveRouting"]>,
      initialCapital: 10_000,
      lotSize: 100,
      maxPositionWeight: 0.5,
      maxSingleOrderNotional: 5_000,
      commissionRate: 0.0003,
      minimumCommission: 5,
      cashReserveRatio: 0,
      strategyProfile: "growth",
    });

    expect(plan.strategyProfile.key).toBe("growth");
    expect(plan.strategyProfile.allowNewPositions).toBe(false);
    expect(plan.strategyProfile.effectiveCashReserveRatio).toBe(0.75);
    expect(plan.operations.some((operation) => operation.action === "paper-buy-plan")).toBe(false);
  });
});

function buildEntryDisciplinePlan(input: {
  price?: number;
  maxSingleOrderNotional?: number;
  stockRegime?: StockRegime | "missing";
  confidence?: number;
  orders?: OrderRecord[];
}) {
  const marketTime = "2026-07-21T02:00:00.000Z";
  const price = input.price ?? 10;
  const symbol = "600010";
  const snapshot: MarketSnapshot = {
    mode: "paper",
    sequence: 1,
    marketTime,
    quotes: [{
      symbol,
      name: "包钢股份",
      tradable: true,
      price,
      previousClose: price * 0.99,
      changePercent: 1.01,
      volume: 30_000_000,
      amount: price * 30_000_000,
      turnover: 2,
      amplitude: 2.5,
      open: price * 0.99,
      high: price * 1.01,
      low: price * 0.98,
      updatedAt: marketTime,
    }],
  };
  const account: AccountSnapshot = {
    accountId: "PAPER-CN-01",
    mode: "paper",
    cash: 10_000,
    equity: 10_000,
    marketValue: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    dailyPnl: 0,
    dailyPnlPercent: 0,
    riskUtilization: 0,
    paused: false,
    updatedAt: marketTime,
  };
  const marketRegimeResearch = input.stockRegime === undefined
    ? undefined
    : {
        sourceStatus: "live-read-only",
        stockRegimes: input.stockRegime === "missing"
          ? []
          : [{
              symbol,
              name: "包钢股份",
              regime: input.stockRegime,
              confidence: input.confidence ?? 0.72,
              validation: {
                samples: 28,
                hitRate5d: 0.61,
                averageForwardReturn5d: 0.02,
              },
            }],
      } as unknown as MarketRegimeResearchReport | undefined;

  return buildPaperTradingPlan({
    snapshot,
    provider: "akshare",
    account,
    positions: [],
    orders: input.orders ?? [],
    leaderboard: { entries: [] } as unknown as StrategyLeaderboardReport,
    candidates: { candidates: [] } as unknown as DailyCandidateReport,
    qualityStocks: {
      stocks: [{
        symbol,
        name: "包钢股份",
        price,
        score: 96,
        action: "focus",
        reasons: ["流动性充足", "日内承接较强"],
      }],
    } as unknown as DailyQualityStockReport,
    marketRegimeResearch,
    initialCapital: 10_000,
    lotSize: 100,
    maxPositionWeight: 0.5,
    maxSingleOrderNotional: input.maxSingleOrderNotional ?? 2_000,
    commissionRate: 0.0003,
    minimumCommission: 5,
    cashReserveRatio: 0,
    strategyProfile: "growth",
  });
}

describe("buildPaperTradingPlan entry discipline", () => {
  it.each(["trend-deterioration", "unclear", "insufficient-data", "missing"] as const)(
    "blocks new positions when historical persistence is %s",
    (stockRegime) => {
      const plan = buildEntryDisciplinePlan({ stockRegime });

      expect(plan.operations.some((operation) => operation.action === "paper-buy-plan")).toBe(false);
      expect(plan.operations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          symbol: "600010",
          action: "blocked",
          ruleChecks: expect.arrayContaining([
            expect.stringContaining("entry-persistence: blocked"),
          ]),
        }),
      ]));
    },
  );

  it("allows a fee-efficient candidate with a confirmed healthy trend", () => {
    const plan = buildEntryDisciplinePlan({ stockRegime: "healthy-trend" });

    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "600010",
        action: "paper-buy-plan",
        ruleChecks: expect.arrayContaining([
          expect.stringContaining("entry-persistence: pass (healthy-trend"),
          expect.stringContaining("round-trip-fee-ratio: pass"),
        ]),
      }),
    ]));
  });

  it("blocks the small BaoSteel order when minimum round-trip fees dominate", () => {
    const plan = buildEntryDisciplinePlan({
      price: 2.15,
      maxSingleOrderNotional: 300,
      stockRegime: "healthy-trend",
    });

    expect(plan.operations.some((operation) => operation.action === "paper-buy-plan")).toBe(false);
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "600010",
        action: "blocked",
        reason: expect.stringContaining("往返最低手续费"),
        ruleChecks: expect.arrayContaining([
          expect.stringContaining("round-trip-fee-ratio: blocked"),
        ]),
      }),
    ]));
  });

  it("does not buy back a symbol sold by auto execution on the same day", () => {
    const soldToday: OrderRecord = {
      id: "sold-today",
      symbol: "600010",
      name: "包钢股份",
      side: "sell",
      type: "market",
      quantity: 100,
      status: "filled",
      requestedPrice: 10,
      filledPrice: 10,
      filledQuantity: 100,
      notional: 1_000,
      commission: 5,
      clientOrderId: "kairos-auto-paper:2026-07-21:600010:paper-sell-plan:100",
      createdAt: "2026-07-21T01:40:00.000Z",
      updatedAt: "2026-07-21T01:40:00.000Z",
    };
    const plan = buildEntryDisciplinePlan({
      stockRegime: "healthy-trend",
      orders: [soldToday],
    });

    expect(plan.operations.some((operation) => operation.action === "paper-buy-plan")).toBe(false);
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "600010",
        action: "blocked",
        ruleChecks: expect.arrayContaining(["same-day-reentry: blocked"]),
      }),
    ]));
  });
});
