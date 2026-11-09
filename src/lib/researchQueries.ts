import { queryOptions, type Query, type QueryClient } from "@tanstack/react-query";
import {
  fetchDailyCandidates,
  fetchDailyMarketReview,
  fetchPaperTradingPlan,
  fetchRealResearchDataFeed,
  fetchStrategyLeaderboard,
  fetchWeeklyPaperReview,
  fetchPaperHistoryArchive,
  type WeeklyPaperReviewWindow,
} from "./tradingApi";

export function isAccountResearchQuery({ queryKey }: Pick<Query, "queryKey">): boolean {
  return queryKey[0] === "paper-trading-plan" ||
    queryKey[0] === "paper-risk-state" ||
    queryKey[0] === "paper-history-archive" ||
    queryKey[0] === "daily-market-review" ||
    queryKey[0] === "weekly-paper-review";
}

/** Retire old account reads and data; new active reports continue independently. */
export async function resetAccountResearchQueries(queryClient: QueryClient, isCurrent = () => true): Promise<void> {
  const filters = { predicate: isAccountResearchQuery };
  await queryClient.cancelQueries(filters);
  if (!isCurrent()) return;
  void queryClient.resetQueries(filters);
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function strategyLeaderboardQueryOptions(bars = 120) {
  const boundedBars = boundedInteger(bars, 30, 240);
  return queryOptions({
    queryKey: ["strategy-leaderboard", boundedBars] as const,
    queryFn: ({ signal }) => fetchStrategyLeaderboard(boundedBars, signal),
    staleTime: 60_000,
  });
}

export function dailyCandidatesQueryOptions(limit = 24) {
  const boundedLimit = boundedInteger(limit, 1, 80);
  return queryOptions({
    queryKey: ["daily-candidates", boundedLimit] as const,
    queryFn: ({ signal }) => fetchDailyCandidates(boundedLimit, signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function paperTradingPlanQueryOptions() {
  return queryOptions({
    queryKey: ["paper-trading-plan"] as const,
    queryFn: ({ signal }) => fetchPaperTradingPlan(signal),
    refetchInterval: 60_000,
    staleTime: 45_000,
    placeholderData: (previousData) => previousData,
  });
}

export function dailyMarketReviewQueryOptions() {
  return queryOptions({
    queryKey: ["daily-market-review"] as const,
    queryFn: ({ signal }) => fetchDailyMarketReview(signal),
    refetchInterval: 60_000,
    staleTime: 45_000,
    placeholderData: (previousData) => previousData,
  });
}

export function paperHistoryArchiveQueryOptions() {
  return queryOptions({
    queryKey: ["paper-history-archive"] as const,
    queryFn: ({ signal }) => fetchPaperHistoryArchive(signal),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });
}

export function weeklyPaperReviewQueryOptions(
  period: WeeklyPaperReviewWindow = "current",
) {
  return queryOptions({
    queryKey: ["weekly-paper-review", period] as const,
    queryFn: ({ signal }) => fetchWeeklyPaperReview(signal, period),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });
}

export function realResearchNewsFeedQueryOptions() {
  const newsLimit = 40;
  const symbolLimit = 3;
  return queryOptions({
    queryKey: ["real-research-data-feed", "news", newsLimit, symbolLimit] as const,
    queryFn: ({ signal }) =>
      fetchRealResearchDataFeed(signal, {
        scope: "news",
        newsLimit,
        symbolLimit,
      }),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
    placeholderData: (previousData) => previousData,
  });
}
