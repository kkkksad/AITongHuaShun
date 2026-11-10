import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrategyLeaderboardEntry, StrategyLeaderboardReport } from "../lib/tradingApi";
import { fetchStrategyLeaderboard } from "../lib/tradingApi";
import { StrategyLeaderboard } from "./StrategyLeaderboard";

vi.mock("../lib/tradingApi", async original => ({ ...await original<typeof import("../lib/tradingApi")>(), fetchStrategyLeaderboard: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const key = ["strategy-leaderboard", 120];
function entry(metrics: Record<string, unknown> = {}): StrategyLeaderboardEntry {
  return { rank: 1, strategyKey: "fixture", strategyName: "合成样本策略", score: 1, bestParams: {}, trialCount: 1, qualityGate: "caution",
    metrics: { totalReturn: 0.01, annualizedReturn: 0.02, sharpeRatio: 1, sortinoRatio: 1, calmarRatio: 1, maxDrawdownPercent: 0.01,
      winRate: 0.5, totalTrades: 7, ...metrics } };
}
function report(entries = [entry({ winningMatches: 2, closedMatches: 4 })]): StrategyLeaderboardReport {
  return { generatedAt: "2026-11-10T22:00:00Z", seed: 42,
    source: { provider: "mock", mode: "paper", sampleType: "synthetic-from-current-snapshot", quoteCount: 1, tradableSymbols: ["600001"], bars: 120, snapshotSequence: 1, snapshotTime: "2026-11-10T07:00:00Z" },
    dataQuality: { timestamp: "2026-11-10T22:00:00Z", score: { freshness: 80, completeness: 80, suspensionRate: 0, limitUpCount: 0, limitDownCount: 0, adjustmentWarningCount: 0, anomalyPriceCount: 0, overall: 80 }, totalSymbols: 1, summary: "合成研究样本" },
    objective: [], costModel: { initialCapital: 10_000, commissionRate: 0.0003, minimumCommission: 5, slippageBps: 5, maxOrderNotional: 2_000, maxPositionWeight: 0.2 }, guardrails: ["合成研究不代表真实收益"], entries };
}
describe("synthetic leaderboard closed sample presentation", () => {
  let root: Root, container: HTMLDivElement, client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); });
  async function render(data: StrategyLeaderboardReport) {
    client.setQueryData(key, data); vi.mocked(fetchStrategyLeaderboard).mockResolvedValue(data);
    await act(async () => root.render(<QueryClientProvider client={client}><StrategyLeaderboard /></QueryClientProvider>));
  }
  function rateCell() { return container.querySelector("tbody [data-closed-match-rate]"); }
  it("shows the actual closed denominator separately from filled orders", async () => {
    await render(report());
    expect(rateCell()?.textContent).toContain("50.00%");
    expect(rateCell()?.textContent).toContain("盈利 2 / 4");
    expect(rateCell()?.textContent).toContain("成交 7 单");
    expect(container.textContent).toContain("合成回测");
    expect(container.textContent).toContain("252 根日线");
  });
  it("shows no rate for filled buys with no closed sample", async () => {
    await render(report([entry({ winningMatches: 0, closedMatches: 0, winRate: 0, totalTrades: 1 })]));
    expect(rateCell()?.textContent).toContain("无闭合样本");
    expect(rateCell()?.textContent).toContain("—");
    expect(rateCell()?.textContent).not.toContain("0.00%");
    expect(container.querySelector("[data-summary-closed-rate]")?.textContent).toBe("—");
  });
  it("preserves a genuine zero win rate with a nonzero denominator", async () => {
    await render(report([entry({ winningMatches: 0, closedMatches: 3, winRate: 0 })]));
    expect(rateCell()?.textContent).toContain("0.00%");
    expect(rateCell()?.textContent).toContain("盈利 0 / 3");
  });
  it.each([
    {}, { winningMatches: 1, closedMatches: 0 }, { winningMatches: 5, closedMatches: 4 },
    { winningMatches: 0.5, closedMatches: 1 }, { winningMatches: "2", closedMatches: 4 },
    { winningMatches: 1, closedMatches: 4, winRate: 0.5 },
  ])("keeps legacy or inconsistent evidence unknown: %j", async metrics => {
    await render(report([entry(metrics)]));
    expect(rateCell()?.textContent).toContain("—");
    expect(rateCell()?.textContent).not.toContain("50.00%");
  });
  it("does not display zero-percent performance for an empty leaderboard", async () => {
    await render(report([]));
    expect(container.querySelector("[data-summary-closed-rate]")?.textContent).toBe("—");
    expect(container.textContent).toContain("暂无");
  });
  it("refreshes through the existing shared query and keeps sample meaning", async () => {
    const data = report(); await render(data);
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="刷新策略排行榜"]')!.click(); });
    expect(fetchStrategyLeaderboard).toHaveBeenCalledTimes(1);
    expect(rateCell()?.textContent).toContain("盈利 2 / 4");
  });
});
