import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DailyCandidates", () => {
  it("uses the shared research query state without replacing cached candidates", () => {
    const source = readFileSync("src/components/DailyCandidates.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("<ResearchQueryState");
    expect(source).toContain("hasData={Boolean(report)}");
    expect(source).toContain("const PAGE_SIZE = 8;");
    expect(source).toContain("paginateItems(candidates, page, PAGE_SIZE)");
    expect(source).toContain("pagination.items.map");
    expect(source).not.toContain("candidatesQuery.isLoading &&");
    expect(source).not.toContain("candidatesQuery.isError &&");
  });
});
