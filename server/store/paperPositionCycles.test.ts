import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketQuote, MarketSnapshot, OrderProvenance, OrderSide, RiskLimits } from "../../shared/trading";
import { PaperBroker } from "../broker/paperBroker";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "./inMemoryTradingStore";
import { JsonFileTradingStore } from "./jsonFileTradingStore";
import { PAPER_CYCLE_RESULT_LIMIT } from "./paperPositionCycles";

const directories: string[] = [];
const limits: RiskLimits = { maxOrderNotional: 1_000_000, maxPositionWeight: 1,
  maxDailyLoss: 1, lotSize: 100, realTradingEnabled: false };

class TestMarket extends EventEmitter implements MarketDataProvider {
  price = 10;
  constructor(private readonly now: () => Date) { super(); }
  start() {}
  stop() {}
  tick() { return this.getSnapshot(); }
  getQuote(symbol: string): MarketQuote {
    return { symbol, name: symbol, price: this.price, previousClose: this.price,
      tradable: true, volume: 1_000_000, changePercent: 0, updatedAt: this.now().toISOString() };
  }
  getSnapshot(): MarketSnapshot {
    return { mode: "paper", sequence: 1, marketTime: this.now().toISOString(),
      quotes: [this.getQuote("600001"), this.getQuote("600002"), this.getQuote("600519")] };
  }
}

function fixture(backend: "memory" | "json", seed = false) {
  let time = new Date("2026-11-02T02:00:00Z");
  const now = () => time;
  const directory = backend === "json" ? fs.mkdtempSync(path.join(os.tmpdir(), "kairos-cycle-")) : undefined;
  if (directory) directories.push(directory);
  const load = () => new JsonFileTradingStore(directory!, 1_000_000, seed, { now, retentionDays: 1 });
  let store: TradingStore = directory ? load() : new InMemoryTradingStore(1_000_000, seed, now);
  const market = new TestMarket(now);
  const brokerFor = () => new PaperBroker(market, store, new RiskEngine(limits), {
    mode: "paper", commissionRate: 0, minimumCommission: 5, slippageBps: 0, limits, clock: now,
  });
  let broker = brokerFor();
  return { market, directory, get store() { return store; }, get broker() { return broker; },
    nextDay() { time = new Date(time.getTime() + 86_400_000); },
    reload() { store = load(); broker = brokerFor(); },
    fill(side: OrderSide, quantity = 100, price = market.price, symbol = "600001", provenance?: OrderProvenance) {
      market.price = price;
      const order = broker.submitOrder({ symbol, side, type: "market", quantity }, provenance);
      expect(order.status, order.rejectionReason).toBe("filled");
      return order;
    } };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !path.basename(directory).startsWith("kairos-cycle-")) throw new Error("Unexpected fixture directory");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function latestCompleteCycle(f: ReturnType<typeof fixture>) {
  const result = f.store.getPaperFillLedger().results.at(-1);
  if (result?.evidence !== "complete") throw Error("Expected an actual complete cycle");
  expect(result.entryStrategyBoughtQuantity).toBe(result.boughtQuantity);
  return result;
}

