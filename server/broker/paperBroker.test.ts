import { describe, expect, it } from "vitest";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";

describe("PaperBroker", () => {
  it("fills a valid order and updates account cash", () => {
    const system = createTradingSystem(createTestConfig());
    const before = system.broker.getAccount();
    const order = system.broker.submitOrder({
      symbol: "300750",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "test-fill-1",
    });
    const after = system.broker.getAccount();

    expect(order.status).toBe("filled");
    expect(order.filledQuantity).toBe(100);
    expect(order.commission).toBeGreaterThan(0);
    expect(after.cash).toBeLessThan(before.cash);
    expect(system.store.getPositionQuantity("300750")).toBe(500);
  });

  it("returns the existing order for a repeated client order id", () => {
    const system = createTradingSystem(createTestConfig());
    const request = {
      symbol: "300750",
      side: "buy" as const,
      type: "market" as const,
      quantity: 100,
      clientOrderId: "idempotent-order",
    };

    const first = system.broker.submitOrder(request);
    const second = system.broker.submitOrder(request);

    expect(second.id).toBe(first.id);
    expect(system.broker.getOrders()).toHaveLength(1);
  });

  it("records a risk rejection without changing positions", () => {
    const system = createTradingSystem(createTestConfig());
    const beforeQuantity = system.store.getPositionQuantity("600519");
    const order = system.broker.submitOrder({
      symbol: "600519",
      side: "buy",
      type: "market",
      quantity: 1000,
      clientOrderId: "too-large",
    });

    expect(order.status).toBe("rejected");
    expect(order.rejectionReason).toBe("订单金额超过单笔限额");
    expect(system.store.getPositionQuantity("600519")).toBe(beforeQuantity);
    expect(system.store.listAudit().some((event) => event.category === "risk")).toBe(true);
  });
});
