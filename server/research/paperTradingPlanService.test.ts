import { describe, expect, it } from "vitest";
import type { AuditEvent, PositionSnapshot } from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import {
  buildPreferredHistoricalStocks,
  findLatestConfirmedRestrictiveRouting,
  resolveChinaTradingDate,
} from "./paperTradingPlanService";

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

describe("findLatestConfirmedRestrictiveRouting", () => {
  it("uses only a live intraday defensive route from the requested trading date", () => {
    const audits: AuditEvent[] = [
      {
        id: "degraded-newer",
        category: "system",
        action: "paper-auto-execution.run",
        message: "run recorded",
        timestamp: "2026-07-22T06:55:00.000Z",
        data: {
          tradingDate: "2026-07-22",
          session: "open",
          regime: "unclear",
          sourceStatus: "degraded",
        },
      },
      {
        id: "confirmed-risk-off",
        category: "system",
        action: "paper-auto-execution.run",
        message: "run recorded",
        timestamp: "2026-07-22T06:54:47.616Z",
        data: {
          tradingDate: "2026-07-22",
          session: "open",
          regime: "risk-off",
          sourceStatus: "live-read-only",
        },
      },
      {
        id: "old-day",
        category: "system",
        action: "paper-auto-execution.run",
        message: "run recorded",
        timestamp: "2026-07-21T06:54:47.616Z",
        data: {
          tradingDate: "2026-07-21",
          session: "open",
          regime: "risk-off-recovery",
          sourceStatus: "live-read-only",
        },
      },
    ];

    expect(findLatestConfirmedRestrictiveRouting(audits, "2026-07-22")).toEqual({
      regime: "risk-off",
      confirmedAt: "2026-07-22T06:54:47.616Z",
    });
    expect(findLatestConfirmedRestrictiveRouting(audits, "2026-07-23")).toBeNull();
  });
});

describe("resolveChinaTradingDate", () => {
  it("anchors routing stability to the current Shanghai date instead of a stale snapshot date", () => {
    expect(resolveChinaTradingDate(new Date("2026-07-22T16:30:00.000Z")))
      .toBe("2026-07-23");
  });
});
