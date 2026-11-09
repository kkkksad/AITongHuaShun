import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketSnapshot, RiskLimits } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import { PaperBroker } from "../broker/paperBroker";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { buildPaperTradingPlan } from "./paperTradingPlan";

type PlanInput = Parameters<typeof buildPaperTradingPlan>[0];
const moment = "2026-11-10T02:00:00.000Z";
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
class FixtureMarket extends EventEmitter implements MarketDataProvider {
  constructor(private snapshot: MarketSnapshot) { super(); }
  start() {} stop() {} tick() { return this.snapshot; } getSnapshot() { return this.snapshot; }
  getQuote(symbol: string) { return this.snapshot.quotes.find(quote => quote.symbol === symbol); }
}
function fixture(kind: "memory" | "json", input: {
  cash: number; prices: number[]; weight?: number; slippage?: number; cap?: number; minimumCommission?: number;
}) {
  const limits: RiskLimits = { maxOrderNotional: input.cap ?? 100000, maxPositionWeight: input.weight ?? .25,
    maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false };
  const snapshot: MarketSnapshot = { mode: "paper", sequence: 1, marketTime: moment,
    quotes: input.prices.map((price, index) => ({ symbol: `60001${index}`, name: `成本样本${index}`, tradable: true,
      price, previousClose: price * .99, changePercent: 1.01, volume: 30000000, amount: price * 30000000,
      turnover: 2, amplitude: 2.5, open: price * .99, high: price * 1.01, low: price * .98, updatedAt: moment })) };
  const directory = kind === "json" ? mkdtempSync(join(tmpdir(), "kairos-post-costs-")) : null;
  if (directory) directories.push(directory);
  const clock = () => new Date(moment);
  const store = directory ? new JsonFileTradingStore(directory, input.cash, false, { now: clock }) : new InMemoryTradingStore(input.cash, false, clock);
  const broker = new PaperBroker(new FixtureMarket(snapshot), store, new RiskEngine(limits, undefined, clock), {
    mode: "paper", commissionRate: .0003, minimumCommission: input.minimumCommission ?? 5, slippageBps: input.slippage ?? 0, limits,
    clock, riskTracking: true,
  });
  const planInput = {
    snapshot, provider: "mock", account: broker.getAccount(snapshot), positions: broker.getPositions(snapshot),
    leaderboard: { entries: [] } as unknown as PlanInput["leaderboard"],
    candidates: { candidates: [] } as unknown as PlanInput["candidates"],
    qualityStocks: { stocks: snapshot.quotes.map(quote => ({ symbol: quote.symbol, name: quote.name, price: quote.price,
      score: 96, action: "focus", reasons: ["固定报价与实际Broker成本核验"] })) } as unknown as PlanInput["qualityStocks"],
    initialCapital: input.cash, lotSize: 100, maxPositionWeight: limits.maxPositionWeight,
    maxSingleOrderNotional: limits.maxOrderNotional, commissionRate: .0003, minimumCommission: input.minimumCommission ?? 5,
    slippageBps: input.slippage ?? 0, cashReserveRatio: 0, strategyProfile: "growth" as const,
  };
  const plan = buildPaperTradingPlan(planInput);
  const buys = plan.operations.filter(operation => operation.action === "paper-buy-plan");
  const execute = () => buys.map(operation => broker.submitOrder({ symbol: operation.symbol, side: "buy", type: "market", quantity: operation.quantity }));
  return { broker, store, plan, buys, execute };
}

describe.each(["memory", "json"] as const)("post-cost buy sizing (%s)", kind => {
  it("reduces one lot instead of emitting a buy rejected at the exact position-weight boundary", () => {
    const f = fixture(kind, { cash: 8000, prices: [10] });
    const orders = f.execute();
    expect(orders).toMatchObject([{ status: "filled", quantity: 100 }]);
    expect(f.buys.map(buy => buy.quantity)).toEqual([100]);
    expect(f.broker.getAccount().cash).toBe(6995);
  });
  it("includes rounded slippage before choosing a cash-affordable lot", () => {
    const f = fixture(kind, { cash: 2005, prices: [10], weight: 1, slippage: 10 });
    const orders = f.execute();
    expect(orders).toMatchObject([{ status: "filled", quantity: 100, filledPrice: 10.01, commission: 5 }]);
    expect(f.buys.map(buy => buy.quantity)).toEqual([100]);
    expect(f.plan.qualitySummary.plannedCashRequired).toBe(1006);
    expect(f.broker.getAccount().cash).toBe(999);
  });
  it("carries earlier planned fees into the next stock's projected equity", () => {
    const f = fixture(kind, { cash: 8005, prices: [10, 10] });
    const orders = f.execute();
    expect(orders.map(order => order.status)).toEqual(["filled", "filled"]);
    expect(f.buys.map(buy => buy.quantity)).toEqual([200, 100]);
    expect(f.broker.getAccount().cash).toBe(4995);
    expect(f.plan.qualitySummary.plannedCashRequired).toBe(3010);
  });
  it("does not invent an executable lot when even the first lot exceeds post-cost weight", () => {
    const f = fixture(kind, { cash: 8000, prices: [20] });
    expect(f.buys).toEqual([]); expect(f.store.listOrders()).toEqual([]);
    expect(f.plan.operations.some(operation => operation.ruleChecks.includes("plan-sizing-constrained"))).toBe(true);
    expect(f.broker.getAccount().cash).toBe(8000);
  });
  it("uses execution-price rounding and rounded commission at an exact-cash boundary", () => {
    const f = fixture(kind, { cash: 1005.53, prices: [10.0053], weight: 1, minimumCommission: 5.004 });
    expect(f.buys).toEqual([]); expect(f.store.listOrders()).toEqual([]);
  });
  it("keeps estimated execution principal within the cap and reconciles summary to real debit", () => {
    const f = fixture(kind, { cash: 10000, prices: [10], weight: 1, cap: 4000, slippage: 100 });
    expect(f.buys.map(buy => buy.quantity)).toEqual([300]);
    expect(f.plan.qualitySummary).toMatchObject({ plannedBuyNotional: 3030, plannedBuyFees: 5, plannedCashRequired: 3035 });
    expect(f.execute()).toMatchObject([{ status: "filled", quantity: 300, filledPrice: 10.1, notional: 3030, commission: 5 }]);
    expect(f.broker.getAccount().cash).toBe(6965);
  });
  it("preserves ordinary zero-slippage economics and zero fixed cash reserve", () => {
    const f = fixture(kind, { cash: 10000, prices: [20], weight: 1, cap: 4000 });
    expect(f.buys).toMatchObject([{ quantity: 200, estimatedNotional: 4000 }]);
    expect(f.plan.capitalPlan.cashReserveRatio).toBe(0);
    expect(f.plan.qualitySummary.plannedCashRequired).toBe(4005);
    expect(f.execute()).toMatchObject([{ status: "filled", commission: 5 }]);
  });
  it("finds a funded maximum lot for a large account without scanning rejected lots", () => {
    const input = { cash: 10000000000, prices: [10], weight: 1, cap: 10000000000, slippage: 500 };
    const f = fixture(kind, input);
    expect(f.buys).toHaveLength(1);
    const quantity = f.buys[0].quantity;
    expect(quantity % 100).toBe(0); expect(quantity).toBeGreaterThan(1000000);
    expect(f.execute()[0].status).toBe("filled");
    const control = fixture(kind, input);
    expect(control.broker.submitOrder({ symbol: "600010", side: "buy", type: "market", quantity: quantity + 100 }).status).toBe("rejected");
  });
});
