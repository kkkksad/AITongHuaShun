import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketSnapshot, OrderSide, RiskLimits } from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";
import { MockMarket } from "../market/mockMarket";
import { InMemoryTradingStore } from "./inMemoryTradingStore";
import { JsonFileTradingStore } from "./jsonFileTradingStore";

type Backend = "memory" | "json";
const symbolA = "600519";
const symbolB = "601318";
const initialCash = 10_000;
const temporaryDirectories: string[] = [];
const limits: RiskLimits = {
  maxOrderNotional: 1_000_000,
  maxPositionWeight: 1,
  maxDailyLoss: 1,
  lotSize: 100,
  realTradingEnabled: false,
};
const baseSnapshot = new MockMarket("paper", 500).getSnapshot();

function snapshot(priceA = 12, priceB = 22): MarketSnapshot {
  return {
    ...baseSnapshot,
    marketTime: "2026-11-02T03:00:00.000Z",
    quotes: baseSnapshot.quotes.map((quote) => ({
      ...quote,
      price: quote.symbol === symbolA ? priceA : quote.symbol === symbolB ? priceB : quote.price,
    })),
  };
}

function fixture(backend: Backend, startingCash = initialCash, seed = false) {
  const clock = { value: new Date("2026-11-02T03:00:00.000Z") };
  const now = () => clock.value;
  let directory: string | undefined;
  let store: TradingStore;
  if (backend === "json") {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-account-realized-pnl-"));
    temporaryDirectories.push(directory);
    store = new JsonFileTradingStore(directory, startingCash, seed, { now, retentionDays: 7 });
  } else {
    store = new InMemoryTradingStore(startingCash, seed, now);
  }
  return {
    store,
    clock,
    directory,
    reload: () => new JsonFileTradingStore(directory!, startingCash, seed, { now, retentionDays: 7 }),
  };
}

function fill(store: TradingStore, side: OrderSide, quantity: number, price: number, symbol = symbolA) {
  const order = store.createOrder({ symbol, side, type: "market", quantity }, price, "本地盈亏测试");
  const result = store.fillOrder(order, "本地盈亏测试", price, 5);
  expect(result.status).toBe("filled");
  return result;
}

function account(store: TradingStore, market = snapshot()) {
  return store.getAccount("paper", market, limits);
}

