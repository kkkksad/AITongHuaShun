import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSnapshot, MarketQuote, MarketSnapshot, OrderRecord, OrderRequest, RiskLimits } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { PaperBroker } from "./paperBroker";

type Backend = "memory" | "json";
type Side = "buy" | "sell";
const symbol = "600001";
const directories: string[] = [];
const limits: RiskLimits = {
  maxOrderNotional: 100_000, maxPositionWeight: 1,
  maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false,
};

class FixtureMarket extends EventEmitter implements MarketDataProvider {
  price = 10;
  constructor(private readonly now: () => Date) { super(); }
  start() {}
  stop() {}
  tick() { return this.getSnapshot(); }
  getQuote(): MarketQuote {
    return {
      symbol, name: "pause matching fixture", price: this.price, tradable: true,
      previousClose: 10, changePercent: 0, volume: 1_000_000,
      updatedAt: this.now().toISOString(),
    };
  }
  getSnapshot(): MarketSnapshot {
    return { mode: "paper", sequence: 1, marketTime: this.now().toISOString(), quotes: [this.getQuote()] };
  }
  snapshotAt(price: number): MarketSnapshot {
    const snapshot = this.getSnapshot();
    return { ...snapshot, quotes: snapshot.quotes.map((quote) => ({ ...quote, price })) };
  }
}

function fixture(backend: Backend, input: { cash?: number; maxPositionWeight?: number } = {}) {
  let time = new Date("2026-11-05T02:00:00.000Z");
  const now = () => time;
  const cash = input.cash ?? 10_000;
  const dataDir = backend === "json"
    ? fs.mkdtempSync(path.join(os.tmpdir(), "kairos-pause-matching-")) : undefined;
  if (dataDir) directories.push(dataDir);
  const store: TradingStore = dataDir
    ? new JsonFileTradingStore(dataDir, cash, false, { now })
    : new InMemoryTradingStore(cash, false, now);
  const market = new FixtureMarket(now);
  const riskLimits = { ...limits, maxPositionWeight: input.maxPositionWeight ?? limits.maxPositionWeight };
  const risk = new RiskEngine(riskLimits);
  const options = { mode: "paper" as const, commissionRate: 0.0003, minimumCommission: 5,
    slippageBps: 0, limits: riskLimits };
  const broker = new PaperBroker(market, store, risk, options);
  return {
    market, store, risk, broker, dataDir, now, options,
    nextDay: () => {
      time = new Date(time.getTime() + 86_400_000);
      vi.setSystemTime(time);
    },
  };
}

function request(side: Side, type: "market" | "limit" = "limit", quantity = 100): OrderRequest {
  return { symbol, side, type, quantity,
    ...(type === "limit" ? { limitPrice: side === "buy" ? 10 : 12 } : {}) };
}

function prepare(backend: Backend, side: Side) {
  const current = fixture(backend);
  expect(current.broker.submitOrder(request("buy", "market", side === "buy" ? 100 : 200)).status).toBe("filled");
  current.nextDay();
  current.market.price = 11;
  const order = current.broker.submitOrder(request(side));
  expect(order.status).toBe("pending");
  return { ...current, order };
}

