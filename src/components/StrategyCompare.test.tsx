import { act, cloneElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BacktestResult, StrategyDefinition } from "../types";
import { StrategyCompare } from "./StrategyCompare";

// Supply fixed chart dimensions while keeping the actual chart and component.
vi.mock("recharts", async (importOriginal) => ({
  ...await importOriginal<typeof import("recharts")>(),
  ResponsiveContainer: ({ children }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: 800, height: 300 }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const strategies: StrategyDefinition[] = [
  { id: "momentum", name: "趋势动量", shortName: "动量", description: "趋势测试", tag: "趋势", color: "#2563eb" },
  { id: "mean-reversion", name: "均值回归", shortName: "回归", description: "回归测试", tag: "回归", color: "#16a34a" },
];

const results: { strategy: StrategyDefinition; result: BacktestResult }[] = strategies.map((strategy, index) => ({
  strategy,
  result: {
    equityCurve: [
      { date: "3/2", portfolio: 100_000, benchmark: 100_000 },
      { date: "3/3", portfolio: index === 0 ? 112_000 : 105_000, benchmark: 101_000 },
    ],
    metrics: {
      totalReturn: index === 0 ? 0.12 : 0.05,
      annualizedReturn: index === 0 ? 0.2 : 0.1,
      maxDrawdown: index === 0 ? 0.15 : 0.04,
      sharpe: index === 0 ? 0.8 : 1.8,
      winRate: index === 0 ? 0.6 : 0.7,
      tradeCount: 10,
    },
    trades: [],
  },
}));

describe("StrategyCompare result transitions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });

  async function render(count: number) {
    await act(async () => {
      root.render(<StrategyCompare results={results.slice(0, count)} />);
    });
  }

  function expectEmpty() {
    expect(container.textContent).toContain("需要至少2个策略结果才能进行对比");
    expect(container.querySelector(".compare-ranking-table")).toBeNull();
  }

  function rankedNames() {
    return Array.from(container.querySelectorAll(".compare-ranking-table tbody .symbol-cell strong"))
      .map((element) => element.textContent);
  }

  it.each([0, 1])("renders the empty state for %i results", async (count) => {
    await render(count);
    expectEmpty();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("adds a second result on the same React instance without changing hook order", async () => {
    await render(1);
    expectEmpty();

    await render(2);

    expect(rankedNames()).toEqual(["趋势动量", "均值回归"]);
    expect(container.textContent).toContain("权益曲线对比");
    expect(container.querySelector(".compare-equity-chart svg")).not.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns from two results to one without changing hook order", async () => {
    await render(2);
    expect(rankedNames()).toHaveLength(2);

    await render(1);

    expectEmpty();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("moves from zero to two and back to zero on the same instance", async () => {
    await render(0);
    expectEmpty();
    await render(2);
    expect(rankedNames()).toHaveLength(2);

    await render(0);

    expectEmpty();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps the selected metric and its ranking when results temporarily become insufficient", async () => {
    await render(2);
    const sharpeButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".compare-metric-tabs button"))
      .find((button) => button.textContent === "夏普比率")!;
    await act(async () => sharpeButton.click());
    expect(rankedNames()).toEqual(["均值回归", "趋势动量"]);

    await render(1);
    expectEmpty();
    await render(2);

    expect(container.querySelector(".compare-tab.active")?.textContent).toBe("夏普比率");
    expect(rankedNames()).toEqual(["均值回归", "趋势动量"]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