function expectNetRealized(
  store: TradingStore,
  expected: number,
  market = snapshot(),
  startingCash = initialCash,
) {
  const actual = account(store, market);
  const remainingCost = store.getPositions(market)
    .reduce((total, position) => total + position.quantity * position.averagePrice, 0);
  expect(actual.realizedPnl).toBeCloseTo(expected, 8);
  expect(actual.realizedPnl).toBeCloseTo(store.getCash() + remainingCost - startingCash, 8);
  expect(actual.realizedPnl + actual.unrealizedPnl).toBeCloseTo(actual.equity - startingCash, 8);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("kairos-account-realized-pnl-")) {
      throw new Error("Refusing to remove an unexpected account fixture directory");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe.each<Backend>(["memory", "json"])("account net realized PnL: %s", (backend) => {
  it("starts a pure cash account with zero realized PnL", () => {
    const { store } = fixture(backend);
    expectNetRealized(store, 0);
  });

  it("expenses the paid buy commission while the position remains open", () => {
    const { store } = fixture(backend);
    fill(store, "buy", 200, 10);

    expect(store.getCash()).toBe(7_995);
    expect(store.getPositions(snapshot())[0].realizedPnl).toBe(0);
    expectNetRealized(store, -5);
  });

  it("includes both paid commissions after a partial sale without changing position-level PnL", () => {
    const { store } = fixture(backend);
    fill(store, "buy", 200, 10);
    fill(store, "sell", 100, 12);

    expect(store.getCash()).toBe(9_190);
    expect(store.getPositions(snapshot())).toMatchObject([{ quantity: 100, averagePrice: 10, realizedPnl: 195 }]);
    expectNetRealized(store, 190);
  });

  it("keeps the whole account's net profit after selling the final shares", () => {
    const { store } = fixture(backend);
    fill(store, "buy", 200, 10);
    fill(store, "sell", 100, 12);
    fill(store, "sell", 100, 12);

    expect(store.getCash()).toBe(10_385);
    expect(store.getPositions(snapshot())).toEqual([]);
    expectNetRealized(store, 385);
  });

  it("retains realized losses after partial and complete liquidation", () => {
    const { store } = fixture(backend);
    fill(store, "buy", 200, 10);
    fill(store, "sell", 100, 9);
    const partial = account(store);
    expect(store.getPositions(snapshot())[0].realizedPnl).toBe(-105);
    fill(store, "sell", 100, 8);
    const closed = account(store);

    expect(store.getCash()).toBe(9_685);
    expect([partial.realizedPnl, closed.realizedPnl]).toEqual([-110, -315]);
    expectNetRealized(store, -315);
  });

  it("keeps prior symbols' results when both symbols are closed and reopened", () => {
    const { store } = fixture(backend);
    fill(store, "buy", 200, 10);
    fill(store, "sell", 200, 12);
    fill(store, "buy", 100, 20, symbolB);
    fill(store, "sell", 100, 18, symbolB);
    fill(store, "buy", 100, 8);
    fill(store, "buy", 100, 15, symbolB);

    expect(store.getCash()).toBe(7_870);
    expect(store.getPositions(snapshot()).map((position) => position.realizedPnl)).toEqual([0, 0]);
    expectNetRealized(store, 170);
  });

  it("does not count a pending buy's frozen principal or cancellation as a realized result", () => {
    const { store } = fixture(backend);
    fill(store, "buy", 200, 10);
    fill(store, "sell", 200, 12);
    const before = account(store);
    const pending = store.createOrder({
      symbol: symbolB, side: "buy", type: "limit", quantity: 100, limitPrice: 5,
    }, 22);
    const reserved = account(store);
    store.cancelOrder(pending);
    const cancelled = account(store);

    expect([before.cash, reserved.cash, cancelled.cash]).toEqual([10_390, 9_890, 10_390]);
    expect(store.getCash()).toBe(10_390);
    expect([before.realizedPnl, reserved.realizedPnl, cancelled.realizedPnl]).toEqual([390, 390, 390]);
    expectNetRealized(store, 390);
  });

  it("changes only unrealized PnL when quotes change or fall back to remaining cost", () => {
    const { store } = fixture(backend);
    fill(store, "buy", 200, 10);
    fill(store, "sell", 100, 12);
    const lower = snapshot(9);
    const higher = snapshot(20);
    const missing = { ...snapshot(), quotes: snapshot().quotes.filter((quote) => quote.symbol !== symbolA) };
    const results = [lower, higher, missing].map((market) => account(store, market));

    expect(results.map((result) => result.unrealizedPnl)).toEqual([-100, 1_000, 0]);
    expect(results.map((result) => result.realizedPnl)).toEqual([190, 190, 190]);
    for (const market of [lower, higher, missing]) expectNetRealized(store, 190, market);
  });

  it("does not treat the initial seeded cost as a realized gain or loss", () => {
    const { store } = fixture(backend, 1_000_000, true);
    expect(store.getPositions(snapshot()).length).toBeGreaterThan(0);
    expectNetRealized(store, 0, snapshot(), 1_000_000);
  });

  it("clears prior results and expenses when the paper account is reset", () => {
    const { store } = fixture(backend);
    fill(store, "buy", 200, 10);
    fill(store, "sell", 200, 12);
    store.resetAccount({ startingCash: 12_345, strategyProfile: "balanced" });

    expect(store.getCash()).toBe(12_345);
    expect(store.getPositions(snapshot())).toEqual([]);
    expect(store.listOrders()).toEqual([]);
    expectNetRealized(store, 0, snapshot(), 12_345);
  });
});

describe("JSON account net realized PnL compatibility", () => {
  it.each([false, true])("restores the same net result after restart (fully closed: %s)", (fullyClosed) => {
    const { store, reload, directory } = fixture("json");
    fill(store, "buy", 200, 10);
    fill(store, "sell", 100, 12);
    if (fullyClosed) fill(store, "sell", 100, 12);
    const persisted = JSON.parse(fs.readFileSync(path.join(directory!, "paper-trading-state.json"), "utf-8"));
    expect(persisted.version).toBe(1);
    expect(persisted).not.toHaveProperty("realizedPnl");

    const restored = reload();
    expect(restored.getCash()).toBe(fullyClosed ? 10_385 : 9_190);
    expectNetRealized(restored, fullyClosed ? 385 : 190);
  });

  it.each([false, true])("survives real seven-day order and audit pruning (fully closed: %s)", (fullyClosed) => {
    const { store, reload, clock, directory } = fixture("json");
    fill(store, "buy", 200, 10);
    fill(store, "sell", 100, 12);
    if (fullyClosed) fill(store, "sell", 100, 12);
    const pending = store.createOrder({
      symbol: symbolB, side: "buy", type: "limit", quantity: 100, limitPrice: 5,
    }, 22);
    expect(store.listOrders().length).toBeGreaterThan(1);
    expect(store.listAudit().length).toBeGreaterThan(0);
    clock.value = new Date("2026-11-10T03:00:00.000Z");

    const restored = reload();
    expect(restored.listOrders().map((order) => order.id)).toEqual([pending.id]);
    expect(restored.listAudit()).toEqual([]);
    const persisted = JSON.parse(fs.readFileSync(path.join(directory!, "paper-trading-state.json"), "utf-8"));
    expect(persisted.version).toBe(1);
    expect(persisted.orders.map((order: { id: string }) => order.id)).toEqual([pending.id]);
    expect(persisted.auditEvents).toEqual([]);
    expect(restored.getAvailableCash()).toBe(restored.getCash() - 500);
    expectNetRealized(restored, fullyClosed ? 385 : 190);
  });
});
