import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../../shared/trading";
import { buildDailyMarketReview } from "./dailyMarketReview";

const now = new Date("2026-11-11T08:00:00Z");
function run(timestamp = "2026-11-11T06:50:00Z", data: Record<string, unknown> = {}): AuditEvent {
  return { id: timestamp, timestamp, category: "system", action: "paper-auto-execution.run", message: "fixture",
    data: { session: "open", tradingDate: "2026-11-11", planQuality: "blocked",
      regime: "range-high-volatility", sourceStatus: "live-read-only", ...data } };
}
function review(auditEvents: AuditEvent[]) {
  return buildDailyMarketReview({
    now, auditEvents, provider: "mock", orders: [], positions: [],
    snapshot: { mode: "paper", sequence: 0, marketTime: now.toISOString(), quotes: [] },
    account: { accountId: "fixture", mode: "paper", cash: 13992, equity: 13992, marketValue: 0,
      unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0,
      riskUtilization: 0, paused: false, updatedAt: now.toISOString() },
  }).entryReview;
}

describe("daily audit time selection", () => {
  it.each([
    ["2026-11-10T06:50:00Z", "2026-11-11"],
    ["2026-11-11T06:50:00Z", "2026-11-10"],
    ["2026-11-11T06:50:00Z", null],
    ["2026-11-11T06:50:00Z", 20261111],
  ])("rejects conflicting actual/explicit dates: %s, %s", (timestamp, tradingDate) => {
    const result = review([run(timestamp, { tradingDate, regime: "risk-off" })]);
    expect(result).toMatchObject({ status: "runtime-gap", marketRegime: null, planQuality: null });
    expect(result.coverage?.openRunCount).toBe(0);
  });

  it("selects the numerically latest open run across timezone offsets", () => {
    const result = review([
      run("2026-11-11T09:31:00+08:00", { regime: "risk-off", planQuality: "watch-only" }),
      run("2026-11-11T06:50:00Z"),
    ]);
    expect(result).toMatchObject({ status: "plan-blocked", marketRegime: "range-high-volatility", planQuality: "blocked" });
  });

  it("uses numeric ordering for legacy notification route fallback as well", () => {
    const event = run("2026-11-11T06:00:00Z", { regime: undefined, planQuality: "watch-only" });
    const older = { ...run("2026-11-11T09:31:00+08:00"), action: "wxpusher.paper-plan.sent" };
    const latest = { ...run("2026-11-11T06:50:00Z", { regime: "risk-off" }), action: "wxpusher.paper-plan.failed" };
    expect(review([event, older, latest])).toMatchObject({ status: "risk-blocked", marketRegime: "risk-off" });
  });

  it("keeps stable input precedence for equal instants with different ISO representations", () => {
    const first = run("2026-11-11T01:31:00Z");
    const second = run("2026-11-11T09:31:00+08:00", { regime: "risk-off" });
    expect(review([first, second])).toMatchObject({ status: "plan-blocked", marketRegime: "range-high-volatility" });
  });

  it("preserves legacy missing dates, cutoff exclusion and input immutability", () => {
    const event = run(); delete event.data!.tradingDate;
    const future = run("2026-11-11T08:00:00.001Z", { regime: "risk-off" });
    const invalid = run("not-a-time", { regime: "risk-off" });
    const events = [future, event, invalid];
    const before = JSON.stringify(events);
    expect(review(events)).toMatchObject({ status: "plan-blocked", marketRegime: "range-high-volatility" });
    expect(JSON.stringify(events)).toBe(before);
  });
});
