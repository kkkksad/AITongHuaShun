import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OrderRecord, RiskLimits } from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";
import { MockMarket } from "../market/mockMarket";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { PaperBroker } from "./paperBroker";

type Backend = "memory" | "json";
const temporaryDirectories: string[] = [];
const now = () => new Date("2026-11-05T03:00:00.000Z");
const limits: RiskLimits = {
  maxOrderNotional: 1_000_000,
  maxPositionWeight: 1,
  maxDailyLoss: 1,
  lotSize: 100,
  realTradingEnabled: false,
};

function brokerFor(store: TradingStore, market: MockMarket) {
  return new PaperBroker(market, store, new RiskEngine(limits), {
    mode: "paper",
    commissionRate: 0.0003,
    minimumCommission: 5,
    slippageBps: 5,
    limits,
  });
}

function fixture(backend: Backend) {
  let dataDir: string | undefined;
  let store: TradingStore;
  if (backend === "json") {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-limit-reservations-"));
    temporaryDirectories.push(dataDir);
    store = new JsonFileTradingStore(dataDir, 1_000_000, true, { now });
  } else {
    store = new InMemoryTradingStore(1_000_000, true, now);
  }
  const market = new MockMarket("paper", 500);
  return { store, market, broker: brokerFor(store, market), dataDir };
}

function pendingBuy(broker: PaperBroker) {
  const order = broker.submitOrder({
    symbol: "601318", side: "buy", type: "limit", quantity: 100, limitPrice: 40,
  });
  expect(order.status).toBe("pending");
  return order;
}

function pendingSell(broker: PaperBroker) {
  const order = broker.submitOrder({
    symbol: "600519", side: "sell", type: "limit", quantity: 100, limitPrice: 1_642,
  });
  expect(order.status).toBe("pending");
  return order;
}

function filledOrder(store: TradingStore, id: string): OrderRecord {
  const order = store.findOrderById(id)!;
  expect(order.status).toBe("filled");
  return order;
}

