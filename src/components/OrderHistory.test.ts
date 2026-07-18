import { describe, expect, it } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { resolveOrderName } from "./OrderHistory";

const baseOrder: OrderRecord = {
  id: "PO-1",
  symbol: "600519",
  side: "buy",
  type: "market",
  quantity: 100,
  status: "filled",
  requestedPrice: 1500,
  filledPrice: 1500,
  filledQuantity: 100,
  notional: 150000,
  commission: 45,
  createdAt: "2026-07-18T01:30:00.000Z",
  updatedAt: "2026-07-18T01:30:00.000Z",
};

describe("resolveOrderName", () => {
  it("prefers the persisted order name and falls back for old JSON orders", () => {
    expect(resolveOrderName({ ...baseOrder, name: "贵州茅台" }, new Map([
      ["600519", "行情名称"],
    ]))).toBe("贵州茅台");
    expect(resolveOrderName(baseOrder, new Map([
      ["600519", "贵州茅台"],
    ]))).toBe("贵州茅台");
  });
});