describe.each(["memory", "json"] as const)("persistent cycle entry strategy: %s", (backend) => {
  it("preserves the actual buy strategy, not the strategy used to close it", () => {
    const f = fixture(backend);
    f.fill("buy", 100, 10, "600001", { strategyKey: "rsi" });
    f.nextDay(); f.fill("sell", 100, 11, "600001", { strategyKey: "momentum" });
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "single", strategyKey: "rsi" });
    expect(latestCompleteCycle(f).netPnl).toBe(90);
  });

  it("preserves a single strategy through same-strategy adds and partial sells", () => {
    const f = fixture(backend);
    f.fill("buy", 200, 10, "600001", { strategyKey: "kairosTrendHealth" });
    f.nextDay(); f.fill("sell", 100, 12, "600001", { strategyKey: "rsi" });
    f.fill("buy", 100, 8, "600001", { strategyKey: "kairosTrendHealth" });
    f.nextDay(); f.fill("sell", 200, 9);
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "single", strategyKey: "kairosTrendHealth" });
    expect(latestCompleteCycle(f).netPnl).toBe(180);
  });

  it("marks different actual buy strategies as mixed and cannot later repair that with another known add", () => {
    const f = fixture(backend);
    for (const strategyKey of ["rsi", "momentum", "rsi"]) f.fill("buy", 100, 10, "600001", { strategyKey });
    f.nextDay(); f.fill("sell", 300);
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "mixed" });
  });

  it.each(["unknown-first", "unknown-add", "mixed-then-unknown"])("retains incomplete attribution after %s", (kind) => {
    const f = fixture(backend);
    const strategies = kind === "unknown-first" ? [undefined, "rsi"]
      : kind === "unknown-add" ? ["rsi", undefined, "rsi"] : ["rsi", "momentum", undefined, "rsi"];
    for (const strategyKey of strategies) f.fill("buy", 100, 10, "600001", { strategyKey });
    f.nextDay(); f.fill("sell", strategies.length * 100);
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "unknown" });
  });

  it.each(["auto", "inventedStrategy", "", "rsi "])("does not treat untrusted or non-specific key %j as a single strategy", (strategyKey) => {
    const f = fixture(backend);
    f.fill("buy", 100, 10, "600001", { strategyKey, strategy: "RSI label is not an identity" });
    f.nextDay(); f.fill("sell");
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "unknown" });
  });

  it("starts a new strategy cycle only after the prior holding actually becomes flat", () => {
    const f = fixture(backend);
    f.fill("buy", 100, 10, "600001", { strategyKey: "rsi" });
    f.nextDay(); f.fill("sell");
    f.fill("buy", 100, 10, "600001", { strategyKey: "momentum" });
    f.nextDay(); f.fill("sell");
    const evidence = f.store.getPaperFillLedger().results.map(cycle => cycle.evidence === "complete" && cycle.entryStrategyEvidence);
    expect(evidence).toEqual([{ status: "single", strategyKey: "rsi" }, { status: "single", strategyKey: "momentum" }]);
  });

  it("ignores rejected and cancelled buys from a different strategy", () => {
    const f = fixture(backend);
    f.fill("buy", 100, 10, "600001", { strategyKey: "rsi" });
    const rejected = f.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 1_000_000 }, { strategyKey: "momentum" });
    expect(rejected.status).toBe("rejected");
    const pending = f.broker.submitOrder({ symbol: "600001", side: "buy", type: "limit", quantity: 100, limitPrice: 9 }, { strategyKey: "momentum" });
    expect(pending.status).toBe("pending"); f.broker.cancelOrder(pending.id);
    f.nextDay(); f.fill("sell");
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "single", strategyKey: "rsi" });
  });

  it("attributes a pending buy only when it fills, retaining its original server strategy", () => {
    const f = fixture(backend);
    const pending = f.broker.submitOrder({ symbol: "600001", side: "buy", type: "limit", quantity: 100, limitPrice: 9 }, { strategyKey: "rsi" });
    expect(pending.status).toBe("pending");
    expect(f.broker.getPositions()).toEqual([]);
    f.store.setExecutionStrategy("momentum");
    f.market.price = 9; f.broker.markToMarket();
    expect(f.store.findOrderById(pending.id)?.status).toBe("filled");
    f.nextDay(); f.fill("sell");
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "single", strategyKey: "rsi" });
  });

  it("does not invent entry attribution for seeded positions even after a known add", () => {
    const f = fixture(backend, true);
    f.fill("buy", 100, 10, "600519", { strategyKey: "rsi" });
    f.nextDay(); f.fill("sell", 200, 10, "600519");
    const cycle = f.store.getPaperFillLedger().results[0];
    expect(cycle.evidence).toBe("missing-entry");
    expect(cycle).not.toHaveProperty("entryStrategyEvidence");
  });

  it("returns isolated nested evidence for closed cycles", () => {
    const f = fixture(backend);
    f.fill("buy", 100, 10, "600001", { strategyKey: "rsi" });
    f.nextDay(); f.fill("sell");
    const cycle = latestCompleteCycle(f);
    if (cycle.entryStrategyEvidence?.status !== "single") throw Error("Expected single attribution");
    cycle.entryStrategyEvidence.strategyKey = "momentum";
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "single", strategyKey: "rsi" });
  });
});

