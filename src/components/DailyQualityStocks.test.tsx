import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DailyQualityStocks", () => {
  it("uses the shared research query state without replacing cached stocks", () => {
    const source = readFileSync("src/components/DailyQualityStocks.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("<ResearchQueryState");
    expect(source).toContain("hasData={Boolean(report)}");
    expect(source).toContain("const PAGE_SIZE = 8;");
    expect(source).toContain("paginateItems(stocks, page, PAGE_SIZE)");
    expect(source).toContain("pagination.items.map");
    expect(source).not.toContain("qualityQuery.isLoading &&");
    expect(source).not.toContain("qualityQuery.isError &&");
  });
});
