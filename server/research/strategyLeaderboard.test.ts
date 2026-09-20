import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { buildUnavailableStrategyLeaderboard } from "./strategyLeaderboard";

const emptySnapshot: MarketSnapshot = {
  mode: "paper",
  sequence: 17,
  marketTime: "2026-08-30T02:00:00.000Z",
  quotes: [],
};

describe("unavailable strategy leaderboard", () => {
  it("returns a guarded empty report instead of requiring a tradable quote", () => {
    const report = buildUnavailableStrategyLeaderboard(
      emptySnapshot,
      "akshare",
      120,
      "行情桥暂时没有返回股票快照",
    );

    expect(report.entries).toEqual([]);
    expect(report.source).toMatchObject({
      provider: "akshare",
      quoteCount: 0,
      tradableSymbols: [],
      bars: 120,
    });
    expect(report.dataQuality.summary).toContain("行情桥暂时没有返回股票快照");
    expect(report.guardrails.join(" ")).toContain("没有可交易行情");
  });
});
