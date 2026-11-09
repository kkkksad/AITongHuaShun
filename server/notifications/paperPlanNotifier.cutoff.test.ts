import { describe, expect, it } from "vitest";
import type { AuditEvent, OrderRecord } from "../../shared/trading";
import { summarizePaperOrders } from "./paperPlanNotifier";

const asOf = new Date("2026-07-14T02:00:00Z");
const order = (overrides: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "cutoff", symbol: "600010", side: "buy", type: "limit", quantity: 100,
  requestedPrice: 10, filledPrice: 10, filledQuantity: 100, notional: 1000, commission: 5,
  status: "filled", createdAt: "2026-07-13T02:00:00Z", updatedAt: "2026-07-14T02:00:00.001Z",
  ...overrides,
});
const summarize = (orders: OrderRecord[], audits: AuditEvent[] = []) =>
  summarizePaperOrders(orders, "2026-07-14", audits, asOf);

describe("notification summary evidence cutoff", () => {
  it.each([true, false])("excludes future same-day filled amounts and rows, explicit=%s", (explicit) => {
    const result = summarize([order(explicit ? { filledAt: "2026-07-14T10:00:00.001+08:00" } : {})]);
    expect(result).toMatchObject({ filledOrders: 0, buyNotional: 0, commission: 0, excludedFutureFills: 1, executedOrders: [] });
  });

  it("counts exact-boundary fills and earlier fills together", () => {
    const result = summarize([
      order({ id: "exact", filledAt: "2026-07-14T10:00:00+08:00" }),
      order({ id: "before", updatedAt: "2026-07-14T01:59:59.999Z" }),
    ]);
    expect(result).toMatchObject({ filledOrders: 2, buyNotional: 2000, commission: 10 });
    expect(result.executedOrders.map((row) => row.orderId)).toEqual(["exact", "before"]);
  });

  it("excludes future rejected and pending submissions", () => {
    const result = summarize([
      order({ id: "reject", createdAt: "2026-07-14T02:00:00.001Z", status: "rejected" }),
      order({ id: "pending", createdAt: "2026-07-14T02:00:00.001Z", status: "pending" }),
    ]);
    expect(result).toMatchObject({ rejectedOrders: 0, pendingOrders: 0, unfilledOrders: [] });
  });

  it("cannot borrow a later audit reason for an earlier fill", () => {
    const result = summarize([order({ filledAt: asOf.toISOString() })], [{
      id: "later", category: "system", action: "paper-auto-execution.decision", message: "later",
      timestamp: "2026-07-14T02:00:00.001Z", data: { orderId: "cutoff", reason: "FUTURE_REASON" },
    }]);
    expect(result.executedOrders[0].reasonSource).toBe("historical-fallback");
    expect(JSON.stringify(result)).not.toContain("FUTURE_REASON");
  });

  it("fails explicitly on an invalid report clock", () => {
    expect(() => summarizePaperOrders([order()], "2026-07-14", [], new Date("invalid")))
      .toThrow(/report|asOf|clock/i);
  });
});
