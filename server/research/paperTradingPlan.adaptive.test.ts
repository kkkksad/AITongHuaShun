import { describe, expect, it } from "vitest";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  PositionSnapshot,
} from "../../shared/trading";
import type { AdaptiveStrategyRouting } from "./adaptiveStrategyRouter";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import type { MarketRegimeResearchReport, StockRegime } from "./marketRegimeResearch";
import { buildPaperTradingPlan } from "./paperTradingPlan";
import type { StrategyLeaderboardReport } from "./strategyLeaderboard";

const snapshot: MarketSnapshot = {
  mode: "paper",
  sequence: 1,
  marketTime: "2026-07-15T02:00:00.000Z",
  quotes: [
    {
      symbol: "600519",
      name: "测试持仓",
      tradable: true,
      price: 10,
      previousClose: 10,
      changePercent: 0,
      volume: 10_000_000,
      amount: 100_000_000,
      turnover: 2,
      amplitude: 3,
      open: 10,
      high: 10.2,
      low: 9.8,
      updatedAt: "2026-07-15T02:00:00.000Z",
    },
    {
      symbol: "601988",
      name: "低价候选",
      tradable: true,
      price: 5,
      previousClose: 4.95,
      changePercent: 1,
      volume: 20_000_000,
      amount: 100_000_000,
      turnover: 1.5,
      amplitude: 2.5,
      open: 4.95,
      high: 5.05,
      low: 4.92,
      updatedAt: "2026-07-15T02:00:00.000Z",
    },
  ],
};

function account(cash = 412): AccountSnapshot {
  return {
    accountId: "PAPER-CN-01",
    mode: "paper",
    cash,
    equity: 10_000,
    marketValue: 10_000 - cash,
    unrealizedPnl: 30,
    realizedPnl: 0,
    dailyPnl: 0,
    dailyPnlPercent: 0,
    riskUtilization: (10_000 - cash) / 10_000,
    paused: false,
    updatedAt: snapshot.marketTime,
  };
}

function position(): PositionSnapshot {
  return {
    symbol: "600519",
    name: "测试持仓",
    quantity: 300,
    availableQuantity: 300,
    t1LockedQuantity: 0,
    averagePrice: 9.9,
    currentPrice: 10,
    marketValue: 3_000,
    unrealizedPnl: 30,
    realizedPnl: 0,
    weight: 0.3,
  };
}

function autoSellOrder(quantity = 100): OrderRecord {
  return {
    id: "today-auto-sell",
    symbol: "600519",
    side: "sell",
    type: "market",
    quantity,
    status: "filled",
    requestedPrice: 10,
    filledPrice: 10,
    filledQuantity: quantity,
    notional: quantity * 10,
    commission: 5,
    clientOrderId: `kairos-auto-paper:2026-07-15:600519:paper-sell-plan:${quantity}`,
    createdAt: "2026-07-15T01:35:00.000Z",
    updatedAt: "2026-07-15T01:35:00.000Z",
  };
}

function routing(
  overrides: Partial<AdaptiveStrategyRouting> = {},
): AdaptiveStrategyRouting {
  return {
    version: "1.3.0",
    generatedAt: snapshot.marketTime,
    regime: "trend-up-low-volatility",
    confidence: 0.72,
    positionPosture: "accumulate",
    allowNewPositions: true,
    cashReserveRatio: 0.1,
    newPositionScale: 1,
    eligibleStrategyKeys: ["momentum", "kairosTrendHealth"],
    disabledStrategyKeys: ["rsi"],
    strategyPlaybook: {
      primaryStrategyKeys: ["kairosLowVolTrend", "kairosTrendHealth"],
      useWhen: "趋势和宽度确认",
      avoidWhen: "趋势转弱",
      recheckTriggers: ["宽度转弱"],
    },
    capitalPacing: {
      openingMaxInvestedRatio: 0.55,
      morningMaxInvestedRatio: 0.7,
      afternoonMaxInvestedRatio: 0.82,
      closingMaxInvestedRatio: 0.9,
    },
    stability: {
      status: "direct",
      observedRegime: "trend-up-low-volatility",
      previousConfirmedRegime: null,
      previousConfirmedAt: null,
      rationale: "test fixture",
    },
    evidence: ["趋势向上"],
    riskFlags: [],
    metrics: {
      constructiveSectorRatio: 0.7,
      cautiousSectorRatio: 0.1,
      averageReturn20d: 0.08,
      averageReturn60d: 0.15,
      averageMa20Slope5d: 0.02,
      averageVolatility20d: 0.22,
      averageBreadthRatio: 0.65,
      averageCurrentChangePercent: 1.2,
      healthyStockRatio: 0.6,
      deterioratingStockRatio: 0.1,
    },
    ...overrides,
  };
}

