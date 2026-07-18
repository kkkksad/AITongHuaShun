import { describe, expect, it } from "vitest";
import type { LogEntry, LogLevel } from "../logger";
import { queryLogEntries } from "./logQuery";

function makeEntry(
  index: number,
  level: LogLevel = "info",
  module = "api",
): LogEntry {
  return {
    timestamp: new Date(Date.UTC(2026, 6, 18, 1, 0, index)).toISOString(),
    level,
    module,
    message: `log-${index}`,
  };
}

describe("queryLogEntries", () => {
  it("returns the newest first page with complete counts", () => {
    const entries = Array.from({ length: 120 }, (_, index) => makeEntry(index + 1));

    const page = queryLogEntries(entries, { limit: 50, offset: 0 });

    expect(page).toMatchObject({
      total: 120,
      filtered: 120,
      returned: 50,
      offset: 0,
      limit: 50,
      page: 1,
      pageCount: 3,
      hasPrevious: false,
      hasNext: true,
    });
    expect(page.entries[0].message).toBe("log-120");
    expect(page.entries[49].message).toBe("log-71");
  });

  it("returns a stable middle page", () => {
    const entries = Array.from({ length: 120 }, (_, index) => makeEntry(index + 1));

    const page = queryLogEntries(entries, { limit: 50, offset: 50 });

    expect(page).toMatchObject({
      page: 2,
      pageCount: 3,
      hasPrevious: true,
      hasNext: true,
    });
    expect(page.entries[0].message).toBe("log-70");
    expect(page.entries[49].message).toBe("log-21");
  });

  it("applies minimum severity and case-insensitive module filters before paging", () => {
    const entries = [
      makeEntry(1, "debug", "market"),
      makeEntry(2, "info", "MarketData"),
      makeEntry(3, "warn", "MarketData"),
      makeEntry(4, "error", "market-bridge"),
      makeEntry(5, "error", "orders"),
    ];

    const page = queryLogEntries(entries, {
      limit: 50,
      offset: 0,
      level: "warn",
      module: "MARKET",
    });

    expect(page.total).toBe(5);
    expect(page.filtered).toBe(2);
    expect(page.returned).toBe(2);
    expect(page.entries.map((entry) => entry.message)).toEqual(["log-4", "log-3"]);
  });

  it("clamps a stale offset to the final valid page", () => {
    const entries = Array.from({ length: 61 }, (_, index) => makeEntry(index + 1));

    const page = queryLogEntries(entries, { limit: 50, offset: 500 });

    expect(page).toMatchObject({
      offset: 50,
      page: 2,
      pageCount: 2,
      returned: 11,
      hasPrevious: true,
      hasNext: false,
    });
    expect(page.entries[0].message).toBe("log-11");
  });

  it("returns a stable empty page", () => {
    expect(queryLogEntries([], { limit: 50, offset: 100 })).toEqual({
      total: 0,
      filtered: 0,
      returned: 0,
      offset: 0,
      limit: 50,
      page: 1,
      pageCount: 1,
      hasPrevious: false,
      hasNext: false,
      entries: [],
    });
  });
});