describe("JSON entry strategy evidence boundary", () => {
  it("survives open/partial cycles, order pruning and multiple restarts", () => {
    const f = fixture("json");
    f.fill("buy", 200, 10, "600001", { strategyKey: "kairosQuietPullback" });
    f.nextDay(); f.fill("sell", 100, 11); f.reload();
    f.nextDay(); f.nextDay(); f.reload();
    expect(f.store.listOrders()).toEqual([]);
    f.fill("sell", 100, 9); f.reload();
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "single", strategyKey: "kairosQuietPullback" });
    expect(latestCompleteCycle(f).netPnl).toBe(-15);
  });

  it("does not backfill a legacy cycle from retained orders or current execution settings", () => {
    const f = fixture("json");
    f.fill("buy", 100, 10, "600001", { strategyKey: "rsi" });
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    delete state.positions[0].paperCycle.entryStrategyEvidence;
    delete state.positions[0].paperCycle.entryStrategyBoughtQuantity;
    state.executionStrategy = "momentum";
    fs.writeFileSync(file, JSON.stringify(state));
    f.reload();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).positions[0].paperCycle.entryStrategyEvidence).toBeUndefined();
    f.fill("buy", 100, 10, "600001", { strategyKey: "momentum" });
    f.nextDay(); f.fill("sell", 200);
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "unknown" });
  });

  it("does not promote attribution from a failed atomic fill", () => {
    const f = fixture("json");
    f.fill("buy", 100, 10, "600001", { strategyKey: "rsi" });
    const order = f.store.createOrder({ symbol: "600001", side: "buy", type: "market", quantity: 100 }, 10, "600001", { strategyKey: "momentum" });
    const file = path.join(f.directory!, "paper-trading-state.json");
    const diskBefore = fs.readFileSync(file, "utf8");
    fs.mkdirSync(`${file}.tmp`);
    expect(() => f.store.fillOrder(order, "600001", 10, 5)).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(diskBefore);
    fs.rmdirSync(`${file}.tmp`);
    f.nextDay(); f.fill("sell", 100);
    expect(latestCompleteCycle(f).entryStrategyEvidence).toEqual({ status: "single", strategyKey: "rsi" });
  });

  it.each([null, [], "rsi", {}, { status: "single" }, { status: "single", strategyKey: "auto" },
    { status: "unknown", strategyKey: "rsi" }, { status: "mixed", strategyKey: "rsi" },
    { status: "single", strategyKey: "rsi", extra: true }])("rejects malformed open attribution before pruning: %j", (invalid) => {
    const f = fixture("json"); f.fill("buy");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.positions[0].paperCycle.entryStrategyEvidence = invalid;
    const text = JSON.stringify(state); fs.writeFileSync(file, text);
    f.nextDay(); f.nextDay();
    expect(() => f.reload()).toThrow(/strategy|cycle/i);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });

  it("rejects corrupt closed attribution before rewriting the ledger", () => {
    const f = fixture("json"); f.fill("buy"); f.nextDay(); f.fill("sell");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.paperFillLedger.results[0].entryStrategyEvidence = { status: "single", strategyKey: "unknown" };
    const text = JSON.stringify(state); fs.writeFileSync(file, text);
    expect(() => f.reload()).toThrow(/strategy|cycle/i);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });

  it.each([undefined, 0, -1, 100.5, 100])("rejects missing or stale strategy coverage quantity %j before pruning", (invalid) => {
    const f = fixture("json");
    f.fill("buy", 200, 10, "600001", { strategyKey: "rsi" });
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.positions[0].paperCycle.entryStrategyBoughtQuantity = invalid;
    const text = JSON.stringify(state); fs.writeFileSync(file, text);
    f.nextDay(); f.nextDay();
    expect(() => f.reload()).toThrow(/strategy|cycle/i);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });

  it("rejects a missing-entry cycle that claims strategy attribution", () => {
    const f = fixture("json", true);
    f.nextDay(); f.fill("sell", 100, 10, "600519");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.paperFillLedger.results[0].entryStrategyEvidence = { status: "single", strategyKey: "rsi" };
    const text = JSON.stringify(state); fs.writeFileSync(file, text);
    expect(() => f.reload()).toThrow(/strategy|cycle/i);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });
});

