import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnhancedRiskLimits, MarketQuote, MarketSnapshot, OrderSide } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { PaperBroker } from "./paperBroker";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { PAPER_CYCLE_RESULT_LIMIT } from "../store/paperPositionCycles";

const directories: string[] = [];
const baseLimits: EnhancedRiskLimits = { maxOrderNotional: 100_000, maxPositionWeight: 1,
  maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false, dynamicPositionScaling: false,
  maxDrawdownReductionFactor: 0.25,
  circuitBreaker: { maxConsecutiveLosses: 3, maxDailyDrawdown: 0.5, cooldownMinutes: 15, recoveryMinutes: 5 } };

class TestMarket extends EventEmitter implements MarketDataProvider {
  readonly prices = new Map([["600001", { price: 10, previousClose: 10 }], ["600002", { price: 20, previousClose: 20 }]]);
  stale = false;
  constructor(private readonly now: () => Date) { super(); }
  start() {}
  stop() {}
  tick() { return this.getSnapshot(); }
  getQuote(symbol: string): MarketQuote | undefined {
    const value = this.prices.get(symbol);
    return value && { symbol, name: symbol, ...value, tradable: true, volume: 1_000_000, changePercent: 0,
      updatedAt: new Date(this.now().getTime() - (this.stale ? 180_000 : 0)).toISOString() };
  }
  getSnapshot(): MarketSnapshot {
    return { mode: "paper", sequence: 1, marketTime: this.now().toISOString(),
      quotes: [...this.prices.keys()].map((symbol) => this.getQuote(symbol)!) };
  }
  price(symbol: string, price: number, previousClose = this.prices.get(symbol)?.previousClose ?? price) {
    this.prices.set(symbol, { price, previousClose });
  }
}

