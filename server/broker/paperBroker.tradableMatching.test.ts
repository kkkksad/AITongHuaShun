import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSnapshot, MarketQuote, MarketSnapshot, OrderRecord, RiskLimits } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { PaperBroker } from "./paperBroker";

type Backend = "memory" | "json";
type Side = "buy" | "sell";
const symbol = "600001";
const otherSymbol = "600002";
const temporaryDirectories: string[] = [];
const limits: RiskLimits = {
  maxOrderNotional: 100_000, maxPositionWeight: 1,
  maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false,
};

class FixtureMarket extends EventEmitter implements MarketDataProvider {
  price = 10;
  tradable = true;
  constructor(private readonly now: () => Date) { super(); }
  start() {}
  stop() {}
  tick() { return this.getSnapshot(); }
  getQuote(stock: string): MarketQuote | undefined {
    if (stock !== symbol && stock !== otherSymbol) return undefined;
    return {
      symbol: stock, name: stock, price: this.price, tradable: this.tradable,
      previousClose: 10, changePercent: 0, volume: 1_000_000,
      updatedAt: this.now().toISOString(),
    };
  }
  getSnapshot(): MarketSnapshot {
    return { mode: "paper", sequence: 1, marketTime: this.now().toISOString(),
      quotes: [this.getQuote(symbol)!, this.getQuote(otherSymbol)!] };
  }
  snapshotAt(price: number, tradable = true): MarketSnapshot {
    const snapshot = this.getSnapshot();
    return { ...snapshot, quotes: snapshot.quotes.map((quote) => ({ ...quote, price, tradable })) };
  }
}

function brokerFor(store: TradingStore, market: FixtureMarket) {
  return new PaperBroker(market, store, new RiskEngine(limits), {
    mode: "paper", commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0, limits,
  });
}

function fixture(backend: Backend) {
  let time = new Date("2026-11-05T02:00:00.000Z");
  const now = () => time;
  const dataDir = backend === "json"
    ? fs.mkdtempSync(path.join(os.tmpdir(), "kairos-tradable-matching-")) : undefined;
  if (dataDir) temporaryDirectories.push(dataDir);
  const store: TradingStore = dataDir
    ? new JsonFileTradingStore(dataDir, 10_000, false, { now })
    : new InMemoryTradingStore(10_000, false, now);
  const market = new FixtureMarket(now);
  return {
    store, market, broker: brokerFor(store, market), now, dataDir,
    nextDay: () => {
      time = new Date(time.getTime() + 86_400_000);
      vi.setSystemTime(time);
    },
  };
}

function pending(broker: PaperBroker, side: Side, stock = symbol, quantity = 100) {
  const order = broker.submitOrder({
    symbol: stock, side, type: "limit", quantity, limitPrice: side === "buy" ? 10 : 12,
  });
  expect(order.status).toBe("pending");
  return order;
}

