import { describe, expect, it } from "vitest";
import type { PositionSnapshot } from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import { buildPreferredHistoricalStocks } from "./paperTradingPlanService";

describe("buildPreferredHistoricalStocks", () => {
  it("prioritizes positions and actionable candidates for the bounded history pool", () => {
    const positions = [{
      symbol: "601398",
      name: "工商银行",
    }] as PositionSnapshot[];
    const candidates = {
      candidates: [
        { symbol: "600010", name: "包钢股份", action: "paper-buy", score: 95 },
        { symbol: "600115", name: "中国东航", action: "watch", score: 90 },
      ],
    } as unknown as DailyCandidateReport;
    const qualityStocks = {
      stocks: [
        { symbol: "601288", name: "农业银行", action: "focus", score: 92 },
        { symbol: "600010", name: "包钢股份", action: "focus", score: 91 },
      ],
    } as unknown as DailyQualityStockReport;

    expect(buildPreferredHistoricalStocks({
      positions,
      candidates,
      qualityStocks,
      limit: 12,
    })).toEqual([
      { symbol: "601398", name: "工商银行" },
      { symbol: "600010", name: "包钢股份" },
      { symbol: "600115", name: "中国东航" },
      { symbol: "601288", name: "农业银行" },
    ]);
  });
});
