import { describe, expect, it } from "vitest";
import { paginateItems } from "./pagination";

describe("paginateItems", () => {
  const items = Array.from({ length: 18 }, (_, index) => index + 1);

  it("returns a stable empty first page", () => {
    expect(paginateItems([], 4, 8)).toEqual({
      items: [],
      page: 1,
      pageCount: 1,
      pageSize: 8,
      rangeStart: 0,
      rangeEnd: 0,
      total: 0,
    });
  });

  it("returns the first bounded slice and display range", () => {
    expect(paginateItems(items, 1, 8)).toMatchObject({
      items: [1, 2, 3, 4, 5, 6, 7, 8],
      page: 1,
      pageCount: 3,
      rangeStart: 1,
      rangeEnd: 8,
      total: 18,
    });
  });

  it("clamps an oversized page to the final page", () => {
    expect(paginateItems(items, 99, 8)).toMatchObject({
      items: [17, 18],
      page: 3,
      pageCount: 3,
      rangeStart: 17,
      rangeEnd: 18,
    });
  });

  it("clamps stale page state after the collection shrinks", () => {
    expect(paginateItems(items.slice(0, 9), 3, 8)).toMatchObject({
      items: [9],
      page: 2,
      pageCount: 2,
      rangeStart: 9,
      rangeEnd: 9,
    });
  });

  it("normalizes invalid page and page-size values", () => {
    expect(paginateItems(items, 0, 0)).toMatchObject({
      page: 1,
      pageSize: 1,
      items: [1],
    });
  });
});
