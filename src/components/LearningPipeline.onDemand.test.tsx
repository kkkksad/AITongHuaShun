import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyCandidates } from "../../server/research/dailyCandidates";
import { fetchDailyCandidates, fetchStrategyLeaderboard } from "../lib/tradingApi";
import LearningPipeline from "./LearningPipeline";

vi.mock("../lib/tradingApi", async original => ({
  ...await original<typeof import("../lib/tradingApi")>(),
  fetchDailyCandidates: vi.fn(), fetchStrategyLeaderboard: vi.fn(),
  fetchDailyMarketReview: vi.fn(async () => null), fetchPaperTradingPlan: vi.fn(async () => null),
  fetchWeeklyPaperReview: vi.fn(async () => null), fetchPaperHistoryArchive: vi.fn(async () => null),
  fetchLearningState: vi.fn(async () => null), fetchSelfOptimizationStatus: vi.fn(async () => null),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const key = ["strategy-leaderboard", 120] as const;
function report() {
  return { dataQuality: { score: { overall: 80 } }, entries: [{ strategyName: "cached synthetic sample",
    qualityGate: "pass", metrics: { winRate: 0.5, totalTrades: 4 } }] };
}

describe("LearningPipeline optional synthetic research", () => {
  let root: Root, container: HTMLDivElement, client: QueryClient;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchStrategyLeaderboard).mockReset().mockImplementation(() => new Promise(() => {}));
    const candidates = buildDailyCandidates({
      mode: "paper", sequence: 1, marketTime: "2026-11-10T08:00:00Z", quotes: [],
    }, "mock", 24);
    vi.mocked(fetchDailyCandidates).mockReset().mockResolvedValue({
      ...candidates, source: { ...candidates.source, provider: "mock" },
    });
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  });
  afterEach(() => {
    act(() => root.unmount()); client.clear(); container.remove(); focusManager.setFocused(undefined);
    vi.useRealTimers();
  });
  async function render() {
    await act(async () => root.render(<QueryClientProvider client={client}><LearningPipeline /></QueryClientProvider>));
    await act(() => vi.advanceTimersByTimeAsync(10));
  }
  function syntheticButton() {
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="运行合成初筛"]');
    expect(button).not.toBeNull(); return button!;
  }

  it("does not request the grid on entry, focus, invalidation, or ordinary core refresh", async () => {
    await render();
    expect(fetchStrategyLeaderboard).not.toHaveBeenCalled();
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await act(async () => { await client.invalidateQueries({ queryKey: key }); });
    const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="刷新研究管线"]')!;
    expect(refresh.disabled).toBe(false);
    await act(async () => { refresh.click(); });
    expect(fetchStrategyLeaderboard).not.toHaveBeenCalled();
    expect(fetchDailyCandidates).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".pipeline-list")?.textContent).toContain("按需运行");
  });

  it("runs explicitly once, disables repeated clicks, and leaves core refresh usable", async () => {
    await render();
    await act(async () => { syntheticButton().click(); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(fetchStrategyLeaderboard).toHaveBeenCalledTimes(1);
    expect(syntheticButton().disabled).toBe(true);
    await act(async () => { syntheticButton().click(); });
    expect(fetchStrategyLeaderboard).toHaveBeenCalledTimes(1);
    const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="刷新研究管线"]')!;
    expect(refresh.disabled).toBe(false);
    await act(async () => { refresh.click(); });
    expect(fetchDailyCandidates).toHaveBeenCalledTimes(2);
    expect(fetchStrategyLeaderboard).toHaveBeenCalledTimes(1);
  });

  it("keeps shared stale cache visible without recomputing and preserves it on a failed explicit refresh", async () => {
    client.setQueryData(key, report(), { updatedAt: Date.now() - 120_000 });
    vi.mocked(fetchStrategyLeaderboard).mockRejectedValue(new Error("grid unavailable"));
    await render();
    expect(container.textContent).toContain("cached synthetic sample");
    expect(fetchStrategyLeaderboard).not.toHaveBeenCalled();
    await act(async () => { syntheticButton().click(); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(container.textContent).toContain("cached synthetic sample");
    expect(container.textContent).toContain("继续显示缓存数据");
    expect(syntheticButton().disabled).toBe(false);
  });

  it("can retry its own failure and does not rerun the shared cache on remount", async () => {
    vi.mocked(fetchStrategyLeaderboard).mockRejectedValueOnce(new Error("grid unavailable"))
      .mockResolvedValueOnce(report() as Awaited<ReturnType<typeof fetchStrategyLeaderboard>>);
    await render();
    await act(async () => { syntheticButton().click(); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(container.textContent).toContain("合成初筛暂不可用");
    await act(async () => { syntheticButton().click(); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(container.textContent).toContain("cached synthetic sample");
    await act(async () => root.render(null));
    await render();
    expect(fetchStrategyLeaderboard).toHaveBeenCalledTimes(2);
  });

  it("retires an in-flight read when this is its last observer", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetchStrategyLeaderboard).mockImplementation((_bars, received) => {
      signal = received; return new Promise(() => {});
    });
    await render();
    await act(async () => { syntheticButton().click(); });
    expect(signal?.aborted).toBe(false);
    await act(async () => root.render(null));
    expect(signal?.aborted).toBe(true);
  });
});
