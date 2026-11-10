import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../../shared/trading";
import { findLatestConfirmedRestrictiveRouting, summarizeRecentPaperStrategyUsage } from "./paperTradingPlanService";

const asOf = new Date("2026-07-22T07:00:00Z");
function usage(timestamp: string): AuditEvent {
  return { id: timestamp, timestamp, category: "system", action: "paper-auto-execution.decision",
    message: "fixture", data: { status: "filled", strategyKey: "rsi" } };
}
function route(timestamp: string, regime = "risk-off"): AuditEvent {
  return { id: timestamp, timestamp, category: "system", action: "paper-auto-execution.run",
    message: "fixture", data: { session: "open", sourceStatus: "live-read-only", tradingDate: "2026-07-22", regime } };
}

describe("Paper strategy evidence cutoff", () => {
  it.each(["2026-07-22T07:00:00.001Z", "not-a-time", ""])("excludes unobserved strategy usage at %s", time => {
    expect(summarizeRecentPaperStrategyUsage([usage(time)], asOf)).toEqual({});
  });

  it("includes both exact bounds and parses equivalent timezone offsets by instant", () => {
    expect(summarizeRecentPaperStrategyUsage([
      usage("2026-07-15T06:59:59.999Z"), usage("2026-07-15T07:00:00Z"),
      usage("2026-07-22T15:00:00+08:00"), usage("2026-07-22T15:00:00.001+08:00"),
    ], asOf)).toEqual({ rsi: 2 });
  });

  it("does not accept all strategy usage when the caller clock is invalid", () => {
    expect(summarizeRecentPaperStrategyUsage([usage(asOf.toISOString())], new Date(NaN))).toEqual({});
  });

  it.each(["2026-07-22T07:00:00.001Z", "not-a-time", "", "2026-07-21T15:59:59Z"])(
    "does not extend defensive routing from future, invalid, or mismatched day %s", time => {
      expect(findLatestConfirmedRestrictiveRouting([route(time)], "2026-07-22", asOf)).toBeNull();
    },
  );

  it("selects the latest actual instant instead of sorting timestamp spellings", () => {
    const latest = "2026-07-22T06:30:00Z";
    expect(findLatestConfirmedRestrictiveRouting([
      route("2026-07-22T14:00:00+08:00"), route(latest, "risk-off-recovery"),
    ], "2026-07-22", asOf)).toEqual({ regime: "risk-off-recovery", confirmedAt: latest });
  });

  it("allows a confirmation at the cutoff and does not mutate source records", () => {
    const audits = [route("2026-07-22T07:00:00.001Z"), route(asOf.toISOString())];
    const before = JSON.stringify(audits);
    expect(findLatestConfirmedRestrictiveRouting(audits, "2026-07-22", asOf))
      .toEqual({ regime: "risk-off", confirmedAt: asOf.toISOString() });
    expect(JSON.stringify(audits)).toBe(before);
  });

  it("has no confirmed route without a valid caller clock", () => {
    expect(findLatestConfirmedRestrictiveRouting([route(asOf.toISOString())], "2026-07-22", new Date(NaN))).toBeNull();
  });
});
