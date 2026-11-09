import { describe, expect, it } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { getOrderFillTime } from "./orderFillTime";

const order: OrderRecord = {
  id: "fill-time", symbol: "600010", side: "buy", type: "limit", quantity: 100,
  status: "filled", requestedPrice: 10, filledPrice: 10, filledQuantity: 100,
  notional: 1000, commission: 5, createdAt: "2026-07-13T01:30:00.000Z",
  updatedAt: "2026-07-14T01:30:00.000Z",
};

describe("getOrderFillTime", () => {
  it("normalizes an explicit fill timestamp without using the later update", () => {
    expect(getOrderFillTime({ ...order, filledAt: "2026-07-13T10:00:00+08:00" }))
      .toBe("2026-07-13T02:00:00.000Z");
  });
  it("uses terminal updatedAt when the legacy fill field is absent", () => {
    expect(getOrderFillTime(order)).toBe(order.updatedAt);
  });
  it.each(["", " ", "bad"])('does not fall back from explicit invalid timestamp "%s"', (filledAt) => {
    expect(getOrderFillTime({ ...order, filledAt })).toBeNull();
  });
  it("does not fall back to creation when both fill evidence fields are missing", () => {
    expect(getOrderFillTime({ ...order, updatedAt: "" })).toBeNull();
  });
  it.each(["pending", "accepted", "rejected", "cancelled"] as const)("does not count %s as a fill", (status) => {
    expect(getOrderFillTime({ ...order, status, filledAt: order.updatedAt })).toBeNull();
  });
});
