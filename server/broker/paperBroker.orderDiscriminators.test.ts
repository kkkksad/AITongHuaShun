import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketSnapshot, OrderRequest, RiskLimits } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { PaperBroker } from "./paperBroker";

const symbol = "600001";
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
class FixtureMarket extends EventEmitter implements MarketDataProvider {
  constructor(private snapshot: MarketSnapshot) { super(); }
  start() {} stop() {} tick() { return this.snapshot; } getSnapshot() { return this.snapshot; }
  getQuote(code: string) { return this.snapshot.quotes.find(quote => quote.symbol === code); }
}
function fixture(kind: "memory" | "json", held = false) {
  let now = "2026-11-13T02:00:00.000Z";
  const clock = () => new Date(now);
  const limits: RiskLimits = { maxOrderNotional: 100000, maxPositionWeight: 1, maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false };
  const snapshot: MarketSnapshot = { mode: "paper", sequence: 1, marketTime: now,
    quotes: [{ symbol, name: "枚举边界样本", tradable: true, price: 10, previousClose: 10,
      changePercent: 0, volume: 1000000, updatedAt: now }] };
  const directory = kind === "json" ? mkdtempSync(join(tmpdir(), "kairos-order-enums-")) : null;
  if (directory) directories.push(directory);
  const makeStore = () => directory ? new JsonFileTradingStore(directory, 20000, false, { now: clock }) : new InMemoryTradingStore(20000, false, clock);
  const store = makeStore();
  const risk = new RiskEngine(limits, undefined, clock);
  const options = { mode: "paper" as const, commissionRate: .0003, minimumCommission: 5, slippageBps: 5, limits, clock, riskTracking: true };
  const market = new FixtureMarket(snapshot), broker = new PaperBroker(market, store, risk, options);
  if (held) expect(broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 300 }).status).toBe("filled");
  const economics = () => ({ account: broker.getAccount(snapshot), positions: broker.getPositions(snapshot),
    orders: store.listOrders(), pending: store.getPendingOrders(), ledger: store.getPaperFillLedger(), checkpoint: store.getPaperRiskCheckpoint() });
  return { snapshot, limits, broker, store, risk, economics, directory,
    reload: () => makeStore(),
    nextDay: () => { now = "2026-11-16T02:00:00.000Z"; snapshot.marketTime = now; snapshot.quotes[0].updatedAt = now; },
  };
}
const invalid = [
  { name: "unknown side", fields: { side: "wrong" }, code: "INVALID_ORDER_SIDE" },
  { name: "missing side", fields: { side: undefined }, code: "INVALID_ORDER_SIDE" },
  { name: "null side", fields: { side: null }, code: "INVALID_ORDER_SIDE" },
  { name: "unknown type", fields: { type: "stop" }, code: "INVALID_ORDER_TYPE" },
  { name: "missing type", fields: { type: undefined }, code: "INVALID_ORDER_TYPE" },
  { name: "null type", fields: { type: null }, code: "INVALID_ORDER_TYPE" },
];
const request = { symbol, side: "buy", type: "market", quantity: 100 } as const;

describe.each(["memory", "json"] as const)("Paper order discriminators (%s)", kind => {
  describe.each([false, true])("held=%s", held => {
    it.each(invalid)("rejects $name before creating a false fill or touching locked inventory", ({ fields, code }) => {
      const f = fixture(kind, held), before = f.economics(), auditBefore = f.store.listAudit().length;
      let orderEvents = 0, accountEvents = 0;
      f.broker.on("order.updated", () => orderEvents++);
      f.broker.on("account.updated", () => accountEvents++);
      expect(() => f.broker.submitOrder({ ...request, ...fields } as unknown as OrderRequest)).toThrow(code);
      expect(f.economics()).toEqual(before);
      expect(orderEvents).toBe(0); expect(accountEvents).toBe(0);
      expect(f.store.listAudit()).toHaveLength(auditBefore + 1);
      expect(f.store.listAudit()[0]).toMatchObject({ category: "risk", action: code, data: { stage: "broker-request-shape" } });
      expect(f.store.listAudit()[0].data).toEqual({ stage: "broker-request-shape" });
      const reloaded = f.reload();
      if (f.directory) {
        expect(reloaded.getAccount("paper", f.snapshot, f.limits)).toEqual(before.account);
        expect(reloaded.getPositions(f.snapshot)).toEqual(before.positions);
        expect(reloaded.listOrders()).toEqual(before.orders);
        expect(reloaded.getPaperFillLedger()).toEqual(before.ledger);
        expect(reloaded.getPaperRiskCheckpoint()).toEqual(before.checkpoint);
      }
    });
  });

  it("keeps an existing pending buy's cash reservation and cancellation valid", () => {
    const f = fixture(kind);
    const pending = f.broker.submitOrder({ ...request, type: "limit", limitPrice: 9 });
    expect(pending.status).toBe("pending");
    const before = f.economics();
    expect(() => f.broker.submitOrder({ ...request, type: "stop" } as unknown as OrderRequest)).toThrow("INVALID_ORDER_TYPE");
    expect(f.economics()).toEqual(before);
    expect(f.broker.cancelOrder(pending.id).status).toBe("cancelled");
    expect(f.broker.getAccount().cash).toBe(20000);
  });

  it("preserves the original duplicate-ID return before checking a changed payload", () => {
    const f = fixture(kind);
    const original = f.broker.submitOrder({ ...request, clientOrderId: "same-intent" });
    const before = f.economics(), auditBefore = f.store.listAudit().length;
    expect(f.broker.submitOrder({ ...request, side: "wrong", clientOrderId: "same-intent" } as unknown as OrderRequest)).toEqual(original);
    expect(f.economics()).toEqual(before);
    expect(f.store.listAudit()).toHaveLength(auditBefore);
  });

  it("retains actual buy debit, T+1 refusal and a later valid sell", () => {
    const f = fixture(kind, true);
    expect(f.broker.getPositions()[0]).toMatchObject({ quantity: 300, availableQuantity: 0, t1LockedQuantity: 300 });
    expect(f.broker.submitOrder({ ...request, side: "sell", quantity: 300 }).status).toBe("rejected");
    f.nextDay();
    expect(f.broker.submitOrder({ ...request, side: "sell", quantity: 300 })).toMatchObject({ status: "filled", filledQuantity: 300 });
    expect(f.broker.getPositions()).toEqual([]);
    expect(f.broker.getAccount().cash).toBe(19990);
  });
});

describe("RiskEngine standalone order discriminator boundary", () => {
  it.each(invalid)("rejects $name even when called without Broker", ({ fields, code }) => {
    const f = fixture("memory");
    const result = f.risk.evaluate({ request: { ...request, ...fields } as unknown as OrderRequest,
      account: f.broker.getAccount(), quote: f.snapshot.quotes[0], mode: "paper" });
    expect(result).toMatchObject({ allowed: false, code });
  });

  it.each(["market", "limit"] as const)("keeps legal buy/sell %s requests approved", type => {
    const f = fixture("memory", true); f.nextDay();
    for (const side of ["buy", "sell"] as const) {
      expect(f.risk.evaluate({ request: { ...request, side, type, ...(type === "limit" ? { limitPrice: 10 } : {}) },
        account: f.broker.getAccount(), position: f.broker.getPositions()[0], quote: f.snapshot.quotes[0], mode: "paper" }))
        .toMatchObject({ allowed: true });
    }
  });
});
