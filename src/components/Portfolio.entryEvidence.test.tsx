import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PositionSnapshot } from "../../shared/trading";
import { Portfolio } from "./Portfolio";

const position: PositionSnapshot = { symbol: "600001", name: "测试持仓", quantity: 100,
  averagePrice: 10, currentPrice: 11, marketValue: 1100, unrealizedPnl: 100, realizedPnl: 0, weight: 0.055 };
function render(entry?: unknown) {
  const p = { ...position, ...(entry === undefined ? {} : { paperEntry: entry }) } as PositionSnapshot;
  return renderToStaticMarkup(createElement(Portfolio, { positions: [p], equity: 20_000 }));
}

describe("portfolio actual entry strategy evidence", () => {
  it("shows the actual finite strategy without replacing position values", () => {
    const html = render({ openedAt: "2026-11-02T02:00:00.000Z", strategy: { status: "single", strategyKey: "rsi" } });
    expect(html).toContain("入场：RSI");
    expect(html).toContain("¥10.00"); expect(html).toContain("¥11.00");
    expect(html).toContain("10.00%"); expect(html).toContain("5.5%");
  });
  it("distinguishes mixed buys from a single strategy", () => {
    expect(render({ openedAt: "2026-11-02T02:00:00.000Z", strategy: { status: "mixed" } })).toContain("入场：混合策略");
  });
  it.each([undefined, null, {}, { openedAt: "2026-11-02T02:00:00.000Z", strategy: null },
    { openedAt: "2026-11-02T02:00:00.000Z", strategy: { status: "unknown" } },
    { openedAt: "2026-11-02T02:00:00.000Z", strategy: { status: "single", strategyKey: "auto" } },
    { openedAt: "2026-11-02T02:00:00.000Z", strategy: { status: "single", strategyKey: "<script>bad</script>" } },
    { openedAt: "2026-11-02T02:00:00.000Z", strategy: { status: "single", strategyKey: "toString" } },
    { openedAt: "2026-11-02T02:00:00.000Z", strategy: { status: "future-state" } },
    { openedAt: null, strategy: { status: "single", strategyKey: "rsi" } },
    { openedAt: "bad-date", strategy: { status: "single", strategyKey: "rsi" } },
    { strategy: { status: "single", strategyKey: "rsi" } }])("keeps missing or unsupported evidence unknown: %j", (entry) => {
    const html = render(entry);
    expect(html).toContain("入场：未知");
    expect(html).not.toContain("bad"); expect(html).not.toContain("入场：市场自动路由");
  });
});
