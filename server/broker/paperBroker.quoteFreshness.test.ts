import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketQuote, MarketSnapshot } from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";
import { MockMarket } from "../market/mockMarket";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { PaperBroker } from "./paperBroker";

const directories: string[] = [];
const limits = { maxOrderNotional: 100_000, maxPositionWeight: 1, maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false };
const symbol = "600519";
function fixture(backend: "memory" | "json", guarded = true) {
  const now = () => new Date();
  const directory = backend === "json" ? fs.mkdtempSync(path.join(os.tmpdir(), "kairos-quote-age-")) : undefined;
  if (directory) directories.push(directory);
  const store: TradingStore = directory ? new JsonFileTradingStore(directory, 20_000, false, { now }) : new InMemoryTradingStore(20_000, false, now);
  const market = new MockMarket("paper", 500, now);
  const original = market.getSnapshot();
  let price = 11;
  let updatedAt = now().toISOString();
  market.getSnapshot = (): MarketSnapshot => ({ ...original, marketTime: now().toISOString(),
    quotes: original.quotes.map((quote) => ({ ...quote, price: quote.symbol === symbol ? price : quote.price,
      updatedAt: quote.symbol === symbol ? updatedAt : now().toISOString() })) });
  market.getQuote = (requested) => market.getSnapshot().quotes.find((quote) => quote.symbol === requested);
  const options = { mode: "paper" as const, commissionRate: 0, minimumCommission: 5, slippageBps: 0, limits,
    quoteMaxAgeMs: guarded ? 120_000 : undefined, clock: now };
  const broker = new PaperBroker(market, store, new RiskEngine(limits), options);
  return { store, broker, market, now, options, directory,
    quote: (ageMs: number, value = price) => { updatedAt = new Date(Date.now() - ageMs).toISOString(); price = value; },
    timestamp: (value: string) => { updatedAt = value; },
  };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-09T02:00:00Z")); });
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !path.basename(directory).startsWith("kairos-quote-age-")) throw new Error("Unexpected quote fixture path");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.each(["memory", "json"] as const)("per-symbol quote age: %s", (backend) => {
  it.each([120_001, 3_600_000, 86_400_000])("refuses a new buy using a quote %i milliseconds old", (age) => {
    const f = fixture(backend);
    f.quote(age);
    expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 }).status).toBe("rejected");
    expect(f.store.getCash()).toBe(20_000);
    expect(f.store.getPositionQuantity(symbol)).toBe(0);
  });
  it.each([0, 120_000, -5_000])("accepts a quote at permitted age boundary %i", (age) => {
    const f = fixture(backend);
    f.quote(age);
    expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 }).status).toBe("filled");
  });
  it("refuses a quote too far in the future", () => {
    const f = fixture(backend);
    f.quote(-5_001);
    expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 }).status).toBe("rejected");
  });
  it.each(["", "not-a-time"])("refuses missing or invalid timestamp '%s'", (timestamp) => {
    const f = fixture(backend);
    f.timestamp(timestamp);
    expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 }).status).toBe("rejected");
  });
  it("keeps stale pending orders reserved, values holdings and resumes on a fresh quote", () => {
    const f = fixture(backend);
    const pending = f.broker.submitOrder({ symbol, side: "buy", type: "limit", quantity: 100, limitPrice: 10 });
    expect(pending.status).toBe("pending");
    const before = f.store.listAudit();
    f.quote(120_001, 9);
    f.broker.markToMarket();
    expect(f.store.findOrderById(pending.id)?.status).toBe("pending");
    expect(f.store.getCash()).toBe(20_000);
    expect(f.store.getAvailableCash()).toBe(19_000);
    expect(f.store.listAudit()).toEqual(before);
    f.quote(0, 9);
    f.broker.markToMarket();
    expect(f.store.findOrderById(pending.id)).toMatchObject({ status: "filled", filledPrice: 9 });
  });
  it("permits an unrelated fresh stock when this stock's quote is stale", () => {
    const f = fixture(backend);
    f.quote(86_400_000);
    expect(f.broker.submitOrder({ symbol: "601318", side: "buy", type: "market", quantity: 100 }).status).toBe("filled");
  });
  it("does not apply wall-clock age rules to unguarded mock and historical providers", () => {
    const f = fixture(backend, false);
    f.quote(86_400_000);
    expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 }).status).toBe("filled");
  });
  it("rechecks age immediately before a market order changes the ledger", () => {
    const f = fixture(backend);
    const create = f.store.createOrder.bind(f.store);
    vi.spyOn(f.store, "createOrder").mockImplementation((...args) => {
      const order = create(...args);
      vi.setSystemTime(Date.now() + 120_001);
      return order;
    });
    expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 }).status).toBe("rejected");
    expect(f.store.getCash()).toBe(20_000);
  });
});
