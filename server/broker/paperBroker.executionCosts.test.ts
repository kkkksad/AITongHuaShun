import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketQuote, MarketSnapshot, OrderRequest, RiskLimits } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { PaperBroker } from "./paperBroker";

type Backend = "memory" | "json";
type Options = ConstructorParameters<typeof PaperBroker>[3];
const directories: string[] = [];
const limits: RiskLimits = {
  maxOrderNotional: 1_000_000, maxPositionWeight: 1, maxDailyLoss: 1,
  lotSize: 100, realTradingEnabled: false,
};

class FixtureMarket extends EventEmitter implements MarketDataProvider {
  private readonly prices = new Map([["600001", 11], ["600002", 11]]);
  setPrice(symbol: string, price: number) { this.prices.set(symbol, price); }
  start() {}
  stop() {}
  tick() { return this.getSnapshot(); }
  getQuote(symbol: string): MarketQuote | undefined {
    const price = this.prices.get(symbol);
    return price === undefined ? undefined : {
      symbol, name: symbol, tradable: true, price, previousClose: price,
      changePercent: 0, volume: 1_000_000, updatedAt: new Date().toISOString(),
    };
  }
  getSnapshot(): MarketSnapshot {
    return {
      mode: "paper", sequence: 1, marketTime: new Date().toISOString(),
      quotes: [...this.prices.keys()].map((symbol) => this.getQuote(symbol)!),
    };
  }
}

function fixture(backend: Backend, cash: number, overrides: Partial<Options> = {}) {
  let dataDir: string | undefined;
  if (backend === "json") {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-execution-costs-"));
    directories.push(dataDir);
  }
  const store: TradingStore = dataDir
    ? new JsonFileTradingStore(dataDir, cash, false)
    : new InMemoryTradingStore(cash, false);
  const market = new FixtureMarket();
  const options: Options = {
    mode: "paper", commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0,
    limits, ...overrides,
  };
  const broker = new PaperBroker(market, store, new RiskEngine(limits), options);
  return { store, market, broker, options, dataDir };
}

function buy(symbol = "600001", limitPrice?: number): OrderRequest {
  return { symbol, side: "buy", type: limitPrice === undefined ? "market" : "limit", quantity: 100,
    ...(limitPrice === undefined ? {} : { limitPrice }) };
}

