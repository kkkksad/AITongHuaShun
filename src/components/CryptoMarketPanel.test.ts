import { describe, expect, it } from "vitest";
import type { CryptoMarketResearchReport } from "../lib/tradingApi";
import { buildCryptoPanelRows } from "./CryptoMarketPanel";

describe("buildCryptoPanelRows", () => {
  it("derives the current 24h range position without inventing history", () => {
    const report = {
      crypto: [{
        symbol: "BTCUSDT",
        name: "Bitcoin",
        priceUsd: 105,
        change24hPercent: 2,
        high24h: 110,
        low24h: 90,
        volume24h: 1_000,
        updatedAt: "2026-07-21T01:00:00.000Z",
        source: "test",
      }],
    } as CryptoMarketResearchReport;

    expect(buildCryptoPanelRows(report)).toEqual([
      expect.objectContaining({
        symbol: "BTCUSDT",
        rangePosition: 0.75,
      }),
    ]);
  });

  it("keeps range position unavailable when the source range is missing", () => {
    const report = {
      crypto: [{
        symbol: "ETHUSDT",
        name: "Ethereum",
        priceUsd: 3_500,
        change24hPercent: -1,
        high24h: null,
        low24h: null,
        volume24h: null,
        updatedAt: "2026-07-21T01:00:00.000Z",
        source: "test",
      }],
    } as CryptoMarketResearchReport;

    expect(buildCryptoPanelRows(report)[0].rangePosition).toBeNull();
  });
});
