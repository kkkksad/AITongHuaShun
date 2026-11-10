import { describe, expect, it } from "vitest";
import type { AccountSnapshot, MarketSnapshot } from "../../shared/trading";
import { buildPaperTradingPlan } from "./paperTradingPlan";

function plan(input: {
  executionStrategy?: "auto" | "movingAverageCross";
  emptyPool?: boolean;
  adaptiveRouting?: {
    allowNewPositions: boolean;
    newPositionScale: number;
    eligibleStrategyKeys: string[];
  };
}) {
  const marketTime = "2026-11-05T02:00:00.000Z";
  const quote = {
    symbol: "601318", name: "覆盖样本", tradable: true, price: 7.8,
    previousClose: 7.7, changePercent: 1.3, volume: 30_000_000,
    amount: 234_000_000, turnover: 2, amplitude: 2.5, open: 7.7,
    high: 7.9, low: 7.6, updatedAt: marketTime,
  };
  const snapshot: MarketSnapshot = {
    mode: "paper", sequence: 1, marketTime, quotes: [quote],
  };
  const account: AccountSnapshot = {
    accountId: "PAPER-COVERAGE", mode: "paper", cash: 20_000, equity: 20_000,
    marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0,
    dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: marketTime,
  };
  return buildPaperTradingPlan({
    snapshot, provider: "mock", account, positions: [],
    leaderboard: { entries: [] } as never,
    candidates: { candidates: [] } as never,
    qualityStocks: { stocks: input.emptyPool ? [] : [{
      symbol: quote.symbol, name: quote.name, price: quote.price,
      score: 96, action: "focus", reasons: ["覆盖样本"],
    }] } as never,
    initialCapital: 20_000, lotSize: 100, maxPositionWeight: 1,
    maxSingleOrderNotional: 20_000, commissionRate: 0.0003,
    minimumCommission: 5, cashReserveRatio: 0, strategyProfile: "growth",
    executionStrategy: input.executionStrategy,
    adaptiveRouting: input.adaptiveRouting as never,
  });
}

describe("paper strategy coverage mode", () => {
  it("marks mock auto candidates as snapshot fallback without changing legacy counts", () => {
    const result = plan({});
    expect(result.qualitySummary.strategyCoverage).toMatchObject({
      coverageMode: "snapshot-fallback",
      matchedCandidateCount: 0,
      unmatchedCandidateCount: 1,
      summary: "当前候选来自快照/质量筛选，未启用市场策略路由；仍须通过金额、候选质量和风控复核。",
    });
    expect(result.qualitySummary.strategyCoverage).toHaveProperty("newPositionFunnel.eligibleNewSymbolCount", 1);
    expect(result.qualitySummary.strategyCoverage).toHaveProperty("newPositionFunnel.plannedBuyCount", 1);
    expect(result.guardrails.join(" ")).toContain("合成研究");
  });

  it("marks an adaptive route separately and preserves matched strategy counts", () => {
    const result = plan({
      adaptiveRouting: {
        allowNewPositions: true, newPositionScale: 1,
        eligibleStrategyKeys: ["kairosQualifiedProbe"],
      },
    });
    expect(result.qualitySummary.strategyCoverage.coverageMode).toBe("adaptive-routing");
  });

  it("marks fixed strategy coverage separately", () => {
    const result = plan({ executionStrategy: "movingAverageCross" });
    expect(result.qualitySummary.strategyCoverage.coverageMode).toBe("manual-strategy");
  });

  it("marks an empty candidate pool as none", () => {
    const result = plan({ emptyPool: true });
    expect(result.qualitySummary.strategyCoverage.coverageMode).toBe("none");
  });

  it("assigns an explicit candidate tier to every plan operation", () => {
    const result = plan({});
    expect(result.operations.every((operation) => operation.tier)).toBe(true);
    expect(result.operations.find((operation) => operation.action === "paper-buy-plan")?.tier).toBe("executable");
  });
});