describe.each(["memory", "json"] as const)("paper position cycles: %s", (backend) => {
  it("does not count an entry fee or partial exit as a closed trade", () => {
    const f = fixture(backend);
    f.fill("buy", 200);
    expect(f.store.getPaperFillLedger()).toEqual({ lastSequence: 0, results: [] });
    f.nextDay();
    f.fill("sell", 100, 11);
    expect(f.store.getPaperFillLedger()).toEqual({ lastSequence: 0, results: [] });
    expect(f.broker.getAccount().realizedPnl).toBeCloseTo(90);
  });

  it("includes all entry/exit fees when the last shares leave", () => {
    const f = fixture(backend);
    const opening = f.fill("buy", 200);
    f.nextDay();
    f.fill("sell", 100, 11);
    const closing = f.fill("sell", 100, 9);
    expect(f.store.getPaperFillLedger()).toMatchObject({ lastSequence: 1, results: [{
      sequence: 1, symbol: "600001", openingOrderId: opening.id, closingOrderId: closing.id,
      openedAt: opening.filledAt, closedAt: closing.filledAt, netPnl: -15,
      buyNotional: 2000, buyFees: 5, sellNotional: 2000, sellFees: 10, evidence: "complete",
    }] });
    expect(f.broker.getAccount().realizedPnl).toBeCloseTo(-15);
  });

  it("keeps adds and partial exits inside one cycle", () => {
    const f = fixture(backend);
    f.fill("buy", 200, 10);
    f.nextDay();
    f.fill("sell", 100, 12);
    f.fill("buy", 100, 8);
    f.nextDay();
    f.fill("sell", 200, 9);
    expect(f.store.getPaperFillLedger().results).toMatchObject([{
      netPnl: 180, buyNotional: 2800, buyFees: 10, sellNotional: 3000, sellFees: 10,
    }]);
    expect(f.broker.getAccount().realizedPnl).toBeCloseTo(180);
  });

  it("recognizes a gross gain as a net loss after actual fees", () => {
    const f = fixture(backend);
    f.fill("buy"); f.nextDay(); f.fill("sell", 100, 10.05);
    expect(f.store.getPaperFillLedger().results[0].netPnl).toBe(-5);
  });

  it("keeps simultaneous symbols independent", () => {
    const f = fixture(backend);
    f.fill("buy", 100, 10, "600001"); f.fill("buy", 100, 10, "600002");
    f.nextDay();
    f.fill("sell", 100, 12, "600002"); f.fill("sell", 100, 9, "600001");
    expect(f.store.getPaperFillLedger().results.map((r) => [r.symbol, r.netPnl])).toEqual([
      ["600002", 190], ["600001", -110],
    ]);
  });

  it("records a flat-price round trip with zero fees as a zero result", () => {
    const f = fixture(backend);
    for (const side of ["buy", "sell"] as const) {
      const order = f.store.createOrder({ symbol: "600001", side, type: "market", quantity: 100 }, 10);
      f.store.fillOrder(order, "600001", 10, 0);
      f.nextDay();
    }
    expect(f.store.getPaperFillLedger().results[0].netPnl).toBe(0);
  });

  it("does not duplicate terminal fills, idempotent submissions or reads", () => {
    const f = fixture(backend);
    f.fill("buy"); f.nextDay();
    const close = f.broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100, clientOrderId: "cycle-close" });
    expect(close.status).toBe("filled");
    f.store.fillOrder(close, "600001", 99, 50);
    expect(f.broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100, clientOrderId: "cycle-close" }).id).toBe(close.id);
    expect(f.store.getPaperFillLedger().lastSequence).toBe(1);
    expect(f.store.getPaperFillLedger().results[0].netPnl).toBe(-10);
  });

  it("separates a new cycle after flattening and returns isolated copies", () => {
    const f = fixture(backend);
    const first = f.fill("buy"); f.nextDay(); f.fill("sell");
    const second = f.fill("buy", 100, 20); f.nextDay(); f.fill("sell", 100, 21);
    const ledger = f.store.getPaperFillLedger();
    expect(ledger.results.map((r) => r.openingOrderId)).toEqual([first.id, second.id]);
    expect(ledger.results.map((r) => r.netPnl)).toEqual([-10, 90]);
    ledger.results[0].netPnl = 999;
    ledger.results.length = 0;
    expect(f.store.getPaperFillLedger().results.map((r) => r.netPnl)).toEqual([-10, 90]);
  });

  it("marks seeded holdings as missing entry evidence even after an add", () => {
    const f = fixture(backend, true);
    f.fill("buy", 100, 10, "600519"); f.nextDay();
    f.fill("sell", 200, 10, "600519");
    expect(f.store.getPaperFillLedger().results).toMatchObject([{
      symbol: "600519", evidence: "missing-entry", netPnl: null, openingOrderId: null, openedAt: null,
    }]);
  });

  it("retains the injected-clock T+1 lock until the next Beijing date", () => {
    const f = fixture(backend);
    f.fill("buy");
    expect(f.broker.getPositions()[0]).toMatchObject({ availableQuantity: 0, t1LockedQuantity: 100 });
    expect(f.broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 100 }).status).toBe("rejected");
    f.nextDay();
    expect(f.broker.getPositions()[0]).toMatchObject({ availableQuantity: 100, t1LockedQuantity: 0 });
    f.fill("sell");
  });

  it("does not close a cycle on cancellation or rejected sells", () => {
    const f = fixture(backend);
    f.fill("buy");
    expect(f.broker.submitOrder({ symbol: "600001", side: "sell", type: "market", quantity: 200 }).status).toBe("rejected");
    f.nextDay();
    const pending = f.broker.submitOrder({ symbol: "600001", side: "sell", type: "limit", quantity: 100, limitPrice: 11 });
    f.broker.cancelOrder(pending.id);
    expect(f.store.getPaperFillLedger()).toEqual({ lastSequence: 0, results: [] });
  });

  it("clears cycles on an explicitly requested account reset", () => {
    const f = fixture(backend);
    f.fill("buy"); f.nextDay(); f.fill("sell");
    f.broker.resetAccount({ startingCash: 20000, strategyProfile: "growth" });
    expect(f.store.getPaperFillLedger()).toEqual({ lastSequence: 0, results: [] });
  });
});