function prepare(backend: Backend, side: Side) {
  const current = fixture(backend);
  expect(current.broker.submitOrder({
    symbol, side: "buy", type: "market", quantity: side === "buy" ? 100 : 200,
  }).status).toBe("filled");
  current.nextDay();
  current.market.price = 11;
  return { ...current, order: pending(current.broker, side) };
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
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("kairos-tradable-matching-")) {
      throw new Error("Unexpected tradable matching fixture directory");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe.each<Backend>(["memory", "json"])("PaperBroker pending tradability: %s", (backend) => {
  it.each<Side>(["buy", "sell"])("keeps %s pending and reserved on explicitly non-tradable crossing quotes, values them, then fills on a tradable tick", (side) => {
    const { store, market, broker, order } = prepare(backend, side);
    const cash = store.getCash();
    const quantity = store.getPositionQuantity(symbol);
    const frozenPrincipal = store.getCash() - store.getAvailableCash();
    const availableCash = broker.getAccount().cash;
    const original = { ...store.findOrderById(order.id)! };
    const audit = store.listAudit();
    const events = observe(broker);
    const prices = side === "buy" ? [9, 8] : [13, 14];

    for (const price of prices) {
      const valued = broker.markToMarket(market.snapshotAt(price, false));
      expect(valued).toMatchObject({
        paused: false, cash: availableCash, equity: cash + quantity * price,
        marketValue: quantity * price,
      });
      expect(events.accounts.at(-1)).toEqual(valued);
      expect(store.findOrderById(order.id)).toEqual(original);
      expect(store.getPendingOrders().map((item) => item.id)).toEqual([order.id]);
      expect(store.getCash()).toBe(cash);
      expect(store.getPositionQuantity(symbol)).toBe(quantity);
      expect(store.getCash() - store.getAvailableCash()).toBe(frozenPrincipal);
    }
    expect(frozenPrincipal).toBe(side === "buy" ? 1_000 : 0);
    expect(availableCash).toBe(side === "buy" ? 7_990 : 7_995);
    expect(events.orders).toEqual([]);
    expect(events.accounts).toHaveLength(2);
    expect(store.listAudit()).toEqual(audit);
    expect(market.price).toBe(11);
    expect(market.tradable).toBe(true);

    const matched = broker.markToMarket(market.snapshotAt(prices[0], true));
    expect(store.findOrderById(order.id)).toMatchObject({
      status: "filled", filledQuantity: 100, filledPrice: prices[0], commission: 5,
    });
    expect(store.getCash()).toBe(side === "buy" ? 8_090 : 9_290);
    expect(store.getPositionQuantity(symbol)).toBe(side === "buy" ? 200 : 100);
    expect(store.getPendingOrders()).toEqual([]);
    expect(store.getAvailableCash()).toBe(store.getCash());
    expect(events.orders).toEqual([expect.objectContaining({ id: order.id, status: "filled" })]);
    expect(events.accounts.at(-1)).toEqual(matched);
    expect(broker.getPositions(market.snapshotAt(prices[0]))[0]).toMatchObject({
      availableQuantity: 100, t1LockedQuantity: side === "buy" ? 100 : 0,
    });
  });

  it.each<Side>(["buy", "sell"])("allows explicit %s cancellation after a non-tradable tick and releases only its reservation", (side) => {
    const { store, market, broker, order } = prepare(backend, side);
    const cash = store.getCash();
    const quantity = store.getPositionQuantity(symbol);
    broker.markToMarket(market.snapshotAt(side === "buy" ? 9 : 13, false));
    expect(broker.cancelOrder(order.id)).toMatchObject({ id: order.id, status: "cancelled" });
    expect(store.getPendingOrders()).toEqual([]);
    expect(store.getCash()).toBe(cash);
    expect(store.getAvailableCash()).toBe(cash);
    expect(broker.getAccount().cash).toBe(cash);
    expect(store.getPositionQuantity(symbol)).toBe(quantity);
    const events = observe(broker);
    broker.markToMarket(market.snapshotAt(side === "buy" ? 9 : 13));
    expect(events.orders).toEqual([]);
    expect(store.findOrderById(order.id)?.status).toBe("cancelled");
  });

  it("retains sell-share reservation until cancellation even after non-tradable quotes cross the limit", () => {
    const { store, market, broker, order } = prepare(backend, "sell");
    broker.markToMarket(market.snapshotAt(13, false));
    expect(broker.submitOrder({ symbol, side: "sell", type: "limit", quantity: 200, limitPrice: 12 }))
      .toMatchObject({ status: "rejected", rejectionReason: "可卖持仓不足" });
    expect(store.getPositionQuantity(symbol)).toBe(200);
    expect(store.getPendingOrders()).toMatchObject([{ id: order.id, quantity: 100 }]);
    expect(broker.cancelOrder(order.id).status).toBe("cancelled");
    expect(pending(broker, "sell", symbol, 200)).toMatchObject({ quantity: 200 });
  });

  it.each<Side>(["buy", "sell"])("skips only the non-tradable stock while another %s order fills", (side) => {
    const { store, market, broker, nextDay } = fixture(backend);
    if (side === "sell") {
      for (const stock of [symbol, otherSymbol]) {
        expect(broker.submitOrder({ symbol: stock, side: "buy", type: "market", quantity: 100 }).status).toBe("filled");
      }
      nextDay();
    }
    market.price = 11;
    const unavailable = pending(broker, side);
    const active = pending(broker, side, otherSymbol);
    const events = observe(broker);
    const price = side === "buy" ? 9 : 13;
    const snapshot = market.snapshotAt(price);
    snapshot.quotes[0].tradable = false;
    broker.markToMarket(snapshot);
    expect(store.findOrderById(unavailable.id)?.status).toBe("pending");
    expect(store.findOrderById(active.id)).toMatchObject({ status: "filled", filledPrice: price, commission: 5 });
    expect(store.getPendingOrders().map((item) => item.id)).toEqual([unavailable.id]);
    expect(events.orders).toEqual([expect.objectContaining({ id: active.id, status: "filled" })]);
    expect(store.getCash()).toBe(side === "buy" ? 9_095 : 9_285);
    expect(broker.getAccount(snapshot).cash).toBe(side === "buy" ? 8_090 : 9_285);
    expect(store.getPositionQuantity(symbol)).toBe(side === "buy" ? 0 : 100);
    expect(store.getPositionQuantity(otherSymbol)).toBe(side === "buy" ? 100 : 0);

    broker.markToMarket(market.snapshotAt(price));
    expect(store.findOrderById(unavailable.id)?.status).toBe("filled");
    expect(store.getPendingOrders()).toEqual([]);
    expect(store.getCash()).toBe(side === "buy" ? 8_190 : 10_580);
  });

  it.each<Side>(["buy", "sell"])("preserves the missing and invalid price protections for a %s until a valid tradable tick", (side) => {
    const { store, market, broker, order } = prepare(backend, side);
    const original = { ...store.findOrderById(order.id)! };
    const cash = store.getCash();
    const quantity = store.getPositionQuantity(symbol);
    const availableCash = broker.getAccount().cash;
    const audit = store.listAudit();
    const events = observe(broker);
    const missing = { ...market.getSnapshot(), quotes: [market.getQuote(otherSymbol)!] };
    const invalid = [NaN, Infinity, -Infinity, 0, -1].map((price) => market.snapshotAt(price));
    for (const snapshot of [missing, ...invalid]) {
      broker.markToMarket(snapshot);
      expect(store.findOrderById(order.id)).toEqual(original);
      expect(store.getCash()).toBe(cash);
      expect(store.getPositionQuantity(symbol)).toBe(quantity);
      expect(broker.getAccount(snapshot).cash).toBe(availableCash);
    }
    expect(store.listAudit()).toEqual(audit);
    expect(events.orders).toEqual([]);
    expect(events.accounts).toHaveLength(6);
    broker.markToMarket(market.snapshotAt(side === "buy" ? 9 : 13));
    expect(store.findOrderById(order.id)?.status).toBe("filled");
  });

  it.each<Side>(["buy", "sell"])("keeps matching legacy %s snapshots without a tradable field", (side) => {
    const { store, market, broker, order } = prepare(backend, side);
    const snapshot = market.snapshotAt(side === "buy" ? 9 : 13);
    // Older callers omit this field; only an explicit false defers existing orders.
    snapshot.quotes = snapshot.quotes.map(({ tradable: _tradable, ...quote }) => quote as MarketQuote);
    expect(snapshot.quotes[0]).not.toHaveProperty("tradable");
    broker.markToMarket(snapshot);
    expect(store.findOrderById(order.id)).toMatchObject({
      status: "filled", filledQuantity: 100, filledPrice: side === "buy" ? 9 : 13, commission: 5,
    });
    expect(store.getCash()).toBe(side === "buy" ? 8_090 : 9_290);
  });

  it.each<Side>(["buy", "sell"])("still rejects new %s submissions on a non-tradable quote", (side) => {
    const { store, market, broker, order } = prepare(backend, side);
    const cash = store.getCash();
    const availableCash = broker.getAccount().cash;
    const quantity = store.getPositionQuantity(symbol);
    market.tradable = false;
    expect(broker.submitOrder({ symbol, side, type: "market", quantity: 100 }))
      .toMatchObject({ status: "rejected", rejectionReason: "当前标的仅用于行情展示，不能下单" });
    expect(store.getPendingOrders().map((item) => item.id)).toEqual([order.id]);
    expect(store.getCash()).toBe(cash);
    expect(broker.getAccount().cash).toBe(availableCash);
    expect(store.getPositionQuantity(symbol)).toBe(quantity);
  });
});

describe("JsonFileTradingStore non-tradable pending persistence", () => {
  it.each<Side>(["buy", "sell"])("reopens the pending %s reservation unchanged and fills only when tradability returns", (side) => {
    const { store, market, broker, order, dataDir, now } = prepare("json", side);
    const cash = store.getCash();
    const availableCash = broker.getAccount().cash;
    const quantity = store.getPositionQuantity(symbol);
    const original = { ...store.findOrderById(order.id)! };
    broker.markToMarket(market.snapshotAt(side === "buy" ? 9 : 13, false));

    const reopened = new JsonFileTradingStore(dataDir!, 10_000, false, { now });
    const next = brokerFor(reopened, market);
    expect(reopened.findOrderById(order.id)).toEqual(original);
    expect(reopened.getCash()).toBe(cash);
    expect(next.getAccount().cash).toBe(availableCash);
    expect(reopened.getPositionQuantity(symbol)).toBe(quantity);
    next.markToMarket(market.snapshotAt(side === "buy" ? 8 : 14, false));
    expect(reopened.findOrderById(order.id)).toEqual(original);
    next.markToMarket(market.snapshotAt(side === "buy" ? 9 : 13));
    expect(reopened.findOrderById(order.id)?.status).toBe("filled");
    expect(reopened.getPendingOrders()).toEqual([]);
    expect(reopened.getCash()).toBe(side === "buy" ? 8_090 : 9_290);
  });
});
