import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FlowPanel", () => {
  it("uses the shared research query state for loading and refresh failures", () => {
    const source = readFileSync("src/components/FlowPanel.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("<ResearchQueryState");
    expect(source).not.toContain("regimeQuery.isLoading &&");
    expect(source).not.toContain("regimeQuery.isError &&");
  });
});