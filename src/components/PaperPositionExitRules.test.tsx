import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PositionSnapshot } from "../../shared/trading";
import { PaperPositionExitRules } from "./PaperPositionExitRules";
import { Portfolio } from "./Portfolio";

function render(averagePrice: number) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(PaperPositionExitRules, { averagePrice }));
  return root;
}

describe("actual Paper position exit policy explanation", () => {
  it("shows the unrounded cost-based reference for the China State Construction case", () => {
    const root = render(4.69);
    expect(root.querySelector("[data-cost-stop-price]")?.textContent).toBe("¥4.5493");
    expect(root.textContent).toContain("不含费用");
    expect(root.textContent).toContain("不表示当前已触发");
    expect(root.querySelector("details")?.open).toBe(false);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("does not invent a reference from invalid cost %s", cost => {
    const root = render(cost);
    expect(root.textContent).toContain("成本无效，参考价未知");
    expect(root.querySelector("[data-cost-stop-price]")).toBeNull();
    expect(root.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("keeps references tied to each actual average cost despite different market prices", () => {
    const positions: PositionSnapshot[] = [
      { symbol: "601668", name: "测试甲", quantity: 500, averagePrice: 4.69, currentPrice: 4.55,
        marketValue: 2275, unrealizedPnl: -70, realizedPnl: 0, weight: 0.11375 },
      { symbol: "600001", name: "测试乙", quantity: 100, averagePrice: 100, currentPrice: 110,
        marketValue: 11000, unrealizedPnl: 1000, realizedPnl: 0, weight: 0.55 },
    ];
    const before = structuredClone(positions);
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(createElement(Portfolio, { positions }));
    expect([...root.querySelectorAll("[data-cost-stop-price]")].map(item => item.textContent).sort())
      .toEqual(["¥4.5493", "¥97.0000"]);
    expect(positions).toEqual(before);
    expect(root.textContent).toContain("¥4.55");
    expect(root.textContent).toContain("¥110.00");
  });

  it("distinguishes shared risk exits from absent strategy-specific profit and time exits", () => {
    const root = render(10);
    expect(root.textContent).toContain("市场要求减仓且个股趋势恶化");
    expect(root.textContent).toContain("65%");
    expect(root.textContent).toContain("T+1");
    expect(root.textContent).toContain("整手");
    expect(root.textContent).toContain("固定止盈、跟踪止盈和超时退出尚未接入");
    expect(root.textContent).toContain("入场标签不代表专属退出规则");
    expect(root.querySelector("button, form, a")).toBeNull();
  });
});
