import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { TradingBackend } from "../hooks/useTradingBackend";
import LearningPipeline from "./LearningPipeline";
import { Settings } from "./Settings";

const trading: TradingBackend = {
  connectionState: "connected", realtimeState: "connected", mode: "paper",
  marketDataProvider: "mock", positions: [], orders: [], pendingAction: false,
  refresh: async () => undefined,
  submitOrder: async () => { throw new Error("unexpected order"); },
  cancelOrder: async () => { throw new Error("unexpected cancellation"); },
  setPaused: async () => undefined, resetAccount: async () => undefined,
  setStrategyProfile: async () => undefined, setExecutionStrategy: async () => undefined,
};

function renderSizing(page: "settings" | "learning", options: { manual?: boolean; legacy?: boolean } = {}) {
  const client = new QueryClient();
  client.setQueryData(["paper-trading-plan"], {
    account: { equity: 10_000, cash: 10_000, marketValue: 0 },
    capitalPlan: {
      maxPositionWeight: 0.5, lotSize: 100,
      sizingDiagnostics: {
        profileNewPositionScale: options.legacy ? undefined : 1,
        riskOrderCapBeforeScale: 4_000, riskOrderCapAfterScale: 2_000,
        positionWeightCapAfterScale: 2_500, cashReserveAmount: 0,
        plannedCashBudget: 10_000, effectiveOrderCap: 2_000,
        minimumFeeEfficientNotional: 1_000, plannedBuyOrderCount: 0,
        plannedBuyNotional: 0, averagePlannedBuyNotional: 0, largestPlannedBuyNotional: 0,
        limitingConstraint: "strategy-profile-scale",
        limitingConstraintLabel: options.legacy ? undefined : "市场路由缩放",
        summary: "诊断样本。",
      },
    },
    strategyProfile: {
      label: "进取", summary: "不固定预留现金。", effectiveCashReserveRatio: 0,
      effectiveNewPositionScale: options.manual ? 1 : 0.5,
      minDefensiveScore: 58, maxNewPositionsPerPlan: 3, allowNewPositions: true,
    },
    executionStrategy: { mode: options.manual ? "manual" : "auto", label: "样本策略" },
    adaptiveRouting: {
      newPositionScale: 0.5, regime: "trend-up-high-volatility", confidence: 0.7,
      positionPosture: "selective", cashReserveRatio: 0, evidence: [],
      strategyPlaybook: { useWhen: "样本", avoidWhen: "样本" },
      eligibleStrategyKeys: [], allowNewPositions: true,
    },
    operations: [],
  });
  const html = renderToStaticMarkup(createElement(
    QueryClientProvider, { client },
    page === "settings" ? createElement(Settings, { trading }) : createElement(LearningPipeline),
  ));
  client.clear();
  return html;
}

describe.each(["settings", "learning"] as const)("%s sizing explanations", (page) => {
  it("shows profile, market route and effective ratios independently", () => {
    const html = renderSizing(page);
    expect(html).toContain("档位比例 100%");
    expect(html).toContain("市场路由 50%");
    expect(html).toContain("最终生效 50%");
    expect(html).toContain("市场路由缩放");
    expect(html).toContain("比例用于缩放单笔和单股金额上限，不表示整体仓位比例或满仓目标");
    if (page === "learning") {
      expect(html).toContain("最终缩放后");
      expect(html).not.toContain("档位缩放后");
    }
  });

  it("shows that market routing does not participate in fixed-strategy sizing", () => {
    const html = renderSizing(page, { manual: true });
    expect(html).toContain("市场路由 不参与");
    expect(html).toContain("最终生效 100%");
  });

  it("keeps a neutral explanation when a legacy report lacks the source fields", () => {
    const html = renderSizing(page, { legacy: true });
    expect(html).toContain("档位比例 未提供");
    expect(html).toContain("新增仓位缩放");
    expect(html).not.toContain("策略档位缩放");
  });
});
