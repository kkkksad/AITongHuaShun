import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DailyCandidates", () => {
  it("uses the shared research query state without replacing cached candidates", () => {
    const source = readFileSync("src/components/DailyCandidates.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("<ResearchQueryState");
    expect(source).toContain("hasData={Boolean(report)}");
    expect(source).not.toContain("candidatesQuery.isLoading &&");
    expect(source).not.toContain("candidatesQuery.isError &&");
  });
});