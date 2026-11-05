import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import LearningPipeline from "./LearningPipeline";

function renderCoverage(coverageMode?: "snapshot-fallback" | "adaptive-routing") {
  const client = new QueryClient();
  client.setQueryData(["paper-trading-plan"], {
    tradingDate: "2026-11-05", provider: "mock",
    account: { equity: 20_000, cash: 20_000, marketValue: 0 },
    capitalPlan: { initialCapital: 20_000, maxPositionWeight: 0.25, lotSize: 100 },
    strategyProfile: {
      label: "进取", summary: "样本", effectiveCashReserveRatio: 0,
      effectiveNewPositionScale: 1, minDefensiveScore: 55,
      maxNewPositionsPerPlan: 3, allowNewPositions: true,
    },
    executionStrategy: {
      key: "auto", label: "自动选择（跟随市场）", mode: "auto",
      selectedStrategyMatched: false, matchedCandidateCount: 0,
    },
    adaptiveRouting: coverageMode === "adaptive-routing" ? {
      newPositionScale: 1, regime: "trend-up-low-volatility", confidence: 0.7,
      positionPosture: "accumulate", cashReserveRatio: 0, evidence: [],
      strategyPlaybook: { useWhen: "样本", avoidWhen: "样本" },
      eligibleStrategyKeys: [], allowNewPositions: true,
    } : null,
    qualitySummary: {
      candidatePoolSize: 4, affordableCandidateCount: 4,
      positionConflictCount: 0, actionCounts: { observe: 0, "paper-buy-plan": 0,
        "paper-sell-plan": 0, blocked: 0, hold: 0 }, blockedReasons: {},
      plannedBuyNotional: 0, plannedBuyFees: 0, plannedCashRequired: 0,
      plannedSellNotional: 0, cashDeploymentPercent: 0, remainingCashAfterPlan: 20_000,
      strategyCoverage: {
        coverageMode, eligibleKeys: [], matchedKeys: [], matchedCandidateCount: 0,
        unmatchedCandidateCount: 4, dominantStrategyKey: null, dominantBlocker: null,
        summary: coverageMode === "snapshot-fallback"
          ? "当前候选来自快照/质量筛选，未启用市场策略路由；仍须通过金额、候选质量和风控复核。"
          : "当前没有候选通过可用策略规则，保持观察，不强行增加交易。",
      },
      planQuality: "watch-only", summary: "样本",
    },
    operations: [],
    topStrategy: null,
  });
  const html = renderToStaticMarkup(createElement(
    QueryClientProvider, { client }, createElement(LearningPipeline),
  ));
  client.clear();
  return html;
}

describe("LearningPipeline strategy coverage explanation", () => {
  it("describes snapshot fallback without claiming unmatched strategies", () => {
    const html = renderCoverage("snapshot-fallback");
    expect(html).toContain("快照候选筛选（未启用市场策略路由）·候选 4 个");
    expect(html).not.toContain("当前无匹配候选");
    expect(html).not.toContain("未匹配 4 个");
  });

  it("keeps adaptive coverage wording available", () => {
    const html = renderCoverage("adaptive-routing");
    expect(html).toContain("当前无匹配候选");
    expect(html).toContain("未匹配 4 个");
  });

  it("infers snapshot fallback for legacy auto reports without the optional field", () => {
    const html = renderCoverage(undefined);
    expect(html).toContain("快照候选筛选（未启用市场策略路由）·候选 4 个");
    expect(html).not.toContain("当前无匹配候选");
  });
});
