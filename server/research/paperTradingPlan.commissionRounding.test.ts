import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { MarketSnapshot, RiskLimits } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import { PaperBroker } from "../broker/paperBroker";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { buildPaperTradingPlan } from "./paperTradingPlan";

type PlanInput = Parameters<typeof buildPaperTradingPlan>[0];
const marketTime = "2026-11-05T02:00:00.000Z";

class FixtureMarket extends EventEmitter implements MarketDataProvider {
  constructor(private readonly snapshot: MarketSnapshot) { super(); }
  start() {}
  stop() {}
  tick() { return this.snapshot; }
  getSnapshot() { return this.snapshot; }
  getQuote(symbol: string) { return this.snapshot.quotes.find((quote) => quote.symbol === symbol); }
}

function fixture(input: {
  price: number;
  cash: number;
  minimumCommission?: number;
  maxOrderNotional?: number;
  symbols?: string[];
}) {
  const symbols = input.symbols ?? ["601318"];
  const minimumCommission = input.minimumCommission ?? 5;
  const limits: RiskLimits = {
    maxOrderNotional: input.maxOrderNotional ?? 1_000_000,
    maxPositionWeight: 1, maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false,
  };
  const snapshot: MarketSnapshot = {
    mode: "paper", sequence: 1, marketTime,
    quotes: symbols.map((symbol) => ({
      symbol, name: `commission rounding ${symbol}`, tradable: true,
      price: input.price, previousClose: input.price * 0.99, changePercent: 1.01,
      volume: 30_000_000, amount: input.price * 30_000_000,
      turnover: 2, amplitude: 2.5,
      open: input.price * 0.99, high: input.price * 1.01, low: input.price * 0.98,
      updatedAt: marketTime,
    })),
  };
  const market = new FixtureMarket(snapshot);
  const store = new InMemoryTradingStore(input.cash, false, () => new Date(marketTime));
  // Zero slippage isolates commission rounding. The plan does not model slippage;
  // execution still performs its separate current-price and risk checks.
  const broker = new PaperBroker(market, store, new RiskEngine(limits), {
    mode: "paper", commissionRate: 0.0003, minimumCommission, slippageBps: 0, limits,
  });
  const plan = buildPaperTradingPlan({
    snapshot, provider: "mock", account: broker.getAccount(snapshot), positions: broker.getPositions(snapshot),
    leaderboard: { entries: [] } as unknown as PlanInput["leaderboard"],
    candidates: { candidates: [] } as unknown as PlanInput["candidates"],
    qualityStocks: { stocks: snapshot.quotes.map((quote) => ({
      symbol: quote.symbol, name: quote.name, price: quote.price,
      score: 96, action: "focus", reasons: ["commission rounding control"],
    })) } as unknown as PlanInput["qualityStocks"],
    initialCapital: input.cash, lotSize: limits.lotSize,
    maxPositionWeight: limits.maxPositionWeight, maxSingleOrderNotional: limits.maxOrderNotional,
    commissionRate: 0.0003, minimumCommission, cashReserveRatio: 0, strategyProfile: "growth",
  });
  return { broker, store, plan };
}

function buys(plan: ReturnType<typeof buildPaperTradingPlan>) {
  return plan.operations.filter((operation) => operation.action === "paper-buy-plan");
}

function executePlan({ plan, broker }: ReturnType<typeof fixture>) {
  return buys(plan).map((operation) => broker.submitOrder({
    symbol: operation.symbol, side: "buy", type: "market", quantity: operation.quantity,
  }));
}