function expectBuyReservation(store: TradingStore, buyId: string) {
  expect(store.getPendingOrders()).toMatchObject([
    { id: buyId, side: "buy", quantity: 100, limitPrice: 40 },
  ]);
  expect(store.getCash() - store.getAvailableCash()).toBeCloseTo(4_000, 8);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("kairos-limit-reservations-")) {
      throw new Error("Refusing to remove an unexpected fixture directory");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe.each<Backend>(["memory", "json"])("PaperBroker limit reservations: %s", (backend) => {
  it("reserves sell shares without reducing cash or allowing a second sale of the same shares", () => {
    const { store, broker } = fixture(backend);
    const totalCash = store.getCash();
    const equity = broker.getAccount().equity;
    pendingBuy(broker);
    const sell = pendingSell(broker);

    expect(store.getAvailableCash()).toBe(totalCash - 4_000);
    expect(store.getCash()).toBe(totalCash);
    expect(broker.getAccount().equity).toBe(equity);
    const duplicate = broker.submitOrder({
      symbol: "600519", side: "sell", type: "limit", quantity: 100, limitPrice: 1_642,
    });
    expect(duplicate).toMatchObject({ status: "rejected", rejectionReason: "可卖持仓不足" });
    expect(store.getPositionQuantity("600519")).toBe(100);
    expect(store.getPendingOrders().filter((order) => order.side === "sell"))
      .toMatchObject([{ id: sell.id, quantity: 100 }]);
    expect(store.getAvailableCash()).toBe(totalCash - 4_000);
  });

  it("cancels a sell without releasing another order's frozen buy principal", () => {
    const { store, broker } = fixture(backend);
    const totalCash = store.getCash();
    const buy = pendingBuy(broker);
    const sell = pendingSell(broker);

    expect(broker.cancelOrder(sell.id).status).toBe("cancelled");
    expect(store.getCash()).toBe(totalCash);
    expect(store.getAvailableCash()).toBe(totalCash - 4_000);
    expectBuyReservation(store, buy.id);
    expect(() => broker.cancelOrder(sell.id)).toThrow("只能撤销挂单状态");
    expect(store.getAvailableCash()).toBe(totalCash - 4_000);
  });

  it("rejects an oversized sell without releasing another order's buy reservation", () => {
    const { store, broker } = fixture(backend);
    const totalCash = store.getCash();
    const buy = pendingBuy(broker);
    const rejected = broker.submitOrder({
      symbol: "600519", side: "sell", type: "limit", quantity: 200, limitPrice: 1_642,
    });

    expect(rejected).toMatchObject({ status: "rejected", rejectionReason: "可卖持仓不足" });
    expect(store.getCash()).toBe(totalCash);
    expect(store.getAvailableCash()).toBe(totalCash - 4_000);
    expectBuyReservation(store, buy.id);
  });

  it("fills a pending sell with only its net proceeds credited and the buy reservation intact", () => {
    const { store, market, broker } = fixture(backend);
    const totalCash = store.getCash();
    const buy = pendingBuy(broker);
    const sell = pendingSell(broker);
    const snapshot = market.getSnapshot();
    broker.markToMarket({
      ...snapshot,
      quotes: snapshot.quotes.map((quote) => quote.symbol === sell.symbol ? { ...quote, price: 1_643 } : quote),
    });
    const filled = filledOrder(store, sell.id);

    expect(filled.filledPrice).toBe(1_642.18);
    expect(filled.commission).toBe(49.27);
    expect(store.getCash()).toBeCloseTo(totalCash + filled.notional - filled.commission, 8);
    expect(store.getAvailableCash()).toBeCloseTo(totalCash + filled.notional - filled.commission - 4_000, 8);
    expect(store.getPositionQuantity(sell.symbol)).toBe(0);
    expectBuyReservation(store, buy.id);
  });

  it("fills a marketable sell without adding a nonexistent cash release", () => {
    const { store, broker } = fixture(backend);
    const totalCash = store.getCash();
    const buy = pendingBuy(broker);
    const filled = broker.submitOrder({
      symbol: "600519", side: "sell", type: "limit", quantity: 100, limitPrice: 1_490,
    });

    expect(filled.status).toBe("filled");
    expect(filled.filledPrice).toBeGreaterThanOrEqual(1_490);
    expect(store.getCash()).toBeCloseTo(totalCash + filled.notional - filled.commission, 8);
    expectBuyReservation(store, buy.id);
  });

  it("keeps actual buy spending power available while a sell remains pending", () => {
    const { store, broker } = fixture(backend);
    const totalCash = store.getCash();
    const buy = pendingBuy(broker);
    const sell = pendingSell(broker);
    const filled = broker.submitOrder({ symbol: "601318", side: "buy", type: "market", quantity: 10_000 });

    expect(filled.status).toBe("filled");
    expect(store.getCash()).toBeCloseTo(totalCash - filled.notional - filled.commission, 8);
    expect(store.getAvailableCash()).toBeCloseTo(totalCash - filled.notional - filled.commission - 4_000, 8);
    expect(store.getPendingOrders().map((order) => order.id).sort()).toEqual([buy.id, sell.id].sort());
  });

  it("continues to freeze only the existing buy principal and releases it on cancellation", () => {
    const { store, broker } = fixture(backend);
    const totalCash = store.getCash();
    const buy = pendingBuy(broker);

    expect(store.getAvailableCash()).toBe(totalCash - 4_000);
    expect(broker.cancelOrder(buy.id).status).toBe("cancelled");
    expect(store.getCash()).toBe(totalCash);
    expect(store.getAvailableCash()).toBe(totalCash);
  });

  it("keeps an existing buy reservation after another limit buy fails its cash check", () => {
    const { store, broker } = fixture(backend);
    const totalCash = store.getCash();
    const buy = pendingBuy(broker);
    const rejected = broker.submitOrder({
      symbol: "601318", side: "buy", type: "limit", quantity: 100, limitPrice: 10_000,
    });

    expect(rejected).toMatchObject({ status: "rejected", rejectionReason: "可用资金不足" });
    expect(store.getCash()).toBe(totalCash);
    expect(store.getAvailableCash()).toBe(totalCash - 4_000);
    expectBuyReservation(store, buy.id);
  });

  it("releases a filled buy's principal once and still charges the existing fill and commission", () => {
    const { store, market, broker } = fixture(backend);
    const totalCash = store.getCash();
    const buy = pendingBuy(broker);
    const snapshot = market.getSnapshot();
    broker.markToMarket({
      ...snapshot,
      quotes: snapshot.quotes.map((quote) => quote.symbol === buy.symbol ? { ...quote, price: 39.99 } : quote),
    });
    const filled = filledOrder(store, buy.id);

    expect(filled.filledPrice).toBe(40);
    expect(filled.commission).toBe(5);
    expect(store.getCash()).toBe(totalCash - 4_005);
    expect(store.getAvailableCash()).toBe(store.getCash());
    expect(store.getPositionQuantity(buy.symbol)).toBe(100);
  });
});

describe("JsonFileTradingStore legacy reservation cache", () => {
  it.each([
    { cached: "stale", terminal: "cancel" },
    { cached: "missing", terminal: "cancel" },
    { cached: "stale", terminal: "fill" },
    { cached: "missing", terminal: "fill" },
  ])("rebuilds $cached blockedCash from buys and preserves it when the sell reaches $terminal", ({ cached, terminal }) => {
    const { store, market, broker, dataDir } = fixture("json");
    const totalCash = store.getCash();
    const buy = pendingBuy(broker);
    const sell = pendingSell(broker);
    const filePath = path.join(dataDir!, "paper-trading-state.json");
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (cached === "stale") persisted.blockedCash = 168_200;
    else delete persisted.blockedCash;
    fs.writeFileSync(filePath, JSON.stringify(persisted), "utf-8");

    const reloaded = new JsonFileTradingStore(dataDir!, 1_000_000, true, { now });
    const reloadedBroker = brokerFor(reloaded, market);
    expect(reloaded.getAvailableCash()).toBe(totalCash - 4_000);
    expect(reloaded.getPendingOrders().map((order) => order.id).sort()).toEqual([buy.id, sell.id].sort());
    if (terminal === "cancel") {
      expect(reloadedBroker.cancelOrder(sell.id).status).toBe("cancelled");
      expect(reloaded.getCash()).toBe(totalCash);
    } else {
      const snapshot = market.getSnapshot();
      reloadedBroker.markToMarket({
        ...snapshot,
        quotes: snapshot.quotes.map((quote) => quote.symbol === sell.symbol ? { ...quote, price: 1_643 } : quote),
      });
      const filled = filledOrder(reloaded, sell.id);
      expect(reloaded.getCash()).toBeCloseTo(totalCash + filled.notional - filled.commission, 8);
    }
    expectBuyReservation(reloaded, buy.id);
    const saved = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(saved.version).toBe(1);
    expect(saved.blockedCash).toBe(4_000);
    expect(saved.cash).toBe(reloaded.getCash());
    expect(saved.orders.find((order: OrderRecord) => order.id === buy.id).status).toBe("pending");
  });
});
