import { describe, expect, it } from "vitest";
import {
  dailyCandidatesQueryOptions,
  dailyMarketReviewQueryOptions,
  paperTradingPlanQueryOptions,
  realResearchNewsFeedQueryOptions,
  strategyLeaderboardQueryOptions,
} from "./researchQueries";

describe("research query options", () => {
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

  it("defines paper plan and daily review refresh behavior once", () => {
    const plan = paperTradingPlanQueryOptions();
    const review = dailyMarketReviewQueryOptions();

    expect(plan.queryKey).toEqual(["paper-trading-plan"]);
    expect(review.queryKey).toEqual(["daily-market-review"]);
    expect(plan.refetchInterval).toBe(60_000);
    expect(review.refetchInterval).toBe(60_000);
    expect(plan.staleTime).toBe(30_000);
    expect(review.staleTime).toBe(30_000);
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
