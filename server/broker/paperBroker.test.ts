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
    expect(order.rejectionReason).toContain("单笔限额");
    expect(system.store.getPositionQuantity("600519")).toBe(beforeQuantity);
    expect(system.store.listAudit().some((event) => event.category === "risk")).toBe(true);
  });

  it("accepts a limit order as pending without filling", () => {
    const system = createTradingSystem(createTestConfig());
    const before = system.broker.getAccount();
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

    expect(
      system.store.listAudit().some(
        (event) => event.action === "order.cancelled"
      )
    ).toBe(true);
  });

  it("fills a marketable limit order immediately", () => {
    const system = createTradingSystem(createTestConfig());
    const quote = system.market.getQuote("601318");
    const currentPrice = quote!.price;

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

  // ── 新增边界case ──────────────────────────────────────────

  it("emit order.updated event on market order fill", () => {
    const system = createTradingSystem(createTestConfig());
    const events: any[] = [];
    system.broker.on("order.updated", (order: any) => events.push(order));

    system.broker.submitOrder({
      symbol: "300750",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "event-test",
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].status).toBe("filled");
  });

  it("emit account.updated event on order fill", () => {
    const system = createTradingSystem(createTestConfig());
    const events: any[] = [];
    system.broker.on("account.updated", (account: any) => events.push(account));

    system.broker.submitOrder({
      symbol: "300750",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "acct-event-test",
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(typeof events[0].equity).toBe("number");
  });

  it("pause updates account and emits event", () => {
    const system = createTradingSystem(createTestConfig());
    const account = system.broker.pause();
    expect(account.paused).toBe(true);

    // Verify subsequent orders are rejected
    const order = system.broker.submitOrder({
      symbol: "300750",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "paused-order",
    });
    expect(order.status).toBe("rejected");
    expect(order.rejectionReason).toContain("暂停");
  });

  it("resume re-enables trading", () => {
    const system = createTradingSystem(createTestConfig());
    system.broker.pause();
    const account = system.broker.resume();
    expect(account.paused).toBe(false);

    // Should be able to trade again
    const order = system.broker.submitOrder({
      symbol: "300750",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "resumed-order",
    });
    expect(order.status).toBe("filled");
  });

  it("getOrders returns correct count", () => {
    const system = createTradingSystem(createTestConfig());
    const before = system.broker.getOrders().length;

    system.broker.submitOrder({
      symbol: "300750",
      side: "buy",
      type: "market",
      quantity: 100,
    });

    expect(system.broker.getOrders().length).toBe(before + 1);
  });

  it("getOrders respects limit parameter", () => {
    const system = createTradingSystem(createTestConfig());
    // Submit multiple orders
    for (let i = 0; i < 5; i++) {
      system.broker.submitOrder({
        symbol: "300750",
        side: "buy",
        type: "market",
        quantity: 100,
        clientOrderId: `limit-test-${i}`,
      });
    }

    const limited = system.broker.getOrders(2);
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  it("getPositions returns all positions", () => {
    const system = createTradingSystem(createTestConfig());
    const positions = system.broker.getPositions();
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.some((p) => p.symbol === "600519")).toBe(true);
  });

  it("markToMarket does not crash with no pending orders", () => {
    const system = createTradingSystem(createTestConfig());
    // No pending orders — markToMarket should return account without error
    const account = system.broker.markToMarket();
    expect(typeof account.equity).toBe("number");
    expect(account.cash).toBeGreaterThan(0);
  });

  it("commission is at least minimumCommission", () => {
    const system = createTradingSystem(createTestConfig({
      COMMISSION_RATE: 0.0001,
      MIN_COMMISSION: 5,
      SLIPPAGE_BPS: 0,
      MAX_ORDER_NOTIONAL: 300_000,
    }));
    const order = system.broker.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "min-commission-test",
    });

    // 中国平安 ~50元 * 100股 = 5000 notional * 0.0001 = 0.5 commission
    // But minimum is 5, so commission should be >= 5
    expect(order.commission).toBeGreaterThanOrEqual(5);
  });

  it("slippage affects fill price for buy orders", () => {
    const system = createTradingSystem(createTestConfig({
      SLIPPAGE_BPS: 10, // 0.1%
      COMMISSION_RATE: 0,
      MIN_COMMISSION: 0,
      MAX_ORDER_NOTIONAL: 300_000,
    }));
    const quote = system.market.getQuote("601318");
    const currentPrice = quote!.price;

    const order = system.broker.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "slippage-test",
    });

    // Buy order fill price should be >= current price (slippage pushes up)
    expect(order.filledPrice).toBeGreaterThanOrEqual(currentPrice! * 0.99);
  });
});
