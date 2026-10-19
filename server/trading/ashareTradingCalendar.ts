const CHINA_TZ_OFFSET_MINUTES = 8 * 60;
const CHINA_TZ_OFFSET_MS = CHINA_TZ_OFFSET_MINUTES * 60_000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const ASHARE_TRADING_CALENDAR_VERSION = "2026.10.04";
export const ASHARE_TRADING_CALENDAR_SOURCE =
  "AkShare tool_trade_date_hist_sina, cross-checked 2024-2026";
export const ASHARE_TRADING_CALENDAR_COVERAGE = Object.freeze({
  startDate: "2024-01-01",
  endDate: "2026-12-31",
});

// Weekday exchange closures. Weekends are handled separately and working
// weekends remain non-trading days for the exchange.
const ASHARE_WEEKDAY_CLOSURES = new Set([
  "2024-01-01",
  "2024-02-09",
  "2024-02-12",
  "2024-02-13",
  "2024-02-14",
  "2024-02-15",
  "2024-02-16",
  "2024-04-04",
  "2024-04-05",
  "2024-05-01",
  "2024-05-02",
  "2024-05-03",
  "2024-06-10",
  "2024-09-16",
  "2024-09-17",
  "2024-10-01",
  "2024-10-02",
  "2024-10-03",
  "2024-10-04",
  "2024-10-07",
  "2025-01-01",
  "2025-01-28",
  "2025-01-29",
  "2025-01-30",
  "2025-01-31",
  "2025-02-03",
  "2025-02-04",
  "2025-04-04",
  "2025-05-01",
  "2025-05-02",
  "2025-05-05",
  "2025-06-02",
  "2025-10-01",
  "2025-10-02",
  "2025-10-03",
  "2025-10-06",
  "2025-10-07",
  "2025-10-08",
  "2026-01-01",
  "2026-01-02",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-02-23",
  "2026-04-06",
  "2026-05-01",
  "2026-05-04",
  "2026-05-05",
  "2026-06-19",
  "2026-09-25",
  "2026-10-01",
  "2026-10-02",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
]);

export type AshareTradingDayReason =
  | "open"
  | "weekend"
  | "holiday"
  | "out-of-coverage";

export interface AshareTradingDayStatus {
  date: string;
  covered: boolean;
  isTradingDay: boolean;
  reason: AshareTradingDayReason;
}

export type AshareMarketSession =
  | "open"
  | "pre-market"
  | "lunch-break"
  | "after-hours"
  | "weekend"
  | "holiday"
  | "calendar-unavailable";

function assertValidDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) {
    throw new RangeError("A valid Date is required for A-share calendar checks");
  }
}

function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function dateKeyCoverage(date: string): boolean {
  return date >= ASHARE_TRADING_CALENDAR_COVERAGE.startDate &&
    date <= ASHARE_TRADING_CALENDAR_COVERAGE.endDate;
}

export function getChinaDateKey(value: Date): string {
  assertValidDate(value);
  return new Date(value.getTime() + CHINA_TZ_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

export function getChinaMinutes(value: Date): number {
  assertValidDate(value);
  const shifted = new Date(value.getTime() + CHINA_TZ_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function getAshareTradingDayStatus(value: Date): AshareTradingDayStatus {
  return getAshareTradingDateStatus(getChinaDateKey(value));
}

export function getAshareTradingDateStatus(date: string): AshareTradingDayStatus {
  if (!isDateKey(date)) {
    throw new RangeError(`Invalid A-share trading date: ${date}`);
  }
  if (!dateKeyCoverage(date)) {
    return {
      date,
      covered: false,
      isTradingDay: false,
      reason: "out-of-coverage",
    };
  }

  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  if (day === 0 || day === 6) {
    return {
      date,
      covered: true,
      isTradingDay: false,
      reason: "weekend",
    };
  }
  if (ASHARE_WEEKDAY_CLOSURES.has(date)) {
    return {
      date,
      covered: true,
      isTradingDay: false,
      reason: "holiday",
    };
  }
  return {
    date,
    covered: true,
    isTradingDay: true,
    reason: "open",
  };
}

export function isAshareTradingDate(date: string): boolean {
  return getAshareTradingDateStatus(date).isTradingDay;
}

export function getPreviousAshareTradingDate(
  value: Date | string,
  maxLookbackDays = 370,
): string | null {
  const startDate = typeof value === "string" ? value : getChinaDateKey(value);
  if (!isDateKey(startDate) || maxLookbackDays < 1) return null;

  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  for (let offset = 1; offset <= Math.floor(maxLookbackDays); offset += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const candidate = cursor.toISOString().slice(0, 10);
    const status = getAshareTradingDateStatus(candidate);
    if (status.isTradingDay) return candidate;
    if (status.reason === "out-of-coverage") return null;
  }
  return null;
}

export function getAshareMarketSession(value = new Date()): AshareMarketSession {
  const dayStatus = getAshareTradingDayStatus(value);
  if (!dayStatus.covered) return "calendar-unavailable";
  if (dayStatus.reason === "weekend") return "weekend";
  if (dayStatus.reason === "holiday") return "holiday";

  const minutes = getChinaMinutes(value);
  if (minutes < 9 * 60 + 30) return "pre-market";
  if (minutes <= 11 * 60 + 30) return "open";
  if (minutes < 13 * 60) return "lunch-break";
  if (minutes <= 15 * 60) return "open";
  return "after-hours";
}

export function isAshareTradingTime(value = new Date()): boolean {
  return getAshareMarketSession(value) === "open";
}