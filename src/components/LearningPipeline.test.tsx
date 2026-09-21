import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LearningPipeline", () => {
  it("uses the shared research query state for learning memory", () => {
    const source = readFileSync("src/components/LearningPipeline.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("hasData={Boolean(learningState)}");
    expect(source).toContain("isLoading={learningStateQuery.isLoading}");
    expect(source).toContain("isError={learningStateQuery.isError}");
    expect(source).toContain("dataUpdatedAt={learningStateQuery.dataUpdatedAt}");
    expect(source).toContain('loadingText="正在加载研究记忆…"');
    expect(source).toContain('unavailableText="研究记忆暂不可用，请稍后重试。"');
  });

  it("shows the audited reason for entering or staying out", () => {
    const source = readFileSync("src/components/LearningPipeline.tsx", "utf8");

    expect(source).toContain("dailyReview.entryReview.summary");
    expect(source).toContain("dailyReview.entryReview.reasons.map");
    expect(source).toContain("为什么没有入场 / 为什么入场");
  });

  it("shows weekly capital use and closed-fill strategy evidence", () => {
    const source = readFileSync("src/components/LearningPipeline.tsx", "utf8");

    expect(source).toContain("{weeklyPeriodLabel} Paper 复盘");
    expect(source).toContain("weeklyPaperReviewQueryOptions(weeklyPeriod)");
    expect(source).toContain("weeklyPaperReview.capital.initialCapital");
    expect(source).toContain("weeklyPaperReview.capital.averageFilledOrderNotional");
    expect(source).toContain("weeklyPaperReview?.capital.plannedBuyNotional");
    expect(source).toContain("weeklyPaperReview?.capital.automaticFilledBuyNotional");
    expect(source).toContain("weeklyPaperReview?.capital.planRealizationRatio");
    expect(source).toContain("weeklyPaperReview?.sample.planSnapshotDays");
    expect(source).toContain("weeklyPaperReview?.capital.maxDailyPlannedBuyNotional");
    expect(source).toContain("每日金额对账");
    expect(source).toContain("weeklyDailyReconciliation.map");
    expect(source).toContain("day.planRealizationRatio");
    expect(source).toContain("weeklyPaperReview.capital.maxSingleOrderNotional");
    expect(source).toContain("weeklyPaperReview.capital.maxOrderCapitalRatio");
    expect(source).toContain("weeklyPaperReview.capital.sizingConstraint");
    expect(source).toContain('"cash-or-reserve": "现金/现金缓冲"');
    expect(source).toContain('"phase-budget": "阶段订单额度"');
    expect(source).toContain("weeklyPaperReview?.sample.historyCoverage");
    expect(source).toContain("weeklyHistoryCoverage &&");
    expect(source).toContain("可能已被清理");
    expect(source).toContain("weeklyPaperReview.performance.winRate");
    expect(source).toContain("仅已成交 FIFO");
    expect(source).toContain("strategy.winRate === null");
    expect(source).toContain("weeklyPaperReview.blockers.slice(0, 4)");
    expect(source).toContain("记录估算金额");
  });

  it("shows the paper activity funnel and bounded blocker categories", () => {
    const source = readFileSync("src/components/LearningPipeline.tsx", "utf8");

    expect(source).toContain("activityFunnel");
    expect(source).toContain("候选 → 可买 → 历史 → 策略 → 计划 → 成交");
    expect(source).toContain("historyCoveredCandidates");
    expect(source).toContain("strategyQualifiedCandidates");
    expect(source).toContain("blockerCounts");
    expect(source).toContain("成交结果只代表本地 Paper");
  });
});
