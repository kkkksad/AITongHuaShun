import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PositionSnapshot } from "../../shared/trading";
import { Portfolio } from "./Portfolio";

function holding(marketValue: number, weight = 0.055, index = 0): PositionSnapshot {
  return { symbol: String(600000 + index), name: `持仓${index}`, quantity: 100,
    averagePrice: 10, currentPrice: 11, marketValue, unrealizedPnl: 100, realizedPnl: 0, weight };
}
function render(positions: PositionSnapshot[]) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(Portfolio, { positions }));
  const card = [...root.querySelectorAll(".summary-card")].find(item => item.textContent?.includes("集中度"));
  if (!card) throw Error("Missing concentration summary");
  return { root, card, value: card.querySelector("strong")?.textContent };
}

describe("holdings-only stock concentration", () => {
  it("normalizes three equal holdings within stocks rather than diluting with cash", () => {
    expect(render([0, 1, 2].map(i => holding(1100, 0.055, i))).value).toBe("33.3%");
  });
  it("does not change when cash and account weights change but holdings do not", () => {
    for (const accountWeight of [0.01, 0.1, 1 / 3]) {
      expect(render([0, 1, 2].map(i => holding(1100, accountWeight, i))).value).toBe("33.3%");
    }
  });
  it("shows a single stock as fully concentrated even with mostly cash", () => {
    expect(render([holding(1100, 0.01)]).value).toBe("100.0%");
  });
  it("uses actual stock market values for an unequal mix", () => {
    expect(render([holding(7000, 0.07), holding(3000, 0.03, 1)]).value).toBe("58.0%");
  });
  it("ignores rounded or stale account weights when the stock mix is equal", () => {
    expect(render([holding(1000, 0.9), holding(1000, 0.1, 1)]).value).toBe("50.0%");
  });
  it.each([{ positions: [] }, { positions: [holding(0, 0)] },
    { positions: [holding(0, 0), holding(0, 0, 1)] }])("does not call an empty stock mix diversified: %j", ({ positions }) => {
    const { value, card, root } = render(positions);
    expect(value).toBe("—"); expect(card.querySelector("strong")?.className).not.toContain("positive");
    expect(root.textContent).toContain(positions.length ? "暂无有效持仓市值" : "暂无持仓数据");
    expect(root.querySelector(".portfolio-allocation-legend")).toBeNull();
  });
  it.each([NaN, Infinity, -1])("does not report a known concentration with invalid market value %j", value => {
    expect(render([holding(1100), holding(value, 0.05, 1)]).value).toBe("—");
  });
  it("keeps zero-valued rows from diluting the one positive holding", () => {
    expect(render([holding(1100), holding(0, 0.05, 1)]).value).toBe("100.0%");
  });
  it("makes the stock-only scope visible and preserves economic values and table weights", () => {
    const positions = [Object.freeze(holding(1100, 0.055))];
    const { root, card } = render(positions);
    expect(card.textContent).toContain("持仓内个股集中度");
    expect(card.textContent).toContain("不反映行业及相关性");
    expect(root.textContent).toContain("5.5%");
    expect(root.textContent).toContain("10.00%");
    expect(root.textContent).toContain("¥10.00");
    expect(positions[0]).toEqual(holding(1100, 0.055));
  });

  it("groups only the tail by market value and preserves duplicate display names by symbol", () => {
    const positions = Array.from({ length: 10 }, (_, index) => ({ ...holding((10 - index) * 1000, 0.01, index), name: "同名持仓" }));
    const { root } = render(positions);
    const items = [...root.querySelectorAll(".portfolio-allocation-legend li")];
    expect(items).toHaveLength(8);
    expect(items[0].querySelector("small")?.textContent).toBe("600000");
    expect(items[0].querySelector(".portfolio-allocation-value")?.textContent).toBe("18.2%");
    expect(items[1].querySelector("small")?.textContent).toBe("600001");
    expect(items[1].querySelector(".portfolio-allocation-value")?.textContent).toBe("16.4%");
    expect(items[7].textContent).toBe("其他 (3 个)10.9%");
  });
});
