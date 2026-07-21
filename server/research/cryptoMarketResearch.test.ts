import { describe, expect, it, vi } from "vitest";
import {
  boundedCryptoBridgeTimeoutMs,
  buildCryptoMarketResearch,
} from "./cryptoMarketResearch";

describe("buildCryptoMarketResearch", () => {
  it("bounds crypto bridge latency without inheriting the longer market timeout", () => {
    expect(boundedCryptoBridgeTimeoutMs(15_000)).toBe(5_000);
    expect(boundedCryptoBridgeTimeoutMs(200)).toBe(1_000);
  });

  it("returns a bounded live read-only BTC/ETH report", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      provider: "akshare",
      source: "jin10-public-crypto",
      fetchedAt: "2026-07-21T02:00:00.000Z",
      items: [
        {
          symbol: "BTCUSD",
          name: "比特币",
          priceUsd: 68_000,
          change24hPercent: 2,
          high24h: 69_000,
          low24h: 66_000,
          volume24h: 120_000,
          updatedAt: "2026-07-21T02:00:00.000Z",
          source: "jin10-public-crypto",
        },
        {
          symbol: "DOGEUSD",
          name: "DOGE",
          priceUsd: 0.2,
          change24hPercent: 10,
          high24h: 0.21,
          low24h: 0.18,
          volume24h: 1,
          updatedAt: "2026-07-21T02:00:00.000Z",
          source: "test",
        },
      ],
    }), { status: 200 }));

    const report = await buildCryptoMarketResearch({
      bridgeUrl: "http://bridge.test",
      marketDataProvider: "akshare",
      mode: "paper",
      timeoutMs: 1_000,
      fetchImpl,
    });

    expect(report.sourceStatus).toBe("live-read-only");
    expect(report.crypto.map((item) => item.symbol)).toEqual(["BTCUSD"]);
    expect(report.market.tone).toBe("positive");
    expect(report.aShareContext.summary).toContain("不能单独改变 A 股方向");
  });

  it("does not fabricate prices when the bridge is unavailable", async () => {
    const report = await buildCryptoMarketResearch({
      bridgeUrl: "http://bridge.test",
      marketDataProvider: "akshare",
      mode: "paper",
      timeoutMs: 20,
      fetchImpl: vi.fn(async () => { throw new Error("offline"); }),
    });

    expect(report.sourceStatus).toBe("degraded");
    expect(report.crypto).toEqual([]);
    expect(report.warnings[0]).toContain("无法连接行情桥");
  });
});
