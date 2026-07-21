import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LearningPipeline", () => {
  it("uses the shared research query state for learning memory", () => {
    const source = readFileSync("src/components/LearningPipeline.tsx", "utf8");

    expect(source).toContain('import { ResearchQueryState } from "./ResearchQueryState";');
    expect(source).toContain("hasData={Boolean(learningState)}");
    expect(source).toContain("isLoading={learningStateQuery.isLoading}");
    expect(source).toContain("isError={learningStateQuery.isError}");
    expect(source).toContain("dataUpdatedAt={learningStateQuery.dataUpdatedAt}");
    expect(source).toContain('loadingText="正在加载研究记忆…"');
    expect(source).toContain('unavailableText="研究记忆暂不可用，请稍后重试。"');
  });

  it("shows the audited reason for entering or staying out", () => {
    const source = readFileSync("src/components/LearningPipeline.tsx", "utf8");

    expect(source).toContain("dailyReview.entryReview.summary");
    expect(source).toContain("dailyReview.entryReview.reasons.map");
    expect(source).toContain("为什么没有入场 / 为什么入场");
  });
});