function observe(broker: PaperBroker) {
  const orders: OrderRecord[] = [];
  const accounts: AccountSnapshot[] = [];
  broker.on("order.updated", (order: OrderRecord) => orders.push({ ...order }));
  broker.on("account.updated", (account: AccountSnapshot) => accounts.push({ ...account }));
  return { orders, accounts };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T02:00:00.000Z"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("kairos-pause-matching-")) {
      throw new Error("Unexpected pause matching fixture directory");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe.each<Backend>(["memory", "json"])("PaperBroker paused pending matching: %s", (backend) => {
  it.each<Side>(["buy", "sell"])("keeps %s pending and reserved while valuing every passed snapshot, then fills on the next tick after resume", (side) => {
    const { market, store, broker, order } = prepare(backend, side);
    const cash = store.getCash();
    const quantity = store.getPositionQuantity(symbol);
    const availableCash = broker.getAccount().cash;
    const storedOrder = { ...store.findOrderById(order.id)! };
    broker.pause();
    const audit = store.listAudit();
    const events = observe(broker);
    const prices = side === "buy" ? [9, 8] : [13, 14];

    for (const price of prices) {
      const valued = broker.markToMarket(market.snapshotAt(price));
      expect(valued).toMatchObject({
        paused: true, cash: availableCash, equity: cash + quantity * price,
        marketValue: quantity * price,
      });
      expect(events.accounts.at(-1)).toEqual(valued);
      expect(store.findOrderById(order.id)).toEqual(storedOrder);
      expect(store.getPendingOrders().map((pending) => pending.id)).toEqual([order.id]);
      expect(store.getCash()).toBe(cash);
      expect(store.getPositionQuantity(symbol)).toBe(quantity);
    }
    expect(events.orders).toEqual([]);
    expect(events.accounts).toHaveLength(2);
    expect(store.listAudit()).toEqual(audit);
    expect(market.price).toBe(11);

    const resumed = broker.resume();
    expect(resumed.paused).toBe(false);
    expect(store.findOrderById(order.id)).toEqual(storedOrder);
    expect(store.getCash()).toBe(cash);
    expect(broker.getAccount().cash).toBe(availableCash);
    expect(events.orders).toEqual([]);

    const matched = broker.markToMarket(market.snapshotAt(prices[0]));
    expect(store.findOrderById(order.id)).toMatchObject({
      status: "filled", filledQuantity: 100, filledPrice: prices[0], commission: 5,
    });
    expect(store.getCash()).toBe(side === "buy" ? 8_090 : 9_290);
    expect(store.getPositionQuantity(symbol)).toBe(side === "buy" ? 200 : 100);
    expect(store.getPendingOrders()).toEqual([]);
    expect(events.orders).toEqual([expect.objectContaining({ id: order.id, status: "filled" })]);
    expect(events.accounts.at(-1)).toEqual(matched);
    expect(broker.getPositions(market.snapshotAt(prices[0]))[0]).toMatchObject({
      availableQuantity: 100, t1LockedQuantity: side === "buy" ? 100 : 0,
    });
  });

  it.each<Side>(["buy", "sell"])("allows explicit %s cancellation while paused and releases its reservation", (side) => {
    const { store, broker, order } = prepare(backend, side);
    const cash = store.getCash();
    const quantity = store.getPositionQuantity(symbol);
    broker.pause();
    const events = observe(broker);
    expect(broker.cancelOrder(order.id)).toMatchObject({ id: order.id, status: "cancelled" });
    expect(store.getPendingOrders()).toEqual([]);
    expect(store.getCash()).toBe(cash);
    expect(store.getPositionQuantity(symbol)).toBe(quantity);
    expect(broker.getAccount()).toMatchObject({ paused: true, cash });
    expect(events.orders).toEqual([expect.objectContaining({ id: order.id, status: "cancelled" })]);
    expect(events.accounts).toHaveLength(1);
    broker.resume();
    expect(broker.submitOrder(request(side, "market", side === "sell" ? quantity : 100)).status).toBe("filled");
  });

  it.each([
    ["buy", "market"], ["buy", "limit"], ["sell", "market"], ["sell", "limit"],
  ] as const)("still rejects a new %s %s order while paused without queuing it", (side, type) => {
    const { store, broker, order } = prepare(backend, side);
    broker.pause();
    const cash = store.getCash();
    const availableCash = broker.getAccount().cash;
    const quantity = store.getPositionQuantity(symbol);
    expect(broker.submitOrder(request(side, type))).toMatchObject({
      status: "rejected", rejectionReason: expect.stringContaining("暂停"), filledQuantity: 0,
    });
    expect(store.getPendingOrders().map((pending) => pending.id)).toEqual([order.id]);
    expect(store.getCash()).toBe(cash);
    expect(broker.getAccount().cash).toBe(availableCash);
    expect(store.getPositionQuantity(symbol)).toBe(quantity);
  });

  it.each<Side>(["buy", "sell"])("stops the remaining %s orders when an order.updated listener pauses the same tick", (side) => {
    const { market, store, broker } = prepare(backend, side);
    expect(broker.submitOrder(request(side)).status).toBe("pending");
    const [first, remaining] = store.getPendingOrders();
    const quantity = store.getPositionQuantity(symbol);
    const events = observe(broker);
    broker.once("order.updated", () => broker.pause());
    const snapshot = market.snapshotAt(side === "buy" ? 9 : 13);

    const valued = broker.markToMarket(snapshot);

    expect(store.findOrderById(first.id)?.status).toBe("filled");
    expect(store.findOrderById(remaining.id)?.status).toBe("pending");
    expect(store.getPositionQuantity(symbol)).toBe(quantity + (side === "buy" ? 100 : -100));
    expect(store.getPendingOrders().map((order) => order.id)).toEqual([remaining.id]);
    expect(events.orders.map((order) => order.id)).toEqual([first.id]);
    expect(events.accounts.at(-1)).toEqual(valued);
    expect(valued.paused).toBe(true);
    const cash = store.getCash();
    broker.markToMarket(snapshot);
    expect(store.getCash()).toBe(cash);
    expect(events.orders).toHaveLength(1);
    broker.resume();
    expect(store.findOrderById(remaining.id)?.status).toBe("pending");
    broker.markToMarket(snapshot);
    expect(store.findOrderById(remaining.id)?.status).toBe("filled");
    expect(events.orders.map((order) => order.id)).toEqual([first.id, remaining.id]);
  });

  it.each<Side>(["buy", "sell"])("defers a %s when the limit-price check pauses before returning a match", (side) => {
    const { market, store, broker, order } = prepare(backend, side);
    const cash = store.getCash();
    const quantity = store.getPositionQuantity(symbol);
    const check = store.checkLimitOrderFill.bind(store);
    vi.spyOn(store, "checkLimitOrderFill").mockImplementationOnce((...args) => {
      const matched = check(...args);
      broker.pause();
      return matched;
    });
    const events = observe(broker);
    const snapshot = market.snapshotAt(side === "buy" ? 9 : 13);
    expect(broker.markToMarket(snapshot).paused).toBe(true);
    expect(store.findOrderById(order.id)?.status).toBe("pending");
    expect(store.getCash()).toBe(cash);
    expect(store.getPositionQuantity(symbol)).toBe(quantity);
    expect(events.orders).toEqual([]);
    broker.resume();
    broker.markToMarket(snapshot);
    expect(store.findOrderById(order.id)?.status).toBe("filled");
  });

  it.each<Side>(["buy", "sell"])("defers a %s when reading execution cash pauses before the fill", (side) => {
    const { market, store, broker, order } = prepare(backend, side);
    const cash = store.getCash();
    const quantity = store.getPositionQuantity(symbol);
    const readCash = store.getCash.bind(store);
    vi.spyOn(store, "getCash").mockImplementationOnce(() => {
      broker.pause();
      return readCash();
    });
    const events = observe(broker);
    const snapshot = market.snapshotAt(side === "buy" ? 9 : 13);
    expect(broker.markToMarket(snapshot).paused).toBe(true);
    expect(store.findOrderById(order.id)?.status).toBe("pending");
    expect(store.getCash()).toBe(cash);
    expect(store.getPositionQuantity(symbol)).toBe(quantity);
    expect(events.orders).toEqual([]);
    broker.resume();
    broker.markToMarket(snapshot);
    expect(store.findOrderById(order.id)?.status).toBe("filled");
  });

  it("preserves an underfunded legacy pending order when its cash read pauses, then applies cash rejection after resume", () => {
    const { market, store, broker } = fixture(backend, { cash: 1_000 });
    market.price = 11;
    const order = store.createOrder(request("buy"), 11);
    const readCash = store.getCash.bind(store);
    vi.spyOn(store, "getCash").mockImplementationOnce(() => {
      broker.pause();
      return readCash();
    });
    const events = observe(broker);
    const snapshot = market.snapshotAt(10);
    broker.markToMarket(snapshot);
    expect(store.findOrderById(order.id)).toMatchObject({ status: "pending", commission: 0 });
    expect(store.getCash()).toBe(1_000);
    expect(store.getPositionQuantity(symbol)).toBe(0);
    expect(events.orders).toEqual([]);
    broker.resume();
    broker.markToMarket(snapshot);
    expect(store.findOrderById(order.id)).toMatchObject({ status: "rejected", rejectionReason: "可用资金不足" });
    expect(store.getCash()).toBe(1_000);
    expect(broker.getAccount().cash).toBe(1_000);
  });

  it.each([1, 0.1])("defers before an allowed or rejected position decision mutates an order when risk pauses at cap %s", (maxPositionWeight) => {
    const { market, store, risk, broker } = fixture(backend, { maxPositionWeight });
    market.price = 11;
    const order = broker.submitOrder(request("buy"));
    expect(order.status).toBe("pending");
    const evaluate = risk.evaluatePositionWeight.bind(risk);
    vi.spyOn(risk, "evaluatePositionWeight").mockImplementationOnce((input) => {
      broker.pause();
      return evaluate(input);
    });
    const events = observe(broker);
    const snapshot = market.snapshotAt(10);
    broker.markToMarket(snapshot);
    expect(store.findOrderById(order.id)).toMatchObject({ status: "pending", filledQuantity: 0, commission: 0 });
    expect(store.getCash()).toBe(10_000);
    expect(store.getPositionQuantity(symbol)).toBe(0);
    expect(broker.getAccount().cash).toBe(8_995);
    expect(events.orders).toEqual([]);
    broker.resume();
    broker.markToMarket(snapshot);
    expect(store.findOrderById(order.id)?.status).toBe(maxPositionWeight === 1 ? "filled" : "rejected");
    expect(store.listAudit().some((event) => event.action === "POSITION_WEIGHT_LIMIT")).toBe(maxPositionWeight !== 1);
  });

  it("continues publishing valuation while paused with holdings and no pending orders", () => {
    const { market, store, broker } = fixture(backend);
    broker.submitOrder(request("buy", "market"));
    broker.pause();
    const events = observe(broker);
    const valued = broker.markToMarket(market.snapshotAt(12));
    expect(valued).toMatchObject({ paused: true, cash: 8_995, marketValue: 1_200, equity: 10_195 });
    expect(store.getPositionQuantity(symbol)).toBe(100);
    expect(events.accounts).toEqual([valued]);
    expect(events.orders).toEqual([]);
  });
});

it("keeps JSON pending reservations and pause state after reopening before later resume and matching", () => {
  const { market, broker, dataDir, now, options, order } = prepare("json", "buy");
  broker.pause();
  const store = new JsonFileTradingStore(dataDir!, 10_000, false, { now });
  const reopened = new PaperBroker(market, store, new RiskEngine(options.limits), options);
  const snapshot = market.snapshotAt(9);
  expect(reopened.markToMarket(snapshot)).toMatchObject({ paused: true, cash: 7_990, equity: 9_895 });
  expect(store.findOrderById(order.id)?.status).toBe("pending");
  expect(store.getCash()).toBe(8_995);
  reopened.resume();
  expect(store.findOrderById(order.id)?.status).toBe("pending");
  reopened.markToMarket(snapshot);
  expect(store.findOrderById(order.id)?.status).toBe("filled");
  expect(store.getCash()).toBe(8_090);
});
