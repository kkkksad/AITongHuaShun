import { describe, expect, it } from "vitest";
import type {
  DailyMarketReview,
  PaperAutoExecutionSession,
  PaperAutoExecutionStatus,
  PaperTradingPlan,
} from "./tradingApi";
import { buildDailyTaskCenterModel } from "./dailyTaskCenter";

function makePlan(
  quality: PaperTradingPlan["qualitySummary"]["planQuality"] = "actionable",
): PaperTradingPlan {
  return {
    generatedAt: "2026-07-17T00:45:00.000Z",
    tradingDate: "2026-07-17",
    mode: "paper",
    provider: "akshare",
    account: {
      accountId: "paper-main",
      cash: 7_000,
      equity: 10_000,
      marketValue: 3_000,
    },
    capitalPlan: {
      initialCapital: 10_000,
      maxPositionWeight: 0.3,
      maxSingleOrderNotional: 3_000,
      lotSize: 100,
      cashReserveRatio: 0.3,
      cashReserveAmount: 3_000,
    },
    strategyProfile: {
      key: "balanced",
      label: "均衡",
      summary: "在现金防守和机会参与之间保持中等节奏。",
      cashReserveFloor: 0.5,
      minDefensiveScore: 62,
      maxNewPositionsPerPlan: 2,
      allowNewPositions: true,
      effectiveCashReserveRatio: 0.5,
      effectiveNewPositionScale: 0.85,
    },
    rules: [],
    topStrategy: null,
    adaptiveRouting: {
      version: "1.4.0",
      generatedAt: "2026-07-17T00:45:00.000Z",
      regime: "trend-up-low-volatility",
      confidence: 0.72,
      positionPosture: "accumulate",
      allowNewPositions: true,
      cashReserveRatio: 0.3,
      newPositionScale: 1,
      eligibleStrategyKeys: ["pullback"],
      disabledStrategyKeys: [],
      strategyPlaybook: {
        primaryStrategyKeys: ["pullback"],
        useWhen: "趋势向上",
        avoidWhen: "风险退潮",
        recheckTriggers: [],
      },
      capitalPacing: {
        openingMaxInvestedRatio: 0.2,
        morningMaxInvestedRatio: 0.35,
        afternoonMaxInvestedRatio: 0.45,
        closingMaxInvestedRatio: 0.5,
      },
      stability: {
        status: "direct",
        observedRegime: "trend-up-low-volatility",
        previousConfirmedRegime: null,
        previousConfirmedAt: null,
        rationale: "test fixture",
      },
      evidence: [],
      riskFlags: [],
      metrics: {
        constructiveSectorRatio: 0.6,
        cautiousSectorRatio: 0.2,
        averageReturn20d: 0.04,
        averageReturn60d: 0.08,
        averageMa20Slope5d: 0.01,
        averageVolatility20d: 0.18,
        averageBreadthRatio: 1.4,
        averageCurrentChangePercent: 1.2,
        healthyStockRatio: 0.62,
        deterioratingStockRatio: 0.18,
      },
    },
    qualitySummary: {
      candidatePoolSize: 12,
      affordableCandidateCount: 4,
      positionConflictCount: 0,
      actionCounts: {
        observe: 2,
        "paper-buy-plan": quality === "actionable" ? 1 : 0,
        "paper-sell-plan": 0,
        blocked: quality === "blocked" ? 3 : 0,
        hold: 0,
      },
      blockedReasons: quality === "blocked" ? { "现金不足": 2, "市场路由暂停新增仓位": 1 } : {},
      plannedBuyNotional: quality === "actionable" ? 2_000 : 0,
      plannedBuyFees: quality === "actionable" ? 5 : 0,
      plannedCashRequired: quality === "actionable" ? 2_005 : 0,
      plannedSellNotional: 0,
      cashDeploymentPercent: quality === "actionable" ? 0.2 : 0,
      remainingCashAfterPlan: quality === "actionable" ? 4_995 : 7_000,
      strategyCoverage: {
        eligibleKeys: ["kairosLowVolTrend"],
        matchedKeys: quality === "actionable" ? ["kairosLowVolTrend"] : [],
        matchedCandidateCount: quality === "actionable" ? 1 : 0,
        unmatchedCandidateCount: quality === "actionable" ? 0 : 1,
        dominantStrategyKey: quality === "actionable" ? "kairosLowVolTrend" : null,
        dominantBlocker: null,
        summary: "test strategy coverage",
      },
      planQuality: quality,
      summary: quality === "blocked" ? "当前计划被风控阻止。" : "存在可复核的 Paper 候选。",
    },
    operations: [],
    guardrails: [],
  };
}

