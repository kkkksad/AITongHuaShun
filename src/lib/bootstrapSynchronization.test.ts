import { describe, expect, it } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import type { TradingBootstrap } from "./tradingApi";
import { BootstrapSynchronization, upsertOrder } from "./bootstrapSynchronization";

function order(id: string, status: OrderRecord["status"] = "pending"): OrderRecord {
  return {
    id, symbol: "600519", side: "buy", type: "limit", quantity: 100, status,
    requestedPrice: 10, limitPrice: 10, filledQuantity: 0, notional: 0, commission: 0,
    createdAt: "2026-11-05T02:00:00Z", updatedAt: "2026-11-05T02:00:00Z",
  };
}

function base(orders = [order("base")]): TradingBootstrap {
  // This pure projection fixture deliberately omits API fields the helper never reads.
  return {
    health: { mode: "paper" }, capabilities: {},
    market: { mode: "paper", sequence: 1, quotes: [] }, account: { cash: 10_000 },
    positions: [], orders, limits: {},
  } as unknown as TradingBootstrap;
}

describe("bootstrap synchronization windows", () => {
  it("coalesces fields in the current window and consumes them before a later REST read", () => {
    const sync = new BootstrapSynchronization();
    const token = sync.beginBootstrap(false);
    for (let sequence = 2; sequence <= 1_001; sequence++) {
      sync.record({ type: "market.snapshot", data: { ...base().market, mode: "mock", sequence } }, false);
    }
    sync.record({ type: "account.snapshot", data: { ...base().account, cash: 9_000 } }, false);
    sync.record({ type: "positions.snapshot", data: [] }, false);
    const result = sync.finishBootstrap(token, base());
    expect(result.market.sequence).toBe(1_001);
    expect(result.health.mode).toBe("mock");
    expect(result.account.cash).toBe(9_000);
    const next = sync.beginBootstrap(true);
    expect(sync.finishBootstrap(next, base())).toEqual(base());
  });

  it("retains the ID operation order when an initially held tail order is evicted and reinserted", () => {
    const sync = new BootstrapSynchronization();
    const token = sync.beginBootstrap(false);
    const initial = Array.from({ length: 50 }, (_, index) => order(index === 49 ? "tail" : `base-${index}`));
    const events = [order("tail", "filled"), order("new"), order("tail", "cancelled")];
    for (const event of events) sync.record({ type: "order.updated", data: event }, false);
    const result = sync.finishBootstrap(token, base(initial));
    expect(result.orders).toEqual(events.reduce(upsertOrder, initial));
    expect(result.orders[0]).toEqual(order("tail", "cancelled"));
    expect(result.orders[1]).toEqual(order("new"));
  });

  it("deduplicates consecutive updates of the same order without a catchup", () => {
    const sync = new BootstrapSynchronization();
    const token = sync.beginBootstrap(false);
    for (let index = 0; index < 1_000; index++) {
      sync.record({ type: "order.updated", data: order("same", index === 999 ? "filled" : "pending") }, false);
    }
    expect(sync.finishBootstrap(token, base()).orders[0]).toEqual(order("same", "filled"));
    expect(sync.ordersIncomplete).toBe(false);
    expect(sync.takeOrdersCatchup()).toBeUndefined();
  });

  it("clears an overflow when a full snapshot arrives, including an empty snapshot", () => {
    const sync = new BootstrapSynchronization();
    const token = sync.beginBootstrap(false);
    for (let index = 0; index < 101; index++) sync.record({ type: "order.updated", data: order(String(index)) }, false);
    sync.record({ type: "orders.snapshot", data: [] }, false);
    expect(sync.finishBootstrap(token, base()).orders).toEqual([]);
    expect(sync.ordersIncomplete).toBe(false);
    expect(sync.takeOrdersCatchup()).toBeUndefined();
  });

  it("retains initial events after failure but discards a failed cached refresh's window", () => {
    const sync = new BootstrapSynchronization();
    const initial = sync.beginBootstrap(false);
    sync.record({ type: "orders.snapshot", data: [order("early")] }, false);
    sync.failBootstrap(initial);
    const retry = sync.beginBootstrap(false);
    expect(sync.finishBootstrap(retry, base()).orders).toEqual([order("early")]);
    const refresh = sync.beginBootstrap(true);
    sync.record({ type: "orders.snapshot", data: [order("live")] }, true);
    sync.failBootstrap(refresh);
    expect(sync.finishBootstrap(sync.beginBootstrap(true), base()).orders).toEqual(base().orders);
  });

  it("requires only one catchup and replays only changes received during that catchup", () => {
    const sync = new BootstrapSynchronization();
    const initial = sync.beginBootstrap(false);
    for (let index = 0; index < 101; index++) sync.record({ type: "order.updated", data: order(String(index)) }, false);
    expect(sync.finishBootstrap(initial, base()).orders).toHaveLength(50);
    expect(sync.ordersIncomplete).toBe(true);
    const catchup = sync.takeOrdersCatchup()!;
    expect(sync.takeOrdersCatchup()).toBeUndefined();
    sync.record({ type: "order.updated", data: order("during") }, true);
    expect(sync.finishOrders(catchup, [order("authority")])).toEqual([order("during"), order("authority")]);
    expect(sync.ordersIncomplete).toBe(false);
  });

  it("keeps an overflowed catchup incomplete without automatically restarting it", () => {
    const sync = new BootstrapSynchronization();
    const initial = sync.beginBootstrap(false);
    for (let index = 0; index < 101; index++) sync.record({ type: "order.updated", data: order(String(index)) }, false);
    sync.finishBootstrap(initial, base());
    const catchup = sync.takeOrdersCatchup()!;
    for (let index = 0; index < 101; index++) sync.record({ type: "order.updated", data: order(`later-${index}`) }, true);
    expect(sync.finishOrders(catchup, [])).toBeUndefined();
    expect(sync.ordersIncomplete).toBe(true);
    expect(sync.takeOrdersCatchup()).toBeUndefined();
  });

  it("rejects stale epoch results and discards old initial snapshots", () => {
    const sync = new BootstrapSynchronization();
    const token = sync.beginBootstrap(false);
    sync.record({ type: "orders.snapshot", data: [order("old-epoch")] }, false);
    sync.invalidate();
    expect(sync.isCurrentBootstrap(token)).toBe(false);
    expect(() => sync.finishBootstrap(token, base())).toThrow();
    expect(sync.finishBootstrap(sync.beginBootstrap(false), base()).orders).toEqual(base().orders);
  });
});
