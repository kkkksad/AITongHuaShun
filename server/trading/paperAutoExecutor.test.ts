import { describe, expect, it } from "vitest";
import { shouldRunScheduledPaperAutoExecution } from "./paperAutoExecutor";

describe("shouldRunScheduledPaperAutoExecution", () => {
  it.each([
    ["pre-market", "2026-07-16T09:00:00+08:00"],
    ["lunch break", "2026-07-16T12:00:00+08:00"],
    ["after hours", "2026-07-16T16:00:00+08:00"],
    ["weekend", "2026-07-18T10:00:00+08:00"],
  ])("skips %s timer runs when trade-window-only is enabled", (_label, value) => {
    expect(
      shouldRunScheduledPaperAutoExecution(new Date(value), true),
    ).toBe(false);
  });

  it("runs the timer during the A-share session", () => {
    expect(
      shouldRunScheduledPaperAutoExecution(
        new Date("2026-07-16T10:00:00+08:00"),
        true,
      ),
    ).toBe(true);
  });

  it("allows scheduled runs in all sessions when the restriction is disabled", () => {
    expect(
      shouldRunScheduledPaperAutoExecution(
        new Date("2026-07-16T16:00:00+08:00"),
        false,
      ),
    ).toBe(true);
  });
});
