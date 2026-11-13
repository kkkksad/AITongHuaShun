import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { routeAdaptiveStrategies } from "../research/adaptiveStrategyRouter";
import { buildDailyCandidates } from "../research/dailyCandidates";
import { buildDailyQualityStocks } from "../research/dailyQualityStocks";
import { buildUnavailableExternalMarketImpact } from "../research/externalMarketImpact";
import { buildUnavailableMarketRegimeResearch } from "../research/marketRegimeResearch";
import { buildPaperTradingPlan } from "../research/paperTradingPlan";
import * as paperPlans from "../research/paperTradingPlanService";
import { buildUnavailableRealResearchDataFeed } from "../research/realResearchData";
import { buildUnavailableStrategyLeaderboard } from "../research/strategyLeaderboard";
import { PaperAutoExecutor } from "./paperAutoExecutor";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("kairos-notification-ledger-")) {
      throw new Error("Unexpected notification ledger fixture directory");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(backend: "memory" | "json", setup?: (f: { buy: (limit?: boolean) => OrderRecord; seedSellable: () => void;
  sellPending: () => OrderRecord }) => OrderRecord) {
  const directory = mkdtempSync(join(tmpdir(), "kairos-notification-ledger-")); directories.push(directory);
  let clock = new Date("2026-08-21T06:00:00Z"); const now = () => clock;
  const config = createTestConfig({ MARKET_MODE: "paper", STORE_BACKEND: backend, DATA_DIR: directory,
    TRADING_STARTING_CASH: 20_000, TRADING_SEED_PORTFOLIO: false, MAX_ORDER_NOTIONAL: 10_000,
    MAX_POSITION_WEIGHT: 0.8, SLIPPAGE_BPS: 0, PAPER_AUTO_EXECUTION_ENABLED: true });
  const system = createTradingSystem(config, now); system.broker.setStrategyProfile("growth");
  const snapshot = { mode: "paper" as const, sequence: 1, marketTime: now().toISOString(),
    quotes: ["600001", "600002", "600003"].map(symbol => ({ symbol, name: symbol, tradable: true,
      price: 10, previousClose: 10, changePercent: 0, volume: 10_000_000, updatedAt: now().toISOString() })) };
  vi.spyOn(system.market, "getSnapshot").mockReturnValue(snapshot);
  vi.spyOn(system.market, "getQuote").mockImplementation(symbol => snapshot.quotes.find(q => q.symbol === symbol));
  const buy = (limit = false) => system.broker.submitOrder({ symbol: "600001", side: "buy",
    type: limit ? "limit" : "market", quantity: 100, ...(limit ? { limitPrice: 9 } : {}) });
  const seedSellable = () => { clock = new Date("2026-08-20T06:00:00Z"); buy(); clock = new Date("2026-08-21T06:00:00Z"); };
  const sellPending = () => system.broker.submitOrder({ symbol: "600001", side: "sell", type: "limit", quantity: 100, limitPrice: 11 });
  const initial = setup?.({ buy, seedSellable, sellPending });
  const provider = system.marketDataProvider;
  const input = { bridgeUrl: config.AKSHARE_BRIDGE_URL, marketDataProvider: provider,
    mode: config.MARKET_MODE, snapshot, timeoutMs: config.MARKET_DATA_TIMEOUT_MS };
  const leaderboard = buildUnavailableStrategyLeaderboard(snapshot, provider);
  const candidates = buildDailyCandidates(snapshot, provider, 40);
  const qualityStocks = buildDailyQualityStocks(snapshot, provider, 60);
  const marketRegimeResearch = buildUnavailableMarketRegimeResearch({ ...input, sectorLimit: 6, stockLimit: 6, days: 180 });
  const realResearchDataFeed = buildUnavailableRealResearchDataFeed(input);
  const externalMarketImpact = buildUnavailableExternalMarketImpact({ ...input, days: 500 });
  const adaptiveRouting = routeAdaptiveStrategies(marketRegimeResearch);
  const plan = buildPaperTradingPlan({ snapshot, provider, account: system.broker.getAccount(snapshot),
    positions: system.broker.getPositions(snapshot), leaderboard, candidates, qualityStocks, initialCapital: 20_000,
    lotSize: 100, maxPositionWeight: 0.8, maxSingleOrderNotional: 10_000, commissionRate: config.COMMISSION_RATE,
    minimumCommission: config.MIN_COMMISSION, cashReserveRatio: 0, strategyProfile: "growth", executionStrategy: "auto" });
  // Fix qualified inputs to isolate the wait boundary; broker, preflight and ledger stay real.
  plan.operations = snapshot.quotes.slice(1).map(q => ({ timestamp: now().toISOString(), symbol: q.symbol, name: q.name,
    action: "paper-buy-plan", strategy: "local boundary fixture", quantity: 100, price: 10,
    estimatedNotional: 1000, reason: "qualified fixture", ruleChecks: ["cash-check: pass"] }));
  plan.qualitySummary.planQuality = "actionable";
  vi.spyOn(paperPlans, "buildCurrentPaperTradingPlan").mockResolvedValue({ plan, leaderboard, candidates,
    qualityStocks, marketRegimeResearch, realResearchDataFeed, externalMarketImpact, adaptiveRouting });
  let begin!: () => void; let finish!: () => void;
  const started = new Promise<void>(yes => { begin = yes; });
  const notifier = { notify: vi.fn().mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ status: "disabled" }); begin();
  })), notifyOrderEvents: vi.fn().mockResolvedValue({ status: "disabled" }) };
  const executor = new PaperAutoExecutor({ system, config, enabled: true, intervalMs: 60_000,
    tradeWindowOnly: true, maxOrdersPerRun: 2, maxDailyOrders: 10, targetDailyOrders: 6, clock: now, planNotifier: notifier });
  const digest = () => ({ cash: system.store.getCash(), available: system.store.getAvailableCash(),
    positions: system.broker.getPositions(snapshot), orders: system.broker.getOrders(10_000),
    ledger: system.store.getPaperFillLedger(), risk: system.store.getPaperRiskCheckpoint() });
  return { system, snapshot, executor, notifier, initial, buy, digest, started, finish: () => finish(), directory };
}
type Fixture = ReturnType<typeof fixture>;
const changes: Array<{ name: string; setup?: Parameters<typeof fixture>[1]; mutate: (f: Fixture) => void }> = [
  { name: "new pending buy", mutate: f => { expect(f.buy(true).status).toBe("pending"); } },
  { name: "external immediate buy", mutate: f => { expect(f.buy().status).toBe("filled"); } },
  { name: "pending cancellation", setup: f => f.buy(true), mutate: f => {
    expect(f.system.broker.cancelOrder(f.initial!.id).status).toBe("cancelled");
  } },
  { name: "pending fill without a new order", setup: f => f.buy(true), mutate: f => {
    f.snapshot.quotes[0].price = 8; f.system.broker.markToMarket(f.snapshot);
    expect(f.system.broker.getOrders()[0].status).toBe("filled");
  } },
  { name: "rejection leaving cash unchanged", mutate: f => {
    expect(f.system.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 1 }).status).toBe("rejected");
  } },
  { name: "new pending then cancellation restoring cash", mutate: f => { f.system.broker.cancelOrder(f.buy(true).id); } },
  { name: "sell cancellation leaving cash unchanged", setup: f => { f.seedSellable(); return f.sellPending(); },
    mutate: f => { expect(f.system.broker.cancelOrder(f.initial!.id).status).toBe("cancelled"); } },
];

