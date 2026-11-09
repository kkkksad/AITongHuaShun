import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPaperHistoryArchive } from "./paperHistoryArchive";

const epoch = "034f4f49-c160-43f8-9c8d-f319e35d215d";
const accountId = "PAPER-CN-01";
const now = new Date("2026-11-09T15:00:00Z");
const directories: string[] = [];
function model() {
  const dates = Array.from({ length: 7 }, (_, index) => `2026-11-0${index + 3}`);
  return { schemaVersion: 1, accountId, accountEpoch: epoch, generatedAt: now.toISOString(),
    firstObservedAt: "2026-11-09T14:00:00.000Z", lastObservedAt: now.toISOString(),
    window: { fromDate: dates[0], toDate: dates[6] }, runCount: 1, openSessionRuns: 0,
    unknownSessionRuns: 1, submittedAttempts: 0, submissionEvidenceRuns: 0,
    days: dates.map((date, index) => ({ date, runs: index === 6 ? 1 : 0, openRuns: 0,
      unknownSessionRuns: index === 6 ? 1 : 0, submittedAttempts: 0, submissionEvidenceRuns: 0 })),
    blockers: [], issues: [], latestRuns: [{ occurredAt: now.toISOString(), session: null, phase: null,
      regime: null, planQuality: null, sourceStatus: null, submittedOrders: null, skippedOperations: null,
      blockers: {}, issues: [] }],
  };
}
function setup(value: unknown = model()) {
  const directory = mkdtempSync(join(tmpdir(), "kairos-read-model-"));
  directories.push(directory);
  const file = join(directory, "current.json");
  writeFileSync(file, JSON.stringify(value));
  const read = (expectedEpoch: string | null = epoch, clock = now) => readPaperHistoryArchive({ file, accountId, accountEpoch: expectedEpoch, now: clock });
  return { file, read };
}
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("bounded Paper archive read model", () => {
  it("returns current evidence without exposing its epoch or unknown extra fields", async () => {
    const { file, read } = setup({ ...model(), token: "DO_NOT_PUBLISH" });
    const before = readFileSync(file, "utf8");
    const result = await read();
    expect(result).toMatchObject({ state: "ready", data: { runCount: 1, unknownSessionRuns: 1 } });
    expect(result.data).not.toHaveProperty("accountEpoch");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_PUBLISH");
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("retains evidence as stale after three minutes rather than presenting fresh zero counts", async () => {
    const { read } = setup();
    expect(await read(epoch, new Date(now.getTime() + 180000))).toMatchObject({ state: "ready" });
    expect(await read(epoch, new Date(now.getTime() + 180001))).toMatchObject({ state: "stale", data: { runCount: 1 } });
  });
  it("never serves a different account or a previous reset epoch", async () => {
    expect(await setup({ ...model(), accountId: "PAPER-OTHER" }).read()).toEqual({ state: "waiting-for-account", data: null });
    expect(await setup().read("2e64ed4f-b965-4504-9418-a4276eb03df0")).toEqual({ state: "waiting-for-account", data: null });
  });
  it("stays disabled without a configured file or persistent epoch", async () => {
    expect(await setup().read(null)).toEqual({ state: "disabled", data: null });
    expect(await readPaperHistoryArchive({ file: "", accountId, accountEpoch: epoch, now })).toEqual({ state: "disabled", data: null });
  });
  it("fails closed on future report or run evidence", async () => {
    const future = new Date(now.getTime() + 1).toISOString();
    expect(await setup({ ...model(), generatedAt: future }).read()).toEqual({ state: "unavailable", data: null });
    const value = model(); value.latestRuns[0].occurredAt = future;
    expect(await setup(value).read()).toEqual({ state: "unavailable", data: null });
  });
  it.each(["not-json", "x".repeat(128 * 1024 + 1)])("handles malformed or oversized files without leaking their content", async (body) => {
    const { file, read } = setup(); writeFileSync(file, body);
    expect(await read()).toEqual({ state: "unavailable", data: null });
  });
  it("handles missing files and inconsistent count totals", async () => {
    const { file, read } = setup(); rmSync(file);
    expect(await read()).toEqual({ state: "unavailable", data: null });
    expect(await setup({ ...model(), runCount: 2 }).read()).toEqual({ state: "unavailable", data: null });
  });
  it("rejects unlisted diagnostic strings", async () => {
    expect(await setup({ ...model(), issues: [{ code: "DO_NOT_PUBLISH", count: 1 }] }).read())
      .toEqual({ state: "unavailable", data: null });
  });
});