function marketRegime(
  stockRegime: StockRegime,
  confidence = 0.72,
): MarketRegimeResearchReport {
  return {
    sourceStatus: "live-read-only",
    stockRegimes: [
      {
        symbol: "600519",
        name: "测试持仓",
        regime: stockRegime,
        confidence,
      },
    ],
  } as unknown as MarketRegimeResearchReport;
}

function leaderboard(): StrategyLeaderboardReport {
  return {
    entries: [
      {
        rank: 1,
        strategyKey: "momentum",
        strategyName: "动量策略",
        trialCount: 10,
        bestParams: {},
        metrics: { winRate: 0.7, totalTrades: 20 },
        qualityGate: "pass",
      },
      {
        rank: 2,
        strategyKey: "kairosCapitalShield",
        strategyName: "资金盾牌",
        trialCount: 8,
        bestParams: {},
        metrics: { winRate: 0.55, totalTrades: 18 },
        qualityGate: "pass",
      },
    ],
  } as unknown as StrategyLeaderboardReport;
}

function candidates(): DailyCandidateReport {
  return {
    strategyName: "强势回踩",
    candidates: [],
  } as unknown as DailyCandidateReport;
}

function qualityStocks(includeCandidate = false): DailyQualityStockReport {
  return {
    stocks: includeCandidate
      ? [{
          symbol: "601988",
          name: "低价候选",
          price: 5,
          score: 90,
          action: "focus",
          reasons: ["流动性充足"],
        }]
      : [],
  } as unknown as DailyQualityStockReport;
}

function build(input: {
  positions?: PositionSnapshot[];
  adaptiveRouting?: AdaptiveStrategyRouting;
  research?: MarketRegimeResearchReport;
  includeCandidate?: boolean;
  orders?: OrderRecord[];
}) {
  return buildPaperTradingPlan({
    snapshot,
    provider: "akshare",
    account: account(),
    positions: input.positions ?? [],
    orders: input.orders ?? [],
    leaderboard: leaderboard(),
    candidates: candidates(),
    qualityStocks: qualityStocks(input.includeCandidate),
    adaptiveRouting: input.adaptiveRouting ?? routing(),
    marketRegimeResearch: input.research ?? marketRegime("healthy-trend"),
    initialCapital: 10_000,
    lotSize: 100,
    maxPositionWeight: 0.35,
    maxSingleOrderNotional: 3_500,
    commissionRate: 0.0003,
    minimumCommission: 5,
    cashReserveRatio: 0.1,
  });
}

