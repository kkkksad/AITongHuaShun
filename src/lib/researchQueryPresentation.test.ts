import { describe, expect, it } from "vitest";
import { getResearchRefreshState } from "./researchQueryPresentation";

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
});