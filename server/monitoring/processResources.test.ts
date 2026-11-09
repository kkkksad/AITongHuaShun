import { describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { ProcessResourceMonitor, type ProcessResourceReading } from "./processResources";

function fixture() {
  let reading: ProcessResourceReading = {
    observedAt: "2026-11-09T20:00:00.000Z", monotonicMs: 100,
    cpuUserMicros: 10, cpuSystemMicros: 20, eventLoopIdleMs: 100, eventLoopActiveMs: 10,
    memory: { rssBytes: 128, heapUsedBytes: 32, heapTotalBytes: 64, externalBytes: 8, arrayBuffersBytes: 4 },
  };
  const histogram = { enable: vi.fn(), disable: vi.fn(), reset: vi.fn(), count: 0, percentile: vi.fn(() => 40_000_000) };
  const createHistogram = vi.fn(() => histogram);
  const monitor = new ProcessResourceMonitor({ read: () => structuredClone(reading), createHistogram });
  return { monitor, histogram, createHistogram, set: (changes: Partial<ProcessResourceReading>) => { reading = { ...reading, ...changes }; } };
}

describe("API process resource windows", () => {
  it("starts lazily and reports current memory while warming", () => {
    const f = fixture(); expect(f.createHistogram).not.toHaveBeenCalled();
    expect(f.monitor.snapshot()).toMatchObject({ scope: "api-process", interval: null, memory: { rssBytes: 128 } });
    expect(f.histogram.enable).toHaveBeenCalledOnce();
    f.monitor.snapshot(); expect(f.createHistogram).toHaveBeenCalledOnce(); f.monitor.close();
  });
  it("uses monotonic elapsed time and one-core CPU units, including values above 100%", () => {
    const f = fixture(); f.monitor.snapshot(); f.histogram.count = 10;
    f.set({ observedAt: "2026-11-09T19:59:59.000Z", monotonicMs: 2100, cpuUserMicros: 2_000_010,
      cpuSystemMicros: 1_000_020, eventLoopIdleMs: 1600, eventLoopActiveMs: 510 });
    expect(f.monitor.snapshot().interval).toEqual({ startedAt: "2026-11-09T20:00:00.000Z", endedAt: "2026-11-09T19:59:59.000Z",
      durationMs: 2000, cpuPercentOfOneCore: 150, eventLoopUtilization: 0.25, eventLoopDelayP95Ms: 40 });
    expect(f.histogram.reset).toHaveBeenCalledOnce(); f.monitor.close();
  });
  it("keeps the baseline during sub-second reads and preserves the last completed interval", () => {
    const f = fixture(); f.monitor.snapshot(); f.set({ monotonicMs: 900 });
    expect(f.monitor.snapshot().interval).toBeNull(); expect(f.histogram.reset).not.toHaveBeenCalled();
    f.set({ monotonicMs: 1100, cpuUserMicros: 500_010 }); const result = f.monitor.snapshot();
    expect(result.interval?.cpuPercentOfOneCore).toBe(50);
    f.set({ monotonicMs: 1200, observedAt: "2026-11-09T20:00:02.000Z" });
    expect(f.monitor.snapshot().interval).toEqual(result.interval); f.monitor.close();
  });
  it("does not invent zero delay or loop utilization before usable samples exist", () => {
    const f = fixture(); f.monitor.snapshot(); f.set({ monotonicMs: 1100 });
    expect(f.monitor.snapshot().interval).toMatchObject({ eventLoopDelayP95Ms: null, eventLoopUtilization: null });
    expect(f.histogram.percentile).not.toHaveBeenCalled(); f.monitor.close();
  });
  it("does not emit negative CPU evidence if a source counter resets", () => {
    const f = fixture(); f.monitor.snapshot(); f.set({ monotonicMs: 1100, cpuUserMicros: 0 });
    expect(f.monitor.snapshot().interval).toBeNull(); f.monitor.close();
  });
  it("isolates instances, releases its native sampler once, and never restarts after closing", () => {
    const first = fixture(), second = fixture(); first.monitor.snapshot();
    first.monitor.close(); first.monitor.close();
    expect(first.histogram.disable).toHaveBeenCalledOnce();
    expect(() => first.monitor.snapshot()).toThrow("closed");
    expect(second.createHistogram).not.toHaveBeenCalled(); second.monitor.close();
    expect(second.createHistogram).not.toHaveBeenCalled();
  });
  it("collects bounded native measurements without involving network, storage or trading", async () => {
    const monitor = new ProcessResourceMonitor();
    try {
      expect(monitor.snapshot().interval).toBeNull();
      await delay(1050);
      const result = monitor.snapshot();
      expect(result.memory.rssBytes).toBeGreaterThan(0);
      expect(result.interval?.durationMs).toBeGreaterThanOrEqual(1000);
      expect(result.interval?.cpuPercentOfOneCore).toBeGreaterThanOrEqual(0);
      expect(result.interval?.eventLoopUtilization).toBeGreaterThanOrEqual(0);
      expect(result.interval?.eventLoopUtilization).toBeLessThanOrEqual(1);
      expect(result.interval?.eventLoopDelayP95Ms).toBeGreaterThan(0);
    } finally { monitor.close(); }
  });
});
