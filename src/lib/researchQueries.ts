import { queryOptions } from "@tanstack/react-query";
import {
  fetchDailyCandidates,
  fetchDailyMarketReview,
  fetchPaperTradingPlan,
  fetchStrategyLeaderboard,
} from "./tradingApi";

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function strategyLeaderboardQueryOptions(bars = 120) {
  const boundedBars = boundedInteger(bars, 30, 240);
  return queryOptions({
    queryKey: ["strategy-leaderboard", boundedBars] as const,
    queryFn: () => fetchStrategyLeaderboard(boundedBars),
    staleTime: 60_000,
  });
}

export function dailyCandidatesQueryOptions(limit = 24) {
  const boundedLimit = boundedInteger(limit, 1, 80);
  return queryOptions({
    queryKey: ["daily-candidates", boundedLimit] as const,
    queryFn: () => fetchDailyCandidates(boundedLimit),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function paperTradingPlanQueryOptions() {
  return queryOptions({
    queryKey: ["paper-trading-plan"] as const,
    queryFn: fetchPaperTradingPlan,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function dailyMarketReviewQueryOptions() {
  return queryOptions({
    queryKey: ["daily-market-review"] as const,
    queryFn: fetchDailyMarketReview,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
