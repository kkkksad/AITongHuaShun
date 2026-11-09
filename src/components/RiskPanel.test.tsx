import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSnapshot, RiskLimits, RiskState } from "../../shared/trading";
import { fetchRiskState } from "../lib/tradingApi";
import { RiskPanel } from "./RiskPanel";

vi.mock("../lib/tradingApi", () => ({ fetchRiskState: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const key = ["paper-risk-state"];
const limits: RiskLimits = { maxOrderNotional: 5000, maxPositionWeight: 0.3, maxDailyLoss: 0.03, lotSize: 100, realTradingEnabled: false };
const account: AccountSnapshot = { accountId: "PAPER-CN-01", mode: "paper", cash: 15000, equity: 20000, marketValue: 5000,
  unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 4000, dailyPnlPercent: 0.25, riskUtilization: 0.3, paused: false,
  updatedAt: "2026-11-10T02:00:00.000Z",
  tradingDayPerformance: { date: "2026-11-10", openingEquity: 20408.16, pnl: -408.16, pnlPercent: -0.02, baselineSource: "previous-close" } };
const state: RiskState = { tradingDate: "2026-11-10", circuitState: "normal", consecutiveLosses: 1, dailyDrawdown: 0.02,
  peakDailyEquity: 20408.16, trippedAt: null, warningAt: null, tradeCount: 7, lossCount: 4, unknownCycleCount: 2,
  ledgerStatus: "ready", baselineResetDate: null, lastTradeTime: "2026-11-09T07:00:00.000Z", lastEvaluationTime: "2026-11-10T01:59:50.000Z" };

describe("actual Paper risk panel", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-10T02:00:00.000Z"));
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    vi.mocked(fetchRiskState).mockResolvedValue(state);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); vi.restoreAllMocks(); });
  async function render(overrides: Partial<AccountSnapshot> = {}, risk: RiskState | null = state) {
    if (risk) client.setQueryData(key, risk);
    await act(async () => root.render(<QueryClientProvider client={client}><RiskPanel limits={limits} account={{ ...account, ...overrides }} /></QueryClientProvider>));
    return container;
  }
  async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
  function dailyRow() { return [...container.querySelectorAll("tr")].find((row) => row.textContent?.includes("每日亏损停止线"))!; }

  it("uses actual daily losses despite a profitable cumulative account", async () => {
    await render();
    expect(container.textContent).toContain("当日盈亏");
    expect(container.textContent).toContain("-2.0%");
    expect(container.textContent).toContain("账户重置以来累计");
    expect(dailyRow().textContent).toContain("未触发");
  });
  it("does not trip the daily line because of old cumulative losses", async () => {
    await render({ dailyPnl: -4000, dailyPnlPercent: -0.2, tradingDayPerformance: { ...account.tradingDayPerformance!, pnl: 0, pnlPercent: 0 } });
    expect(dailyRow().textContent).toContain("未触发");
    expect(container.textContent).not.toContain("所有指标在安全范围内");
  });
  it.each([undefined, { ...account.tradingDayPerformance!, openingEquity: null, pnl: null, pnlPercent: null, baselineSource: "unavailable" as const }])(
    "keeps a missing daily baseline unknown rather than inferring it from cumulative PnL", async (tradingDayPerformance) => {
      await render({ dailyPnlPercent: -0.2, tradingDayPerformance });
      expect(dailyRow().textContent).toContain("待建立基线");
      expect(container.textContent).toContain("当日基线不可用");
      expect(container.textContent).not.toContain("所有指标在安全范围内");
    });
  it("shows a daily stop despite profitable cumulative returns", async () => {
    await render({ tradingDayPerformance: { ...account.tradingDayPerformance!, pnl: -1000, pnlPercent: -0.05 } });
    expect(dailyRow().textContent).toContain("已触发");
    expect(container.textContent).toContain("当日亏损已达停止线");
  });
  it("shows the actual tripped circuit even when utilization is low", async () => {
    await render({}, { ...state, circuitState: "tripped", trippedAt: "2026-11-10T01:30:00.000Z" });
    expect(container.textContent).toContain("风险熔断");
    expect(container.textContent).toContain("09:30:00");
    expect(container.textContent).not.toContain("所有指标在安全范围内");
  });
  it("shows the actual warning, peak drawdown and fee-inclusive cycle evidence", async () => {
    await render({}, { ...state, circuitState: "warning", warningAt: "2026-11-10T01:45:00.000Z" });
    expect(container.textContent).toContain("风险预警");
    expect(container.textContent).toContain("当日峰值回撤");
    expect(container.textContent).toContain("已知完整周期 7");
    expect(container.textContent).toContain("亏损 4");
    expect(container.textContent).toContain("缺入场证据 2");
    expect(container.textContent).toContain("买卖费用");
  });
  it.each([
    ["history-gap", "成交风险记录存在缺口"],
    ["checkpoint-unavailable", "风险状态保存异常"],
  ] as const)("explains %s without presenting it as normal", async (ledgerStatus, label) => {
    await render({}, { ...state, ledgerStatus });
    expect(container.textContent).toContain(label);
    expect(container.textContent).not.toContain("所有指标在安全范围内");
  });
  it("does not invent a ready ledger or zero unknown cycles for a legacy response", async () => {
    await render({}, { ...state, ledgerStatus: undefined, unknownCycleCount: undefined });
    expect(container.textContent).toContain("账本状态未提供");
    expect(container.textContent).toContain("缺入场证据未提供");
    expect(container.textContent).not.toContain("缺入场证据 0");
  });
  it("keeps risk state unknown while its first request is pending", async () => {
    vi.mocked(fetchRiskState).mockReturnValue(new Promise(() => undefined));
    await render({}, null);
    expect(fetchRiskState).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("等待风险状态");
    expect(container.textContent).not.toContain("所有指标在安全范围内");
  });
  it("preserves a cached snapshot with an explicit failure after a failed refresh", async () => {
    await render();
    vi.mocked(fetchRiskState).mockRejectedValue(new Error("fixture read unavailable"));
    await act(async () => { await client.invalidateQueries({ queryKey: key }); });
    await settle();
    expect(container.textContent).toContain("风险状态读取失败");
    expect(container.textContent).toContain("上次快照");
    expect(container.textContent).toContain("已知完整周期 7");
    expect(container.textContent).not.toContain("所有指标在安全范围内");
  });
  it("labels old risk dates rather than calling them current daily protection", async () => {
    await render({}, { ...state, tradingDate: "2026-11-09" });
    expect(container.textContent).toContain("风险观察日期未对齐");
    expect(container.textContent).toContain("2026-11-09");
  });
  it("does not call two matching old dates current protection", async () => {
    await render({ tradingDayPerformance: { ...account.tradingDayPerformance!, date: "2026-11-09" } }, { ...state, tradingDate: "2026-11-09" });
    expect(container.textContent).toContain("风险观察日期未对齐");
    expect(dailyRow().textContent).toContain("待建立基线");
  });
  it("labels same-day old observations despite successful state reads", async () => {
    await render({}, { ...state, lastEvaluationTime: "2026-11-10T01:50:00.000Z" });
    expect(container.textContent).toContain("风险观察尚未更新");
    expect(container.textContent).toContain("超过2分钟");
  });
  it("keeps stored failure and circuit facts visible while the account is paused", async () => {
    await render({ paused: true }, { ...state, ledgerStatus: "checkpoint-unavailable", circuitState: "tripped" });
    expect(container.textContent).toContain("交易已暂停");
    expect(container.textContent).toContain("风险状态保存异常");
    expect(container.textContent).toContain("已触发，恢复由服务端核验");
  });
  it("refreshes only the risk query on an explicit read and does not poll before account data exists", async () => {
    await act(async () => root.render(<QueryClientProvider client={client}><RiskPanel /></QueryClientProvider>));
    expect(fetchRiskState).not.toHaveBeenCalled();
    await render();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="刷新风险状态"]')!.click());
    await settle();
    expect(fetchRiskState).toHaveBeenCalledOnce();
    expect(fetchRiskState).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("cancels an outstanding read when the risk page leaves", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetchRiskState).mockImplementation((input) => {
      signal = input;
      return new Promise(() => undefined);
    });
    await render({}, null);
    expect(signal?.aborted).toBe(false);
    await act(async () => root.render(<div>另一页面</div>));
    expect(signal?.aborted).toBe(true);
  });
});
