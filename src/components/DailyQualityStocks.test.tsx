import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DailyQualityStocks", () => {
  it("uses the shared research query state without replacing cached stocks", () => {
    const source = readFileSync("src/components/DailyQualityStocks.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("<ResearchQueryState");
    expect(source).toContain("hasData={Boolean(report)}");
    expect(source).not.toContain("qualityQuery.isLoading &&");
    expect(source).not.toContain("qualityQuery.isError &&");
  });
});