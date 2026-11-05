import { describe, expect, it } from "vitest";
import { MockMarket } from "./mockMarket";

describe("MockMarket snapshot version time", () => {
  it("preserves the snapshot when reads cross into another trading date", () => {
    let now = new Date("2026-08-20T15:00:00+08:00");
    const market = new MockMarket("paper", 60_000, () => now);
    const initial = market.getSnapshot();

    now = new Date("2026-08-21T09:35:00+08:00");

    expect(market.getSnapshot()).toEqual(initial);
    expect(market.getSnapshot().marketTime).toBe("2026-08-20T07:00:00.000Z");
  });

  it("timestamps a new tick and all its quotes from one clock sample", () => {
    let clockReads = 0;
    const market = new MockMarket("paper", 60_000, () =>
      new Date(Date.UTC(2026, 7, 21, 1, 35, clockReads++)),
    );
    const initial = market.getSnapshot();
    const updated = market.tick();

    expect(clockReads).toBe(2);
    expect(initial.marketTime).toBe("2026-08-21T01:35:00.000Z");
    expect(updated.sequence).toBe(initial.sequence + 1);
    expect(updated.marketTime).toBe("2026-08-21T01:35:01.000Z");
    expect(updated.quotes.every((quote) => quote.updatedAt === updated.marketTime)).toBe(true);
    expect(market.getSnapshot()).toEqual(updated);
    expect(clockReads).toBe(2);
  });

  it("replays the current version on start without advancing its time", () => {
    let now = new Date("2026-08-21T09:35:00+08:00");
    const market = new MockMarket("paper", 60_000, () => now);
    const initial = market.getSnapshot();
    const emitted: ReturnType<MockMarket["getSnapshot"]>[] = [];
    market.on("snapshot", (snapshot) => emitted.push(snapshot));
    now = new Date("2026-08-21T09:36:00+08:00");

    try {
      market.start();
      expect(emitted).toEqual([initial]);
    } finally {
      market.stop();
    }
  });
});
