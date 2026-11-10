import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyMarketReview } from "../../server/research/dailyMarketReview";
import { fetchDailyMarketReview, fetchPaperTradingPlan, fetchStrategyLeaderboard } from "../lib/tradingApi";
import LearningPipeline from "./LearningPipeline";

vi.mock("../lib/tradingApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/tradingApi")>(),
  fetchDailyMarketReview: vi.fn(),
  fetchStrategyLeaderboard: vi.fn(() => new Promise(() => {})),
  fetchDailyCandidates: vi.fn(() => new Promise(() => {})),
  fetchPaperTradingPlan: vi.fn(() => new Promise(() => {})),
  fetchWeeklyPaperReview: vi.fn(() => new Promise(() => {})),
  fetchPaperHistoryArchive: vi.fn(() => new Promise(() => {})),
  fetchLearningState: vi.fn(() => new Promise(() => {})),
  fetchSelfOptimizationStatus: vi.fn(() => new Promise(() => {})),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function review() {
  const now = new Date("2026-11-10T08:00:00Z");
  return buildDailyMarketReview({
    now, provider: "akshare",
    snapshot: { mode: "paper", sequence: 1, marketTime: now.toISOString(), quotes: [] },
    account: { accountId: "daily-loading", mode: "paper", cash: 20000, equity: 20000,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0,
      riskUtilization: 0, paused: false, updatedAt: now.toISOString() },
    positions: [], orders: [], auditEvents: [],
  });
}

describe("daily review independent loading", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchDailyMarketReview).mockReset();
    vi.mocked(fetchPaperTradingPlan).mockClear();
    vi.mocked(fetchStrategyLeaderboard).mockReset().mockImplementation(() => new Promise(() => {}));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
    vi.useRealTimers();
  });

  async function render() {
    await act(async () => root.render(<QueryClientProvider client={client}><LearningPipeline /></QueryClientProvider>));
    await act(() => vi.advanceTimersByTimeAsync(10));
  }

  it("loads today's records while both expensive research requests are pending", async () => {
    vi.mocked(fetchDailyMarketReview).mockResolvedValue(review());
    await render();
    expect(fetchDailyMarketReview).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(container.querySelector("#learning-daily-review")?.textContent).toContain("2026-11-10");
    expect(container.querySelector(".check-list")?.textContent).toContain("每日盘面与交易复盘已生成");
    expect(client.getQueryState(["strategy-leaderboard", 120])?.status).toBe("pending");
    expect(client.getQueryState(["daily-candidates", 24])?.status).toBe("pending");
    expect(fetchPaperTradingPlan).not.toHaveBeenCalled();
  });

  it("shows the daily request's own failure when strategy research has failed or is still pending", async () => {
    vi.mocked(fetchStrategyLeaderboard).mockRejectedValue(new Error("research failed"));
    vi.mocked(fetchDailyMarketReview).mockRejectedValue(new Error("daily unavailable"));
    await render();
    expect(fetchDailyMarketReview).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(["daily-market-review"])?.status).toBe("error");
    expect(container.querySelector("#learning-daily-review")?.textContent).toContain("复盘暂不可用");
    expect(fetchPaperTradingPlan).not.toHaveBeenCalled();
  });

  it("keeps the existing daily refresh interval even when the research foundation never finishes", async () => {
    vi.mocked(fetchDailyMarketReview).mockResolvedValue(review());
    await render();
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(fetchDailyMarketReview).toHaveBeenCalledTimes(2);
    expect(fetchPaperTradingPlan).not.toHaveBeenCalled();
  });

  it("cancels a pending daily read when the component leaves", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetchDailyMarketReview).mockImplementation((received) => {
      signal = received;
      return new Promise(() => {});
    });
    await render();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    await act(async () => root.render(null));
    expect(signal?.aborted).toBe(true);
  });
});
