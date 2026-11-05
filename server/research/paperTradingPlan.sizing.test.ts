import { describe, expect, it } from "vitest";
import type { AccountSnapshot, MarketSnapshot } from "../../shared/trading";
import type { AdaptiveStrategyRouting } from "./adaptiveStrategyRouter";
import { buildPaperTradingPlan } from "./paperTradingPlan";

function plan(overrides: Partial<Parameters<typeof buildPaperTradingPlan>[0]> = {}) {
  const marketTime = "2026-11-05T02:00:00.000Z";
  const snapshot: MarketSnapshot = {
    mode: "paper", sequence: 1, marketTime,
    quotes: [{
      symbol: "600010", name: "规模诊断样本", tradable: true,
      price: 7.8, previousClose: 7.7, changePercent: 1.3,
      volume: 30_000_000, amount: 234_000_000, turnover: 2,
      amplitude: 2.5, open: 7.7, high: 7.9, low: 7.6, updatedAt: marketTime,
    }],
  };
  const account: AccountSnapshot = {
    accountId: "PAPER-SIZING", mode: "paper", cash: 10_000, equity: 10_000,
    marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
    dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: marketTime,
  };
  return buildPaperTradingPlan({
    snapshot, provider: "mock", account, positions: [],
    leaderboard: { entries: [] } as unknown as Parameters<typeof buildPaperTradingPlan>[0]["leaderboard"],
    candidates: { candidates: [] } as unknown as Parameters<typeof buildPaperTradingPlan>[0]["candidates"],
    qualityStocks: { stocks: [{ symbol: "600010", name: "规模诊断样本", price: 7.8, score: 96, action: "focus", reasons: ["流动性充足"] }] } as unknown as Parameters<typeof buildPaperTradingPlan>[0]["qualityStocks"],
    initialCapital: 10_000, lotSize: 100, maxPositionWeight: 0.5,
    maxSingleOrderNotional: 4_000, commissionRate: 0.0003,
    minimumCommission: 5, cashReserveRatio: 0, strategyProfile: "growth",
    ...overrides,
  });
}

function route(scale: number): AdaptiveStrategyRouting {
  return {
    newPositionScale: scale,
    allowNewPositions: scale > 0,
    eligibleStrategyKeys: [],
    regime: "trend-up-high-volatility",
  } as unknown as AdaptiveStrategyRouting;
}

describe("paper sizing explanations preserve order economics", () => {
  it.each([
    ["growth", 0.5, 1, 2_000, 2_500, "市场路由缩放"],
    ["defensive", 1, 0.55, 2_200, 2_750, "策略档位缩放"],
    ["balanced", 0.85, 0.85, 3_400, 4_250, "策略档位与市场路由共同缩放"],
  ] as const)("attributes %s with route %s without changing limits", (profile, routeScale, profileScale, orderCap, positionCap, label) => {
    const result = plan({ strategyProfile: profile, adaptiveRouting: route(routeScale) });
    expect(result.capitalPlan.sizingDiagnostics).toMatchObject({
      profileNewPositionScale: profileScale,
      riskOrderCapBeforeScale: 4_000,
      riskOrderCapAfterScale: orderCap,
      positionWeightCapAfterScale: positionCap,
      effectiveOrderCap: orderCap,
      limitingConstraint: "strategy-profile-scale",
      limitingConstraintLabel: label,
    });
    expect(result.strategyProfile.effectiveNewPositionScale).toBe(Math.min(routeScale, profileScale));
    expect(result.capitalPlan.sizingDiagnostics?.summary).toContain(label);
  });

  it("shows full profile scaling for a manual strategy while ignoring route scaling", () => {
    const result = plan({ executionStrategy: "movingAverageCross", adaptiveRouting: route(0.25) });
    expect(result.capitalPlan.sizingDiagnostics).toMatchObject({
      profileNewPositionScale: 1, riskOrderCapAfterScale: 4_000,
      positionWeightCapAfterScale: 5_000, effectiveOrderCap: 4_000,
      limitingConstraintLabel: "服务端单笔风控上限",
    });
    expect(result.strategyProfile.effectiveNewPositionScale).toBe(1);
  });

  it("keeps the ordinary candidate at 200 shares, 1560 notional and five commission", () => {
    const result = plan({ adaptiveRouting: route(0.5) });
    const buy = result.operations.find((operation) => operation.action === "paper-buy-plan");
    expect(buy).toMatchObject({ quantity: 200, price: 7.8, estimatedNotional: 1_560 });
    expect(buy?.ruleChecks).toContain("cash-reservation: pass (1565.00)");
    expect(result.capitalPlan.sizingDiagnostics).toMatchObject({ effectiveOrderCap: 2_000, minimumFeeEfficientNotional: 1_000, plannedBuyNotional: 1_560 });
  });

  it("keeps cash and single-stock limits distinct from scaling", () => {
    const baseline = plan();
    const cashLimited = plan({ account: { ...baseline.account, mode: "paper", cash: 1_700 } as AccountSnapshot, adaptiveRouting: route(0.5) });
    expect(cashLimited.capitalPlan.sizingDiagnostics).toMatchObject({ effectiveOrderCap: 1_700, limitingConstraint: "planned-cash-budget" });
    expect(cashLimited.operations.find((operation) => operation.action === "paper-buy-plan")).toMatchObject({ quantity: 200, estimatedNotional: 1_560 });
    const stockLimited = plan({ maxPositionWeight: 0.1 });
    expect(stockLimited.capitalPlan.sizingDiagnostics).toMatchObject({ effectiveOrderCap: 1_000, limitingConstraint: "position-weight-cap" });
  });

  it.each([
    ["cash", { account: { ...plan().account, mode: "paper", cash: 0 } as AccountSnapshot }, "planned-cash-budget", "实际现金"],
    ["profile", { strategyProfile: "capital-preservation" as const }, "strategy-profile-scale", "策略档位停止新增仓位"],
    ["route", { adaptiveRouting: route(0) }, "strategy-profile-scale", "市场路由停止新增仓位"],
    ["order cap", { maxSingleOrderNotional: 0 }, "risk-order-cap", "单笔风控"],
    ["position cap", { maxPositionWeight: 0 }, "position-weight-cap", "单票仓位"],
  ])("does not describe a zero %s limit as unconstrained", (_name, overrides, constraint, label) => {
    const result = plan(overrides);
    const sizing = result.capitalPlan.sizingDiagnostics!;
    expect(sizing.effectiveOrderCap).toBe(0);
    expect(sizing.limitingConstraint).toBe(constraint);
    expect(sizing.limitingConstraintLabel).toContain(label);
    expect(sizing.summary).not.toContain("无资金约束");
    expect(result.operations.some((operation) => operation.action === "paper-buy-plan")).toBe(false);
  });
});
