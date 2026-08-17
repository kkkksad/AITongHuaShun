import { describe, expect, it } from "vitest";
import type { AuditEvent, PositionSnapshot } from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import {
  buildPreferredHistoricalStocks,
  findLatestConfirmedRestrictiveRouting,
  resolveChinaTradingDate,
  summarizeRecentPaperStrategyUsage,
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
      { symbol: "601288", name: "农业银行" },
      { symbol: "600115", name: "中国东航" },
    ]);
  });

  it("keeps both scanners represented when the bounded pool is crowded", () => {
    const candidates = {
      candidates: Array.from({ length: 8 }, (_, index) => ({
        symbol: `6000${String(index).padStart(2, "0")}`,
        name: `候选${index}`,
        action: "paper-buy",
        score: 90 - index,
      })),
    } as unknown as DailyCandidateReport;
    const qualityStocks = {
      stocks: Array.from({ length: 4 }, (_, index) => ({
        symbol: `6010${String(index).padStart(2, "0")}`,
        name: `优质${index}`,
        action: "focus",
        score: 88 - index,
      })),
    } as unknown as DailyQualityStockReport;

    const result = buildPreferredHistoricalStocks({
      positions: [],
      candidates,
      qualityStocks,
      limit: 6,
    });

    expect(result).toHaveLength(6);
    expect(result.filter((stock) => stock.name.startsWith("候选"))).toHaveLength(3);
    expect(result.filter((stock) => stock.name.startsWith("优质"))).toHaveLength(3);
  });
});

describe("critical paper research bounds", () => {
  it("keeps the critical stock pool small enough to finish before auxiliary history work", () => {
    const candidates = {
      candidates: Array.from({ length: 12 }, (_, index) => ({
        symbol: `600${String(index).padStart(3, "0")}`,
        name: `候选${index}`,
        action: "paper-buy",
        score: 90 - index,
      })),
    } as unknown as DailyCandidateReport;
    const qualityStocks = { stocks: [] } as unknown as DailyQualityStockReport;

    expect(buildPreferredHistoricalStocks({
      positions: [],
      candidates,
      qualityStocks,
      limit: 6,
    })).toHaveLength(6);
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

describe("summarizeRecentPaperStrategyUsage", () => {
  it("counts only recently filled automatic decisions and extracts legacy rule checks", () => {
    const audits = [
      {
        id: "filled-explicit",
        category: "system",
        action: "paper-auto-execution.decision",
        message: "decision",
        timestamp: "2026-08-17T05:10:00.000Z",
        data: { status: "filled", strategyKey: "kairosRangeRotation" },
      },
      {
        id: "filled-legacy",
        category: "system",
        action: "paper-auto-execution.decision",
        message: "decision",
        timestamp: "2026-08-16T05:10:00.000Z",
        data: {
          status: "filled",
          ruleChecks: ["paper-only", "strategy-route: pass (rsi)"],
        },
      },
      {
        id: "rejected",
        category: "system",
        action: "paper-auto-execution.decision",
        message: "decision",
        timestamp: "2026-08-17T05:20:00.000Z",
        data: { status: "rejected", strategyKey: "kairosRangeRotation" },
      },
      {
        id: "expired",
        category: "system",
        action: "paper-auto-execution.decision",
        message: "decision",
        timestamp: "2026-08-01T05:10:00.000Z",
        data: { status: "filled", strategyKey: "momentum" },
      },
    ] as AuditEvent[];

    expect(summarizeRecentPaperStrategyUsage(
      audits,
      new Date("2026-08-17T07:00:00.000Z"),
    )).toEqual({ kairosRangeRotation: 1, rsi: 1 });
  });
});
