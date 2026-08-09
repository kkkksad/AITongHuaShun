import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import {
  createEsotericMarketReading,
  formatLocalDate,
  getEsotericMethodLabel,
  summarizeEsotericMarketContext,
  summarizeEsotericStockContext,
} from "./esotericMarket";

const market: MarketSnapshot = {
  mode: "paper",
  sequence: 12,
  marketTime: "2026-08-08T06:00:00.000Z",
  quotes: [
    {
      symbol: "600519",
      name: "甲",
      tradable: true,
      price: 102,
      previousClose: 100,
      changePercent: 2,
      volume: 1_000_000,
      amplitude: 3,
      updatedAt: "2026-08-08T05:59:00.000Z",
    },
    {
      symbol: "000858",
      name: "乙",
      tradable: true,
      price: 99,
      previousClose: 100,
      changePercent: -1,
      volume: 1_000_000,
      high: 101,
      low: 98,
      updatedAt: "2026-08-08T05:58:00.000Z",
    },
    {
      symbol: "601318",
      name: "丙",
      tradable: true,
      price: 101,
      previousClose: 100,
      changePercent: 1,
      volume: 1_000_000,
      amplitude: 2,
      updatedAt: "2026-08-08T05:59:30.000Z",
    },
    {
      symbol: "002594",
      name: "丁",
      tradable: true,
      price: 100,
      previousClose: 100,
      changePercent: 0,
      volume: 1_000_000,
      amplitude: 2,
      updatedAt: "2026-08-08T05:57:00.000Z",
    },
    {
      symbol: "SH000001",
      name: "上证指数",
      tradable: false,
      price: 3_200,
      previousClose: 3_180,
      changePercent: 0.63,
      volume: 0,
      updatedAt: "2026-08-08T05:59:00.000Z",
    },
  ],
};

describe("esotericMarket", () => {
  it("generates a reproducible reading for the same date and target", () => {
    const input = { date: "2026-08-08", target: "600519", method: "yijing" as const };
    expect(createEsotericMarketReading(input)).toEqual(createEsotericMarketReading(input));
  });

  it("keeps the reading within the bounded cultural reference set", () => {
    const reading = createEsotericMarketReading({
      date: "2026-08-08",
      target: "今日大盘",
      method: "wuxing",
    });

    expect(reading.hexagram.number).toBeGreaterThanOrEqual(1);
    expect(reading.hexagram.number).toBeLessThanOrEqual(64);
    expect(reading.changingLine).toBeGreaterThanOrEqual(1);
    expect(reading.changingLine).toBeLessThanOrEqual(6);
    expect(reading.risk).toContain("不得据此");
    expect(reading.target).toBe("今日大盘");
  });

  it("changes the deterministic draw when the round changes", () => {
    const first = createEsotericMarketReading({ date: "2026-08-08", target: "半导体" });
    const second = createEsotericMarketReading({ date: "2026-08-08", target: "半导体", round: 1 });

    expect(second.seed).not.toBe(first.seed);
  });

  it("uses a different cultural lens for each method without changing the market data layer", () => {
    const readings = (['yijing', 'wuxing', 'number'] as const).map((method) =>
      createEsotericMarketReading({
        date: "2026-08-08",
        target: "半导体",
        method,
        marketContext: summarizeEsotericMarketContext(market, new Date("2026-08-08T06:00:00.000Z")),
      }),
    );

    expect(new Set(readings.map((reading) => reading.methodLens)).size).toBe(3);
    expect(new Set(readings.map((reading) => reading.reviewQuestions[0])).size).toBe(3);
    expect(readings.every((reading) => reading.entertainmentIndex >= 0 && reading.entertainmentIndex <= 100)).toBe(true);
    expect(readings.every((reading) => !("action" in reading) && !("order" in reading))).toBe(true);
  });

  it("summarizes only valid tradable quotes and classifies unavailable data safely", () => {
    const context = summarizeEsotericMarketContext(
      market,
      new Date("2026-08-08T06:00:00.000Z"),
    );

    expect(context.sampleCount).toBe(4);
    expect(context.validCount).toBe(4);
    expect(context.breadthRatio).toBe(0.5);
    expect(context.averageChangePercent).toBe(0.5);
    expect(context.marketState).toBe("balanced");
    expect(context.freshnessMinutes).toBeLessThan(5);

    const unavailable = summarizeEsotericMarketContext({ ...market, quotes: [] }, new Date("2026-08-08T06:00:00.000Z"));
    expect(unavailable.marketState).toBe("unavailable");
    expect(unavailable.coverageRatio).toBe(0);
  });

  it("labels agreement and conflict without converting either into a trade action", () => {
    const context = summarizeEsotericMarketContext(
      market,
      new Date("2026-08-08T06:00:00.000Z"),
    );
    const input = {
      date: "2026-08-08",
      target: "今日大盘",
      method: "yijing" as const,
    };
    const aligned = createEsotericMarketReading({
      ...input,
      marketContext: { ...context, marketState: "contracting" },
    });
    const conflicted = createEsotericMarketReading({
      ...input,
      marketContext: { ...context, marketState: "expanding" },
    });

    expect(aligned.symbolLayer.state).toBe("contracting");
    expect(aligned.alignment).toBe("aligned");
    expect(conflicted.alignment).toBe("conflicted");
    expect(conflicted.risk).toContain("不得据此");
  });

  it("formats local dates without UTC shifting", () => {
    expect(formatLocalDate(new Date(2026, 7, 8, 23, 59))).toBe("2026-08-08");
    expect(getEsotericMethodLabel("number")).toBe("数字起卦");
  });

  it("builds a deterministic single-stock reality mirror without trade fields", () => {
    const stock = market.quotes[0];
    const context = summarizeEsotericStockContext(stock, new Date("2026-08-08T06:00:00.000Z"));
    const input = {
      date: "2026-08-08",
      target: `${stock.name} (${stock.symbol})`,
      method: "yijing" as const,
      stockContext: context,
    };
    const first = createEsotericMarketReading(input);
    const second = createEsotericMarketReading(input);

    expect(first).toEqual(second);
    expect(first.focusType).toBe("stock");
    expect(first.focusMirror.summary).toContain("甲 600519");
    expect(first.focusMirror.evidence.join(" ")).toContain("+2.00%");
    expect(first.reviewQuestions[0]).toContain("600519");
    expect(first).not.toHaveProperty("action");
    expect(first).not.toHaveProperty("order");
  });
});