function makeReview(
  tone: DailyMarketReview["market"]["tone"] = "balanced",
  rejected = 0,
): DailyMarketReview {
  return {
    generatedAt: "2026-07-17T07:10:00.000Z",
    tradingDate: "2026-07-17",
    dateBasis: "current-weekday",
    mode: "paper",
    provider: "akshare",
    market: {
      snapshotTime: "2026-07-17T07:00:00.000Z",
      snapshotTradingDate: "2026-07-17",
      evidenceStatus: "matched",
      tone,
      summary: tone === "risk-off" ? "市场宽度偏弱。" : "市场宽度均衡。",
      breadth: {
        total: 5_000,
        advancers: 2_600,
        decliners: 2_300,
        flat: 100,
        averageChangePercent: 0.18,
        advanceDeclineRatio: 1.13,
      },
      indices: [],
    },
    account: {
      equity: 10_000,
      cash: 7_000,
      marketValue: 3_000,
      dailyPnl: 35,
      dailyPnlPercent: 0.0035,
      cumulativePnl: 80,
      cumulativePnlPercent: 0.008,
      performanceBasis: "mark-to-market",
      openingEquity: 9_965,
      missingPreviousCloseSymbols: [],
      cashRatio: 0.7,
      capitalDeployedPercent: 0.3,
      positionCount: 1,
      t1LockedPositions: 0,
    },
    trades: {
      submitted: rejected > 0 ? 2 : 1,
      filled: 1,
      rejected,
      filledBuys: 1,
      filledSells: 0,
      filledBuyNotional: 2_000,
      filledSellNotional: 0,
      commission: 5,
      items: [],
    },
    entryReview: {
      status: "entered",
      summary: "当日已有 1 笔本地 Paper 买入成交。",
      reasons: ["结论来自本地订单。"],
      marketRegime: "trend-up-low-volatility",
      planQuality: "actionable",
      cashWasConstraint: false,
    },
    strategyReview: {
      grade: rejected > 0 ? "watch" : "disciplined",
      summary: rejected > 0 ? "执行纪律正常，样本仍少。" : "计划与成交记录未见异常。",
      strengths: [],
      issues: rejected > 0 ? ["存在一笔拒单。"] : [],
      nextActions: rejected > 0 ? ["复核拒单原因并调整下一交易日计划。"] : [],
    },
    guardrails: [],
  };
}

function makeExecution(session: PaperAutoExecutionSession): PaperAutoExecutionStatus {
  return {
    enabled: true,
    running: false,
    mode: "paper-auto",
    execution: "local-paper-broker-only",
    liveTradingEnabled: false,
    intervalMs: 60_000,
    tradeWindowOnly: true,
    maxOrdersPerRun: 2,
    maxDailyOrders: 8,
    targetDailyOrders: 2,
    activityMode: "qualified-probe",
    qualifiedProbeActive: false,
    todaySubmittedOrders: 2,
    todayFilledOrders: 2,
    activityTarget: {
      status: "met",
      targetOrders: 2,
      filledOrders: 2,
      remainingOrders: 0,
      reason: "今日 Paper 成交活跃度目标已达到。",
    },
    phaseDailyOrderLimit: 4,
    phaseRemainingOrders: 2,
    currentSession: session,
    startedAt: "2026-07-17T00:30:00.000Z",
    lastRunAt: "2026-07-17T06:58:00.000Z",
    nextRunAt: "2026-07-17T06:59:00.000Z",
    latestRun: null,
    recentRuns: [],
    guardrails: [],
  };
}

describe("buildDailyTaskCenterModel", () => {
  it("builds a pre-market checklist from an actionable paper plan", () => {
    const model = buildDailyTaskCenterModel({
      plan: makePlan(),
      review: makeReview(),
      execution: makeExecution("pre-market"),
    });

    expect(model.phase).toMatchObject({ key: "pre-market", label: "盘前准备" });
    expect(model.tasks.map((task) => task.state)).toEqual([
      "current",
      "pending",
      "pending",
      "done",
    ]);
    expect(model.plan).toMatchObject({ label: "可执行计划", tone: "positive" });
    expect(model.plan.detail).toBe("计划包含 1 笔模拟买入，预计占用现金 2,005 元。");
    expect(model.account.investedRatio).toBe(0.3);
    expect(model.nextAction).toContain("核对行情源");
  });

  it("prioritizes blocked reasons and risk-off routing during the open session", () => {
    const plan = makePlan("blocked");
    plan.adaptiveRouting = {
      ...plan.adaptiveRouting!,
      regime: "risk-off",
      allowNewPositions: false,
      positionPosture: "reduce",
    };
    const model = buildDailyTaskCenterModel({
      plan,
      review: makeReview("risk-off"),
      execution: makeExecution("open"),
    });

    expect(model.phase.label).toBe("盘中执行");
    expect(model.market).toMatchObject({ label: "风险偏弱", allowNewPositions: false });
    expect(model.plan.blockedReasons).toEqual(["现金不足 ×2", "市场路由暂停新增仓位 ×1"]);
    expect(model.tasks[3]).toMatchObject({ state: "attention" });
    expect(model.nextAction).toContain("暂停新增 Paper 仓位");
  });

  it("uses the review result and next action after hours", () => {
    const model = buildDailyTaskCenterModel({
      plan: makePlan("watch-only"),
      review: makeReview("balanced", 1),
      execution: makeExecution("after-hours"),
    });

    expect(model.tasks.map((task) => task.state)).toEqual([
      "done",
      "done",
      "current",
      "attention",
    ]);
    expect(model.orders).toMatchObject({ submitted: 2, filled: 1, rejected: 1, commission: 5 });
    expect(model.nextAction).toBe("复核拒单原因并调整下一交易日计划。");
  });

  it("keeps weekend status explicit when only partial data is available", () => {
    const model = buildDailyTaskCenterModel({ execution: makeExecution("weekend") });

    expect(model.phase.label).toBe("非交易日");
    expect(model.dataSources).toEqual({ available: 1, total: 3 });
    expect(model.tasks[2]).toMatchObject({ state: "current" });
    expect(model.tasks[3]).toMatchObject({ state: "attention" });
    expect(model.nextAction).toContain("最近交易日");
  });

  it("shows the qualified afternoon activity phase without promising a fill", () => {
    const execution = {
      ...makeExecution("open"),
      qualifiedProbeActive: true,
      todaySubmittedOrders: 0,
      todayFilledOrders: 0,
      activityTarget: {
        status: "active" as const,
        targetOrders: 2,
        filledOrders: 0,
        remainingOrders: 2,
        reason: "下午合格样本验证已开启。",
      },
    };
    const model = buildDailyTaskCenterModel({ execution });

    expect(model.execution).toMatchObject({
      label: "下午合格补足",
      detail: expect.stringContaining("真实历史、费用和风控"),
    });
  });
});
