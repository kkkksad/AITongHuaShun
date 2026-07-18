import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("StrategyLeaderboard", () => {
  it("uses the shared research query state while retaining a cached report", () => {
    const source = readFileSync("src/components/StrategyLeaderboard.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("<ResearchQueryState");
    expect(source).toContain("hasData={Boolean(report)}");
    expect(source).not.toContain("leaderboardQuery.isLoading &&");
    expect(source).not.toContain("leaderboardQuery.isError &&");
  });
});