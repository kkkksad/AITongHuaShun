import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpMarketProvider } from "./HttpMarketProvider";

afterEach(() => vi.unstubAllGlobals());

async function receiveQuotes(sourceTime: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ quotes: [
      { symbol: "600519", price: 100, previousClose: 99, changePercent: 1, volume: 1000, updatedAt: sourceTime },
      { symbol: "300750", price: 50, previousClose: 49, changePercent: 2, volume: 1000, updatedAt: "2026-11-09T08:14:40.000Z" },
    ] }),
  }));
  const provider = new HttpMarketProvider({
    baseUrl: "http://quote-time.test", mode: "paper", tickMs: 60_000,
    symbols: ["600519", "300750"], timeout: 1000,
  });
  try {
    provider.start();
    await vi.waitFor(() => expect(provider.getSnapshot().sequence).toBe(1));
    return { snapshot: provider.getSnapshot(), receivedAt: provider.getLastFetchSuccessMs() };
  } finally { provider.stop(); }
}

describe("HTTP quote source time and receipt time", () => {
  it.each([undefined, null, "", 1794211200000, {}, Number.NaN])(
    "keeps unknown source time unknown when input is %j", async (time) => {
      const { snapshot, receivedAt } = await receiveQuotes(time);
      expect(snapshot.quotes.find(q => q.symbol === "600519")?.updatedAt).toBe("");
      expect(snapshot.quotes.find(q => q.symbol === "300750")?.updatedAt).toBe("2026-11-09T08:14:40.000Z");
      expect(Date.parse(snapshot.marketTime)).toBe(receivedAt);
      expect(receivedAt).toBeGreaterThan(0);
    },
  );

  it("preserves an old valid source time when a fresh response arrives", async () => {
    const { snapshot } = await receiveQuotes("2026-11-06T07:00:00.000Z");
    expect(snapshot.quotes[0].updatedAt).toBe("2026-11-06T07:00:00.000Z");
    expect(Date.parse(snapshot.marketTime)).toBeGreaterThan(Date.parse(snapshot.quotes[0].updatedAt));
  });
});
