import type { PaperExecutionTiming } from "./paperExecutionTiming";

export const PAPER_HISTORY_SESSIONS = ["open", "pre-market", "lunch-break", "after-hours", "weekend", "holiday", "calendar-unavailable"] as const;
export const PAPER_HISTORY_PHASES = ["opening", "morning-confirmation", "afternoon-confirmation", "closing-risk-review", "closed"] as const;
export const PAPER_HISTORY_REGIMES = ["trend-up-low-volatility", "trend-up-high-volatility", "range-low-volatility", "range-high-volatility", "risk-off-recovery", "risk-off", "unclear"] as const;
export const PAPER_HISTORY_QUALITIES = ["actionable", "watch-only", "blocked", "not-run"] as const;
export const PAPER_HISTORY_SOURCES = ["live-read-only", "degraded", "mock-disabled"] as const;
export const PAPER_HISTORY_BLOCKERS = ["T+1", "strategy-profile", "adaptive-new-position", "strategy-route", "lot-size", "cash-check", "cash-reservation", "plan-sizing", "defensive-score", "same-day-reentry", "round-trip-fee-ratio", "entry-persistence"] as const;
export const PAPER_HISTORY_ISSUES = ["provider-contract", "provider-timeout", "history-warming", "history-queue-full", "sector-history-insufficient", "stock-history-insufficient", "provider-warning"] as const;

export interface PaperHistoryDay {
  date: string;
  runs: number;
  openRuns: number;
  unknownSessionRuns: number;
  submittedAttempts: number;
  submissionEvidenceRuns: number;
}

export interface PaperHistoryRun {
  timing?: PaperExecutionTiming | null;
  occurredAt: string;
  session: typeof PAPER_HISTORY_SESSIONS[number] | null;
  phase: typeof PAPER_HISTORY_PHASES[number] | null;
  regime: typeof PAPER_HISTORY_REGIMES[number] | null;
  planQuality: typeof PAPER_HISTORY_QUALITIES[number] | null;
  sourceStatus: typeof PAPER_HISTORY_SOURCES[number] | null;
  submittedOrders: number | null;
  skippedOperations: number | null;
  blockers: Partial<Record<typeof PAPER_HISTORY_BLOCKERS[number], number>>;
  issues: Array<typeof PAPER_HISTORY_ISSUES[number]>;
}

export interface PaperHistoryEvidence {
  schemaVersion: 1;
  accountId: string;
  generatedAt: string;
  firstObservedAt: string;
  lastObservedAt: string;
  window: { fromDate: string; toDate: string };
  runCount: number;
  openSessionRuns: number;
  unknownSessionRuns: number;
  submittedAttempts: number;
  submissionEvidenceRuns: number;
  days: PaperHistoryDay[];
  blockers: Array<{ code: typeof PAPER_HISTORY_BLOCKERS[number]; count: number }>;
  issues: Array<{ code: typeof PAPER_HISTORY_ISSUES[number]; count: number }>;
  latestRuns: PaperHistoryRun[];
}

export interface PaperHistoryArchiveReport {
  state: "ready" | "stale" | "waiting-for-account" | "unavailable" | "disabled";
  data: PaperHistoryEvidence | null;
}
