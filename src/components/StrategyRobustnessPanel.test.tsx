import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrategyRobustnessPanel } from "./StrategyRobustnessPanel";
import { fetchStrategyRobustness, type StrategyRobustnessEntry, type StrategyRobustnessReport } from "../lib/tradingApi";

vi.mock("../lib/tradingApi", () => ({ fetchStrategyRobustness: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const key = ["strategy-robustness", 12, 500];
function entry(symbol: string, overrides: Partial<StrategyRobustnessEntry> = {}): StrategyRobustnessEntry {
  return { rank: 1, strategyKey: "sample", strategyName: "同一策略", strategyFamily: "trend", fixedParams: {},
    evaluatedSymbol: symbol, evaluatedName: symbol === "600001" ? "第一股" : "第二股", windows: 3, profitableWindows: 1,
    totalTrades: 8, medianReturn: 0.01, worstReturn: -0.02, averageMaxDrawdown: 0.02, worstMaxDrawdown: 0.03,
    averageWinRate: 0.3333, closedMatches: 4, winningMatches: 1, closedMatchWinRate: 0.25,
    averageSharpeRatio: 0.2, averageProfitFactor: 1, evidenceScore: 60, fragilityFlags: [], stabilityGate: "caution", ...overrides };
}
function report(entries = [entry("600001"), entry("600002", { totalTrades: 12 })]): StrategyRobustnessReport {
  return { generatedAt: "2026-11-09T20:00:00Z", mode: "paper", provider: "akshare", sourceStatus: "live-read-only",
    source: { sampleType: "real-qfq-fixed-parameter-multi-window", historySource: "actual-history", fetchedAt: "2026-11-09T20:00:00Z",
      adjustment: "qfq", requestedDays: 500, requestedSymbols: 2, historySymbols: 2, testedSymbols: 2, symbolWindowTests: 6, alignedTradingDays: 400, windowCount: 3 },
    methodology: { parametersOptimizedOnReportData: false, nonOverlappingWindows: true, minimumAlignedTradingDays: 300, stabilityMeaning: "逐股三窗", evidenceScoreMeaning: "非概率" },
    entries, warnings: [], guardrails: [] };
}

describe("per-stock strategy robustness panel", () => {
  let root: Root, container: HTMLDivElement, client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); });
  async function render(data: StrategyRobustnessReport) {
    client.setQueryData(key, data); vi.mocked(fetchStrategyRobustness).mockResolvedValue(data);
    await act(async () => root.render(<QueryClientProvider client={client}><StrategyRobustnessPanel /></QueryClientProvider>));
  }
  function rows() { return container.querySelectorAll("tbody tr"); }

  it("shows one stock at a time and switches identical strategy keys safely", async () => {
    await render(report());
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="选择验证股票"]');
    expect(select).not.toBeNull(); expect(select!.options).toHaveLength(2);
    expect(rows()).toHaveLength(1); expect(rows()[0].textContent).toContain("8");
    await act(async () => { select!.value = "600002"; select!.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(rows()).toHaveLength(1); expect(rows()[0].textContent).toContain("12");
    expect(container.textContent).toContain("第二股");
    expect(container.textContent).toContain("合计 6 次单股窗口验证");
  });

  it("uses pooled closed matches instead of unweighted average window win rate", async () => {
    await render(report());
    expect(rows()[0].textContent).toContain("25.00%");
    expect(rows()[0].textContent).toContain("1 / 4");
    expect(rows()[0].textContent).not.toContain("33.33%");
    expect(container.textContent).toContain("未平仓盈亏不进入闭合片段胜率");
  });

  it("keeps no closed samples unknown even when buys have filled", async () => {
    await render(report([entry("600001", { totalTrades: 7, closedMatches: 0, winningMatches: 0, closedMatchWinRate: null })]));
    expect(container.textContent).toContain("无闭合样本");
    const cell = rows()[0].querySelector('[data-closed-match-rate]');
    expect(cell?.textContent).toContain("—"); expect(cell?.textContent).not.toContain("0.00%");
  });

  it.each([
    ["all losses", 0, 4, 0, "0.00%"],
    ["all wins", 4, 4, 1, "100.00%"],
    ["rounded third", 1, 3, 0.3333, "33.33%"],
    ["rounded two thirds", 2, 3, 0.6667, "66.67%"],
    ["half-up rounding", 1, 32, 0.0313, "3.13%"],
  ])("preserves valid server evidence: %s", async (_name, wins, total, rate, displayed) => {
    const data = report([entry("600001", { winningMatches: wins, closedMatches: total, closedMatchWinRate: rate })]);
    const before = structuredClone(data);
    await render(data);
    const cell = rows()[0].querySelector("[data-closed-match-rate]");
    expect(cell?.textContent).toBe(`${displayed}盈利 ${wins} / ${total}`);
    expect(rows()[0].querySelectorAll("td")[3].textContent).toBe("8");
    expect(data).toEqual(before);
    expect(fetchStrategyRobustness).not.toHaveBeenCalled();
  });

  it.each([
    ["missing numerator", { winningMatches: undefined }, "未提供盈利分子"],
    ["missing denominator", { closedMatches: undefined }, "未提供闭合分母"],
    ["missing rate", { closedMatchWinRate: undefined }, "未提供闭合胜率"],
    ["null rate for positive samples", { closedMatchWinRate: null }, "未提供闭合胜率"],
  ] satisfies [string, Partial<StrategyRobustnessEntry>, string][])("keeps incomplete evidence unknown: %s", async (_name, overrides, message) => {
    await render(report([entry("600001", overrides)]));
    expect(rows()[0].querySelector("[data-closed-match-rate]")?.textContent).toBe(`—${message}`);
    expect(fetchStrategyRobustness).not.toHaveBeenCalled();
  });

  it.each([
    ["negative numerator", { winningMatches: -1 }],
    ["fractional numerator", { winningMatches: 1.5 }],
    ["unsafe numerator", { winningMatches: Number.MAX_SAFE_INTEGER + 1 }],
    ["nonfinite numerator", { winningMatches: Infinity }],
    ["NaN numerator", { winningMatches: NaN }],
    ["negative denominator", { closedMatches: -4 }],
    ["fractional denominator", { closedMatches: 4.5 }],
    ["unsafe denominator", { closedMatches: Number.MAX_SAFE_INTEGER + 1 }],
    ["nonfinite denominator", { closedMatches: Infinity }],
    ["NaN denominator", { closedMatches: NaN }],
    ["more wins than samples", { winningMatches: 5 }],
    ["NaN rate", { closedMatchWinRate: NaN }],
    ["infinite rate", { closedMatchWinRate: Infinity }],
    ["negative rate", { closedMatchWinRate: -0.25 }],
    ["rate over one", { closedMatchWinRate: 1.25 }],
    ["mismatched rate", { closedMatchWinRate: 0.5 }],
    ["unrounded rate outside server contract", { winningMatches: 1, closedMatches: 3, closedMatchWinRate: 1 / 3 }],
    ["false zero sample rate", { winningMatches: 0, closedMatches: 0, closedMatchWinRate: 0 }],
    ["zero sample with wins", { winningMatches: 1, closedMatches: 0, closedMatchWinRate: null }],
  ] satisfies [string, Partial<StrategyRobustnessEntry>][])("rejects unverifiable cached evidence: %s", async (_name, overrides) => {
    const data = report([entry("600001", overrides)]), before = structuredClone(data);
    await render(data);
    expect(rows()[0].querySelector("[data-closed-match-rate]")?.textContent).toBe("—闭合样本不可核对");
    expect(rows()[0].querySelectorAll("td")[3].textContent).toBe("8");
    expect(data).toEqual(before);
    expect(fetchStrategyRobustness).not.toHaveBeenCalled();
  });

  it("explains missing stock coverage and denominator in a legacy report", async () => {
    const legacy = report([entry("600001", { evaluatedSymbol: undefined, evaluatedName: undefined, closedMatches: undefined, winningMatches: undefined, closedMatchWinRate: undefined })]);
    legacy.source.testedSymbols = undefined; legacy.source.symbolWindowTests = undefined;
    await render(legacy);
    expect(container.textContent).toContain("旧报告未提供逐股覆盖");
    expect(container.textContent).toContain("未提供闭合分母");
    expect(rows()).toHaveLength(1); expect(container.querySelector("select")).toBeNull();
    expect(rows()[0].textContent).not.toContain("33.33%");
  });

  it("retains a selected stock through refresh and recovers if it disappears", async () => {
    await render(report());
    const select = container.querySelector("select")!;
    expect(select).not.toBeNull();
    await act(async () => { select.value = "600002"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { client.setQueryData(key, report([entry("600001"), entry("600002", { totalTrades: 19 })])); await new Promise(r => setTimeout(r, 1)); });
    expect(container.querySelector("select")?.value).toBe("600002"); expect(rows()[0].textContent).toContain("19");
    await act(async () => { client.setQueryData(key, report([entry("600001")])); await new Promise(r => setTimeout(r, 1)); });
    expect(container.querySelector("select")?.value).toBe("600001"); expect(rows()).toHaveLength(1);
  });
});
