import { performance } from "node:perf_hooks";
import { PAPER_EXECUTION_TIMING_MAX_MS, type PaperExecutionTiming } from "../../shared/paperExecutionTiming";

type Stage = "researchMs" | "notificationMs" | "executionMs";

function duration(start: number, end: number): number | null {
  const elapsed = end - start;
  return Number.isFinite(start) && Number.isFinite(end) && elapsed >= 0 && elapsed <= PAPER_EXECUTION_TIMING_MAX_MS
    ? elapsed : null;
}
function rounded(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(3));
}

/** Local scalar samples only. Instrumentation must never change a task's result or failure. */
export class PaperExecutionTimer {
  private readonly started: number;
  private readonly values: Record<Stage, number | null> = { researchMs: null, notificationMs: null, executionMs: null };
  private readonly invalid = new Set<Stage>();

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.started = this.now();
  }

  private now(): number {
    try { return this.clock(); } catch { return Number.NaN; }
  }

  start(stage: Stage): () => void {
    const started = this.now();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      const elapsed = duration(started, this.now());
      const combined = (this.values[stage] ?? 0) + (elapsed ?? 0);
      if (elapsed === null || combined > PAPER_EXECUTION_TIMING_MAX_MS) this.invalid.add(stage);
      this.values[stage] = this.invalid.has(stage) ? null : combined;
    };
  }

  async measure<T>(stage: Stage, task: () => Promise<T> | T): Promise<T> {
    const finish = this.start(stage);
    try { return await task(); } finally { finish(); }
  }

  measureSync<T>(stage: Stage, task: () => T): T {
    const finish = this.start(stage);
    try { return task(); } finally { finish(); }
  }

  snapshot(): PaperExecutionTiming {
    return { clock: "monotonic", scope: "run-before-audit", unit: "ms",
      totalMs: rounded(duration(this.started, this.now())),
      researchMs: rounded(this.values.researchMs), notificationMs: rounded(this.values.notificationMs),
      executionMs: rounded(this.values.executionMs) };
  }
}
