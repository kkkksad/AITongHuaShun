import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWeeklyPaperReview } from "../../server/research/weeklyPaperReview";
import { fetchWeeklyPaperReview } from "../lib/tradingApi";
import LearningPipeline from "./LearningPipeline";

vi.mock("../lib/tradingApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/tradingApi")>(),
  fetchWeeklyPaperReview: vi.fn(),
  fetchStrategyLeaderboard: vi.fn(() => new Promise(() => {})),
  fetchDailyCandidates: vi.fn(() => new Promise(() => {})),
  fetchLearningState: vi.fn(() => new Promise(() => {})),
  fetchSelfOptimizationStatus: vi.fn(() => new Promise(() => {})),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function review(period: "previous" | "current") {
  return buildWeeklyPaperReview({
    now: new Date("2026-09-20T04:00:00Z"), period, initialCapital: 100_000,
    account: { equity: 100_000, cash: 100_000, marketValue: 0 },
    orders: [], auditEvents: [],
  });
}

describe("weekly review interaction", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchWeeklyPaperReview).mockReset();
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
    await act(async () => {
      root.render(<QueryClientProvider client={client}><LearningPipeline /></QueryClientProvider>);
    });
    await act(() => vi.advanceTimersByTimeAsync(10));
  }

  function weeklyText() {
    return container.querySelector(".weekly-paper-review")?.textContent ?? "";
  }

  it("loads weekly evidence without waiting for strategy research", async () => {
    vi.mocked(fetchWeeklyPaperReview).mockResolvedValue(review("previous"));
    await render();
    expect(fetchWeeklyPaperReview).toHaveBeenCalledWith(expect.any(AbortSignal), "previous");
    expect(weeklyText()).toContain("2026-09-07 - 2026-09-11");
    expect(weeklyText()).toContain("100,000");
    expect(client.getQueryState(["strategy-leaderboard", 120])?.status).toBe("pending");
    expect(container.querySelector(".pipeline-list")?.textContent).not.toContain("完成 24 / 24");
    expect(container.querySelector(".pipeline-list")?.textContent).not.toContain("通过 7 / 24");
    expect(container.querySelector(".pipeline-list")?.textContent).not.toContain("运行第 8 天");
    expect(container.querySelector(".score-ring strong")?.textContent).toBe("--");
    expect(container.querySelector(".check-list")?.textContent).not.toContain("A 股 T+1 纸面计划已生成");
  });

  it("never shows the previous week's figures under the current week selection", async () => {
    let resolveCurrent!: (value: ReturnType<typeof review>) => void;
    vi.mocked(fetchWeeklyPaperReview)
      .mockResolvedValueOnce(review("previous"))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveCurrent = resolve; }));
    await render();
    const current = container.querySelector<HTMLButtonElement>('button[aria-label="本周 Paper 复盘"]');
    expect(current).not.toBeNull();
    await act(async () => { current!.click(); });
    expect(current!.getAttribute("aria-pressed")).toBe("true");
    expect(weeklyText()).not.toContain("2026-09-07");
    expect(weeklyText()).not.toContain("100,000");
    expect(weeklyText()).toContain("正在汇总本周 Paper 记录");
    await act(async () => { resolveCurrent(review("current")); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(weeklyText()).toContain("2026-09-14 - 2026-09-20");
    expect(fetchWeeklyPaperReview).toHaveBeenLastCalledWith(expect.any(AbortSignal), "current");
    expect(container.querySelector(".check-list")?.textContent).toContain("本周资金使用与闭合成交复盘已生成");
    expect(container.querySelector(".pipeline-list")?.textContent).toContain("本周成交 0 笔");
  });

  it("retries a failed weekly request through its own refresh control", async () => {
    vi.mocked(fetchWeeklyPaperReview)
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValueOnce(review("previous"));
    await render();
    expect(weeklyText()).toContain("上周 Paper 复盘暂不可用");
    const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="刷新上周 Paper 复盘"]');
    expect(refresh).not.toBeNull();
    await act(async () => { refresh!.click(); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(weeklyText()).toContain("100,000");
    expect(weeklyText()).not.toContain("暂不可用");
    expect(fetchWeeklyPaperReview).toHaveBeenCalledTimes(2);
  });

  it("keeps same-period evidence visible when a background refresh fails", async () => {
    vi.mocked(fetchWeeklyPaperReview)
      .mockResolvedValueOnce(review("previous"))
      .mockRejectedValueOnce(new Error("temporarily unavailable"));
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="刷新上周 Paper 复盘"]')!.click();
    });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(weeklyText()).toContain("100,000");
    expect(weeklyText()).toContain("继续显示缓存数据");
    expect(weeklyText()).not.toContain("上周 Paper 复盘暂不可用");
  });
});
