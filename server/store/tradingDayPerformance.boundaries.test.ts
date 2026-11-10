import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import * as calendar from "../trading/ashareTradingCalendar";
import { calculateTradingDayPerformance } from "./tradingDayPerformance";

function order(timestamp: string, overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "day-boundary", symbol: "600001", side: "buy", type: "market", quantity: 100,
    status: "filled", requestedPrice: 10, filledPrice: 10, filledQuantity: 100,
    notional: 1_000, commission: 5, filledAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    ...overrides,
  };
}

function input(now = "2026-11-10T02:00:00.000Z") {
  const timestamp = new Date(now).toISOString();
  return {
    now: new Date(now), cash: 8_995, equity: 9_995, startingEquity: 10_000,
    positions: [{
      symbol: "600001", name: "boundary fixture", quantity: 100, availableQuantity: 100,
      averagePrice: 10, currentPrice: 10, marketValue: 1_000,
      unrealizedPnl: 0, realizedPnl: 0, weight: 1_000 / 9_995,
    }],
    orders: [order(timestamp)],
    auditEvents: [{ id: "start", category: "system" as const, action: "account.created", message: "fixture", timestamp: "1960-01-01T00:00:00Z" }],
    snapshot: {
      mode: "paper" as const, sequence: 1, marketTime: timestamp,
      quotes: [{ symbol: "600001", name: "boundary fixture", tradable: true, price: 10,
        previousClose: 10, changePercent: 0, volume: 1_000, updatedAt: timestamp }],
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("daily baseline numeric day membership", () => {
  it.each([
    ["2026-11-09T15:59:59.999Z", false],
    ["2026-11-09T16:00:00.000Z", true],
    ["2026-11-10T15:59:59.999Z", true],
    ["2026-11-10T16:00:00.000Z", false],
    ["2026-11-10T00:00:00+08:00", true],
    ["2026-11-09T11:00:00-05:00", true],
  ])("keeps exact Beijing-day fill membership at %s", (timestamp, included) => {
    const value = input();
    value.orders = [order(timestamp)];
    expect(calculateTradingDayPerformance(value)).toMatchObject({
      date: "2026-11-10", openingEquity: included ? 10_000 : 9_995,
      pnl: included ? -5 : 0, baselineSource: "previous-close",
    });
  });

  it.each(["2024-02-29T02:00:00Z", "2027-01-01T02:00:00Z", "1969-12-31T02:00:00Z"])(
    "preserves leap/year/pre-epoch boundaries for %s", (now) => {
      const value = input(now);
      const start = Date.parse(`${calendar.getChinaDateKey(value.now)}T00:00:00+08:00`);
      for (const [offset, included] of [[-1, false], [0, true], [86_399_999, true], [86_400_000, false]] as const) {
        value.orders = [order(new Date(start + offset).toISOString())];
        expect(calculateTradingDayPerformance(value).openingEquity).toBe(included ? 10_000 : 9_995);
      }
    },
  );

  it("keeps account-start priority and checks the same day boundary", () => {
    const value = input();
    value.orders = [order("invalid")];
    value.auditEvents[0].timestamp = "2026-11-09T16:00:00Z";
    expect(calculateTradingDayPerformance(value).baselineSource).toBe("account-start");
    value.auditEvents[0].timestamp = "2026-11-09T15:59:59.999Z";
    expect(calculateTradingDayPerformance(value).baselineSource).toBe("unavailable");
  });

  it.each([
    ["2026-11-09T15:59:59.999Z", "unavailable"],
    ["2026-11-09T16:00:00.000Z", "previous-close"],
    ["2026-11-10T15:59:59.999Z", "previous-close"],
    ["2026-11-10T16:00:00.000Z", "unavailable"],
    ["invalid", "unavailable"],
  ])("requires an overnight position's previous close source in this day: %s", (timestamp, baselineSource) => {
    const value = input();
    value.orders = [];
    value.snapshot.quotes[0].updatedAt = timestamp;
    expect(calculateTradingDayPerformance(value).baselineSource).toBe(baselineSource);
  });

  it("retains invalid filled timestamps as unknown even when another row is valid", () => {
    const value = input();
    value.orders.push(order("bad", { id: "bad" }));
    expect(calculateTradingDayPerformance(value).baselineSource).toBe("unavailable");
    value.orders[1].status = "rejected";
    expect(calculateTradingDayPerformance(value).openingEquity).toBe(10_000);
  });

  it("preserves legacy updatedAt fallback and does not replace an invalid explicit filledAt", () => {
    const value = input();
    value.orders[0].filledAt = undefined;
    expect(calculateTradingDayPerformance(value).openingEquity).toBe(10_000);
    value.orders[0].filledAt = "invalid";
    expect(calculateTradingDayPerformance(value).baselineSource).toBe("unavailable");
  });

  it.each([
    { notional: -1 }, { commission: -1 }, { commission: Infinity },
    { filledQuantity: 0 }, { filledQuantity: 1.5 },
  ])("keeps malformed in-day fill fields unknown: %j", (overrides) => {
    const value = input();
    value.orders[0] = order(value.now.toISOString(), overrides);
    expect(calculateTradingDayPerformance(value).baselineSource).toBe("unavailable");
  });

  it("recomputes changed cash, commission and source fields without a stale account cache", () => {
    const value = input();
    expect(calculateTradingDayPerformance(value).pnl).toBe(-5);
    value.orders[0].commission = 10;
    expect(calculateTradingDayPerformance(value).pnl).toBe(-10);
    value.cash = 8_990;
    value.equity = 9_990;
    expect(calculateTradingDayPerformance(value).openingEquity).toBe(10_000);
    value.orders = [];
    value.snapshot.quotes[0].previousClose = 0;
    expect(calculateTradingDayPerformance(value).baselineSource).toBe("unavailable");
  });

  it("does not repeatedly format calendar dates for a large filled ledger", () => {
    const value = input();
    value.positions = [];
    value.orders = Array.from({ length: 1_000 }, (_, index) => order(
      new Date(value.now.getTime() + index).toISOString(), { id: String(index), side: "sell" },
    ));
    const format = vi.spyOn(calendar, "getChinaDateKey");
    expect(calculateTradingDayPerformance(value).baselineSource).toBe("previous-close");
    expect(format).toHaveBeenCalledTimes(1);
  });

  it("keeps invalid main clocks explicit", () => {
    const value = input();
    value.now = new Date(NaN);
    expect(() => calculateTradingDayPerformance(value)).toThrow(RangeError);
  });
});