describe.each(["memory", "json"] as const)("%s notification wait ledger boundary", backend => {
  it.each(changes)("discards prepared orders after $name and preserves external economics", async ({ setup, mutate }) => {
    const f = fixture(backend, setup); const revision = f.system.store.getExecutionRevision();
    const run = f.executor.runOnce(); await f.started;
    mutate(f); const afterExternal = f.digest();
    expect(f.system.store.getExecutionRevision()).toBe(revision);
    const submit = vi.spyOn(f.system.broker, "submitOrder");
    f.finish(); const result = await run;
    expect(result.submittedOrders).toEqual([]); expect(result.planQuality).toBe("watch-only");
    expect(result.skippedOperations).toEqual(expect.arrayContaining([expect.objectContaining({
      symbol: "SYSTEM", reason: expect.stringContaining("账本"),
    })]));
    expect(submit).not.toHaveBeenCalled(); expect(f.notifier.notify).toHaveBeenCalledOnce();
    expect(f.notifier.notifyOrderEvents).not.toHaveBeenCalled(); expect(f.digest()).toEqual(afterExternal);
    if (backend === "json") {
      const persisted = JSON.parse(readFileSync(join(f.directory, "paper-trading-state.json"), "utf8"));
      expect(persisted.cash).toBe(afterExternal.cash); expect(persisted.orders).toEqual(afterExternal.orders);
    }
  });

  it("allows both of its own fills when the ledger stays unchanged during notification", async () => {
    const f = fixture(backend); const run = f.executor.runOnce(); await f.started;
    f.finish(); const result = await run;
    expect(result.submittedOrders.map(o => o.status)).toEqual(["filled", "filled"]);
    expect(f.system.broker.getAccount().cash).toBe(17_990);
    expect(f.system.broker.getPositions().map(p => p.symbol)).toEqual(["600002", "600003"]);
    expect(f.notifier.notifyOrderEvents).toHaveBeenCalledOnce();
  });

  it("allows price, audit and risk observation changes without a new ledger operation", async () => {
    const f = fixture(backend, f => { f.seedSellable(); return f.sellPending(); });
    const run = f.executor.runOnce(); await f.started;
    // Price 10.5 does not cross the existing sell limit of 11.
    f.snapshot.quotes[0].price = 10.5; f.system.broker.markToMarket(f.snapshot);
    f.system.store.appendAudit("system", "fixture.read", "observation only");
    f.finish(); const result = await run;
    expect(result.submittedOrders.map(o => o.status)).toEqual(["filled", "filled"]);
    expect(f.system.store.getPendingOrders().map(o => o.id)).toEqual([f.initial!.id]);
  });
});
