import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("StockTrendForecastPanel query state", () => {
  it("uses the shared research query state instead of duplicating refresh-state markup", () => {
    const source = readFileSync(resolve("src/components/StockTrendForecastPanel.tsx"), "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("<ResearchQueryState");
    expect(source).not.toContain("getResearchRefreshState");
    expect(source).not.toContain("refreshState.showBlockingError");
    expect(source).not.toContain("refreshState.showStaleWarning");
  });
});