describe("adaptive paper trading plan", () => {
  it("reduces half of an available position when real history shows deterioration", () => {
    const plan = build({
      positions: [position()],
      adaptiveRouting: routing({
        regime: "risk-off",
        positionPosture: "reduce",
        allowNewPositions: false,
        cashReserveRatio: 0.55,
        newPositionScale: 0,
        eligibleStrategyKeys: ["kairosCapitalShield"],
      }),
      research: marketRegime("trend-deterioration", 0.75),
    });

    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "600519",
        action: "paper-sell-plan",
        quantity: 100,
        strategy: "市场状态减仓",
      }),
    ]));
  });

  it("limits ordinary adaptive reduction to once per symbol per trading day", () => {
    const plan = build({
      positions: [position()],
      orders: [autoSellOrder()],
      adaptiveRouting: routing({
        regime: "risk-off",
        positionPosture: "reduce",
        allowNewPositions: false,
        cashReserveRatio: 0.55,
        newPositionScale: 0,
        eligibleStrategyKeys: ["kairosCapitalShield"],
      }),
      research: marketRegime("trend-deterioration", 0.75),
    });

    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "600519",
        action: "hold",
        ruleChecks: expect.arrayContaining(["daily-reduction-limit"]),
      }),
    ]));
    expect(plan.operations.some((operation) =>
      operation.symbol === "600519" && operation.action === "paper-sell-plan"
    )).toBe(false);
  });

  it("allows the hard stop to override the daily adaptive reduction limit", () => {
    const losingPosition = {
      ...position(),
      currentPrice: 9,
      marketValue: 2_700,
      unrealizedPnl: -270,
    };
    const plan = build({
      positions: [losingPosition],
      orders: [autoSellOrder()],
      adaptiveRouting: routing({
        regime: "risk-off",
        positionPosture: "reduce",
        allowNewPositions: false,
        cashReserveRatio: 0.55,
        newPositionScale: 0,
      }),
      research: marketRegime("trend-deterioration", 0.75),
    });

    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "600519",
        action: "paper-sell-plan",
        strategy: "回撤控制",
        quantity: 300,
      }),
    ]));
  });

  it("stages one-lot exposure reduction for an unclear holding in risk-off", () => {
    const plan = build({
      positions: [position()],
      adaptiveRouting: routing({
        regime: "risk-off",
        positionPosture: "reduce",
        allowNewPositions: false,
        cashReserveRatio: 0.55,
        newPositionScale: 0,
        eligibleStrategyKeys: ["kairosCapitalShield"],
      }),
      research: marketRegime("unclear", 0.4),
    });

    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "600519",
        action: "paper-sell-plan",
        strategy: "风险仓位再平衡",
        quantity: 100,
        ruleChecks: expect.arrayContaining(["risk-off-target"]),
      }),
    ]));
  });

  it.each(["healthy-trend", "washout-candidate"] as const)(
    "does not sell a %s holding only to satisfy the broad risk-off target",
    (stockRegime) => {
      const plan = build({
        positions: [position()],
        adaptiveRouting: routing({
          regime: "risk-off",
          positionPosture: "reduce",
          allowNewPositions: false,
          cashReserveRatio: 0.55,
          newPositionScale: 0,
          eligibleStrategyKeys: ["kairosCapitalShield"],
        }),
        research: marketRegime(stockRegime, 0.75),
      });

      expect(plan.operations.some((operation) =>
        operation.symbol === "600519" && operation.action === "paper-sell-plan"
      )).toBe(false);
    },
  );

  it("holds an intact washout candidate instead of selling it", () => {
    const plan = build({
      positions: [position()],
      adaptiveRouting: routing({ positionPosture: "hold" }),
      research: marketRegime("washout-candidate", 0.7),
    });

    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "600519",
        action: "hold",
        reason: expect.stringContaining("洗盘候选"),
      }),
    ]));
    expect(plan.operations.some((operation) =>
      operation.symbol === "600519" && operation.action === "paper-sell-plan"
    )).toBe(false);
  });

  it("returns cash observation instead of repeated blocked buys when no lot is affordable", () => {
    const plan = build({ includeCandidate: true });

    expect(plan.qualitySummary.affordableCandidateCount).toBe(0);
    expect(plan.qualitySummary.planQuality).toBe("watch-only");
    expect(plan.operations.filter((operation) => operation.action === "blocked")).toEqual([]);
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: "CASH",
        action: "observe",
        reason: expect.stringContaining("可用现金"),
      }),
    ]));
  });

  it("selects the highest ranked strategy eligible for the current market state", () => {
    const plan = build({
      adaptiveRouting: routing({
        regime: "risk-off",
        positionPosture: "reduce",
        allowNewPositions: false,
        cashReserveRatio: 0.55,
        newPositionScale: 0,
        eligibleStrategyKeys: ["kairosCapitalShield"],
      }),
    });

    expect(plan.topStrategy).toMatchObject({
      strategyKey: "kairosCapitalShield",
      strategyName: "资金盾牌",
    });
  });
});
