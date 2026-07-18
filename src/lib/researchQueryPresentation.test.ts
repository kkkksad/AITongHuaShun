import { describe, expect, it } from "vitest";
import { formatResearchDataTime, getResearchRefreshState } from "./researchQueryPresentation";

describe("research query presentation", () => {
  it("keeps successful data visible when a background refresh fails", () => {
    expect(getResearchRefreshState({ hasData: true, isError: true })).toEqual({
      showBlockingError: false,
      showStaleWarning: true,
    });
  });

  it("shows a blocking error only when no successful data exists", () => {
    expect(getResearchRefreshState({ hasData: false, isError: true })).toEqual({
      showBlockingError: true,
      showStaleWarning: false,
    });
  });

  it("formats the retained result update time and handles an unknown timestamp", () => {
    expect(formatResearchDataTime(0)).toBe("未知");
    expect(formatResearchDataTime(Date.parse("2026-07-18T03:04:05Z"))).toContain("2026");
  });
});
