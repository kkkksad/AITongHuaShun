import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMarketRegimeResearch, type MarketRegimeResearchReport } from "../lib/tradingApi";
import { MarketRegimePanel } from "./MarketRegimePanel";

vi.mock("../lib/tradingApi", async original => ({
  ...await original<typeof import("../lib/tradingApi")>(), fetchMarketRegimeResearch: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function report(withStructure = true): MarketRegimeResearchReport {
  return {
    generatedAt: "2026-11-13T08:00:00.000Z", mode: "paper", provider: "akshare", sourceStatus: "live-read-only",
    source: { sectorSource: "frozen-test", sectorHistorySource: "frozen-test", stockHistorySource: "frozen-test",
      fetchedAt: "2026-11-13T07:30:00.000Z", days: 180, sectorAdjustment: "none", stockAdjustment: "qfq", sectorCount: 0, stockCount: 1 },
    methodology: { version: "test", horizons: [3, 5], minimumBars: 61, walkForward: true, probabilityMeaning: "仅研究评分" },
    sectorOutlooks: [], warnings: [], guardrails: [],
    stockRegimes: [{ rank: 1, symbol: "600001", name: "测试股票", latestDate: "2026-11-13", barCount: 80,
      regime: "unclear", confidence: 0.5,
      features: { return5d: 0, return20d: 0, return60d: 0, pullbackFrom20DayHigh: 0,
        distanceFromMa20: 0, distanceFromMa60: 0, ma20Slope5d: 0, ma60Slope5d: 0, volumeRatio: 1 },
      validation: { samples: 0, hitRate5d: null, averageForwardReturn5d: null }, evidence: ["旧形态依据"], riskFlags: [],
      ...(withStructure ? { historicalEntryStructure: {
        symbol: "600001", latestDate: "2026-11-13", barCount: 80, requiredBars: 61, source: "frozen-price-test",
        adjustment: "qfq", asOf: "2026-11-13T07:30:00.000Z",
        scope: "completed-qfq-daily-structure-not-live-intraday-signal-or-trade-permission", status: "observed", observed: true,
        validation: { invalidBars: 0, duplicateBars: 0, excludedIncompleteOrFutureBars: 0, trimmedBars: 0 },
        breakout: { resistanceWindowBars: 20, priorHigh20: 12, priorHighDate: "2026-11-02", latestClose: 11,
          latestDayHigh: 12.3, closesAbovePriorHigh20: false },
      } } : {}),
    }],
  };
}

describe("market regime completed structure interaction", () => {
  let root: Root, client: QueryClient, container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers(); vi.mocked(fetchMarketRegimeResearch).mockReset();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); vi.useRealTimers(); });
  async function mount() {
    await act(async () => { root.render(<QueryClientProvider client={client}><MarketRegimePanel /></QueryClientProvider>); });
    await act(() => vi.advanceTimersByTimeAsync(10));
  }
  function stockTab() {
    return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent?.includes("形态识别"))!;
  }

  it("uses the existing response once while tabbing and expanding without changing historical identity", async () => {
    const data = report(), before = structuredClone(data);
    vi.mocked(fetchMarketRegimeResearch).mockResolvedValue(data); await mount();
    await act(async () => stockTab().click());
    expect(container.querySelector('[role="tabpanel"]')?.getAttribute("tabindex")).toBe("0");
    const details = container.querySelector("details")!;
    expect(details.textContent).toContain("冲高未站稳");
    expect(details.textContent).toContain("回撤证据未知");
    expect(container.textContent).toContain("旧形态依据");
    expect(details.open).toBe(false);
    await act(async () => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.textContent).toContain("15:30:00");
    expect(fetchMarketRegimeResearch).toHaveBeenCalledTimes(1);
    const [sectors, stocks, days, signal] = vi.mocked(fetchMarketRegimeResearch).mock.calls[0];
    expect([sectors, stocks, days]).toEqual([10, 8, 180]);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
    expect(data).toEqual(before);
    await act(async () => root.render(null));
    expect(fetchMarketRegimeResearch).toHaveBeenCalledTimes(1);
  });

  it("keeps legacy data unknown without requesting a replacement history", async () => {
    vi.mocked(fetchMarketRegimeResearch).mockResolvedValue(report(false)); await mount();
    await act(async () => stockTab().click());
    expect(container.textContent).toContain("完成日线结构未知");
    expect(container.querySelector("details")).toBeNull();
    expect(fetchMarketRegimeResearch).toHaveBeenCalledTimes(1);
  });

  it("still aborts the existing pending request when leaving the panel", async () => {
    vi.mocked(fetchMarketRegimeResearch).mockImplementation(() => new Promise(() => {}));
    await mount();
    const signal = vi.mocked(fetchMarketRegimeResearch).mock.calls[0][3]!;
    expect(signal.aborted).toBe(false);
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    expect(fetchMarketRegimeResearch).toHaveBeenCalledTimes(1);
  });
});
