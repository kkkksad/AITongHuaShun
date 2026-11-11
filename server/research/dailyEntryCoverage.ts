import type { AuditEvent } from "../../shared/trading";
import type { DailyEntryCoverage } from "../../shared/dailyEntryCoverage";
import { PAPER_HISTORY_SESSIONS } from "../../shared/paperHistory";
import { getChinaDateKey } from "../trading/ashareTradingCalendar";
import { parseDailyEntryFunnel } from "./dailyEntryFunnelEvidence";

const closedSessions = new Set<string>([
  ...PAPER_HISTORY_SESSIONS.filter(session => session !== "open"), "post-market",
]);

/** Summarize only observed, correctly dated records without repairing missing history. */
export function buildDailyEntryCoverage(
  events: AuditEvent[], tradingDate: string, asOf: Date,
): DailyEntryCoverage {
  const result: DailyEntryCoverage = {
    scope: "retained-daily-runs", retainedRunCount: 0, openRunCount: 0,
    outsideSessionRunCount: 0, unknownSessionRunCount: 0,
    validFunnelRunCount: 0, unknownFunnelRunCount: 0,
    firstOpenRunAt: null, lastOpenRunAt: null,
    stages: { globalPermissionClosed: 0, noNewSymbols: 0, noEligibleNewSymbols: 0,
      noIndividuallySizedNewSymbols: 0, noPlannedBuy: 0, plannedBuy: 0 },
  };
  const cutoff = asOf.getTime();
  let firstTime = Infinity;
  let lastTime = -Infinity;
  for (const event of events) {
    if (event.action !== "paper-auto-execution.run") continue;
    const timestamp = Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp) || !Number.isFinite(cutoff) || timestamp > cutoff) continue;
    if (getChinaDateKey(new Date(timestamp)) !== tradingDate) continue;
    const explicitDate = event.data?.tradingDate;
    if (explicitDate !== undefined && explicitDate !== tradingDate) continue;
    result.retainedRunCount += 1;
    const session = event.data?.session;
    if (session !== "open") {
      if (typeof session === "string" && closedSessions.has(session)) result.outsideSessionRunCount += 1;
      else result.unknownSessionRunCount += 1;
      continue;
    }
    result.openRunCount += 1;
    firstTime = Math.min(firstTime, timestamp);
    lastTime = Math.max(lastTime, timestamp);
    const value = parseDailyEntryFunnel(event.data?.strategyCoverage);
    if (!value) {
      result.unknownFunnelRunCount += 1;
      continue;
    }
    result.validFunnelRunCount += 1;
    const stage: keyof DailyEntryCoverage["stages"] = !value.allowNewPositions
      ? "globalPermissionClosed" : value.newSymbolCount === 0
      ? "noNewSymbols" : value.eligibleNewSymbolCount === 0
      ? "noEligibleNewSymbols" : value.individuallySizedNewSymbolCount === 0
      ? "noIndividuallySizedNewSymbols" : value.plannedBuyCount === 0
      ? "noPlannedBuy" : "plannedBuy";
    result.stages[stage] += 1;
  }
  if (result.openRunCount > 0) {
    result.firstOpenRunAt = new Date(firstTime).toISOString();
    result.lastOpenRunAt = new Date(lastTime).toISOString();
  }
  return result;
}