describe("Paper plan whole lots use the broker's rounded commission", () => {
  it.each([
    { name: "default proportional fee rounded down", price: 166.72, cash: 16_677, minimumCommission: 5, fee: 5 },
    { name: "fractional minimum fee rounded down", price: 20, cash: 2_005, minimumCommission: 5.004, fee: 5 },
    { name: "fractional minimum fee rounded up and funded", price: 20, cash: 2_005.01, minimumCommission: 5.0052, fee: 5.01 },
    { name: "default proportional fee rounded up and funded", price: 166.84, cash: 16_689.01, minimumCommission: 5, fee: 5.01 },
    { name: "binary whole-lot division and debit noise", price: 10.05, cash: 1_010, minimumCommission: 5, fee: 5 },
  ])("plans an exact-fit lot with $name and fills the actual plan", (input) => {
    const current = fixture(input);
    expect(buys(current.plan)).toMatchObject([{ quantity: 100, price: input.price }]);
    expect(current.plan.qualitySummary.affordableCandidateCount).toBe(1);
    expect(buys(current.plan)[0].ruleChecks).toContain(`cash-reservation: pass (${input.cash.toFixed(2)})`);
    expect(current.plan.qualitySummary.plannedBuyFees).toBe(input.fee);
    const orders = executePlan(current);
    expect(orders).toMatchObject([{ status: "filled", quantity: 100, commission: input.fee }]);
    expect(current.store.getPositionQuantity("601318")).toBe(100);
    expect(current.broker.getAccount().cash).toBe(0);
  });

  it.each([
    { price: 20, cash: 2_004.99, minimumCommission: 5 },
    { price: 20, cash: 2_004.9999, minimumCommission: 5 },
    { price: 20, cash: 2_005.0052, minimumCommission: 5.0052 },
    { price: 166.84, cash: 16_689.0052, minimumCommission: 5 },
    { price: 10.05, cash: 1_009.9999, minimumCommission: 5 },
  ])("does not round $cash cash up to fund a truly unaffordable $price lot", (input) => {
    const current = fixture(input);
    expect(buys(current.plan)).toEqual([]);
    expect(current.plan.qualitySummary.affordableCandidateCount).toBe(0);
    expect(current.plan.operations[0].ruleChecks).toContain("cash-constrained");
    // A separate minimum-lot control confirms the reason for omitting a plan.
    const order = current.broker.submitOrder({ symbol: "601318", side: "buy", type: "market", quantity: 100 });
    expect(order).toMatchObject({ status: "rejected", rejectionReason: "可用资金不足", commission: 0 });
    expect(current.store.getPositionQuantity("601318")).toBe(0);
    expect(current.broker.getAccount().cash).toBe(input.cash);
  });

  it.each([
    { minimumCommission: 5, price: 166.72, cash: 33_354, maxOrderNotional: 16_672 },
    { minimumCommission: 5.004, price: 20, cash: 4_010, maxOrderNotional: 2_000 },
  ])("reserves rounded fees cumulatively for two real planned orders with minimum $minimumCommission", (input) => {
    const current = fixture({ ...input, symbols: ["601318", "600001"] });
    expect(buys(current.plan).map(({ symbol, quantity }) => ({ symbol, quantity }))).toEqual([
      { symbol: "601318", quantity: 100 }, { symbol: "600001", quantity: 100 },
    ]);
    expect(current.plan.qualitySummary.plannedBuyFees).toBe(10);
    expect(current.plan.qualitySummary.plannedCashRequired).toBe(input.cash);
    expect(current.plan.qualitySummary.remainingCashAfterPlan).toBe(0);
    expect(executePlan(current)).toMatchObject([
      { status: "filled", quantity: 100, commission: 5 },
      { status: "filled", quantity: 100, commission: 5 },
    ]);
    expect(current.store.getPositionQuantity("601318")).toBe(100);
    expect(current.store.getPositionQuantity("600001")).toBe(100);
    expect(current.broker.getAccount().cash).toBe(0);
  });

  it("does not spend a rounded-up fractional fee twice against a genuinely short remaining budget", () => {
    const current = fixture({
      price: 20, cash: 4_010.0152, minimumCommission: 5.0052,
      maxOrderNotional: 2_000, symbols: ["601318", "600001"],
    });
    expect(buys(current.plan)).toMatchObject([{ symbol: "601318", quantity: 100 }]);
    expect(buys(current.plan)).toHaveLength(1);
    expect(current.plan.operations.find((operation) => operation.symbol === "600001")).toMatchObject({
      action: "blocked", quantity: 0,
    });
    expect(executePlan(current)).toMatchObject([{ status: "filled", commission: 5.01 }]);
    const remainingCash = current.broker.getAccount().cash;
    expect(remainingCash).toBeCloseTo(2_005.0052, 8);
    const control = current.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 100 });
    expect(control).toMatchObject({ status: "rejected", rejectionReason: "可用资金不足", commission: 0 });
    expect(current.broker.getAccount().cash).toBe(remainingCash);
  });

  it.each([
    { price: 20, cash: 10_000, maxOrderNotional: 1_999.99 },
    { price: 20, cash: 10_000, maxOrderNotional: 1_999.9999999999 },
    { price: 10.05, cash: 10_000, maxOrderNotional: 1_005 },
  ])("keeps the original strict principal cap $maxOrderNotional when checking a neighboring whole lot", (input) => {
    const current = fixture(input);
    expect(buys(current.plan)).toEqual([]);
    expect(current.plan.operations[0].ruleChecks).toContain("plan-sizing-constrained");
    expect(current.plan.operations[0].ruleChecks).not.toContain("cash-constrained");
    const control = current.broker.submitOrder({ symbol: "601318", side: "buy", type: "market", quantity: 100 });
    expect(control.status).toBe("rejected");
    expect(control.rejectionReason).toContain("单笔限额");
    expect(current.broker.getAccount().cash).toBe(input.cash);
  });

  it("keeps the ordinary cap-sized plan and its actual fees unchanged", () => {
    const current = fixture({ price: 20, cash: 10_000, maxOrderNotional: 4_000 });
    expect(buys(current.plan)).toMatchObject([{ quantity: 200, estimatedNotional: 4_000 }]);
    expect(current.plan.qualitySummary.plannedCashRequired).toBe(4_005);
    expect(executePlan(current)).toMatchObject([{ status: "filled", quantity: 200, commission: 5 }]);
    expect(current.broker.getAccount().cash).toBe(5_995);
  });

  it("preserves the existing one-yuan sizing floor without changing candidate or broker prices", () => {
    const current = fixture({ price: 0.5, cash: 10_000, maxOrderNotional: 4_000 });
    expect(buys(current.plan)).toMatchObject([{ quantity: 4_000, price: 0.5, estimatedNotional: 2_000 }]);
    expect(executePlan(current)).toMatchObject([{ status: "filled", quantity: 4_000, filledPrice: 0.5, commission: 5 }]);
    expect(current.broker.getAccount().cash).toBe(7_995);
  });
});
