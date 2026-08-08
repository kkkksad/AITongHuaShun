import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EsotericMarketPanel } from "./EsotericMarketPanel";

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
});
