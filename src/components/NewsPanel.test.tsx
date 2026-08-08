import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RealNewsItem } from "../lib/tradingApi";
import { filterNewsItems } from "./NewsPanel";

describe("NewsPanel", () => {
  it("uses the shared research query state for loading and refresh failures", () => {
    const source = readFileSync("src/components/NewsPanel.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("<ResearchQueryState");
    expect(source).not.toContain("getResearchRefreshState");
    expect(source).not.toContain("showBlockingError");
    expect(source).not.toContain("showStaleWarning");
    expect(source).toContain("realResearchNewsFeedQueryOptions()");
  });

  it("paginates the full bounded feed instead of slicing five headlines", () => {
    const source = readFileSync("src/components/NewsPanel.tsx", "utf8");

    expect(source).toContain('import { paginateItems } from "../lib/pagination";');
    expect(source).toContain("const PAGE_SIZE = 10");
    expect(source).not.toContain("slice(0, 5)");
    expect(source).toContain('aria-label="新闻上一页"');
    expect(source).toContain('aria-label="新闻下一页"');
    expect(source).toContain('rel="noreferrer"');
  });

  it("filters the aggregated feed by macro, market, and company category", () => {
    const items = (["macro", "market", "company"] as const).map((category) => ({
      id: category,
      source: "source",
      title: category,
      publishedAt: "2026-07-19T00:00:00+08:00",
      fetchedAt: "2026-07-19T00:00:00Z",
      url: null,
      symbols: category === "company" ? ["600519"] : [],
      sentiment: "neutral" as const,
      summary: null,
      category,
    })) satisfies RealNewsItem[];

    expect(filterNewsItems(items, "all")).toHaveLength(3);
    expect(filterNewsItems(items, "macro").map((item) => item.id)).toEqual([
      "macro",
    ]);
    expect(filterNewsItems(items, "company").map((item) => item.id)).toEqual([
      "company",
    ]);
  });
});
