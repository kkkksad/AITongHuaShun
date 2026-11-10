import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { PAPER_EXECUTION_TIMING_MAX_MS } from "../../shared/paperExecutionTiming";
import {
  PAPER_HISTORY_BLOCKERS, PAPER_HISTORY_ISSUES, PAPER_HISTORY_PHASES,
  PAPER_HISTORY_QUALITIES, PAPER_HISTORY_REGIMES, PAPER_HISTORY_SESSIONS, PAPER_HISTORY_SOURCES,
  type PaperHistoryArchiveReport,
} from "../../shared/paperHistory";

const MAX_BYTES = 128 * 1024;
const elapsed = z.number().finite().min(0).max(PAPER_EXECUTION_TIMING_MAX_MS).nullable();
const timingSchema = z.object({
  clock: z.literal("monotonic"), scope: z.literal("run-before-audit"), unit: z.literal("ms"),
  totalMs: elapsed, researchMs: elapsed, notificationMs: elapsed, executionMs: elapsed,
}).refine(value => value.totalMs === null ||
  (value.researchMs ?? 0) + (value.notificationMs ?? 0) + (value.executionMs ?? 0) <= value.totalMs + 0.003);
const count = z.number().int().min(0).max(20_000_000_000);
const runs = z.number().int().min(0).max(20_000);
const time = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const daySchema = z.object({ date, runs, openRuns: runs, unknownSessionRuns: runs,
  submittedAttempts: count, submissionEvidenceRuns: runs });
const modelSchema = z.object({
  schemaVersion: z.literal(1), accountId: z.string().regex(/^PAPER-[A-Z0-9-]{1,48}$/),
  accountEpoch: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  generatedAt: time, firstObservedAt: time, lastObservedAt: time,
  window: z.object({ fromDate: date, toDate: date }), runCount: runs, openSessionRuns: runs,
  unknownSessionRuns: runs, submittedAttempts: count, submissionEvidenceRuns: runs,
  days: z.array(daySchema).length(7),
  blockers: z.array(z.object({ code: z.enum(PAPER_HISTORY_BLOCKERS), count })).max(PAPER_HISTORY_BLOCKERS.length),
  issues: z.array(z.object({ code: z.enum(PAPER_HISTORY_ISSUES), count: runs })).max(PAPER_HISTORY_ISSUES.length),
  latestRuns: z.array(z.object({
    timing: timingSchema.nullable().catch(null),
    occurredAt: time, session: z.enum(PAPER_HISTORY_SESSIONS).nullable(), phase: z.enum(PAPER_HISTORY_PHASES).nullable(),
    regime: z.enum(PAPER_HISTORY_REGIMES).nullable(), planQuality: z.enum(PAPER_HISTORY_QUALITIES).nullable(),
    sourceStatus: z.enum(PAPER_HISTORY_SOURCES).nullable(), submittedOrders: count.nullable(), skippedOperations: count.nullable(),
    blockers: z.partialRecord(z.enum(PAPER_HISTORY_BLOCKERS), count), issues: z.array(z.enum(PAPER_HISTORY_ISSUES)).max(PAPER_HISTORY_ISSUES.length),
  })).max(20),
});

function validTotals(model: z.infer<typeof modelSchema>): boolean {
  const generated = Date.parse(model.generatedAt);
  const chinaDate = new Date(generated + 8 * 60 * 60_000).toISOString().slice(0, 10);
  const firstDate = Date.parse(model.window.toDate) - 6 * 86_400_000;
  if (model.window.toDate !== chinaDate || new Date(firstDate).toISOString().slice(0, 10) !== model.window.fromDate ||
      Date.parse(model.firstObservedAt) > Date.parse(model.lastObservedAt) || Date.parse(model.lastObservedAt) > generated ||
      model.openSessionRuns + model.unknownSessionRuns > model.runCount || model.submissionEvidenceRuns > model.runCount ||
      model.latestRuns.length !== Math.min(20, model.runCount)) return false;
  for (const [index, day] of model.days.entries()) {
    if (day.date !== new Date(firstDate + index * 86_400_000).toISOString().slice(0, 10) ||
        day.openRuns + day.unknownSessionRuns > day.runs || day.submissionEvidenceRuns > day.runs) return false;
  }
  const sum = (key: keyof Omit<z.infer<typeof daySchema>, "date">) => model.days.reduce((total, day) => total + day[key], 0);
  if (sum("runs") !== model.runCount || sum("openRuns") !== model.openSessionRuns ||
      sum("unknownSessionRuns") !== model.unknownSessionRuns || sum("submittedAttempts") !== model.submittedAttempts ||
      sum("submissionEvidenceRuns") !== model.submissionEvidenceRuns) return false;
  const windowStart = Date.parse(model.window.fromDate + "T00:00:00+08:00");
  if (model.latestRuns.some((run, index) => Date.parse(run.occurredAt) > generated || Date.parse(run.occurredAt) < windowStart ||
      index > 0 && Date.parse(run.occurredAt) > Date.parse(model.latestRuns[index - 1].occurredAt))) return false;
  return new Set(model.blockers.map((item) => item.code)).size === model.blockers.length &&
    new Set(model.issues.map((item) => item.code)).size === model.issues.length;
}

export async function readPaperHistoryArchive(input: {
  file: string; accountId: string; accountEpoch: string | null; now?: Date;
}): Promise<PaperHistoryArchiveReport> {
  if (!input.file || !input.accountEpoch) return { state: "disabled", data: null };
  const unavailable: PaperHistoryArchiveReport = { state: "unavailable", data: null };
  if (!isAbsolute(input.file)) return unavailable;
  const now = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) return unavailable;
  try {
    const handle = await open(input.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    let body: string;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) return unavailable;
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const { bytesRead } = await handle.read(buffer, bytes, buffer.length - bytes, null);
        if (!bytesRead) break;
        bytes += bytesRead;
      }
      if (bytes > MAX_BYTES) return unavailable;
      body = buffer.subarray(0, bytes).toString("utf8");
    } finally { await handle.close(); }
    const model = modelSchema.parse(JSON.parse(body));
    if (!validTotals(model) || Date.parse(model.generatedAt) > now) return unavailable;
    if (model.accountId !== input.accountId || model.accountEpoch !== input.accountEpoch) {
      return { state: "waiting-for-account", data: null };
    }
    const { accountEpoch: _epoch, ...data } = model;
    return { state: now - Date.parse(model.generatedAt) > 180_000 ? "stale" : "ready", data };
  } catch {
    return unavailable;
  }
}
