import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EsotericMarketPanel } from "./EsotericMarketPanel";
import type { MarketSnapshot } from "../../shared/trading";

const market: MarketSnapshot = {
  mode: "paper",
  sequence: 1,
  marketTime: "2026-08-08T06:00:00.000Z",
  quotes: [{
    symbol: "600519",
    name: "贵州茅台",
    tradable: true,
    price: 1500,
    previousClose: 1490,
    changePercent: 0.67,
    volume: 1_000,
    amplitude: 1.2,
    updatedAt: "2026-08-08T05:59:00.000Z",
  }],
};

describe("EsotericMarketPanel", () => {
  it("renders the cultural observation boundary and current market check", () => {
    const html = renderToStaticMarkup(
      <EsotericMarketPanel today={new Date(2026, 7, 8)} />,
    );

    expect(html).toContain("玄学观察");
    expect(html).toContain("不会进入策略路由");
    expect(html).toContain("不得据此开仓");
    expect(html).toContain("传统参考");
    expect(html).toContain("Paper 执行");
    expect(html).toContain("盘面镜像");
    expect(html).toContain("收盘复盘问题");
    expect(html).toContain("不是胜率");
  });

  it("renders a bounded single-stock selector from the real snapshot", () => {
    const html = renderToStaticMarkup(
      <EsotericMarketPanel market={market} today={new Date(2026, 7, 8)} />,
    );

    expect(html).toContain("单票观察");
    expect(html).toContain("单票观察");
  });
});
