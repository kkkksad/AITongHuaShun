import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnhancedRiskLimits, MarketQuote, MarketSnapshot, OrderRecord, OrderRequest } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { PaperBroker } from "./paperBroker";

type Backend = "memory" | "json";
type BrokerOptions = ConstructorParameters<typeof PaperBroker>[3];
const directories: string[] = [];
const limits: EnhancedRiskLimits = {
  maxOrderNotional: 100_000, maxPositionWeight: 0.25, maxDailyLoss: 1,
  lotSize: 100, realTradingEnabled: false,
  circuitBreaker: {
    maxConsecutiveLosses: 5, maxDailyDrawdown: 0.08,
    cooldownMinutes: 15, recoveryMinutes: 5,
  },
  dynamicPositionScaling: false, maxDrawdownReductionFactor: 0.25,
};

class FixtureMarket extends EventEmitter implements MarketDataProvider {
  private readonly prices = new Map([["600001", 11], ["600002", 11]]);
  constructor(private readonly now: () => Date) { super(); }
  setPrice(symbol: string, price: number) { this.prices.set(symbol, price); }
  start() {}
  stop() {}
  tick() { return this.getSnapshot(); }
  getQuote(symbol: string): MarketQuote | undefined {
    const price = this.prices.get(symbol);
    return price === undefined ? undefined : {
      symbol, name: symbol, price, previousClose: price, changePercent: 0,
      volume: 1_000_000, tradable: true, updatedAt: this.now().toISOString(),
    };
  }
  getSnapshot(): MarketSnapshot {
    return { mode: "paper", sequence: 1, marketTime: this.now().toISOString(),
      quotes: [...this.prices.keys()].map((symbol) => this.getQuote(symbol)!) };
  }
  snapshotWith(prices: Record<string, number>): MarketSnapshot {
    const snapshot = this.getSnapshot();
    return { ...snapshot, quotes: snapshot.quotes.map((quote) => ({
      ...quote, price: prices[quote.symbol] ?? quote.price,
    })) };
  }
}

function fixture(backend: Backend, input: {
  cash?: number; costs?: Partial<BrokerOptions>; riskLimits?: Partial<EnhancedRiskLimits>;
} = {}) {
  let time = new Date("2026-11-05T02:00:00.000Z");
  const now = () => time;
  const cash = input.cash ?? 10_000;
  const dataDir = backend === "json"
    ? fs.mkdtempSync(path.join(os.tmpdir(), "kairos-position-reservations-")) : undefined;
  if (dataDir) directories.push(dataDir);
  const store: TradingStore = dataDir
    ? new JsonFileTradingStore(dataDir, cash, false, { now })
    : new InMemoryTradingStore(cash, false, now);
  const market = new FixtureMarket(now);
  const riskLimits = { ...limits, ...input.riskLimits };
  const risk = new RiskEngine(riskLimits);
  const options: BrokerOptions = {
    mode: "paper", commissionRate: 0.0003, minimumCommission: 5,
    slippageBps: 0, ...input.costs, limits: riskLimits,
  };
  const broker = new PaperBroker(market, store, risk, options);
  return { store, market, risk, broker, dataDir, options, now,
    nextDay: () => {
      time = new Date(time.getTime() + 86_400_000);
      vi.setSystemTime(time);
    } };
}

function buy(symbol = "600001", quantity = 200, limitPrice?: number): OrderRequest {
  return { symbol, side: "buy", type: limitPrice === undefined ? "market" : "limit",
    quantity, ...(limitPrice === undefined ? {} : { limitPrice }) };
}

function pending(broker: PaperBroker, symbol = "600001", quantity = 200, limitPrice = 10) {
  const order = broker.submitOrder(buy(symbol, quantity, limitPrice));
  expect(order.status).toBe("pending");
  return order;
}

