import { describe, expect, it } from "vitest";
import { SectorPulseTracker } from "./sectorPulse";

function observe(
  tracker: SectorPulseTracker,
  sectors: Array<{ name: string; changePercent: number }>,
  overrides: Partial<Parameters<SectorPulseTracker["observe"]>[0]> = {},
) {
  return tracker.observe({
    tradingDate: "2026-07-21",
    observedAt: "2026-07-21T02:00:00.000Z",
    sourceStatus: "live-read-only",
    sectors,
    ...overrides,
  });
}

describe("SectorPulseTracker", () => {
  it("builds a baseline before reporting a technology pullback", () => {
    const tracker = new SectorPulseTracker();

    expect(observe(tracker, [
      { name: "半导体", changePercent: 6.2 },
      { name: "银行", changePercent: 1.1 },
    ])).toEqual([]);

    expect(observe(tracker, [
      { name: "半导体", changePercent: 4.4 },
      { name: "银行", changePercent: 1.2 },
    ], { observedAt: "2026-07-21T02:05:00.000Z" })).toEqual([
      expect.objectContaining({
        event: "technology-pullback",
        sectorName: "半导体",
        peakChangePercent: 6.2,
        currentChangePercent: 4.4,
        pullbackPercentPoints: 1.8,
      }),
    ]);
  });

  it("reports a severe pullback in a non-technology market leader", () => {
    const tracker = new SectorPulseTracker();

    observe(tracker, [{ name: "贵金属", changePercent: 6.4 }]);
    expect(observe(tracker, [{ name: "贵金属", changePercent: 3.9 }], {
      observedAt: "2026-07-21T02:08:00.000Z",
    })).toEqual([
      expect.objectContaining({
        event: "leader-pullback",
        sectorName: "贵金属",
        pullbackPercentPoints: 2.5,
      }),
    ]);
  });

  it("reports a rapid technology drop between adjacent valid snapshots", () => {
    const tracker = new SectorPulseTracker();

    observe(tracker, [{ name: "计算机设备", changePercent: 3 }]);
    observe(tracker, [{ name: "计算机设备", changePercent: 3.4 }], {
      observedAt: "2026-07-21T02:03:00.000Z",
    });

    expect(observe(tracker, [{ name: "计算机设备", changePercent: 2.3 }], {
      observedAt: "2026-07-21T02:05:00.000Z",
    })).toEqual([
      expect.objectContaining({
        event: "technology-pullback",
        previousChangePercent: 3.4,
        currentChangePercent: 2.3,
        pullbackPercentPoints: 1.1,
      }),
    ]);
  });

  it("ignores degraded input, mild noise, and duplicate same-day pullbacks", () => {
    const tracker = new SectorPulseTracker();

    expect(observe(tracker, [{ name: "通信设备", changePercent: 5.1 }], {
      sourceStatus: "degraded",
    })).toEqual([]);
    expect(tracker.getTrackedCount()).toBe(0);

    observe(tracker, [{ name: "通信设备", changePercent: 5.1 }]);
    expect(observe(tracker, [{ name: "通信设备", changePercent: 4.4 }])).toEqual([]);
    expect(observe(tracker, [{ name: "通信设备", changePercent: 3.3 }], {
      observedAt: "2026-07-21T02:10:00.000Z",
    })).toHaveLength(1);
    expect(observe(tracker, [{ name: "通信设备", changePercent: 2.1 }], {
      observedAt: "2026-07-21T02:15:00.000Z",
    })).toEqual([]);
  });

  it("resets alerts on the next trading date and bounds tracked sectors", () => {
    const tracker = new SectorPulseTracker({ maxSectors: 2 });

    observe(tracker, [
      { name: "半导体", changePercent: 5 },
      { name: "通信设备", changePercent: 4 },
      { name: "计算机设备", changePercent: 3 },
    ]);
    expect(tracker.getTrackedCount()).toBe(2);

    expect(observe(tracker, [{ name: "半导体", changePercent: 2.9 }])).toHaveLength(1);
    expect(observe(tracker, [{ name: "半导体", changePercent: 5.2 }], {
      tradingDate: "2026-07-22",
      observedAt: "2026-07-22T02:00:00.000Z",
    })).toEqual([]);
    expect(observe(tracker, [{ name: "半导体", changePercent: 3.2 }], {
      tradingDate: "2026-07-22",
      observedAt: "2026-07-22T02:05:00.000Z",
    })).toHaveLength(1);
  });
});
