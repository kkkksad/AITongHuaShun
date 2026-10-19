import { describe, expect, it } from "vitest";
import {
  ASHARE_TRADING_CALENDAR_COVERAGE,
  getAshareMarketSession,
  getAshareTradingDateStatus,
  getChinaDateKey,
  getPreviousAshareTradingDate,
  isAshareTradingDate,
  isAshareTradingTime,
} from "./ashareTradingCalendar";

describe("A-share trading calendar", () => {
  it("exposes an explicit deterministic coverage window", () => {
    expect(ASHARE_TRADING_CALENDAR_COVERAGE).toEqual({
      startDate: "2024-01-01",
      endDate: "2026-12-31",
    });
  });

  it.each([
    ["2026-07-17", true, "open"],
    ["2026-01-02", false, "holiday"],
    ["2026-10-01", false, "holiday"],
    ["2026-10-05", false, "holiday"],
    ["2026-10-04", false, "weekend"],
    ["2027-01-04", false, "out-of-coverage"],
  ] as const)("classifies %s", (date, isTradingDay, reason) => {
    expect(getAshareTradingDateStatus(date)).toEqual({
      date,
      covered: reason !== "out-of-coverage",
      isTradingDay,
      reason,
    });
  });

  it("fails closed outside the calendar coverage window", () => {
    expect(isAshareTradingDate("2027-01-04")).toBe(false);
    expect(getAshareMarketSession(new Date("2027-01-04T10:00:00+08:00")))
      .toBe("calendar-unavailable");
  });

  it.each([
    ["2026-10-08T09:29:59+08:00", "pre-market"],
    ["2026-10-08T09:30:00+08:00", "open"],
    ["2026-10-08T11:30:00+08:00", "open"],
    ["2026-10-08T12:00:00+08:00", "lunch-break"],
    ["2026-10-08T13:00:00+08:00", "open"],
    ["2026-10-08T15:00:00+08:00", "open"],
    ["2026-10-08T15:01:00+08:00", "after-hours"],
    ["2026-10-01T10:00:00+08:00", "holiday"],
    ["2026-10-04T10:00:00+08:00", "weekend"],
  ] as const)("classifies %s as %s", (value, session) => {
    expect(getAshareMarketSession(new Date(value))).toBe(session);
    expect(isAshareTradingTime(new Date(value))).toBe(session === "open");
  });

  it("returns the previous real trading date across holidays", () => {
    expect(getPreviousAshareTradingDate(new Date("2026-10-04T12:00:00+08:00")))
      .toBe("2026-09-30");
    expect(getPreviousAshareTradingDate(new Date("2026-10-05T10:00:00+08:00")))
      .toBe("2026-09-30");
    expect(getPreviousAshareTradingDate(new Date("2026-10-08T09:00:00+08:00")))
      .toBe("2026-09-30");
  });

  it("uses Beijing time for date and minute boundaries", () => {
    expect(getChinaDateKey(new Date("2026-10-07T16:30:00.000Z")))
      .toBe("2026-10-08");
  });
});