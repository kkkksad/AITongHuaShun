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

  it("accepts a limit order as pending without filling", () => {
    const system = createTradingSystem(createTestConfig());
    const before = system.broker.getAccount();
    // 中国平安 ~¥52, 100 shares at limit 50 = ¥5,000 (well under 100K limit)
    const order = system.broker.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "limit",
      quantity: 100,
      limitPrice: 50,
      clientOrderId: "limit-buy-1",
    });

    expect(order.status).toBe("pending");
    expect(order.limitPrice).toBe(50);
    expect(order.filledQuantity).toBe(0);

    // Available cash should be reduced by blocked amount
    const after = system.broker.getAccount();
    expect(after.cash).toBeLessThan(before.cash);
  });

  it("cancels a pending limit order", () => {
    const system = createTradingSystem(createTestConfig());
    const order = system.broker.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "limit",
      quantity: 100,
      limitPrice: 50,
      clientOrderId: "to-cancel",
    });

    expect(order.status).toBe("pending");

    const cancelled = system.broker.cancelOrder(order.id);
    expect(cancelled.status).toBe("cancelled");

    // Verify cancelled orders in audit
    expect(
      system.store.listAudit().some(
        (event) => event.action === "order.cancelled"
      )
    ).toBe(true);
  });

  it("fills a marketable limit order immediately", () => {
    const system = createTradingSystem(createTestConfig());
    const quote = system.market.getQuote("601318");
    const currentPrice = quote!.price; // ~52

    // Place a buy limit order at a price HIGHER than current
    const order = system.broker.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "limit",
      quantity: 100,
      limitPrice: currentPrice + 10,
      clientOrderId: "limit-fill-1",
    });

    expect(order.status).toBe("filled");
    expect(order.filledPrice).toBeLessThanOrEqual(currentPrice + 10);
  });

  it("prevents pending sell orders from reserving the same position twice", () => {
    const system = createTradingSystem(createTestConfig({ MAX_ORDER_NOTIONAL: 300_000 }));
    const first = system.broker.submitOrder({
      symbol: "600519",
      side: "sell",
      type: "limit",
      quantity: 100,
      limitPrice: 2_000,
      clientOrderId: "sell-reservation-1",
    });
    const second = system.broker.submitOrder({
      symbol: "600519",
      side: "sell",
      type: "limit",
      quantity: 100,
      limitPrice: 2_000,
      clientOrderId: "sell-reservation-2",
    });

    expect(first.status).toBe("pending");
    expect(second.status).toBe("rejected");
    expect(second.rejectionReason).toBe("可卖持仓不足");
  });

  it("throws when cancelling a non-existent order", () => {
    const system = createTradingSystem(createTestConfig());
    expect(() => system.broker.cancelOrder("non-existent-id")).toThrow(
      "订单不存在"
    );
  });

  it("throws when cancelling a filled order", () => {
    const system = createTradingSystem(createTestConfig());
    const order = system.broker.submitOrder({
      symbol: "300750",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "cant-cancel-filled",
    });

    expect(order.status).toBe("filled");
    expect(() => system.broker.cancelOrder(order.id)).toThrow(
      "只能撤销挂单状态的订单"
    );
  });
});
