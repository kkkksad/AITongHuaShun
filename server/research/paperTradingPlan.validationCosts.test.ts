import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketSnapshot, RiskLimits } from "../../shared/trading";
import { PaperBroker } from "../broker/paperBroker";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { buildPaperTradingPlan } from "./paperTradingPlan";

type PlanInput = Parameters<typeof buildPaperTradingPlan>[0];
type Strategy = "kairosQualifiedProbe" | "kairosValidationBasket";
const moment = "2026-11-13T02:00:00.000Z";
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

class FixtureMarket extends EventEmitter implements MarketDataProvider {
  constructor(private snapshot: MarketSnapshot) { super(); }
  start() {} stop() {} tick() { return this.snapshot; } getSnapshot() { return this.snapshot; }
  getQuote(symbol: string) { return this.snapshot.quotes.find(quote => quote.symbol === symbol); }
}

function fixture(kind: "memory" | "json", strategy: Strategy, options: {
  price?: number; slippage?: number; cash?: number; cap?: number; scale?: number; weight?: number;
  commissionRate?: number; ordinary?: boolean; weakHistory?: boolean; held?: boolean;
} = {}) {
  const price = options.price ?? 10.05;
  const cash = options.cash ?? 20000;
  const clock = () => new Date(moment);
  const limits: RiskLimits = { maxOrderNotional: options.cap ?? 100000,
    maxPositionWeight: options.weight ?? .25, maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false };
  const snapshot: MarketSnapshot = { mode: "paper", sequence: 1, marketTime: moment,
    quotes: [{ symbol: "600010", name: "验证成本样本", tradable: true, price, previousClose: price * .99,
      changePercent: 1.01, volume: 30000000, amount: price * 30000000, turnover: 2, amplitude: 2.5,
      open: price * .99, high: price * 1.01, low: price * .98, updatedAt: moment }] };
  const directory = kind === "json" ? mkdtempSync(join(tmpdir(), "kairos-validation-costs-")) : null;
  if (directory) directories.push(directory);
  const store = directory ? new JsonFileTradingStore(directory, cash, false, { now: clock })
    : new InMemoryTradingStore(cash, false, clock);
  const broker = new PaperBroker(new FixtureMarket(snapshot), store, new RiskEngine(limits, undefined, clock), {
    mode: "paper", commissionRate: options.commissionRate ?? .0003, minimumCommission: 5,
    slippageBps: options.slippage ?? 5, limits, clock, riskTracking: true,
  });
  if (options.held) expect(broker.submitOrder({ symbol: "600010", side: "buy", type: "market", quantity: 100 }).status).toBe("filled");
  const input = {
    snapshot, provider: "mock", account: broker.getAccount(snapshot), positions: broker.getPositions(snapshot),
    leaderboard: { entries: [] }, candidates: { candidates: [] },
    qualityStocks: { stocks: [{ symbol: "600010", name: "验证成本样本", price, score: 70,
      action: "watch", reasons: ["合成合法历史及实际Broker成本"] }] },
    initialCapital: cash, lotSize: 100, maxPositionWeight: limits.maxPositionWeight,
    maxSingleOrderNotional: limits.maxOrderNotional, commissionRate: options.commissionRate ?? .0003,
    minimumCommission: 5, slippageBps: options.slippage ?? 5, cashReserveRatio: 0, strategyProfile: "growth",
    adaptiveRouting: { regime: "range-high-volatility", allowNewPositions: true, newPositionScale: options.scale ?? .25,
      eligibleStrategyKeys: [strategy], strategyPlaybook: { primaryStrategyKeys: [strategy] } },
    activityTargetActive: true,
    ...(strategy === "kairosValidationBasket" ? { activityMode: "validation-probe" } : {}),
    marketRegimeResearch: { stockRegimes: [{ symbol: "600010", regime: options.weakHistory ? "unclear" : "healthy-trend", confidence: .72,
      barCount: options.weakHistory ? 0 : 180,
      features: { return5d: .015, return20d: .04, return60d: .08, distanceFromMa20: .01, distanceFromMa60: .04,
        ma20Slope5d: .01, ma60Slope5d: .01, pullbackFrom20DayHigh: .035, volumeRatio: .88 },
      validation: { samples: 28, hitRate5d: .61, averageForwardReturn5d: .02 } }] },
  } as unknown as PlanInput;
  if (options.ordinary) {
    delete input.adaptiveRouting;
    delete input.marketRegimeResearch;
    input.activityTargetActive = false;
    delete input.activityMode;
  }
  const original = structuredClone(input);
  const plan = buildPaperTradingPlan(input);
  expect(input).toEqual(original);
  const buys = plan.operations.filter(operation => operation.action === "paper-buy-plan");
  const execute = () => buys.map(operation => broker.submitOrder({ symbol: operation.symbol, side: "buy", type: "market", quantity: operation.quantity }));
  return { plan, buys, execute, broker, store };
}

