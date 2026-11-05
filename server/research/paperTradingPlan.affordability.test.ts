import { describe, expect, it } from "vitest";
import type { AccountSnapshot, MarketSnapshot } from "../../shared/trading";
import type { AdaptiveStrategyRouting } from "./adaptiveStrategyRouter";
import type { MarketRegimeResearchReport } from "./marketRegimeResearch";
import { buildPaperTradingPlan } from "./paperTradingPlan";

type PlanInput = Parameters<typeof buildPaperTradingPlan>[0];

function plan(input: {
  price?: number;
  cash?: number;
  equity?: number;
  emptyPool?: boolean;
  quoteTradable?: boolean;
  overrides?: Partial<PlanInput>;
} = {}) {
  const price = input.price ?? 52.1;
  const cash = input.cash ?? 20_000;
  const equity = input.equity ?? cash;
  const marketTime = "2026-11-05T02:00:00.000Z";
  const snapshot: MarketSnapshot = {
    mode: "paper", sequence: 1, marketTime,
    quotes: [{
      symbol: "601318", name: "金额说明样本", tradable: input.quoteTradable ?? true,
      price, previousClose: price * 0.99, changePercent: 1.01,
      volume: 30_000_000, amount: price * 30_000_000,
      turnover: 2, amplitude: 2.5,
      open: price * 0.99, high: price * 1.01, low: price * 0.98, updatedAt: marketTime,
    }],
  };
  const account: AccountSnapshot = {
    accountId: "PAPER-AFFORDABILITY", mode: "paper", cash, equity,
    marketValue: Math.max(0, equity - cash), unrealizedPnl: 0, realizedPnl: 0,
    dailyPnl: 0, dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: marketTime,
  };
  return buildPaperTradingPlan({
    snapshot, provider: "mock", account, positions: [],
    leaderboard: { entries: [] } as unknown as PlanInput["leaderboard"],
    candidates: { candidates: [] } as unknown as PlanInput["candidates"],
    qualityStocks: { stocks: input.emptyPool ? [] : [{
      symbol: "601318", name: "金额说明样本", price, score: 96,
      action: "focus", reasons: ["金额说明样本"],
    }] } as unknown as PlanInput["qualityStocks"],
    initialCapital: equity, lotSize: 100, maxPositionWeight: 0.25,
    maxSingleOrderNotional: 100_000, commissionRate: 0.0003,
    minimumCommission: 5, cashReserveRatio: 0, strategyProfile: "growth",
    ...input.overrides,
  });
}

function buySet(result: ReturnType<typeof plan>) {
  return result.operations.filter((operation) => operation.action === "paper-buy-plan")
    .map(({ symbol, quantity, price, estimatedNotional, strategyKey }) => ({
      symbol, quantity, price, estimatedNotional, strategyKey,
    }));
}

function route(overrides: Partial<AdaptiveStrategyRouting> = {}): AdaptiveStrategyRouting {
  return {
    regime: "range-high-volatility", allowNewPositions: true, newPositionScale: 1,
    eligibleStrategyKeys: ["kairosQualifiedProbe"],
    strategyPlaybook: { primaryStrategyKeys: ["kairosQualifiedProbe"] },
    ...overrides,
  } as AdaptiveStrategyRouting;
}

const healthyHistory = {
  stockRegimes: [{
    symbol: "601318", regime: "healthy-trend", confidence: 0.72, barCount: 180,
    features: {
      return5d: 0.015, return20d: 0.04, return60d: 0.08,
      distanceFromMa20: 0.01, distanceFromMa60: 0.04,
      ma20Slope5d: 0.01, ma60Slope5d: 0.01,
      pullbackFrom20DayHigh: 0.035, volumeRatio: 0.88,
    },
    validation: { samples: 28, hitRate5d: 0.61, averageForwardReturn5d: 0.02 },
  }],
} as unknown as MarketRegimeResearchReport;

