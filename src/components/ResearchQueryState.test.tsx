import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResearchQueryState } from "./ResearchQueryState";

describe("ResearchQueryState", () => {
  it("renders a blocking error only when no successful result exists", () => {
    const html = renderToStaticMarkup(
      <ResearchQueryState
        dataUpdatedAt={0}
        hasData={false}
        isError
        isLoading={false}
        loadingText="正在加载"
        unavailableText="研究暂不可用"
      />,
    );

    expect(html).toContain("研究暂不可用");
    expect(html).not.toContain("缓存数据");
  });

  it("keeps the error non-blocking when cached data remains available", () => {
    const html = renderToStaticMarkup(
      <ResearchQueryState
        dataUpdatedAt={Date.parse("2026-07-18T03:04:05Z")}
        hasData
        isError
        isLoading={false}
        loadingText="正在加载"
        unavailableText="研究暂不可用"
      />,
    );

    expect(html).toContain("继续显示缓存数据");
    expect(html).toContain("上次成功更新");
    expect(html).not.toContain("研究暂不可用");
  });

  it("renders a stable loading message before the first result", () => {
    const html = renderToStaticMarkup(<ResearchQueryState dataUpdatedAt={0} hasData={false} isError={false} isLoading loadingText="正在加载" unavailableText="研究暂不可用" />);
    expect(html).toContain("正在加载");
  });

  it("does not cover retained content with the initial loading state during a refresh", () => {
    const html = renderToStaticMarkup(
      <ResearchQueryState
        dataUpdatedAt={Date.parse("2026-07-18T03:04:05Z")}
        hasData
        isError={false}
        isLoading
        loadingText="正在加载期货研究"
        unavailableText="期货研究暂不可用"
      />,
    );

    expect(html).toBe("");
  });
});
