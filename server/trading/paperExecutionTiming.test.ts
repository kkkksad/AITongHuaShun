import { describe, expect, it } from "vitest";
import { PaperExecutionTimer } from "./paperExecutionTiming";

describe("bounded paper execution timer", () => {
  it("retains task values and failures, sums repeated stages and stops each sample once", async () => {
    let now = 0;
    const timer = new PaperExecutionTimer(() => now);
    expect(await timer.measure("researchMs", async () => { now = 12.3456; return "research"; })).toBe("research");
    const finish = timer.start("notificationMs");
    now = 22.3456; finish();
    now = 30; finish();
    const failure = new Error("original task failure");
    expect(() => timer.measureSync("notificationMs", () => { now += 5; throw failure; })).toThrow(failure);
    expect(timer.snapshot()).toEqual({ clock: "monotonic", scope: "run-before-audit", unit: "ms",
      totalMs: 35, researchMs: 12.346, notificationMs: 15, executionMs: null });
    await expect(timer.measure("executionMs", async () => { now += 2; throw failure; })).rejects.toBe(failure);
    expect(timer.snapshot().executionMs).toBe(2);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 86_400_001])("leaves invalid or out-of-bound %s samples unknown", async value => {
    let now = 0;
    const timer = new PaperExecutionTimer(() => now);
    expect(await timer.measure("researchMs", async () => { now = value; return 42; })).toBe(42);
    expect(timer.snapshot()).toMatchObject({ totalMs: null, researchMs: null, notificationMs: null, executionMs: null });
  });

  it("does not fail work when an injected diagnostic clock fails", async () => {
    const timer = new PaperExecutionTimer(() => { throw new Error("clock failed"); });
    expect(await timer.measure("researchMs", async () => "done")).toBe("done");
    expect(timer.snapshot().researchMs).toBeNull();
  });
});