describe("Paper plan affordability explanations preserve the buy set", () => {
  it.each(["auto", "movingAverageCross"] as const)(
    "does not call 20000 cash insufficient when a 5000 cap is below a 5210 lot (%s)",
    (executionStrategy) => {
      const result = plan({ overrides: { executionStrategy } });
      const observe = result.operations.find((operation) => operation.symbol === "CASH")!;
      expect(result.account.cash).toBe(20_000);
      expect(result.capitalPlan.maxSingleOrderNotional).toBe(5_000);
      expect(result.qualitySummary.affordableCandidateCount).toBe(0);
      expect(observe.ruleChecks).toContain("plan-sizing-constrained");
      expect(observe.ruleChecks).not.toContain("cash-constrained");
      expect(observe.reason).toContain("金额上限");
      expect(observe.reason).not.toContain("现金不足");
      expect(buySet(result)).toEqual([]);
    },
  );

  it.each(["auto", "movingAverageCross"] as const)(
    "retains the true cash shortage when 784 cannot pay 780 plus five commission (%s)",
    (executionStrategy) => {
      const result = plan({ price: 7.8, cash: 784, overrides: { maxPositionWeight: 1, executionStrategy } });
      expect(result.operations[0].ruleChecks).toContain("cash-constrained");
      expect(result.operations[0].ruleChecks).not.toContain("plan-sizing-constrained");
      expect(result.operations[0].reason).toContain("现金不足");
      expect(buySet(result)).toEqual([]);
    },
  );

  it.each([
    { name: "single order cap", overrides: { maxPositionWeight: 1, maxSingleOrderNotional: 5_000 } },
    { name: "profile scale", overrides: { maxPositionWeight: 1, maxSingleOrderNotional: 9_000, strategyProfile: "defensive" as const } },
    { name: "route scale", overrides: { maxPositionWeight: 1, maxSingleOrderNotional: 10_000, adaptiveRouting: route({ newPositionScale: 0.5 }) } },
    { name: "explicit plan reserve", overrides: { maxPositionWeight: 1, cashReserveRatio: 0.99 } },
  ])("attributes $name to this plan's amount constraints", ({ overrides }) => {
    const result = plan({ overrides });
    expect(result.account.cash).toBeGreaterThan(5_215);
    expect(result.operations[0].ruleChecks).toContain("plan-sizing-constrained");
    expect(result.operations[0].reason).not.toContain("现金不足");
    expect(buySet(result)).toEqual([]);
  });

  it("keeps validation fee efficiency distinct from actual cash affordability", () => {
    const result = plan({ price: 7.8, overrides: {
      maxPositionWeight: 1, maxSingleOrderNotional: 1_500,
      executionStrategy: "kairosQualifiedProbe", adaptiveRouting: route(),
      marketRegimeResearch: healthyHistory,
    } });
    expect(result.executionStrategy.selectedStrategyMatched).toBe(true);
    expect(result.qualitySummary.affordableCandidateCount).toBe(0);
    expect(result.account.cash).toBe(20_000);
    expect(result.operations[0].reason).toContain("费用效率");
    expect(result.operations[0].reason).not.toContain("现金不足");
    expect(result.operations[0].ruleChecks).toContain("plan-sizing-constrained");
    expect(buySet(result)).toEqual([]);
  });

  it("keeps sufficient-money candidates blocked by their actual unmatched strategy", () => {
    const result = plan({ price: 7.8, overrides: { executionStrategy: "movingAverageCross" } });
    expect(result.qualitySummary.affordableCandidateCount).toBe(1);
    expect(result.operations[0].ruleChecks).toContain("strategy-route: blocked (no-qualified-signal)");
    expect(result.operations.some((operation) => operation.ruleChecks.includes("cash-constrained"))).toBe(false);
    expect(buySet(result)).toEqual([]);
  });

  it("keeps an empty candidate pool distinct from a cash shortage", () => {
    const result = plan({ emptyPool: true });
    expect(result.qualitySummary.candidatePoolSize).toBe(0);
    expect(result.operations[0].ruleChecks).not.toContain("cash-constrained");
    expect(result.operations[0].ruleChecks).not.toContain("plan-sizing-constrained");
    expect(buySet(result)).toEqual([]);
  });

  it("retains the ordinary 600-share buy and its reserved commission", () => {
    const result = plan({ price: 7.8 });
    expect(buySet(result)).toEqual([{
      symbol: "601318", quantity: 600, price: 7.8,
      estimatedNotional: 4_680, strategyKey: "snapshot-candidate",
    }]);
    expect(result.operations[0].ruleChecks).toContain("cash-reservation: pass (4685.00)");
  });

  it("retains the same buy for an eligible fixed strategy", () => {
    const result = plan({ price: 7.8, overrides: {
      executionStrategy: "movingAverageCross", adaptiveRouting: route(),
      marketRegimeResearch: healthyHistory,
    } });
    expect(buySet(result)).toEqual([{
      symbol: "601318", quantity: 600, price: 7.8,
      estimatedNotional: 4_680, strategyKey: "movingAverageCross",
    }]);
    expect(result.operations[0].ruleChecks).toContain("cash-reservation: pass (4685.00)");
  });
});