function expectPositionRejection(store: TradingStore, order: OrderRecord) {
  expect(store.findOrderById(order.id)).toMatchObject({
    status: "rejected", filledQuantity: 0, commission: 0,
    rejectionReason: expect.stringContaining("单标的上限"),
  });
  expect(store.listAudit().some((event) =>
    event.action === "POSITION_WEIGHT_LIMIT" && event.data?.orderId === order.id)).toBe(true);
  expect(store.listAudit().some((event) =>
    event.action === "order.filled" && event.data?.orderId === order.id)).toBe(false);
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
      !path.basename(resolved).startsWith("kairos-position-reservations-")) {
      throw new Error("Unexpected position fixture directory");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe.each<Backend>(["memory", "json"])("PaperBroker position reservations: %s", (backend) => {
  it("rejects the second same-symbol 20% pending buy before either fills", () => {
    const { store, market, broker } = fixture(backend);
    const first = pending(broker);
    const rejected = broker.submitOrder(buy("600001", 200, 10));
    expectPositionRejection(store, rejected);
    expect(store.getPendingOrders().map((order) => order.id)).toEqual([first.id]);
    expect(store.getCash()).toBe(10_000);
    expect(broker.getAccount().cash).toBe(7_995);
    market.setPrice("600001", 10);
    broker.markToMarket();
    expect(store.findOrderById(first.id)?.status).toBe("filled");
    expect(broker.getPositions()[0]).toMatchObject({ quantity: 200, marketValue: 2_000 });
    expect(broker.getPositions()[0].weight).toBeLessThan(0.25);
  });

  it.each(["market", "marketable-limit"] as const)("includes pending buys before a new %s buy", (kind) => {
    const { store, broker } = fixture(backend);
    const first = pending(broker);
    const rejected = broker.submitOrder(buy("600001", 100, kind === "market" ? undefined : 12));
    expectPositionRejection(store, rejected);
    expect(store.getPositionQuantity("600001")).toBe(0);
    expect(store.getCash()).toBe(10_000);
    expect(store.getPendingOrders().map((order) => order.id)).toEqual([first.id]);
  });

  it("keeps different symbols' pending exposure independent", () => {
    const { store, market, broker } = fixture(backend);
    const first = pending(broker);
    const second = pending(broker, "600002");
    market.setPrice("600001", 10);
    market.setPrice("600002", 10);
    broker.markToMarket();
    expect(store.findOrderById(first.id)?.status).toBe("filled");
    expect(store.findOrderById(second.id)?.status).toBe("filled");
    expect(broker.getPositions()).toHaveLength(2);
    expect(broker.getPositions().every((position) => position.weight < 0.25)).toBe(true);
    expect(store.getCash()).toBe(5_990);
  });

  it("reserves a pending buy at its limit rather than its original higher requested quote", () => {
    const { market, broker } = fixture(backend);
    pending(broker);
    market.setPrice("600001", 4);
    const filled = broker.submitOrder(buy("600001", 100));
    expect(filled.status).toBe("filled");
    expect(broker.getPositions()[0].quantity).toBe(100);
  });

  it("fills two affordable same-symbol pending buys without double-counting either reservation", () => {
    const { store, market, broker } = fixture(backend);
    const first = pending(broker, "600001", 100);
    const second = pending(broker, "600001", 100);
    market.setPrice("600001", 10);
    broker.markToMarket();
    expect([first, second].map((order) => store.findOrderById(order.id)?.status)).toEqual(["filled", "filled"]);
    expect(store.getPositionQuantity("600001")).toBe(200);
    expect(store.getPendingOrders()).toEqual([]);
    expect(store.getCash()).toBe(7_990);
  });

  it.each(["cancel", "reject"] as const)("releases derived pending exposure on %s", (terminal) => {
    const { store, broker } = fixture(backend);
    const first = pending(broker);
    if (terminal === "cancel") broker.cancelOrder(first.id);
    else store.rejectOrder(first, "fixture rejection", "FIXTURE_REJECTION");
    const next = pending(broker);
    expect(store.getPendingOrders().map((order) => order.id)).toEqual([next.id]);
    expect(broker.getAccount().cash).toBe(7_995);
    expect(store.getCash()).toBe(10_000);
  });

  it("replaces filled exposure with the actual position, leaving only remaining capacity", () => {
    const { store, market, broker } = fixture(backend);
    const first = pending(broker, "600001", 100);
    market.setPrice("600001", 10);
    broker.markToMarket();
    expect(store.findOrderById(first.id)?.status).toBe("filled");
    expect(broker.submitOrder(buy("600001", 100)).status).toBe("filled");
    const third = broker.submitOrder(buy("600001", 100));
    expectPositionRejection(store, third);
    expect(store.getPositionQuantity("600001")).toBe(200);
    expect(store.getCash()).toBe(7_990);
  });

  it("does not count a pending sell as a completed reduction in held exposure", () => {
    const { store, market, broker, nextDay } = fixture(backend);
    market.setPrice("600001", 10);
    expect(broker.submitOrder(buy()).status).toBe("filled");
    nextDay();
    const sell = broker.submitOrder({ symbol: "600001", side: "sell", type: "limit", quantity: 100, limitPrice: 20 });
    expect(sell.status).toBe("pending");
    const beforeCash = store.getCash();
    const rejected = broker.submitOrder(buy("600001", 100));
    expectPositionRejection(store, rejected);
    expect(store.getPositionQuantity("600001")).toBe(200);
    expect(store.getCash()).toBe(beforeCash);
    expect(store.getAvailableCash()).toBe(beforeCash);
    expect(store.getPendingOrders().map((order) => order.id)).toEqual([sell.id]);
  });

  it("allows sells to reduce an already overweight legacy position", () => {
    const { store, market, broker, nextDay } = fixture(backend);
    market.setPrice("600001", 10);
    const legacy = store.createOrder(buy("600001", 300), 10);
    store.fillOrder(legacy, "600001", 10, 5);
    nextDay();
    const sold = broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100 });
    expect(sold.status).toBe("filled");
    expect(store.getPositionQuantity("600001")).toBe(200);
    expect(store.getCash()).toBe(7_990);
  });

  it("uses the passed matching snapshot to reject a buy after other holdings lose value", () => {
    const { store, market, broker } = fixture(backend);
    market.setPrice("600002", 10);
    expect(broker.submitOrder(buy("600002")).status).toBe("filled");
    market.setPrice("600001", 13);
    const first = pending(broker, "600001", 200, 12);
    const snapshot = market.snapshotWith({ "600001": 12, "600002": 7 });
    const beforeCash = store.getCash();
    const updated = broker.markToMarket(snapshot);
    expectPositionRejection(store, first);
    expect(store.getCash()).toBe(beforeCash);
    expect(store.getPositionQuantity("600001")).toBe(0);
    expect(store.getPositionQuantity("600002")).toBe(200);
    expect(updated).toMatchObject({ cash: beforeCash, equity: 9_395 });
    expect(market.getQuote("600002")?.price).toBe(10);
    expect(store.getPendingOrders()).toEqual([]);
    expect(pending(broker, "600001", 200, 12).status).toBe("pending");
  });

  it("uses the submission snapshot for an immediate fill even if provider valuation changes after order creation", () => {
    const { store, market, broker } = fixture(backend);
    market.setPrice("600002", 10);
    broker.submitOrder(buy("600002"));
    market.setPrice("600001", 24);
    const snapshot = market.getSnapshot();
    const createOrder = store.createOrder.bind(store);
    vi.spyOn(store, "createOrder").mockImplementation((...args) => {
      const order = createOrder(...args);
      market.setPrice("600002", 7);
      return order;
    });
    const filled = broker.submitOrder(buy("600001", 100));
    expect(filled.status).toBe("filled");
    expect(broker.getPositions(snapshot).find((position) => position.symbol === "600001")?.weight).toBeLessThan(0.25);
    expect(store.getCash()).toBe(5_590);
  });

  it("can fill against a healthy passed snapshot even when the provider still has an older low valuation", () => {
    const { store, market, broker } = fixture(backend);
    market.setPrice("600002", 10);
    broker.submitOrder(buy("600002"));
    market.setPrice("600001", 13);
    const first = pending(broker, "600001", 200, 12);
    market.setPrice("600002", 7);
    const snapshot = market.snapshotWith({ "600001": 12, "600002": 10 });
    broker.markToMarket(snapshot);
    expect(store.findOrderById(first.id)?.status).toBe("filled");
    expect(broker.getPositions(snapshot).find((position) => position.symbol === "600001")?.weight).toBeLessThan(0.25);
    expect(store.getCash()).toBe(5_590);
  });

  it("matches legacy overcommitted buys in existing order and rejects only the later excess", () => {
    const { store, market, broker, dataDir, now, options } = fixture(backend);
    store.createOrder(buy("600001", 200, 10), 11);
    store.createOrder(buy("600001", 200, 10), 11);
    const activeStore = dataDir ? new JsonFileTradingStore(dataDir, 10_000, false, { now }) : store;
    const activeBroker = dataDir ? new PaperBroker(market, activeStore, new RiskEngine(limits), options) : broker;
    const order = activeStore.getPendingOrders();
    market.setPrice("600001", 10);
    activeBroker.markToMarket();
    expect(activeStore.findOrderById(order[0].id)?.status).toBe("filled");
    expectPositionRejection(activeStore, order[1]);
    expect(activeStore.getPositionQuantity("600001")).toBe(200);
    expect(activeStore.getCash()).toBe(7_995);
    expect(activeStore.getAvailableCash()).toBe(7_995);
    expect(activeStore.getPendingOrders()).toEqual([]);
  });

  it("uses requestedPrice as the exposure fallback for an old pending buy without a limit", () => {
    const { store, broker } = fixture(backend);
    store.createOrder({ ...buy("600001", 200), type: "limit" }, 10);
    const rejected = broker.submitOrder(buy("600001", 100));
    expectPositionRejection(store, rejected);
    expect(store.getPositionQuantity("600001")).toBe(0);
  });

  it.each(["filled", "cancelled", "rejected"] as const)("ignores a stale pending copy of a %s order before any new rejection or mutation", (terminal) => {
    const { store, market, broker } = fixture(backend);
    const first = pending(broker);
    const stale = { ...first, quantity: 100_000 };
    if (terminal === "filled") {
      market.setPrice("600001", 10);
      broker.markToMarket();
    } else if (terminal === "cancelled") broker.cancelOrder(first.id);
    else store.rejectOrder(first, "fixture rejection", "FIXTURE_REJECTION");
    const expected = { ...store.findOrderById(first.id)! };
    const before = { cash: store.getCash(), positions: broker.getPositions(), audit: store.listAudit() };
    const beforeFile = backend === "json"
      ? fs.readFileSync(path.join(directories.at(-1)!, "paper-trading-state.json"), "utf8") : undefined;
    const reject = vi.spyOn(store, "rejectOrder");
    const fill = vi.spyOn(store, "fillOrder");
    const internalBroker = broker as unknown as {
      fillOrder(order: OrderRecord, name: string, marketPrice: number, snapshot: MarketSnapshot): OrderRecord;
    };
    expect(internalBroker.fillOrder(stale, "600001", 10, market.getSnapshot())).toEqual(expected);
    expect(reject).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
    expect({ cash: store.getCash(), positions: broker.getPositions(), audit: store.listAudit() }).toEqual(before);
    if (beforeFile !== undefined) {
      expect(fs.readFileSync(path.join(directories.at(-1)!, "paper-trading-state.json"), "utf8")).toBe(beforeFile);
    }
  });

  it.each(["market", "marketable-limit", "pending-limit"] as const)("rejects a fee-only excess at the exact principal cap for %s", (kind) => {
    const { store, market, broker } = fixture(backend);
    market.setPrice("600001", kind === "pending-limit" ? 26 : 25);
    const first = broker.submitOrder(buy("600001", 100, kind === "market" ? undefined : 25));
    if (kind === "pending-limit") {
      expect(first.status).toBe("pending");
      market.setPrice("600001", 25);
      broker.markToMarket();
    }
    expectPositionRejection(store, first);
    expect(store.getCash()).toBe(10_000);
    expect(store.getAvailableCash()).toBe(10_000);
    expect(store.getPositionQuantity("600001")).toBe(0);
  });

  it.each([
    { cash: 10_005, slippageBps: 0, filledPrice: 25 },
    { cash: 10_030, slippageBps: 100, filledPrice: 25.25 },
  ])("allows an exact fee/slippage-adjusted cap with $cash cash without counting costs as stock value", ({ cash, slippageBps, filledPrice }) => {
    const { store, market, broker } = fixture(backend, { cash, costs: { slippageBps } });
    market.setPrice("600001", 25);
    const filled = broker.submitOrder(buy("600001", 100));
    expect(filled).toMatchObject({ status: "filled", filledPrice, commission: 5 });
    expect(store.getCash()).toBe(7_500);
    expect(broker.getAccount().equity).toBe(10_000);
    expect(broker.getPositions()[0]).toMatchObject({ marketValue: 2_500, weight: 0.25 });
  });

  it.each([
    { cash: 10_004.99, slippageBps: 0 },
    { cash: 10_029.99, slippageBps: 100 },
  ])("rejects a real one-cent excess after costs with $cash cash", ({ cash, slippageBps }) => {
    const { store, market, broker } = fixture(backend, { cash, costs: { slippageBps } });
    market.setPrice("600001", 25);
    const rejected = broker.submitOrder(buy("600001", 100));
    expectPositionRejection(store, rejected);
    expect(store.getCash()).toBe(cash);
    expect(broker.getPositions()).toEqual([]);
  });

  it("checks the effective dynamic cap again before filling without mutating risk state", () => {
    const { store, market, broker, risk } = fixture(backend, { riskLimits: { dynamicPositionScaling: true } });
    risk.setInitialEquity(10_000);
    const first = pending(broker);
    risk.recordTradeResult(0, 9_600);
    expect(risk.getEffectiveMaxPositionWeight()).toBeCloseTo(0.15625);
    const state = risk.getState();
    const evaluate = vi.spyOn(risk, "evaluate");
    market.setPrice("600001", 10);
    broker.markToMarket();
    expectPositionRejection(store, first);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(risk.getState()).toEqual(state);
    expect(store.getCash()).toBe(10_000);
  });

  it("retains complete-cash priority when legacy pending would also exceed position limits", () => {
    const { store, market, broker } = fixture(backend, { cash: 1_000 });
    const first = store.createOrder(buy("600001", 200, 10), 11);
    market.setPrice("600001", 10);
    broker.markToMarket();
    expect(store.findOrderById(first.id)).toMatchObject({ status: "rejected", rejectionReason: "可用资金不足" });
    expect(store.listAudit().some((event) => event.action === "INSUFFICIENT_CASH" && event.data?.orderId === first.id)).toBe(true);
    expect(store.listAudit().some((event) => event.action === "POSITION_WEIGHT_LIMIT" && event.data?.orderId === first.id)).toBe(false);
    expect(store.getCash()).toBe(1_000);
    expect(broker.getPositions()).toEqual([]);
  });

  it("does not let a repeated client key reserve exposure twice", () => {
    const { store, broker } = fixture(backend);
    const request = { ...buy("600001", 100, 10), clientOrderId: "position-once" };
    const first = broker.submitOrder(request);
    expect(broker.submitOrder(request).id).toBe(first.id);
    const second = pending(broker, "600001", 100);
    expect(store.getPendingOrders().map((order) => order.id).sort()).toEqual([first.id, second.id].sort());
    expect(broker.getAccount().cash).toBe(7_990);
  });

  it("leaves later market-driven weight increases unchanged when no new buy is being filled", () => {
    const { store, market, broker } = fixture(backend);
    market.setPrice("600001", 10);
    expect(broker.submitOrder(buy()).status).toBe("filled");
    market.setPrice("600001", 30);
    broker.markToMarket();
    expect(broker.getPositions()[0].weight).toBeGreaterThan(0.25);
    expect(store.getPositionQuantity("600001")).toBe(200);
    expect(store.getCash()).toBe(7_995);
    expect(broker.getOrders()).toHaveLength(1);
  });

  it("preserves complete economic results for orders with sufficient cash and per-symbol capacity", () => {
    const constrained = fixture(backend);
    const permissive = fixture(backend, { riskLimits: { maxPositionWeight: 1 } });
    for (const current of [constrained, permissive]) {
      vi.setSystemTime(new Date("2026-11-05T02:00:00.000Z"));
      const { broker, market, nextDay } = current;
      pending(broker, "600001", 100);
      market.setPrice("600002", 10);
      broker.submitOrder(buy("600002", 100));
      market.setPrice("600001", 10);
      broker.markToMarket();
      nextDay();
      market.setPrice("600001", 12);
      broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100 });
    }
    const economics = ({ broker, store }: typeof constrained) => ({
      account: broker.getAccount(), positions: broker.getPositions(),
      orders: broker.getOrders(), audit: store.listAudit(), totalCash: store.getCash(),
    });
    expect(economics(constrained)).toEqual(economics(permissive));
  });
});
