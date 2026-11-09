import { queryOptions } from "@tanstack/react-query";
import { fetchRiskState } from "./tradingApi";

export function paperRiskStateQueryOptions() {
  return queryOptions({
    queryKey: ["paper-risk-state"] as const,
    queryFn: ({ signal }) => fetchRiskState(signal),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
