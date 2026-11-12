import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyTaskCenter } from "./DailyTaskCenter";
import { fetchPaperAutoExecutionStatus, fetchPaperTradingPlan, fetchDailyMarketReview,
  type PaperAutoExecutionStatus, type PaperTradingPlan, type DailyMarketReview } from "../lib/tradingApi";

vi.mock("../lib/tradingApi", async original => ({
  ...await original<typeof import("../lib/tradingApi")>(),
  fetchPaperAutoExecutionStatus: vi.fn(), fetchPaperTradingPlan: vi.fn(), fetchDailyMarketReview: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Only presentation fields are needed here; endpoint decoding is tested by tradingApi tests.
const plan = { generatedAt: "2026-11-11T07:00:00Z", provider: "akshare",
  account: { cash: 13_992, equity: 19_831, marketValue: 5_839 },
  adaptiveRouting: { allowNewPositions: false },
  qualitySummary: { planQuality: "watch-only", candidatePoolSize: 12, blockedReasons: {},
    actionCounts: { "paper-buy-plan": 0, "paper-sell-plan": 0, blocked: 0 } },
} as unknown as PaperTradingPlan;
const review = { generatedAt: "2026-11-11T07:01:00Z",
  market: { tone: "balanced", summary: "测试市场复盘" },
  strategyReview: { grade: "watch", summary: "测试费用后复盘", nextActions: ["复核已有订单"] },
  account: { cash: 13_992, equity: 19_831, marketValue: 5_839, positionCount: 3 },
  trades: { submitted: 1, filled: 1, rejected: 0, commission: 5 },
} as unknown as DailyMarketReview;
const execution = { enabled: false, currentSession: "after-hours" } as PaperAutoExecutionStatus;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root, container: HTMLDivElement, client: QueryClient;
const callbacks = { onOpenLearning: vi.fn(), onOpenMarket: vi.fn(), onOpenOrders: vi.fn() };
async function mount(count = 1) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}>
      {Array.from({ length: count }, (_, key) => <DailyTaskCenter key={key} {...callbacks} />)}
    </QueryClientProvider>);
  });
  await tick();
}
async function tick(ms = 10) { await act(() => vi.advanceTimersByTimeAsync(ms)); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.mocked(fetchPaperAutoExecutionStatus).mockImplementation(() => new Promise(() => {}));
  vi.mocked(fetchPaperTradingPlan).mockResolvedValue(plan);
  vi.mocked(fetchDailyMarketReview).mockResolvedValue(review);
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => {
  await act(async () => { root.unmount(); client.clear(); });
  container.remove(); vi.clearAllTimers(); vi.useRealTimers();
});

describe("DailyTaskCenter independent reads", () => {
  it("starts the plan and review while status is pending and renders available evidence with unknown execution", async () => {
    await mount(); await tick();
    for (const fn of [fetchPaperAutoExecutionStatus, fetchPaperTradingPlan, fetchDailyMarketReview]) {
      expect(fn).toHaveBeenCalledOnce();
      expect(vi.mocked(fn).mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    }
    expect(container.textContent).toContain("2/3 数据就绪");
    expect(container.textContent).toContain("测试费用后复盘");
    expect(container.textContent).toContain("12 个候选当前仅观察");
    expect(container.textContent).toContain("状态未知");
    expect(container.textContent).not.toContain("已启用");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="刷新每日任务中心"]')!.disabled).toBe(true);
  });

  it("retains the two completed reports when status later fails", async () => {
    const status = deferred<PaperAutoExecutionStatus>();
    vi.mocked(fetchPaperAutoExecutionStatus).mockReturnValue(status.promise);
    await mount();
    expect(fetchPaperTradingPlan).toHaveBeenCalledOnce();
    await act(async () => { status.reject(new Error("status unavailable")); });
    await tick();
    expect(container.textContent).toContain("当前继续展示 2 份可用结果");
    expect(container.textContent).toContain("状态未知");
    expect(container.textContent).toContain("测试费用后复盘");
    expect(fetchPaperTradingPlan).toHaveBeenCalledOnce();
  });

  it("shows an available review even when plan fails and status is still pending", async () => {
    vi.mocked(fetchPaperTradingPlan).mockRejectedValue(new Error("plan unavailable"));
    await mount(); await tick();
    expect(container.textContent).toContain("1/3 数据就绪");
    expect(container.textContent).toContain("测试费用后复盘");
    expect(container.textContent).toContain("等待计划");
    expect(container.textContent).toContain("状态未知");
  });

  it("shares the same three queries across concurrent cards", async () => {
    await mount(2); await tick();
    expect(container.querySelectorAll(".daily-task-center")).toHaveLength(2);
    expect(fetchPaperAutoExecutionStatus).toHaveBeenCalledOnce();
    expect(fetchPaperTradingPlan).toHaveBeenCalledOnce();
    expect(fetchDailyMarketReview).toHaveBeenCalledOnce();
  });

  it("cancels all three pending reads when the last observer unmounts", async () => {
    vi.mocked(fetchPaperTradingPlan).mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchDailyMarketReview).mockImplementation(() => new Promise(() => {}));
    await mount();
    const signals = [fetchPaperAutoExecutionStatus, fetchPaperTradingPlan, fetchDailyMarketReview]
      .map(fn => vi.mocked(fn).mock.calls[0]?.[0]);
    expect(signals.every(s => s instanceof AbortSignal && !s.aborted)).toBe(true);
    await act(async () => root.unmount());
    expect(signals.every(s => s?.aborted)).toBe(true);
    // afterEach still has a valid root to dispose.
    root = createRoot(container);
  });

  it("finishes three controlled 80ms reads in one wave", async () => {
    vi.mocked(fetchPaperAutoExecutionStatus).mockImplementation(() => new Promise(r => setTimeout(() => r(execution), 80)));
    vi.mocked(fetchPaperTradingPlan).mockImplementation(() => new Promise(r => setTimeout(() => r(plan), 80)));
    vi.mocked(fetchDailyMarketReview).mockImplementation(() => new Promise(r => setTimeout(() => r(review), 80)));
    await mount();
    await tick(75);
    expect(container.textContent).toContain("3/3 数据就绪");
    expect(container.textContent).toContain("未启用");
    expect(fetchPaperAutoExecutionStatus).toHaveBeenCalledOnce();
    expect(fetchPaperTradingPlan).toHaveBeenCalledOnce();
    expect(fetchDailyMarketReview).toHaveBeenCalledOnce();
  });

  it("refreshes the same three read queries after initial completion", async () => {
    vi.mocked(fetchPaperAutoExecutionStatus).mockResolvedValue(execution);
    await mount(); await tick();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="刷新每日任务中心"]')!.click());
    await tick();
    expect(fetchPaperAutoExecutionStatus).toHaveBeenCalledTimes(2);
    expect(fetchPaperTradingPlan).toHaveBeenCalledTimes(2);
    expect(fetchDailyMarketReview).toHaveBeenCalledTimes(2);
  });
});