function expectRejectedWithoutFill(store: TradingStore, id: string, cash: number) {
  expect(store.findOrderById(id)).toMatchObject({ status: "rejected", filledQuantity: 0, commission: 0 });
  expect(store.getCash()).toBe(cash);
  expect(store.getPositionQuantity("600001")).toBe(0);
  expect(store.listAudit().some((event) => event.category === "risk" && event.data?.orderId === id)).toBe(true);
  expect(store.listAudit().some((event) => event.action === "order.filled" && event.data?.orderId === id)).toBe(false);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("kairos-execution-costs-")) throw new Error("Unexpected fixture path");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe.each<Backend>(["memory", "json"])("PaperBroker complete execution costs: %s", (backend) => {
  it.each([0, 50])("rejects a principal-only market buy before any fill with %s bps slippage", (slippageBps) => {
    const { store, market, broker } = fixture(backend, 1_000, { slippageBps });
    market.setPrice("600001", 10);
    const order = broker.submitOrder(buy());
    expect(order.rejectionReason).toBe("可用资金不足");
    expectRejectedWithoutFill(store, order.id, 1_000);
    expect(broker.getAccount().cash).toBe(1_000);
  });

  it.each([1_004.99, 1_004.9999])("does not round up %s cash to fund a 1005-cost market buy", (cash) => {
    const { store, market, broker } = fixture(backend, cash);
    market.setPrice("600001", 10);
    const order = broker.submitOrder(buy());
    expectRejectedWithoutFill(store, order.id, cash);
    expect(broker.getAccount().cash).toBe(cash);
  });

  it.each([
    { cash: 1_005, price: 10, slippageBps: 0, filledPrice: 10 },
    { cash: 1_010, price: 10, slippageBps: 50, filledPrice: 10.05 },
    { cash: 10_006, price: 100.01, slippageBps: 0, filledPrice: 100.01 },
  ])("accepts an exact-fit $cash market buy at $price without floating negative cash", ({ cash, price, slippageBps, filledPrice }) => {
    const { store, market, broker } = fixture(backend, cash, { slippageBps });
    market.setPrice("600001", price);
    const order = broker.submitOrder({ ...buy(), clientOrderId: "exact-fit" });
    expect(order).toMatchObject({ status: "filled", filledPrice, commission: 5 });
    expect(store.getCash()).toBe(0);
    expect(broker.getAccount().cash).toBe(0);
    expect(broker.submitOrder({ ...buy(), clientOrderId: "exact-fit" }).id).toBe(order.id);
    expect(store.getPositionQuantity("600001")).toBe(100);
    expect(store.listAudit().filter((event) => event.action === "order.filled")).toHaveLength(1);
  });

  it("refuses a limit buy when its principal fits but its minimum commission does not", () => {
    const { store, broker } = fixture(backend, 1_000);
    const order = broker.submitOrder(buy("600001", 10));
    expectRejectedWithoutFill(store, order.id, 1_000);
    expect(store.getAvailableCash()).toBe(1_000);
    expect(broker.getAccount().cash).toBe(1_000);
  });

  it("keeps Store principal freezing while Broker reserves pending commission", () => {
    const { store, broker } = fixture(backend, 1_005);
    const order = broker.submitOrder(buy("600001", 10));
    expect(order.status).toBe("pending");
    expect(store.getAvailableCash()).toBe(5);
    expect(broker.getAccount()).toMatchObject({ cash: 0, equity: 1_005 });
    broker.cancelOrder(order.id);
    expect(store.getAvailableCash()).toBe(1_005);
    expect(broker.getAccount().cash).toBe(1_005);
  });

  it("does not let a second pending buy spend the first one's reserved commission", () => {
    const { store, broker } = fixture(backend, 2_005);
    const first = broker.submitOrder(buy("600001", 10));
    const second = broker.submitOrder(buy("600002", 10));
    expect(first.status).toBe("pending");
    expect(second).toMatchObject({ status: "rejected", rejectionReason: "可用资金不足" });
    expect(store.getPendingOrders()).toMatchObject([{ id: first.id }]);
    expect(store.getAvailableCash()).toBe(1_005);
    expect(broker.getAccount().cash).toBe(1_000);
    expect(store.getCash()).toBe(2_005);
  });

  it("retains another buy's entire budget across cancellation, rejection and price-improved fill", () => {
    const { store, market, broker } = fixture(backend, 2_010);
    const first = broker.submitOrder(buy("600001", 10));
    const second = broker.submitOrder(buy("600002", 10));
    expect(broker.getAccount().cash).toBe(0);
    broker.cancelOrder(first.id);
    expect(broker.getAccount().cash).toBe(1_005);
    const rejected = broker.submitOrder(buy("600001", 11));
    expect(rejected.status).toBe("rejected");
    expect(broker.getAccount().cash).toBe(1_005);
    market.setPrice("600002", 9.9);
    broker.markToMarket();
    expect(store.findOrderById(second.id)).toMatchObject({ status: "filled", filledPrice: 9.9, commission: 5 });
    expect(store.getCash()).toBe(1_015);
    expect(broker.getAccount().cash).toBe(1_015);
  });

  it("fills two fully funded pending buys at improved prices without keeping phantom reserves", () => {
    const { store, market, broker } = fixture(backend, 2_010);
    broker.submitOrder(buy("600001", 10));
    broker.submitOrder(buy("600002", 10));
    market.setPrice("600001", 9.9);
    market.setPrice("600002", 9.9);
    broker.markToMarket();
    expect(store.listOrders().every((order) => order.status === "filled")).toBe(true);
    expect(store.getCash()).toBe(20);
    expect(broker.getAccount().cash).toBe(20);
  });

  it("uses actual cost for a marketable limit while retaining the original cap principal check", () => {
    const { store, market, broker } = fixture(backend, 1_200);
    market.setPrice("600001", 10);
    expect(broker.submitOrder(buy("600001", 12))).toMatchObject({ status: "filled", filledPrice: 10 });
    expect(store.getCash()).toBe(195);
    expect(broker.getAccount().cash).toBe(195);
  });

  it.each([
    { cap: 10.005, cash: 1_006, rawRemainder: 5.5, filledPrice: 10.01 },
    { cap: 10.004, cash: 1_005, rawRemainder: 4.6, filledPrice: 10 },
  ])("budgets the existing rounded fill at cap $cap without adding an extra rounding buffer", ({ cap, cash, rawRemainder, filledPrice }) => {
    const { store, market, broker } = fixture(backend, cash);
    const order = broker.submitOrder(buy("600001", cap));
    expect(order.status).toBe("pending");
    expect(store.getAvailableCash()).toBeCloseTo(rawRemainder, 8);
    expect(broker.getAccount().cash).toBe(0);
    market.setPrice("600001", cap);
    broker.markToMarket();
    expect(store.findOrderById(order.id)).toMatchObject({ status: "filled", filledPrice, commission: 5 });
    expect(store.getCash()).toBe(0);
    expect(broker.getAccount().cash).toBe(0);
  });

  it("checks proportional commission rather than only the minimum", () => {
    const { store, market, broker } = fixture(backend, 10_099.99, { commissionRate: 0.01 });
    market.setPrice("600001", 100);
    const order = broker.submitOrder(buy());
    expectRejectedWithoutFill(store, order.id, 10_099.99);
  });

  it("protects other full pending budgets when old orders are more expensive than their original funding", () => {
    const { store, market, broker } = fixture(backend, 2_005);
    // Legacy orders were accepted with principal-only funding; no new order schema is needed.
    const first = store.createOrder(buy("600001", 10), 11);
    const second = store.createOrder(buy("600002", 10), 11);
    expect(broker.getAccount().cash).toBe(0);
    market.setPrice("600001", 10);
    market.setPrice("600002", 10);
    broker.markToMarket();
    expect(store.listOrders().filter((order) => order.status === "filled")).toHaveLength(1);
    expect(store.listOrders().filter((order) => order.status === "rejected")).toHaveLength(1);
    expect(store.getCash()).toBe(1_000);
    expect(store.getPendingOrders()).toEqual([]);
    expect([first.id, second.id]).toContain(store.listAudit().find((event) => event.category === "risk")?.data?.orderId);
  });

  it("atomically refuses a direct Store fill that would consume another buy's principal", () => {
    const { store } = fixture(backend, 2_000);
    const first = store.createOrder(buy("600001", 10), 11);
    const second = store.createOrder(buy("600002", 10), 11);
    const result = store.fillOrder(first, "600001", 10, 5);
    expect(result.status).toBe("rejected");
    expectRejectedWithoutFill(store, first.id, 2_000);
    expect(store.getAvailableCash()).toBe(1_000);
    expect(store.getPendingOrders()).toMatchObject([{ id: second.id }]);
    const auditCount = store.listAudit().length;
    store.fillOrder(first, "600001", 10, 5);
    store.rejectOrder(first, "duplicate", "DUPLICATE");
    expect(store.getAvailableCash()).toBe(1_000);
    expect(store.listAudit()).toHaveLength(auditCount);
  });

  it("does not mutate holdings if funds change after the Broker check but before the Store fill", () => {
    const { store, market, broker } = fixture(backend, 1_005);
    market.setPrice("600001", 10);
    const fill = store.fillOrder.bind(store);
    vi.spyOn(store, "fillOrder").mockImplementationOnce((order, name, price, commission) => {
      const withdrawal = store.createOrder(buy("600002"), 1);
      fill(withdrawal, "600002", 1, 0);
      return fill(order, name, price, commission);
    });
    const order = broker.submitOrder(buy());
    expectRejectedWithoutFill(store, order.id, 905);
    expect(store.getPositionQuantity("600002")).toBe(100);
  });

  it("does not fill or reject a completed order again through a stale caller copy", () => {
    const { store, market, broker } = fixture(backend, 2_005);
    market.setPrice("600001", 10);
    const filled = broker.submitOrder(buy());
    const auditCount = store.listAudit().length;
    expect(store.fillOrder({ ...filled, status: "accepted" }, "600001", 10, 5).status).toBe("filled");
    expect(store.rejectOrder({ ...filled, status: "pending" }, "duplicate", "DUPLICATE").status).toBe("filled");
    expect(store.getCash()).toBe(1_000);
    expect(store.getAvailableCash()).toBe(1_000);
    expect(store.getPositionQuantity("600001")).toBe(100);
    expect(store.listAudit()).toHaveLength(auditCount);
  });

  it.each([0, 4])("handles a low-price sell with only %s cash without fee overdraft", (remainingCash) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T03:00:00Z"));
    const { store, market, broker } = fixture(backend, 10 + remainingCash);
    market.setPrice("600001", 0.05);
    expect(broker.submitOrder(buy()).status).toBe("filled");
    vi.setSystemTime(new Date("2026-11-06T03:00:00Z"));
    market.setPrice("600001", 0.01);
    const sell = broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100 });
    if (remainingCash === 0) {
      expect(sell.status).toBe("rejected");
      expect(store.getPositionQuantity("600001")).toBe(100);
      expect(store.getCash()).toBe(0);
    } else {
      expect(sell).toMatchObject({ status: "filled", notional: 1, commission: 5 });
      expect(store.getPositionQuantity("600001")).toBe(0);
      expect(store.getCash()).toBe(0);
    }
  });

  it("allows a net-positive sell to improve cash even when legacy buys are already overcommitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T03:00:00Z"));
    const { store, market, broker } = fixture(backend, 10);
    market.setPrice("600001", 0.05);
    broker.submitOrder(buy());
    store.createOrder(buy("600002", 10), 11);
    vi.setSystemTime(new Date("2026-11-06T03:00:00Z"));
    market.setPrice("600001", 1);
    const sell = broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100 });
    expect(sell).toMatchObject({ status: "filled", notional: 100, commission: 5 });
    expect(store.getCash()).toBe(95);
    expect(broker.getAccount().cash).toBe(0);
  });
});