describe.each(["memory", "json"] as const)("minimum validation execution principal (%s)", kind => {
  describe.each(["kairosQualifiedProbe", "kairosValidationBasket"] as const)("%s", strategy => {
    it.each([
      { price: 10.05, slippage: 5, fillPrice: 10.06, notional: 1006 },
      { price: 11.89, slippage: 5, fillPrice: 11.9, notional: 1190 },
      { price: 10.056, slippage: 0, fillPrice: 10.06, notional: 1006 },
    ])("funds the minimum lot at rounded execution price $fillPrice within the original cap", row => {
      const f = fixture(kind, strategy, row);
      expect(f.plan.capitalPlan.maxSingleOrderNotional).toBe(1250);
      expect(f.buys).toMatchObject([{ strategyKey: strategy, quantity: 100,
        estimatedExecution: { fillPrice: row.fillPrice, notional: row.notional, commission: 5, cashRequired: row.notional + 5 } }]);
      expect(f.execute()).toMatchObject([{ status: "filled", quantity: 100,
        filledPrice: row.fillPrice, notional: row.notional, commission: 5 }]);
      expect(f.broker.getAccount().cash).toBe(20000 - row.notional - 5);
      const position = f.broker.getPositions()[0];
      expect(position.quantity).toBe(100);
      expect(position.availableQuantity).toBe(0);
      expect(position.t1LockedQuantity).toBe(100);
      expect(position.weight).toBeLessThanOrEqual(.25 * .25);
      expect(f.plan.capitalPlan.cashReserveRatio).toBe(0);
    });

    it.each([{ price: 10.05, fillPrice: 10.05 }, { price: 10.053, fillPrice: 10.05 }])(
      "preserves the reference principal check when zero slippage rounds $price to $fillPrice", row => {
        const f = fixture(kind, strategy, { price: row.price, slippage: 0 });
        expect(f.buys).toMatchObject([{ quantity: 100 }]);
        expect(f.execute()).toMatchObject([{ status: "filled", quantity: 100, filledPrice: row.fillPrice, commission: 5 }]);
      },
    );

    it.each([
      { name: "execution principal exceeds final cap", options: { cap: 1005.5, scale: 1 } },
      { name: "cash cannot pay required commission", options: { cash: 1010.99, weight: 1, scale: 1 } },
      { name: "post-fee equity fails the stock cap", options: { price: 10, slippage: 0, weight: .2 } },
      { name: "fee-efficient quantity exceeds cap", options: { price: 7.8 } },
      { name: "round-trip commission exceeds one percent", options: { commissionRate: .006 } },
      { name: "one-yuan conservative quantity boundary", options: { price: .95 } },
      { name: "insufficient history", options: { weakHistory: true } },
      { name: "existing T+1 position is not topped up", options: { held: true } },
    ])("still refuses $name", ({ options }) => {
      const f = fixture(kind, strategy, options);
      const ordersBefore = f.store.listOrders();
      const accountBefore = f.broker.getAccount();
      expect(f.buys).toEqual([]);
      expect(f.execute()).toEqual([]);
      expect(f.store.listOrders()).toEqual(ordersBefore);
      expect(f.broker.getAccount()).toEqual(accountBefore);
    });

    it("allows the minimum lot when cash exactly pays the rounded execution and commission", () => {
      const f = fixture(kind, strategy, { cash: 1011, weight: 1, scale: 1 });
      expect(f.buys).toMatchObject([{ quantity: 100 }]);
      expect(f.execute()).toMatchObject([{ status: "filled", filledPrice: 10.06, commission: 5 }]);
      expect(f.broker.getAccount().cash).toBe(0);
    });
  });

  it("keeps ordinary candidates sized by the original cap and post-fee weight", () => {
    const f = fixture(kind, "kairosQualifiedProbe", { ordinary: true });
    expect(f.buys).toMatchObject([{ strategyKey: "snapshot-candidate", quantity: 400 }]);
    expect(f.execute()).toMatchObject([{ status: "filled", quantity: 400, notional: 4024, commission: 5 }]);
    expect(f.broker.getAccount().cash).toBe(15971);
  });
});
