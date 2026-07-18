import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { MarketOverview } from "./MarketOverview";

function render(
  market?: MarketSnapshot,
  connectionState: "connected" | "offline" = "connected",
) {
  return renderToStaticMarkup(
    <MarketOverview connectionState={connectionState} market={market} />,
  );
}

describe("MarketOverview", () => {
  it("does not replace a missing live index with static demonstration values", () => {
    const html = render({
      mode: "paper",
      sequence: 1,
      marketTime: "2026-07-19T08:00:00.000Z",
      quotes: [{
        symbol: "600519",
        name: "贵州茅台",
        tradable: true,
        price: 1500,
        previousClose: 1490,
        changePercent: 0.67,
        volume: 1000,
        updatedAt: "2026-07-19T08:00:00.000Z",
      }],
    });

    expect(html).toContain("指数行情暂未返回");
    expect(html).toContain("不使用静态指数补位");
    expect(html).not.toContain("上证指数");
  });

  it("renders actual non-tradable index quotes", () => {
    const html = render({
      mode: "paper",
      sequence: 2,
      marketTime: "2026-07-19T08:00:00.000Z",
      quotes: [{
        symbol: "SH000001",
        name: "上证指数",
        tradable: false,
        price: 3500,
        previousClose: 3480,
        changePercent: 0.57,
        volume: 1000,
        updatedAt: "2026-07-19T08:00:00.000Z",
      }],
    });

    expect(html).toContain("上证指数");
    expect(html).toContain("3,500");
    expect(html).not.toContain("静态指数补位");
  });
});
