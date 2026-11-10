import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "../backtest/backtestEngine";
import { gridSearch } from "../optimizer";
import { buildStrategyLeaderboard } from "./strategyLeaderboard";

vi.mock("../optimizer", async original => ({ ...await original<typeof import("../optimizer")>(), gridSearch: vi.fn() }));
const snapshots: MarketSnapshot[] = [10, 11, 12, 13].map((price, index) => {
  const marketTime = new Date(Date.UTC(2026, 10, index + 2, 7)).toISOString();
  return { mode: "paper", sequence: index + 1, marketTime, quotes: [{ symbol: "600001", name: "closed-match fixture",
    price, tradable: true, previousClose: price, changePercent: 0, volume: 1_000_000, updatedAt: marketTime }] };
});
function configureSearch(closed: boolean) {
  const report = new BacktestEngine(snapshots, { name: "closed-match source",
    onBar: ({ barIndex }) => barIndex === 0 || (closed && barIndex === 2)
      ? [{ symbol: "600001", side: "buy", type: "market", quantity: 100 }]
      : closed && barIndex === 1 ? [{ symbol: "600001", side: "sell", type: "market", quantity: 100 }] : [],
  }, { initialCapital: 10_000, maxPositionWeight: 1, commissionRate: 0, minimumCommission: 5, slippageBps: 0 }).run();
  const trial = { id: 1, params: {}, metrics: report.metrics, score: 1, executionTimeMs: 0 };
  vi.mocked(gridSearch).mockResolvedValue({ strategyName: report.strategyName, method: "grid", parameters: [],
    totalTrials: 1, trials: [trial], best: trial, totalTimeMs: 0 });
  return report;
}
beforeEach(() => vi.resetAllMocks());
describe("synthetic leaderboard closed-match projection", () => {
  it("projects actual fee-adjusted closed matches separately from filled buy and sell orders", async () => {
    const source = configureSearch(true);
    expect(source.trades).toHaveLength(3);
    expect(source.metrics).toMatchObject({ winningTrades: 1, losingTrades: 0, winRate: 1 });
    const report = await buildStrategyLeaderboard(snapshots[0], "mock", 60);
    expect(report.entries.length).toBeGreaterThan(0);
    for (const entry of report.entries) expect(entry.metrics).toMatchObject({ winningMatches: 1, closedMatches: 1, winRate: 1, totalTrades: 3 });
  });
  it("preserves true zero closed samples for a filled buy that is still open", async () => {
    const source = configureSearch(false);
    expect(source.trades).toHaveLength(1);
    const report = await buildStrategyLeaderboard(snapshots[0], "mock", 60);
    for (const entry of report.entries) expect(entry.metrics).toMatchObject({ winningMatches: 0, closedMatches: 0, winRate: 0, totalTrades: 1 });
  });
});
