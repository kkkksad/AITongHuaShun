/** Per run, before its final audit write. Never infer missing samples from wall clocks. */
export const PAPER_EXECUTION_TIMING_MAX_MS = 86_400_000;
export interface PaperExecutionTiming {
  clock: "monotonic";
  scope: "run-before-audit";
  unit: "ms";
  totalMs: number | null;
  researchMs: number | null;
  notificationMs: number | null;
  /** Local order preparation/submission, callbacks and decision audit; excludes notifications. */
  executionMs: number | null;
}