function fixture(backend: "memory" | "json", input: { drawdown?: number; fresh?: boolean } = {}) {
  let time = new Date("2026-11-02T02:00:00.000Z");
  const now = () => time;
  const directory = backend === "json" ? fs.mkdtempSync(path.join(os.tmpdir(), "kairos-risk-ledger-")) : undefined;
  if (directory) directories.push(directory);
  const load = () => new JsonFileTradingStore(directory!, 20_000, false, { now, retentionDays: 1 });
  let store: TradingStore = directory ? load() : new InMemoryTradingStore(20_000, false, now);
  const market = new TestMarket(now);
  const limits = { ...baseLimits, circuitBreaker: { ...baseLimits.circuitBreaker,
    maxDailyDrawdown: input.drawdown ?? baseLimits.circuitBreaker.maxDailyDrawdown } };
  const makeRisk = () => new RiskEngine(limits, undefined, now);
  let risk = makeRisk();
  const makeBroker = () => new PaperBroker(market, store, risk, { mode: "paper", commissionRate: 0,
    minimumCommission: 5, slippageBps: 0, limits, clock: now,
    quoteMaxAgeMs: input.fresh ? 120_000 : undefined, riskTracking: true });
  let broker = makeBroker();
  return { market, now, directory, get store() { return store; }, get risk() { return risk; }, get broker() { return broker; },
    nextDay() { time = new Date(time.getTime() + 86_400_000); },
    advance(seconds: number) { time = new Date(time.getTime() + seconds * 1000); },
    restart() { store = load(); risk = makeRisk(); broker = makeBroker(); },
    fill(side: OrderSide, quantity = 100, price = market.getQuote("600001")!.price, clientOrderId?: string) {
      market.price("600001", price);
      const order = broker.submitOrder({ symbol: "600001", side, type: "market", quantity, clientOrderId });
      expect(order.status, order.rejectionReason).toBe("filled");
      return order;
    },
    roundTrip() {
      market.price("600001", 10, 10);
      const opening = broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 100 });
      expect(opening.status, opening.rejectionReason).toBe("filled");
      time = new Date(time.getTime() + 86_400_000);
      const closing = broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100 });
      expect(closing.status, closing.rejectionReason).toBe("filled");
      return closing;
    } };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !path.basename(directory).startsWith("kairos-risk-ledger-")) throw new Error("Unexpected fixture directory");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.each(["memory", "json"] as const)("paper risk ledger integration: %s", (backend) => {
  it("counts fee-inclusive closed cycles and blocks the next order after a multi-day losing streak", () => {
    const f = fixture(backend);
    for (let i = 0; i < 3; i++) f.roundTrip();
    expect(f.risk.getState()).toMatchObject({ tradeCount: 3, lossCount: 3, consecutiveLosses: 3, circuitState: "tripped" });
    const next = f.broker.submitOrder({ symbol: "600002", side: "buy", type: "market", quantity: 100 });
    expect(next.status).toBe("rejected");
    expect(f.store.getPositionQuantity("600002")).toBe(0);
  });

  it("does not count entry fees, add-ons or partial exits as complete trades", () => {
    const f = fixture(backend); f.fill("buy", 200); f.nextDay();
    f.fill("sell", 100, 11); f.fill("buy", 100, 9);
    expect(f.risk.getState().tradeCount).toBe(0);
    f.nextDay(); f.fill("sell", 200, 9);
    expect(f.risk.getState()).toMatchObject({ tradeCount: 1, lossCount: 1, consecutiveLosses: 1 });
  });

  it("uses net fees rather than a small gross gain to classify a trade", () => {
    const f = fixture(backend); f.fill("buy"); f.nextDay(); const close = f.fill("sell", 100, 10.05);
    expect(f.risk.getState()).toMatchObject({ tradeCount: 1, lossCount: 1, lastTradeTime: close.filledAt });
  });

  it("does not count duplicate submissions, terminal fills, reads or repeated market events twice", () => {
    const f = fixture(backend); f.fill("buy"); f.nextDay();
    const close = f.fill("sell", 100, 10, "risk-close");
    f.broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100, clientOrderId: "risk-close" });
    f.store.fillOrder(close, "600001", 999, 500);
    for (let i = 0; i < 5; i++) { f.broker.markToMarket(); f.broker.getAccount(); f.broker.getOrders(); }
    expect(f.risk.getState()).toMatchObject({ tradeCount: 1, lossCount: 1, consecutiveLosses: 1 });
  });

  it("observes intraday drawdown without a closing trade", () => {
    const f = fixture(backend, { drawdown: 0.08 }); f.fill("buy", 1000); f.nextDay();
    f.market.price("600001", 12); f.broker.markToMarket();
    f.market.price("600001", 10); f.broker.markToMarket();
    expect(f.risk.getState()).toMatchObject({ tradeCount: 0, lossCount: 0, circuitState: "tripped" });
    expect(f.risk.getState().dailyDrawdown).toBeGreaterThan(0.08);
  });

  it("does not invent drawdown from a missing holding quote's cost-price fallback", () => {
    const f = fixture(backend, { drawdown: 0.08 }); f.fill("buy", 1000); f.nextDay();
    f.market.price("600001", 12); f.broker.markToMarket();
    const before = f.risk.getState();
    f.market.prices.delete("600001"); f.broker.markToMarket();
    expect(f.risk.getState()).toMatchObject({ peakDailyEquity: before.peakDailyEquity,
      dailyDrawdown: before.dailyDrawdown, circuitState: "normal" });
  });

  it("does not observe stale held quotes as a new drawdown", () => {
    const f = fixture(backend, { drawdown: 0.08, fresh: true }); f.fill("buy", 1000); f.nextDay();
    f.market.price("600001", 12); f.broker.markToMarket();
    const peak = f.risk.getState().peakDailyEquity;
    f.market.price("600001", 10); f.market.stale = true; f.broker.markToMarket();
    expect(f.risk.getState()).toMatchObject({ peakDailyEquity: peak, dailyDrawdown: 0, circuitState: "normal" });
  });

  it("makes the first matching close's circuit visible to a later pending order", () => {
    const f = fixture(backend); f.roundTrip(); f.roundTrip(); f.fill("buy", 100, 12); f.nextDay();
    f.market.price("600001", 10, 12);
    const buy = f.broker.submitOrder({ symbol: "600002", side: "buy", type: "limit", quantity: 100, limitPrice: 19 });
    const sell = f.broker.submitOrder({ symbol: "600001", side: "sell", type: "limit", quantity: 100, limitPrice: 11 });
    expect([buy.status, sell.status]).toEqual(["pending", "pending"]);
    f.market.price("600001", 11, 12); f.market.price("600002", 19); f.broker.markToMarket();
    expect(f.store.findOrderById(sell.id)?.status).toBe("filled");
    expect(f.store.findOrderById(buy.id)?.status).toBe("rejected");
    expect(f.store.getPositionQuantity("600002")).toBe(0);
    expect(f.risk.getState().tradeCount).toBe(3);
  });

  it("keeps ordinary reads free of risk state changes", () => {
    const f = fixture(backend); const before = f.risk.getState(); f.advance(60);
    for (let i = 0; i < 5; i++) { f.broker.getAccount(); f.broker.getPositions(); f.broker.getOrders(); }
    expect(f.risk.getState()).toEqual(before);
  });

  it("bounds unchanged market writes and persists a material new peak immediately", () => {
    const f = fixture(backend); const save = vi.spyOn(f.store, "setPaperRiskCheckpoint");
    for (let i = 0; i < 100; i++) { f.advance(0.1); f.broker.markToMarket(); }
    expect(save).toHaveBeenCalledTimes(0);
    f.fill("buy", 1000); f.nextDay(); f.broker.markToMarket(); save.mockClear();
    f.market.price("600001", 12); f.broker.markToMarket();
    expect(save).toHaveBeenCalledTimes(1);
    expect(f.store.getPaperRiskCheckpoint()?.state.peakDailyEquity).toBeCloseTo(21_995);
  });

  it("persists small uncheckpointed peaks after the bounded observation interval", () => {
    const f = fixture(backend); f.fill("buy", 1000); f.nextDay(); f.broker.markToMarket();
    const save = vi.spyOn(f.store, "setPaperRiskCheckpoint");
    f.market.price("600001", 10.001);
    for (let i = 0; i < 10; i++) { f.advance(1); f.broker.markToMarket(); }
    expect(save).not.toHaveBeenCalled();
    f.advance(21); f.broker.markToMarket();
    expect(save).toHaveBeenCalledTimes(1);
    expect(f.store.getPaperRiskCheckpoint()?.state.peakDailyEquity).toBeCloseTo(19_996);
  });

  it("does not seed a manual reset from an unreliable valuation or reapply the acknowledged opening peak", () => {
    const f = fixture(backend, { drawdown: 0.08 }); f.fill("buy", 1000); f.nextDay();
    f.market.price("600001", 12); f.broker.markToMarket();
    f.market.price("600001", 8); f.broker.markToMarket();
    expect(f.risk.getState().circuitState).toBe("tripped");
    f.market.prices.delete("600001"); f.broker.resetRiskCircuit();
    expect(f.risk.getState().peakDailyEquity).toBe(0);
    f.market.price("600001", 8, 10); f.broker.markToMarket();
    expect(f.risk.getState()).toMatchObject({ circuitState: "normal", peakDailyEquity: 17_995, dailyDrawdown: 0 });
  });

  it("uses explicit risk reset to start a new baseline and consumption point", () => {
    const f = fixture(backend); for (let i = 0; i < 3; i++) f.roundTrip();
    f.broker.resetRiskCircuit();
    expect(f.risk.getState()).toMatchObject({ tradeCount: 0, lossCount: 0, consecutiveLosses: 0,
      circuitState: "normal", dailyDrawdown: 0, ledgerStatus: "ready" });
    f.broker.markToMarket();
    expect(f.risk.getState().tradeCount).toBe(0);
    expect(f.store.getPaperRiskCheckpoint()?.lastConsumedCycle).toBe(3);
  });

  it("resets account risk without replaying the previous simulation's cycles", () => {
    const f = fixture(backend); f.roundTrip();
    f.broker.resetAccount({ startingCash: 30_000, strategyProfile: "growth" }); f.broker.markToMarket();
    expect(f.risk.getState()).toMatchObject({ tradeCount: 0, lossCount: 0, peakDailyEquity: 30_000 });
    expect(f.store.getPaperRiskCheckpoint()?.lastConsumedCycle).toBe(0);
  });
});