describe("JSON cycle persistence", () => {
  it("does not retain or later promote a fill whose atomic file replacement failed", () => {
    const f = fixture("json"); f.fill("buy", 200); f.nextDay();
    const order = f.store.createOrder({ symbol: "600001", side: "sell", type: "market", quantity: 200 }, 10);
    const file = path.join(f.directory!, "paper-trading-state.json");
    const diskBefore = fs.readFileSync(file, "utf8");
    const cashBefore = f.store.getCash();
    const positionsBefore = f.broker.getPositions();
    const auditBefore = f.store.listAudit();
    const ledgerBefore = f.store.getPaperFillLedger();
    fs.mkdirSync(`${file}.tmp`);
    expect(() => f.store.fillOrder(order, "600001", 10, 5)).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(diskBefore);
    expect(f.store.getCash()).toBe(cashBefore);
    expect(f.broker.getPositions()).toEqual(positionsBefore);
    expect(f.store.listAudit()).toEqual(auditBefore);
    expect(f.store.getPaperFillLedger()).toEqual(ledgerBefore);
    expect(f.store.findOrderById(order.id)?.status).toBe("accepted");
    fs.rmdirSync(`${file}.tmp`);
    f.store.setPaused(true);
    f.reload();
    expect(f.store.findOrderById(order.id)?.status).toBe("accepted");
    expect(f.store.getPaperFillLedger()).toEqual(ledgerBefore);
  });
  it("bounds results while keeping a durable monotonic sequence", () => {
    const f = fixture("json"); f.fill("buy"); f.nextDay(); f.fill("sell");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    const sample = state.paperFillLedger.results[0];
    state.paperFillLedger = { lastSequence: PAPER_CYCLE_RESULT_LIMIT,
      results: Array.from({ length: PAPER_CYCLE_RESULT_LIMIT }, (_, index) => ({ ...sample,
        sequence: index + 1, closingOrderId: `old-close-${index}`, openingOrderId: `old-open-${index}` })) };
    fs.writeFileSync(file, JSON.stringify(state));
    f.reload(); f.fill("buy"); f.nextDay(); f.fill("sell"); f.reload();
    const ledger = f.store.getPaperFillLedger();
    expect(ledger.lastSequence).toBe(PAPER_CYCLE_RESULT_LIMIT + 1);
    expect(ledger.results).toHaveLength(PAPER_CYCLE_RESULT_LIMIT);
    expect(ledger.results[0].sequence).toBe(2);
    expect(ledger.results.at(-1)?.sequence).toBe(PAPER_CYCLE_RESULT_LIMIT + 1);
  });
  it("preserves open and partial-exit evidence beyond order retention and restart", () => {
    const f = fixture("json");
    const opening = f.fill("buy", 200);
    f.nextDay(); f.fill("sell", 100, 11);
    f.nextDay(); f.nextDay(); f.reload();
    expect(f.store.listOrders()).toEqual([]);
    f.fill("sell", 100, 9); f.reload();
    expect(f.store.getPaperFillLedger().results).toMatchObject([{ openingOrderId: opening.id, netPnl: -15 }]);
  });

  it("loads legacy holdings without inventing an entry fee", () => {
    const f = fixture("json");
    f.fill("buy");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    delete state.paperFillLedger;
    delete state.positions[0].paperCycle;
    fs.writeFileSync(file, JSON.stringify(state));
    f.nextDay(); f.reload(); f.fill("sell");
    expect(f.store.getPaperFillLedger().results[0]).toMatchObject({ netPnl: null, evidence: "missing-entry" });
  });

  it.each([null, { lastSequence: -1, results: [] }, { lastSequence: 1, results: [] }])("rejects malformed explicit ledger before rewriting disk: %j", (invalid) => {
    const f = fixture("json");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.paperFillLedger = invalid;
    const text = JSON.stringify(state);
    fs.writeFileSync(file, text);
    expect(() => f.reload()).toThrow(/cycle|ledger/i);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });

  it("rejects corrupt explicit open evidence before pruning history", () => {
    const f = fixture("json"); f.fill("buy");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.positions[0].paperCycle.buyFees = -5;
    const text = JSON.stringify(state);
    fs.writeFileSync(file, text);
    f.nextDay(); f.nextDay();
    expect(() => f.reload()).toThrow(/cycle/i);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });

  it.each(["netPnl", "sequence", "evidence", "closedAt", "boughtQuantity"])("rejects corrupt closed %s without rewriting", (field) => {
    const f = fixture("json"); f.fill("buy"); f.nextDay(); f.fill("sell");
    const file = path.join(f.directory!, "paper-trading-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.paperFillLedger.results[0][field] = "invalid";
    const text = JSON.stringify(state);
    fs.writeFileSync(file, text);
    expect(() => f.reload()).toThrow(/cycle|ledger/i);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });
});
