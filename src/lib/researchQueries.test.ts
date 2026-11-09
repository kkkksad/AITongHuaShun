import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { paperRiskStateQueryOptions } from "./riskQueries";
import {
  dailyCandidatesQueryOptions,
  dailyMarketReviewQueryOptions,
  isAccountResearchQuery,
  paperTradingPlanQueryOptions,
  resetAccountResearchQueries,
  realResearchNewsFeedQueryOptions,
  strategyLeaderboardQueryOptions,
  weeklyPaperReviewQueryOptions,
} from "./researchQueries";

describe("research query options", () => {
  it("drops the old account risk snapshot on reset while retaining market-only data", async () => {
    const client = new QueryClient();
    client.setQueryData(paperRiskStateQueryOptions().queryKey, {
      circuitState: "normal", tradeCount: 7, lossCount: 2, consecutiveLosses: 1, dailyDrawdown: 0,
      peakDailyEquity: 20000, trippedAt: null, warningAt: null, lastTradeTime: "2026-11-10T01:00:00.000Z",
      lastEvaluationTime: "2026-11-10T01:00:00.000Z",
    });
    client.setQueryData(["market-data-quality"], { quality: 99 });
    client.setQueryData(["paper-history-archive"], { previousEpoch: true });
    await resetAccountResearchQueries(client);
    expect(client.getQueryData(paperRiskStateQueryOptions().queryKey)).toBeUndefined();
    expect(client.getQueryData(["market-data-quality"])).toEqual({ quality: 99 });
    expect(client.getQueryData(["paper-history-archive"])).toBeUndefined();
    client.clear();
  });
  it("matches account-dependent research across every weekly period and parameter variant", () => {
    for (const queryKey of [
      paperTradingPlanQueryOptions().queryKey,
      dailyMarketReviewQueryOptions().queryKey,
      weeklyPaperReviewQueryOptions("current").queryKey,
      weeklyPaperReviewQueryOptions("previous").queryKey,
      ["weekly-paper-review", "archived", { limit: 20 }],
      paperRiskStateQueryOptions().queryKey,
      ["paper-history-archive"],
    ]) {
      expect(isAccountResearchQuery({ queryKey })).toBe(true);
    }
  });

  it("excludes market-only research and similarly named unrelated cache keys", () => {
    for (const queryKey of [
      strategyLeaderboardQueryOptions().queryKey,
      dailyCandidatesQueryOptions().queryKey,
      realResearchNewsFeedQueryOptions().queryKey,
      ["market-data-quality"],
      ["paper-auto-execution-status"],
      ["paper-trading-plan-history"],
      ["selected-strategy"],
      [],
    ]) {
      expect(isAccountResearchQuery({ queryKey })).toBe(false);
    }
  });

  it("reuses one strategy leaderboard cache key for the same parameters", () => {
    const strategyView = strategyLeaderboardQueryOptions(120);
    const pipelineView = strategyLeaderboardQueryOptions(120);

    expect(strategyView.queryKey).toEqual(["strategy-leaderboard", 120]);
    expect(pipelineView.queryKey).toEqual(strategyView.queryKey);
    expect(strategyView.queryKey).not.toContain("pipeline");
    expect(strategyView.staleTime).toBe(60_000);
  });

  it("reuses one candidate cache key and refresh policy for the same limit", () => {
    const observeView = dailyCandidatesQueryOptions(24);
    const pipelineView = dailyCandidatesQueryOptions(24);

    expect(observeView.queryKey).toEqual(["daily-candidates", 24]);
    expect(pipelineView.queryKey).toEqual(observeView.queryKey);
    expect(observeView.refetchInterval).toBe(60_000);
    expect(observeView.staleTime).toBe(30_000);
  });

  it("bounds numeric query parameters before creating keys", () => {
    expect(strategyLeaderboardQueryOptions(999).queryKey).toEqual([
      "strategy-leaderboard",
      240,
    ]);
    expect(dailyCandidatesQueryOptions(0).queryKey).toEqual([
      "daily-candidates",
      1,
    ]);
  });

  it("defines paper plan, daily review and weekly review refresh behavior once", () => {
    const plan = paperTradingPlanQueryOptions();
    const review = dailyMarketReviewQueryOptions();
    const weeklyReview = weeklyPaperReviewQueryOptions("previous");

    expect(plan.queryKey).toEqual(["paper-trading-plan"]);
    expect(review.queryKey).toEqual(["daily-market-review"]);
    expect(weeklyReview.queryKey).toEqual(["weekly-paper-review", "previous"]);
    expect(plan.refetchInterval).toBe(60_000);
    expect(review.refetchInterval).toBe(60_000);
    expect(weeklyReview.refetchInterval).toBe(60_000);
    expect(plan.staleTime).toBe(45_000);
    expect(review.staleTime).toBe(45_000);
    expect(weeklyReview.staleTime).toBe(45_000);
    expect(plan.placeholderData).toBeTypeOf("function");
    expect(review.placeholderData).toBeTypeOf("function");
    expect(weeklyReview.placeholderData).toBeUndefined();
  });

  it("keeps current and previous weekly review cache entries separate", () => {
    expect(weeklyPaperReviewQueryOptions("current").queryKey).toEqual([
      "weekly-paper-review",
      "current",
    ]);
  });

  it("keeps the overview news request lightweight and cached", () => {
    const news = realResearchNewsFeedQueryOptions();

    expect(news.queryKey).toEqual([
      "real-research-data-feed",
      "news",
      40,
      3,
    ]);
    expect(news.staleTime).toBe(10 * 60_000);
    expect(news.refetchInterval).toBe(15 * 60_000);
    expect(news.placeholderData).toBeTypeOf("function");
  });
});