describe("durable paper risk recovery", () => {
  it("refuses a cycle-history gap until an explicit risk reset acknowledges a new cursor", () => {
    const f = fixture("json"); f.roundTrip();
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    const sample = state.paperFillLedger.results[0];
    state.paperFillLedger = { lastSequence: PAPER_CYCLE_RESULT_LIMIT + 1,
      results: Array.from({ length: PAPER_CYCLE_RESULT_LIMIT }, (_, index) => ({ ...sample,
        sequence: index + 2, closingOrderId: `gap-close-${index}`, openingOrderId: `gap-open-${index}` })) };
    state.paperRiskCheckpoint.lastConsumedCycle = 0;
    state.paperRiskCheckpoint.state = new RiskEngine(baseLimits, undefined, f.now).getState();
    fs.writeFileSync(file, JSON.stringify(state)); f.restart();
    expect(f.risk.getState().ledgerStatus).toBe("history-gap");
    expect(f.broker.submitOrder({ symbol: "600002", side: "buy", type: "market", quantity: 100 }).status).toBe("rejected");
    const cash = f.store.getCash();
    f.broker.resetRiskCircuit(); f.broker.markToMarket(); f.restart();
    expect(f.risk.getState()).toMatchObject({ ledgerStatus: "ready", tradeCount: 0 });
    expect(f.store.getPaperRiskCheckpoint()?.lastConsumedCycle).toBe(PAPER_CYCLE_RESULT_LIMIT + 1);
    expect(f.store.getCash()).toBe(cash);
    expect(f.store.listAudit().some((event) => event.action === "risk.circuit.reset.requested")).toBe(true);
  });

  it("keeps reads and pending state available when the initial checkpoint cannot be written", () => {
    const f = fixture("json");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8")); delete state.paperRiskCheckpoint;
    fs.writeFileSync(file, JSON.stringify(state)); fs.mkdirSync(`${file}.tmp`);
    f.restart();
    expect(f.risk.getState().ledgerStatus).toBe("checkpoint-unavailable");
    expect(f.broker.getAccount().cash).toBe(20_000);
    expect(() => f.broker.markToMarket()).not.toThrow();
    expect(() => f.broker.submitOrder({ symbol: "600002", side: "buy", type: "market", quantity: 100 })).toThrow(/检查点/);
    expect(f.store.listOrders()).toEqual([]);
    fs.rmdirSync(`${file}.tmp`); f.broker.markToMarket();
    expect(f.risk.getState().ledgerStatus).toBe("ready");
  });

  it("returns isolated checkpoint copies and copies a valid setter input", () => {
    const f = fixture("json"); const checkpoint = f.store.getPaperRiskCheckpoint()!;
    f.store.setPaperRiskCheckpoint(checkpoint);
    checkpoint.state.peakDailyEquity = 1;
    expect(f.store.getPaperRiskCheckpoint()?.state.peakDailyEquity).toBe(20_000);
  });

  it("starts a new daily peak on restart while preserving a multi-day loss streak", () => {
    const f = fixture("json"); f.roundTrip(); f.nextDay(); f.restart();
    expect(f.risk.getState()).toMatchObject({ peakDailyEquity: 19_990, dailyDrawdown: 0, tradeCount: 1, consecutiveLosses: 1 });
  });

  it("blocks future checkpoint evidence rather than carrying it into current execution", () => {
    const f = fixture("json");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.paperRiskCheckpoint.savedAt = new Date(f.now().getTime() + 86_400_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(state)); f.restart();
    expect(f.risk.getState().ledgerStatus).toBe("history-gap");
    expect(f.broker.submitOrder({ symbol: "600002", side: "buy", type: "market", quantity: 100 }).status).toBe("rejected");
  });
  it("rolls a failed checkpoint write back in memory while preserving the prior disk checkpoint", () => {
    const f = fixture("json"); const previous = f.store.getPaperRiskCheckpoint()!;
    const file = path.join(f.directory!, "paper-trading-state.json");
    const diskBefore = fs.readFileSync(file, "utf8");
    fs.mkdirSync(`${file}.tmp`);
    expect(() => f.store.setPaperRiskCheckpoint({ ...previous, state: { ...previous.state, peakDailyEquity: 20_001 } })).toThrow();
    expect(f.store.getPaperRiskCheckpoint()).toEqual(previous);
    expect(fs.readFileSync(file, "utf8")).toBe(diskBefore);
    fs.rmdirSync(`${file}.tmp`);
    f.restart(); expect(f.store.getPaperRiskCheckpoint()).toEqual(previous);
  });
  it("restores streak, peak, counters and cursor across repeated same-day restarts", () => {
    const f = fixture("json"); f.roundTrip(); const before = f.risk.getState();
    f.restart(); f.restart();
    expect(f.risk.getState()).toMatchObject({ tradeCount: 1, lossCount: 1, consecutiveLosses: 1,
      peakDailyEquity: before.peakDailyEquity, lastTradeTime: before.lastTradeTime });
    expect(f.store.getPaperRiskCheckpoint()?.lastConsumedCycle).toBe(1);
  });

  it("restores a recent circuit's original cooldown timestamp", () => {
    const f = fixture("json"); for (let i = 0; i < 3; i++) f.roundTrip();
    const trippedAt = f.risk.getState().trippedAt; f.advance(60); f.restart();
    expect(f.risk.getState()).toMatchObject({ circuitState: "tripped", trippedAt, tradeCount: 3 });
  });

  it("returns a committed fill truthfully if its checkpoint fails, then recovers it exactly once", () => {
    const f = fixture("json"); f.fill("buy"); f.nextDay(); f.broker.markToMarket();
    const previous = f.store.getPaperRiskCheckpoint();
    const save = vi.spyOn(f.store, "setPaperRiskCheckpoint").mockImplementation(() => { throw new Error("fixture checkpoint failure"); });
    const close = f.fill("sell", 100, 10, "committed-close");
    expect(f.risk.getState().ledgerStatus).toBe("checkpoint-unavailable");
    expect(f.store.getPaperRiskCheckpoint()).toEqual(previous);
    const count = f.store.listOrders().length;
    expect(() => f.broker.submitOrder({ symbol: "600002", side: "buy", type: "market", quantity: 100 })).toThrow(/checkpoint|检查点/i);
    expect(f.store.listOrders()).toHaveLength(count);
    expect(f.broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100, clientOrderId: "committed-close" }).id).toBe(close.id);
    save.mockRestore(); f.restart(); f.restart();
    expect(f.risk.getState()).toMatchObject({ tradeCount: 1, lossCount: 1, lastTradeTime: close.filledAt, ledgerStatus: "ready" });
  });

  it("retries a failed checkpoint before resuming further execution", () => {
    const f = fixture("json"); f.fill("buy"); f.nextDay(); f.broker.markToMarket();
    const save = vi.spyOn(f.store, "setPaperRiskCheckpoint").mockImplementation(() => { throw new Error("fixture checkpoint failure"); });
    f.fill("sell"); save.mockRestore(); f.broker.markToMarket();
    expect(f.risk.getState()).toMatchObject({ tradeCount: 1, ledgerStatus: "ready" });
    expect(f.store.getPaperRiskCheckpoint()?.lastConsumedCycle).toBe(1);
    f.fill("buy");
  });

  it("migrates an absent checkpoint using committed cycle times, without fabricating an old peak", () => {
    const f = fixture("json"); const close = f.roundTrip();
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8")); delete state.paperRiskCheckpoint;
    fs.writeFileSync(file, JSON.stringify(state)); f.restart();
    expect(f.risk.getState()).toMatchObject({ tradeCount: 1, lossCount: 1, lastTradeTime: close.filledAt });
    expect(f.store.getPaperRiskCheckpoint()?.lastConsumedCycle).toBe(1);
  });

  it("does not renew an old recovered circuit during startup replay", () => {
    const f = fixture("json"); for (let i = 0; i < 3; i++) f.roundTrip();
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8")); delete state.paperRiskCheckpoint;
    fs.writeFileSync(file, JSON.stringify(state)); f.advance(21 * 60); f.restart();
    expect(f.risk.getState()).toMatchObject({ circuitState: "normal", consecutiveLosses: 0, tradeCount: 3 });
  });

  it("marks unknown legacy entry evidence separately from known wins/losses", () => {
    const f = fixture("json"); f.fill("buy");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8")); delete state.positions[0].paperCycle;
    fs.writeFileSync(file, JSON.stringify(state)); f.nextDay(); f.restart(); f.fill("sell");
    expect(f.risk.getState()).toMatchObject({ tradeCount: 0, lossCount: 0, unknownCycleCount: 1 });
    f.restart(); expect(f.risk.getState().unknownCycleCount).toBe(1);
  });

  it.each([null, { version: 99 }, { version: 1, lastConsumedCycle: -1 }])("preserves disk on malformed explicit checkpoint: %j", (invalid) => {
    const f = fixture("json");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8")); state.paperRiskCheckpoint = invalid;
    const text = JSON.stringify(state); fs.writeFileSync(file, text);
    expect(() => f.restart()).toThrow(/risk|checkpoint/i);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });

  it.each(["tradeCount", "lossCount", "consecutiveLosses", "unknownCycleCount", "peakDailyEquity", "dailyDrawdown", "tradingDate", "ledgerStatus", "trippedAt"])("rejects malformed risk state %s before rewriting", (field) => {
    const f = fixture("json"); const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8")); state.paperRiskCheckpoint.state[field] = "invalid";
    const text = JSON.stringify(state); fs.writeFileSync(file, text);
    expect(() => f.restart()).toThrow(/risk|checkpoint/i);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });
});

it("enables durable cycle tracking in the actual createTradingSystem assembly", () => {
  let time = new Date("2026-11-02T02:00:00.000Z");
  const system = createTradingSystem(createTestConfig({ MARKET_MODE: "paper", STORE_BACKEND: "memory",
    TRADING_STARTING_CASH: 20_000, TRADING_SEED_PORTFOLIO: false,
    MAX_POSITION_WEIGHT: 1, MAX_ORDER_NOTIONAL: 100_000, MAX_DAILY_LOSS: 1,
    SLIPPAGE_BPS: 0, COMMISSION_RATE: 0 }), () => time);
  expect(system.broker.submitOrder({ symbol: "601318", side: "buy", type: "market", quantity: 100 }).status).toBe("filled");
  time = new Date(time.getTime() + 86_400_000);
  expect(system.broker.submitOrder({ symbol: "601318", side: "sell", type: "market", quantity: 100 }).status).toBe("filled");
  expect(system.risk.getState()).toMatchObject({ tradeCount: 1, lossCount: 1, consecutiveLosses: 1 });
  expect(system.store.getPaperRiskCheckpoint()?.lastConsumedCycle).toBe(1);
});
