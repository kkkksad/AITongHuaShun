import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnhancedRiskLimits, MarketQuote, MarketSnapshot, OrderRecord } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { PaperBroker } from "./paperBroker";

const directories: string[] = [];
const limits: EnhancedRiskLimits = {
  maxOrderNotional: 100_000, maxPositionWeight: 1, maxDailyLoss: 0.05,
  lotSize: 100, realTradingEnabled: false,
  circuitBreaker: { maxConsecutiveLosses: 5, maxDailyDrawdown: 0.5, cooldownMinutes: 15, recoveryMinutes: 5 },
  dynamicPositionScaling: false, maxDrawdownReductionFactor: 0.25,
};

class FixtureMarket extends EventEmitter implements MarketDataProvider {
  readonly values = new Map([["600001", { price: 5, previousClose: 5 }], ["600002", { price: 11, previousClose: 11 }]]);
  constructor(private readonly now: () => Date) { super(); }
  start() {}
  stop() {}
  tick() { return this.getSnapshot(); }
  getQuote(symbol: string): MarketQuote | undefined {
    const value = this.values.get(symbol);
    return value && { symbol, name: symbol, tradable: true, volume: 1_000_000,
      changePercent: 0, updatedAt: this.now().toISOString(), ...value };
  }
  getSnapshot(): MarketSnapshot {
    return { mode: "paper", sequence: 1, marketTime: this.now().toISOString(),
      quotes: [...this.values.keys()].map((symbol) => this.getQuote(symbol)!) };
  }
  price(symbol: string, price: number, previousClose = this.values.get(symbol)!.previousClose) {
    this.values.set(symbol, { price, previousClose });
  }
}

function fixture(backend: "memory" | "json", cash = 10_000) {
  let time = new Date("2026-11-09T02:00:00Z");
  const now = () => time;
  const directory = backend === "json" ? fs.mkdtempSync(path.join(os.tmpdir(), "kairos-pending-risk-")) : undefined;
  if (directory) directories.push(directory);
  const load = () => new JsonFileTradingStore(directory!, cash, false, { now });
  const store: TradingStore = directory ? load() : new InMemoryTradingStore(cash, false, now);
  const market = new FixtureMarket(now);
  const risk = new RiskEngine(limits);
  const options = { mode: "paper" as const, commissionRate: 0, minimumCommission: 5, slippageBps: 0, limits };
  const broker = new PaperBroker(market, store, risk, options);
  return { market, store, risk, broker, load, options,
    nextDay: () => { time = new Date(time.getTime() + 86_400_000); vi.setSystemTime(time); } };
}

