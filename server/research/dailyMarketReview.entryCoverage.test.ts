import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../../shared/trading";
import { buildDailyMarketReview } from "./dailyMarketReview";

const now = new Date("2026-11-11T08:00:00Z");
const funnel = {
  scope: "ranked-top-12", scannerCandidateCount: 59, consideredCandidateCount: 12,
  existingPositionCount: 3, newSymbolCount: 9, eligibleNewSymbolCount: 1,
  individuallySizedNewSymbolCount: 0, plannedBuyCount: 0, allowNewPositions: true,
};
function run(index = 0, changes: Record<string, unknown> = {}): AuditEvent {
  return {
    id: `run-${index}`, timestamp: new Date(Date.parse("2026-11-11T01:31:00Z") + index * 1000).toISOString(),
    category: "system", action: "paper-auto-execution.run", message: "fixture",
    data: { session: "open", tradingDate: "2026-11-11", planQuality: "blocked",
      regime: "range-high-volatility", sourceStatus: "live-read-only",
      strategyCoverage: { newPositionFunnel: { ...funnel, ...changes } } },
  };
}
function review(auditEvents: AuditEvent[]) {
  return buildDailyMarketReview({
    now, provider: "mock", positions: [], orders: [], auditEvents,
    snapshot: { mode: "paper", sequence: 0, marketTime: now.toISOString(), quotes: [] },
    account: { accountId: "coverage-fixture", mode: "paper", cash: 13992, equity: 13992,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0,
      riskUtilization: 0, paused: false, updatedAt: now.toISOString() },
  }).entryReview;
}

describe("daily retained entry coverage", () => {
  it("summarizes every retained open run rather than explaining the day from the latest one", () => {
    const events = Array.from({ length: 225 }, (_, i) => run(i,
      i < 45 ? { allowNewPositions: false } : i < 193 ? { eligibleNewSymbolCount: 0 } :
      i === 223 ? { individuallySizedNewSymbolCount: 1 } : {}));
    events[224].data!.strategyCoverage = null;
    expect(review(events).coverage).toEqual({
      scope: "retained-daily-runs", retainedRunCount: 225, openRunCount: 225,
      outsideSessionRunCount: 0, unknownSessionRunCount: 0,
      validFunnelRunCount: 224, unknownFunnelRunCount: 1,
      firstOpenRunAt: events[0].timestamp, lastOpenRunAt: events[224].timestamp,
      stages: { globalPermissionClosed: 45, noNewSymbols: 0, noEligibleNewSymbols: 148,
        noIndividuallySizedNewSymbols: 30, noPlannedBuy: 1, plannedBuy: 0 },
    });
  });

  it("uses mutually exclusive recorded stages without confusing planned orders with fills", () => {
    const changes = [
      { allowNewPositions: false, eligibleNewSymbolCount: 0 },
      { existingPositionCount: 12, newSymbolCount: 0, eligibleNewSymbolCount: 0 },
      { eligibleNewSymbolCount: 0 }, {}, { individuallySizedNewSymbolCount: 1 },
      { individuallySizedNewSymbolCount: 1, plannedBuyCount: 1 },
    ];
    const result = review(changes.map((change, index) => run(index, change)));
    expect(result.coverage?.stages).toEqual({ globalPermissionClosed: 1, noNewSymbols: 1,
      noEligibleNewSymbols: 1, noIndividuallySizedNewSymbols: 1, noPlannedBuy: 1, plannedBuy: 1 });
    expect(result.status).toBe("plan-blocked");
  });

  it("separates known closed sessions from legacy or unrecognized session records", () => {
    const sessions = ["open", "pre-market", "lunch-break", "after-hours", "post-market", "weekend",
      "holiday", "calendar-unavailable", undefined, null, "unrecognized"];
    const events = sessions.map((session, index) => {
      const event = run(index); event.data!.session = session; return event;
    });
    expect(review(events).coverage).toMatchObject({ retainedRunCount: 11, openRunCount: 1,
      outsideSessionRunCount: 7, unknownSessionRunCount: 3, validFunnelRunCount: 1, unknownFunnelRunCount: 0 });
  });

  it("excludes future, bad timestamps, date conflicts, other days and non-run events", () => {
    const atCutoff = { ...run(), timestamp: now.toISOString() };
    const events = [atCutoff,
      { ...run(1), timestamp: "2026-11-11T08:00:00.001Z" },
      { ...run(2), timestamp: "bad-date" },
      { ...run(3), timestamp: "2026-11-10T02:00:00Z" },
      { ...run(4), timestamp: "2026-11-11T16:00:00Z" },
      { ...run(5), data: { ...run().data, tradingDate: "2026-11-10" } },
      { ...run(6), data: { ...run().data, tradingDate: 123 } },
      { ...run(7), action: "paper-auto-execution.decision" },
    ];
    expect(review(events).coverage).toMatchObject({ retainedRunCount: 1, openRunCount: 1,
      validFunnelRunCount: 1, firstOpenRunAt: now.toISOString(), lastOpenRunAt: now.toISOString() });
  });

  it("accepts a missing legacy explicit date only when the actual Beijing date matches", () => {
    const event = run(); delete event.data!.tradingDate;
    expect(review([event]).coverage?.validFunnelRunCount).toBe(1);
  });

  it("computes the numeric first and last time regardless of timestamp offset or array order", () => {
    const first = { ...run(), timestamp: "2026-11-11T09:31:00+08:00" };
    const last = { ...run(1), timestamp: "2026-11-11T06:59:00Z" };
    expect(review([last, first]).coverage).toMatchObject({
      firstOpenRunAt: "2026-11-11T01:31:00.000Z", lastOpenRunAt: "2026-11-11T06:59:00.000Z" });
  });

  it.each([null, {}, { ...funnel, newSymbolCount: 10 }, { ...funnel, allowNewPositions: "false" },
    { ...funnel, eligibleNewSymbolCount: 13 }, { ...funnel, plannedBuyCount: -1 },
    { ...funnel, individuallySizedNewSymbolCount: 2 }, { ...funnel, scannerCandidateCount: 11 }])(
    "keeps malformed or missing funnels unknown: %j", value => {
      const event = run(); event.data!.strategyCoverage = { newPositionFunnel: value };
      expect(review([event]).coverage).toMatchObject({ openRunCount: 1,
        validFunnelRunCount: 0, unknownFunnelRunCount: 1,
        stages: { noEligibleNewSymbols: 0, noIndividuallySizedNewSymbols: 0 } });
    });

  it("emits true zero coverage for no retained runs without fabricating a time range", () => {
    expect(review([]).coverage).toMatchObject({ retainedRunCount: 0, openRunCount: 0,
      validFunnelRunCount: 0, unknownFunnelRunCount: 0, firstOpenRunAt: null, lastOpenRunAt: null });
  });

  it("does not leak private fields and does not mutate the audit input", () => {
    const event = run(0, { privateToken: "PRIVATE_TOKEN" });
    event.data!.privateToken = "PRIVATE_TOKEN";
    const before = JSON.stringify(event);
    const result = review([event]);
    expect(result.coverage?.validFunnelRunCount).toBe(1);
    expect(JSON.stringify(result.coverage)).not.toContain("PRIVATE_TOKEN");
    expect(JSON.stringify(event)).toBe(before);
  });
});