describe("JSON legacy orders and current fees", () => {
  it("rechecks each old pending buy against other budgets after a fee-rate change", () => {
    const { market, broker, options, dataDir } = fixture("json", 2_010);
    broker.submitOrder(buy("600001", 10));
    broker.submitOrder(buy("600002", 10));
    const reloaded = new JsonFileTradingStore(dataDir!, 2_010, false);
    const changed = new PaperBroker(market, reloaded, new RiskEngine(limits), { ...options, minimumCommission: 10 });
    expect(changed.getAccount().cash).toBe(0);
    market.setPrice("600001", 10);
    market.setPrice("600002", 10);
    changed.markToMarket();
    expect(reloaded.listOrders().filter((order) => order.status === "filled")).toHaveLength(1);
    expect(reloaded.listOrders().filter((order) => order.status === "rejected")).toHaveLength(1);
    expect(reloaded.getCash()).toBe(1_000);
    expect(changed.getAccount().cash).toBe(1_000);
    expect(reloaded.getPendingOrders()).toEqual([]);
  });

  it.each([10, 9.9])("uses current commission after restart and actual fill affordability at price %s", (price) => {
    const { store, market, broker, options, dataDir } = fixture("json", 1_000, { minimumCommission: 0, commissionRate: 0 });
    const pending = broker.submitOrder(buy("600001", 10));
    expect(pending.status).toBe("pending");
    const reloaded = new JsonFileTradingStore(dataDir!, 1_000, false);
    const currentBroker = new PaperBroker(market, reloaded, new RiskEngine(limits), { ...options, minimumCommission: 5 });
    expect(currentBroker.getAccount().cash).toBe(0);
    market.setPrice("600001", price);
    currentBroker.markToMarket();
    if (price === 10) {
      expectRejectedWithoutFill(reloaded, pending.id, 1_000);
      expect(currentBroker.getAccount().cash).toBe(1_000);
    } else {
      expect(reloaded.findOrderById(pending.id)).toMatchObject({ status: "filled", notional: 990, commission: 5 });
      expect(reloaded.getCash()).toBe(5);
    }
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir!, "paper-trading-state.json"), "utf-8"));
    expect(persisted.version).toBe(1);
    expect(persisted.blockedCash).toBe(0);
    expect(persisted.orders[0]).not.toHaveProperty("reservedCash");
    expect(store.getCash()).toBe(1_000);
  });
});
