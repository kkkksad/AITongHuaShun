import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { ThemeProvider } from "./hooks/useTheme";
import { I18nProvider } from "./i18n";
import { runBacktest } from "./lib/backtest";
import type { BacktestResult, StrategyParameters } from "./types";

vi.mock("./hooks/useTradingBackend", () => ({
  useTradingBackend: () => ({
    orders: [], positions: [], mode: "paper", marketDataProvider: "mock",
    connectionState: "connected", realtimeState: "connected", pendingAction: false,
  }),
}));
vi.mock("./lib/tradingApi", async (original) => ({
  ...await original<typeof import("./lib/tradingApi")>(),
  verifyLogin: async () => ({ user: { username: "local-interaction-test" } }),
}));
vi.mock("./components/PwaInstallPrompt", () => ({
  OfflineBanner: () => null, PwaInstallPrompt: () => null,
}));
// Keep the real App, shell, strategy form, workflow, Router and deterministic calculation.
vi.mock("./components/BacktestResults", () => ({
  BacktestResults: ({ result }: { result: BacktestResult }) =>
    <output data-testid="backtest-result">{JSON.stringify(result)}</output>,
}));
vi.mock("./components/StrategyCompare", () => ({ StrategyCompare: () => null }));
vi.mock("./components/StrategyLeaderboard", () => ({ StrategyLeaderboard: () => <div>real validation placeholder</div> }));
vi.mock("./components/StrategyRobustnessPanel", () => ({ StrategyRobustnessPanel: () => null }));
vi.mock("./pages/MarketPage", () => ({ default: () => <div>market research placeholder</div> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialParameters: StrategyParameters = {
  lookback: 20, entryThreshold: 1.4, stopLoss: 6, takeProfit: 15,
  maxPosition: 35, rebalanceDays: 5,
};

describe("App submitted backtest interactions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let path: string;
  let mounted: boolean;

  function LocationProbe() {
    const location = useLocation();
    const navigate = useNavigate();
    path = location.pathname + location.search;
    return <button data-testid="history-back" onClick={() => navigate(-1)}>history back</button>;
  }

  beforeAll(async () => {
    await Promise.all([
      import("./components/StrategyLab"), import("./components/BacktestResults"),
      import("./components/StrategyCompare"), import("./components/StrategyLeaderboard"),
      import("./components/StrategyRobustnessPanel"), import("./pages/MarketPage"),
    ]);
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    await act(async () => root.render(<ThemeProvider><I18nProvider>
      <MemoryRouter initialEntries={["/market", "/strategy?stage=configure"]} initialIndex={1}>
        <LocationProbe /><App />
      </MemoryRouter>
    </I18nProvider></ThemeProvider>));
    expect(container.querySelector(".strategy-lab .primary-button")).not.toBeNull();
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function click(button: HTMLButtonElement) { await act(async () => button.click()); }
  function runButton() { return container.querySelector<HTMLButtonElement>(".strategy-lab .primary-button")!; }
  function resultText() { return container.querySelector('[data-testid="backtest-result"]')?.textContent; }
  async function chooseStage(label: string) {
    const button = [...container.querySelectorAll<HTMLButtonElement>(".strategy-workflow-steps button")]
      .find((item) => item.textContent?.includes(label))!;
    await click(button);
  }
  async function finishExistingRun() {
    await click(runButton());
    // Later-edit assertions also cover the old implementation after it completes.
    await act(() => vi.advanceTimersByTimeAsync(420));
  }
  async function changeLookback(value: number) {
    const input = container.querySelector<HTMLInputElement>('.parameter-grid input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function selectStrategy(label: string) {
    const button = [...container.querySelectorAll<HTMLButtonElement>(".strategy-card")]
      .find((item) => item.querySelector("strong")?.textContent === label)!;
    await click(button);
  }

  it("opens the first deterministic result immediately without a timer-only loading state", async () => {
    expect(container.querySelector('[data-testid="backtest-result"]')).toBeNull();
    expect(container.textContent).toContain("等待首次回测");
    const backtestStage = [...container.querySelectorAll<HTMLButtonElement>(".strategy-workflow-steps button")]
      .find((button) => button.textContent?.includes("合成回测"))!;
    expect(backtestStage.disabled).toBe(true);

    await click(runButton());

    expect(path).toBe("/strategy?stage=backtest");
    expect(resultText()).toBe(JSON.stringify(runBacktest("momentum", initialParameters)));
    expect(container.textContent).toContain("合成样本结果");
    expect(container.textContent).toContain("不是真实历史收益");
    expect(container.textContent).not.toContain("正在计算");
  });

  it("reruns identical inputs immediately with an identical result", async () => {
    await finishExistingRun();
    const first = resultText();
    await chooseStage("配置策略");

    await click(runButton());

    expect(path).toBe("/strategy?stage=backtest");
    expect(resultText()).toBe(first);
    expect(container.textContent).not.toContain("结果已过期");
  });

  it("keeps a later validation-stage selection after running", async () => {
    await click(runButton());
    await chooseStage("真实验证");
    expect(path).toBe("/strategy?stage=validate");

    await act(() => vi.advanceTimersByTimeAsync(1_000));

    expect(path).toBe("/strategy?stage=validate");
    expect(container.textContent).toContain("独立真实验证");
  });

  it("keeps a later market navigation after running", async () => {
    await click(runButton());
    const market = [...container.querySelectorAll<HTMLButtonElement>(".primary-nav button")]
      .find((button) => button.textContent?.includes("市场观察"))!;
    await click(market);
    expect(path).toBe("/market");

    await act(() => vi.advanceTimersByTimeAsync(1_000));

    expect(path).toBe("/market");
    expect(container.textContent).toContain("market research placeholder");
  });

  it("keeps browser-back navigation after running", async () => {
    await click(runButton());
    await click(container.querySelector<HTMLButtonElement>('[data-testid="history-back"]')!);
    const destination = path;
    expect(destination).not.toBe("/strategy?stage=backtest");

    await act(() => vi.advanceTimersByTimeAsync(1_000));

    expect(path).toBe(destination);
  });

  it("leaves no pending run callback after unmount", async () => {
    const previousTimers = vi.getTimerCount();
    await click(runButton());
    await act(async () => root.unmount());
    mounted = false;

    expect(vi.getTimerCount()).toBeLessThanOrEqual(previousTimers);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(container.childNodes).toHaveLength(0);
  });

  it("keeps a committed parameter snapshot and marks later edits stale", async () => {
    await finishExistingRun();
    const committed = resultText();
    await chooseStage("配置策略");
    await changeLookback(40);
    expect(container.querySelector<HTMLInputElement>('.parameter-grid input[type="range"]')!.value).toBe("40");
    await chooseStage("合成回测");

    expect(resultText()).toBe(committed);
    expect(container.textContent).toContain("结果已过期");
    expect(container.textContent).toContain("上一次提交配置的结果");
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(resultText()).toBe(committed);
  });

  it("keeps a committed strategy until a new explicit run submits the current strategy and parameters", async () => {
    await finishExistingRun();
    const previous = resultText();
    await chooseStage("配置策略");
    await selectStrategy("均值回归");
    await changeLookback(40);
    await chooseStage("合成回测");
    expect(resultText()).toBe(previous);
    expect(container.querySelector(".strategy-context strong")?.textContent).toBe("趋势动量");
    expect(container.textContent).toContain("结果已过期");
    await chooseStage("配置策略");

    await click(runButton());

    expect(path).toBe("/strategy?stage=backtest");
    expect(resultText()).toBe(JSON.stringify(runBacktest("mean-reversion", { ...initialParameters, lookback: 40 })));
    expect(resultText()).not.toBe(previous);
    expect(container.querySelector(".strategy-context strong")?.textContent).toBe("均值回归");
    expect(container.textContent).not.toContain("结果已过期");
  });
});
