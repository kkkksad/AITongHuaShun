/** Counts retained audit records, not unique signals, orders or complete timer coverage. */
export interface DailyEntryCoverage {
  scope: "retained-daily-runs";
  retainedRunCount: number;
  openRunCount: number;
  outsideSessionRunCount: number;
  unknownSessionRunCount: number;
  validFunnelRunCount: number;
  unknownFunnelRunCount: number;
  firstOpenRunAt: string | null;
  lastOpenRunAt: string | null;
  /** Mutually exclusive stages for valid open-run funnels only. */
  stages: {
    globalPermissionClosed: number;
    noNewSymbols: number;
    noEligibleNewSymbols: number;
    noIndividuallySizedNewSymbols: number;
    noPlannedBuy: number;
    plannedBuy: number;
  };
}
