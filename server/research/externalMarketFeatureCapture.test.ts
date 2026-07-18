import { describe, expect, it, vi } from "vitest";
import type { ExternalMarketImpactReport } from "./externalMarketImpact";
import {
  ExternalMarketFeatureCapture,
  fetchHs300CloseReturnFromBridge,
} from "./externalMarketFeatureCapture";

function report(): ExternalMarketImpactReport {
  return {
    generatedAt: "2026-07-17T01:20:00Z",
    mode: "paper",
    provider: "akshare",
    sourceStatus: "live-read-only",
    influenceMode: "observation-only",
    source: {
      globalSnapshotSources: ["test"],
      globalHistorySource: "test",
      benchmarkHistorySource: "test",
      cryptoSource: "test",
      fetchedAt: "2026-07-17T01:20:00Z",
      requestedDays: 60,
      globalSnapshotCount: 6,
      globalHistoryCount: 6,
      cryptoCount: 2,
    },
    groups: [
      { key: "us-overnight", tone: "negative", coverage: 3, averageChangePercent: -1.2, asOf: null, symbols: ["DJI", "SPX", "IXIC"] },
      { key: "asia", tone: "negative", coverage: 3, averageChangePercent: -0.7, asOf: null, symbols: ["HSI", "N225", "KOSPI"] },
      { key: "crypto", tone: "neutral", coverage: 2, averageChangePercent: 0.2, asOf: null, symbols: ["BTCUSD", "ETHUSD"] },
    ],
    markets: [
      { symbol: "N225", name: "日经225", region: "JP", price: 40000, changePercent: -0.8, updatedAt: "2026-07-17T01:20:00Z", source: "test", sessionDate: "2026-07-17", timezone: "Asia/Tokyo", quoteKind: "snapshot" },
      { symbol: "KOSPI", name: "韩国KOSPI", region: "KR", price: 3200, changePercent: -0.6, updatedAt: "2026-07-17T01:20:00Z", source: "test", sessionDate: "2026-07-17", timezone: "Asia/Seoul", quoteKind: "snapshot" },
      { symbol: "HSI", name: "恒生指数", region: "HK", price: 24000, changePercent: -0.7, updatedAt: "2026-07-17T01:20:00Z", source: "test", sessionDate: "2026-07-17", timezone: "Asia/Hong_Kong", quoteKind: "snapshot" },
    ],
    crypto: [
      { symbol: "BTCUSD", name: "比特币", priceUsd: 68000, change24hPercent: 0.3, high24h: null, low24h: null, volume24h: null, updatedAt: "2026-07-17T01:20:00Z", source: "test" },
      { symbol: "ETHUSD", name: "以太坊", priceUsd: 3600, change24hPercent: 0.1, high24h: null, low24h: null, volume24h: null, updatedAt: "2026-07-17T01:20:00Z", source: "test" },
    ],
    aShareImpact: { bias: "restrictive", confidence: 60, evidenceGrade: "snapshot-only", allowPositionIncrease: false, rationale: [] },
    validation: { benchmark: "SH000300", samples: 0, windows: 0, directionalHitRate: null, averageNextDayReturn: null, unconditionalAverageReturn: null, incrementalReturn: null },
    warnings: [],
    guardrails: [],
  };
}

describe("ExternalMarketFeatureCapture", () => {
  it("normalizes the protected bridge HS300 quote into a decimal return", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      quotes: [{ symbol: "SH000300", changePercent: 0.6 }],
    }), { status: 200 }));

    const value = await fetchHs300CloseReturnFromBridge({
      bridgeUrl: "http://127.0.0.1:8800",
      bridgeToken: "bridge-token",
      timeoutMs: 100,
      fetchImpl,
    });

    expect(value).toBe(0.006);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8800/api/market/indices?symbols=SH000300",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer bridge-token",
        }),
      }),
    );
  });

  it("captures one compact pre-market row at 09:20 China time", async () => {
    const upsert = vi.fn();
    const buildReport = vi.fn().mockResolvedValue(report());
    const capture = new ExternalMarketFeatureCapture({
      store: { upsert },
      buildReport,
      fetchHs300CloseReturn: vi.fn(),
      clock: () => new Date("2026-07-17T01:20:00Z"),
    });

    await capture.runOnce();
    await capture.runOnce();

    expect(buildReport).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      tradeDate: "2026-07-17",
      usOvernightReturn: -0.012,
      japanOpenReturn: -0.008,
      koreaOpenReturn: -0.006,
      hongKongOpenReturn: -0.007,
      btcOvernightReturn: 0.003,
      ethOvernightReturn: 0.001,
    }));
  });

  it("adds the HS300 label at 15:10 without fetching the full report", async () => {
    const upsert = vi.fn();
    const buildReport = vi.fn();
    const fetchHs300CloseReturn = vi.fn().mockResolvedValue(-0.006);
    const capture = new ExternalMarketFeatureCapture({
      store: { upsert },
      buildReport,
      fetchHs300CloseReturn,
      clock: () => new Date("2026-07-17T07:10:00Z"),
    });

    await capture.runOnce();

    expect(buildReport).not.toHaveBeenCalled();
    expect(fetchHs300CloseReturn).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      tradeDate: "2026-07-17",
      hs300CloseReturn: -0.006,
    }));
  });

  it("does nothing on weekends", async () => {
    const upsert = vi.fn();
    const buildReport = vi.fn();
    const capture = new ExternalMarketFeatureCapture({
      store: { upsert },
      buildReport,
      fetchHs300CloseReturn: vi.fn(),
      clock: () => new Date("2026-07-18T01:20:00Z"),
    });

    await capture.runOnce();

    expect(buildReport).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