function expectRejected(store: TradingStore, order: OrderRecord, code: string) {
  expect(store.findOrderById(order.id)).toMatchObject({ status: "rejected", filledQuantity: 0, commission: 0 });
  expect(store.listAudit().some((event) => event.action === code && event.data?.orderId === order.id)).toBe(true);
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-09T02:00:00Z")); });
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !path.basename(directory).startsWith("kairos-pending-risk-")) throw new Error("Unexpected fixture directory");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.each(["memory", "json"] as const)("pending risk rechecks with %s store", (backend) => {
  it("does not execute a pending buy after another holding triggers the daily loss stop", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 1000 });
    f.nextDay();
    const pending = f.broker.submitOrder({ symbol: "600002", side: "buy", type: "limit", quantity: 100, limitPrice: 10 });
    expect(pending.status).toBe("pending");
    const before = f.store.getCash();
    f.market.price("600001", 4);
    f.market.price("600002", 10);
    f.broker.markToMarket();
    expectRejected(f.store, pending, "DAILY_LOSS_LIMIT");
    expect(f.store.getCash()).toBe(before);
    expect(f.store.getPositionQuantity("600002")).toBe(0);
  });

  it("applies the existing daily-loss policy to pending sells as well", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 1000 });
    f.broker.submitOrder({ symbol: "600002", side: "buy", type: "market", quantity: 200 });
    f.nextDay();
    const pending = f.broker.submitOrder({ symbol: "600002", side: "sell", type: "limit", quantity: 100, limitPrice: 12 });
    expect(pending.status).toBe("pending");
    f.market.price("600001", 4);
    f.market.price("600002", 13);
    f.broker.markToMarket();
    expectRejected(f.store, pending, "DAILY_LOSS_LIMIT");
    expect(f.store.getPositionQuantity("600002")).toBe(200);
  });

  it.each(["buy", "sell"] as const)("does not execute a pending %s while the circuit is tripped", (side) => {
    const f = fixture(backend);
    if (side === "sell") f.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 200 });
    f.nextDay();
    const pending = f.broker.submitOrder({ symbol: "600001", side, type: "limit", quantity: 100, limitPrice: side === "buy" ? 4 : 6 });
    expect(pending.status).toBe("pending");
    for (let i = 0; i < 5; i++) f.risk.recordTradeResult(-1, f.broker.getAccount().equity);
    const before = f.store.getCash();
    f.market.price("600001", side === "buy" ? 4 : 6);
    f.broker.markToMarket();
    expectRejected(f.store, pending, "CIRCUIT_BREAKER_TRIPPED");
    expect(f.store.getCash()).toBe(before);
  });

  it("rechecks a lower effective order limit at matching time", () => {
    const f = fixture(backend);
    const pending = f.broker.submitOrder({ symbol: "600002", side: "buy", type: "limit", quantity: 100, limitPrice: 10 });
    expect(pending.status).toBe("pending");
    vi.spyOn(f.risk, "getEffectiveMaxOrderNotional").mockReturnValue(500);
    f.market.price("600002", 10);
    f.broker.markToMarket();
    expectRejected(f.store, pending, "ORDER_NOTIONAL_LIMIT");
  });

  it("does not execute a pending buy when the daily baseline becomes unavailable", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 200 });
    const pending = f.broker.submitOrder({ symbol: "600002", side: "buy", type: "limit", quantity: 100, limitPrice: 10 });
    f.nextDay();
    f.market.price("600001", 5, 0);
    f.market.price("600002", 10);
    f.broker.markToMarket();
    expectRejected(f.store, pending, "DAILY_BASELINE_UNAVAILABLE");
  });

  it("does not let a legacy pending sell bypass today's T+1 lock", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 200 });
    const pending = f.store.createOrder({ symbol: "600001", side: "sell", type: "limit", quantity: 100, limitPrice: 6 }, 5);
    f.market.price("600001", 6);
    f.broker.markToMarket();
    expectRejected(f.store, pending, "INSUFFICIENT_POSITION");
    expect(f.store.getPositionQuantity("600001")).toBe(200);
  });

  it("allows its own reserved buy cash and required commission during matching", () => {
    const f = fixture(backend, 1_005);
    const pending = f.broker.submitOrder({ symbol: "600002", side: "buy", type: "limit", quantity: 100, limitPrice: 10 });
    expect(pending.status).toBe("pending");
    f.market.price("600002", 10);
    f.broker.markToMarket();
    expect(f.store.findOrderById(pending.id)?.status).toBe("filled");
    expect(f.store.getCash()).toBe(0);
  });

  it("uses the passed matching snapshot and does not count its own sell reservation twice", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 200 });
    f.nextDay();
    const pending = f.broker.submitOrder({ symbol: "600001", side: "sell", type: "limit", quantity: 200, limitPrice: 6 });
    expect(pending.status).toBe("pending");
    const snapshot = f.market.getSnapshot();
    snapshot.quotes = snapshot.quotes.map((quote) => ({ ...quote, price: quote.symbol === "600001" ? 6 : quote.price }));
    f.broker.markToMarket(snapshot);
    expect(f.store.findOrderById(pending.id)).toMatchObject({ status: "filled", filledPrice: 6 });
    expect(f.store.getPositionQuantity("600001")).toBe(0);
    expect(f.market.getQuote("600001")?.price).toBe(5);
  });

  it("stops the next pending buy when the first fill's fee crosses the daily loss line", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 1000 });
    f.nextDay();
    for (const id of ["first", "second"]) {
      expect(f.broker.submitOrder({ symbol: "600002", side: "buy", type: "limit", quantity: 100,
        limitPrice: 10, clientOrderId: id }).status).toBe("pending");
    }
    f.market.price("600001", 4.505);
    f.market.price("600002", 10);
    const orderIds = f.store.getPendingOrders().map((order) => order.id);
    f.broker.markToMarket();
    expect(f.store.findOrderById(orderIds[0])?.status).toBe("filled");
    expectRejected(f.store, f.store.findOrderById(orderIds[1])!, "DAILY_LOSS_LIMIT");
    expect(f.store.getPositionQuantity("600002")).toBe(100);
  });

  it("allows a healthy pending buy after the existing circuit cooldown and observation period", () => {
    const f = fixture(backend);
    const pending = f.broker.submitOrder({ symbol: "600002", side: "buy", type: "limit", quantity: 100, limitPrice: 10 });
    for (let i = 0; i < 5; i++) f.risk.recordTradeResult(-1, 10_000);
    f.nextDay();
    f.market.price("600002", 10);
    f.broker.markToMarket();
    expect(f.store.findOrderById(pending.id)?.status).toBe("filled");
    expect(f.risk.getState().circuitState).toBe("normal");
  });
});

it("rechecks persisted pending orders against the restored JSON daily ledger", () => {
  const f = fixture("json");
  f.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 1000 });
  f.nextDay();
  const pending = f.broker.submitOrder({ symbol: "600002", side: "buy", type: "limit", quantity: 100, limitPrice: 10 });
  const restored = f.load();
  const broker = new PaperBroker(f.market, restored, new RiskEngine(limits), f.options);
  f.market.price("600001", 4);
  f.market.price("600002", 10);
  broker.markToMarket();
  expectRejected(restored, pending, "DAILY_LOSS_LIMIT");
  expect(restored.getPositionQuantity("600002")).toBe(0);
});
