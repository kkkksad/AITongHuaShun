import { describe, expect, it } from "vitest";
import type { MarketQuote } from "../../shared/trading";
import {
  buildIndexRangeSnapshot,
  buildPriceDomain,
} from "./MarketChart";

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

describe("buildIndexRangeSnapshot", () => {
  it("normalizes the real quote into a non-sequential intraday range", () => {
    const snapshot = buildIndexRangeSnapshot(indexQuote);

    expect(snapshot).toMatchObject({
      previousClose: 3955.62,
      open: 3940.2,
      low: 3868.5,
      latest: 3882.41,
      high: 3952.8,
      amountBillions: 11242.08,
    });
    expect(snapshot.latestDayRangePercent).toBeCloseTo(16.52, 1);
    expect(snapshot.markers.latest).toBeGreaterThanOrEqual(0);
    expect(snapshot.markers.latest).toBeLessThanOrEqual(100);
    expect(snapshot.markers.previousClose).toBe(100);
  });

  it("uses finite quote fields when optional range values are absent", () => {
    const snapshot = buildIndexRangeSnapshot({
      ...indexQuote,
      open: undefined,
      high: undefined,
      low: undefined,
      amount: undefined,
    });

    expect(snapshot.open).toBe(indexQuote.previousClose);
    expect(snapshot.low).toBe(indexQuote.price);
    expect(snapshot.high).toBe(indexQuote.price);
    expect(snapshot.latestDayRangePercent).toBe(50);
    expect(snapshot.amountBillions).toBeNull();
  });
});

describe("buildPriceDomain", () => {
  it("keeps every static demonstration point inside the padded axis domain", () => {
    const [minimum, maximum] = buildPriceDomain([
      { price: 3500, average: 3510 },
      { price: 3520, average: 3510 },
    ]);

    expect(minimum).toBeLessThan(3500);
    expect(maximum).toBeGreaterThan(3520);
  });
});
