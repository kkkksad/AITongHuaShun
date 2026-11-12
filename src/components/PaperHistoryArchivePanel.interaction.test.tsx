import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPaperHistoryArchive } from "../lib/tradingApi";
import { PaperHistoryArchivePanel } from "./PaperHistoryArchivePanel";

vi.mock("../lib/tradingApi", async (original) => ({
  ...await original<typeof import("../lib/tradingApi")>(), fetchPaperHistoryArchive: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("archive loading and retry", () => {
  let root: Root, client: QueryClient, container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers(); vi.mocked(fetchPaperHistoryArchive).mockReset();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); vi.useRealTimers(); });
  async function mount() {
    await act(async () => { root.render(<QueryClientProvider client={client}><PaperHistoryArchivePanel /></QueryClientProvider>); });
    await act(() => vi.advanceTimersByTimeAsync(10));
  }
  it("allows manual retry after an initial failure", async () => {
    vi.mocked(fetchPaperHistoryArchive).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ state: "waiting-for-account", data: null });
    await mount();
    expect(container.textContent).toContain("归档暂不可用");
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="刷新长期 Paper 归档"]')!.click(); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(container.textContent).toContain("等待当前账户归档");
    expect(fetchPaperHistoryArchive).toHaveBeenCalledTimes(2);
  });
  it("passes and aborts the request signal when leaving the panel", async () => {
    vi.mocked(fetchPaperHistoryArchive).mockImplementation(() => new Promise(() => {}));
    await mount();
    const signal = vi.mocked(fetchPaperHistoryArchive).mock.calls[0][0]!;
    expect(signal.aborted).toBe(false);
    await act(async () => { root.render(null); });
    expect(signal.aborted).toBe(true);
  });
  it("expands archived identities locally and refreshes only through the existing query", async () => {
    const data = {
      schemaVersion: 1 as const, accountId: "PAPER-CN-01", generatedAt: "2026-11-09T15:00:00Z",
      firstObservedAt: "2026-11-09T14:00:00Z", lastObservedAt: "2026-11-09T15:00:00Z",
      window: { fromDate: "2026-11-03", toDate: "2026-11-09" }, runCount: 1, openSessionRuns: 1,
      unknownSessionRuns: 0, submittedAttempts: 0, submissionEvidenceRuns: 1,
      days: [], blockers: [], issues: [], latestRuns: [{ occurredAt: "2026-11-09T14:00:00Z", session: "open" as const,
        phase: null, regime: null, planQuality: null, sourceStatus: null, submittedOrders: 0, skippedOperations: 0,
        blockers: {}, issues: [], stockHistoryCoverage: { scope: "regime-stock-history" as const,
          asOf: "2026-11-09T13:45:00.000Z", selectedSymbols: ["601398"], returnedSymbols: ["601398"],
          acceptedSymbols: ["601398"], usableSymbols: ["601398"] } }],
    };
    vi.mocked(fetchPaperHistoryArchive).mockResolvedValue({ state: "ready", data });
    await mount();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    await act(async () => { details.querySelector("summary")!.click(); });
    expect(details.open).toBe(true);
    expect(details.textContent).toContain("601398");
    expect(fetchPaperHistoryArchive).toHaveBeenCalledTimes(1);
    await act(async () => { details.querySelector("summary")!.click(); });
    expect(details.open).toBe(false);
    expect(fetchPaperHistoryArchive).toHaveBeenCalledTimes(1);
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="刷新长期 Paper 归档"]')!.click(); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(fetchPaperHistoryArchive).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchPaperHistoryArchive).mock.calls.every(([signal]) => signal instanceof AbortSignal)).toBe(true);
  });
  it("marks a failed refresh without inventing a three-minute archive delay", async () => {
    const evidence = {
      schemaVersion: 1 as const, accountId: "PAPER-CN-01", generatedAt: "2026-11-09T15:00:00Z",
      firstObservedAt: "2026-11-09T14:00:00Z", lastObservedAt: "2026-11-09T15:00:00Z",
      window: { fromDate: "2026-11-03", toDate: "2026-11-09" }, runCount: 8, openSessionRuns: 0,
      unknownSessionRuns: 8, submittedAttempts: 0, submissionEvidenceRuns: 0,
      days: [], blockers: [], issues: [], latestRuns: [],
    };
    vi.mocked(fetchPaperHistoryArchive).mockResolvedValueOnce({ state: "ready", data: evidence })
      .mockRejectedValueOnce(new Error("offline"));
    await mount();
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="刷新长期 Paper 归档"]')!.click(); });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(container.textContent).toContain("本次刷新失败");
    expect(container.textContent).toContain("2026-11-03 — 2026-11-09");
    expect(container.textContent).not.toContain("超过三分钟未更新");
  });
});
