import { describe, expect, it } from "vitest";
import type { MarketQuote } from "../../shared/trading";
import { buildIndexSnapshotData, buildPriceDomain } from "./MarketChart";

const indexQuote: MarketQuote = {
  symbol: "SH000001",
  name: "上证指数",
  tradable: false,
  price: 3882.41,
  previousClose: 3955.62,
  changePercent: -1.85,
  volume: 420_000_000,
  amount: 1_124_208_000_000,
  open: 3940.2,
  high: 3952.8,
  low: 3868.5,
  updatedAt: "2026-07-16T07:00:00.000Z",
};

describe("buildIndexSnapshotData", () => {
  it("builds the chart from the real index snapshot", () => {
    const points = buildIndexSnapshotData(indexQuote);

    expect(points.map((point) => point.time)).toEqual([
      "昨收",
      "今开",
      "最低",
      "最新",
      "最高",
    ]);
    expect(points.find((point) => point.time === "最新")).toEqual({
      time: "最新",
      price: 3882.41,
      average: 3955.62,
      volume: 11242.08,
    });
  });
});

describe("buildPriceDomain", () => {
  it("keeps every real snapshot point inside the padded axis domain", () => {
    const points = buildIndexSnapshotData(indexQuote);
    const [minimum, maximum] = buildPriceDomain(points);

    expect(minimum).toBeLessThan(indexQuote.low!);
    expect(maximum).toBeGreaterThan(indexQuote.previousClose);
  });
});
