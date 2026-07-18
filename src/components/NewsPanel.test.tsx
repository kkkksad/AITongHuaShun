import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("NewsPanel", () => {
  it("uses the shared research query state for loading and refresh failures", () => {
    const source = readFileSync("src/components/NewsPanel.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("<ResearchQueryState");
    expect(source).not.toContain("getResearchRefreshState");
    expect(source).not.toContain("showBlockingError");
    expect(source).not.toContain("showStaleWarning");
  });
});
