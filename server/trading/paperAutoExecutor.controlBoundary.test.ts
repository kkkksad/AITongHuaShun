import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradingSystem } from "../system";
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
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("kairos-control-boundary-")) {
      throw new Error("Unexpected control fixture directory");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(backend: "memory" | "json", stage: "research" | "notification" | "after-first-order", change: (system: TradingSystem, executor: PaperAutoExecutor) => void) {
  const directory = mkdtempSync(join(tmpdir(), "kairos-control-boundary-"));
  directories.push(directory);
  const now = () => new Date("2026-08-21T14:00:00+08:00");
  const config = createTestConfig({ MARKET_MODE: "paper", STORE_BACKEND: backend,
    DATA_DIR: directory, TRADING_STARTING_CASH: 20_000, TRADING_SEED_PORTFOLIO: false,
    MAX_ORDER_NOTIONAL: 10_000, MAX_POSITION_WEIGHT: 0.8, PAPER_AUTO_EXECUTION_ENABLED: true });
  const system = createTradingSystem(config, now);
  system.broker.setStrategyProfile("growth");
  const snapshot = { mode: "paper" as const, sequence: 1, marketTime: now().toISOString(),
    quotes: ["600001", "600002"].map(symbol => ({ symbol, name: symbol, tradable: true,
      price: 10, previousClose: 10, changePercent: 0, volume: 10_000_000, updatedAt: now().toISOString() })) };
  vi.spyOn(system.market, "getSnapshot").mockReturnValue(snapshot);
  vi.spyOn(system.market, "getQuote").mockImplementation(symbol => snapshot.quotes.find(q => q.symbol === symbol));
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
    positions: [], leaderboard, candidates, qualityStocks, initialCapital: 20_000, lotSize: 100,
    maxPositionWeight: 0.8, maxSingleOrderNotional: 10_000, commissionRate: config.COMMISSION_RATE,
    minimumCommission: config.MIN_COMMISSION, cashReserveRatio: 0, strategyProfile: "growth", executionStrategy: "auto" });
  // Deterministic eligible plans isolate the control boundary from signal selection.
  plan.operations = snapshot.quotes.map(q => ({ timestamp: now().toISOString(), symbol: q.symbol, name: q.name,
    action: "paper-buy-plan", strategy: "control boundary fixture", quantity: 100, price: 10,
    estimatedNotional: 1000, reason: "qualified fixture", ruleChecks: ["cash-check: pass"] }));
  plan.qualitySummary.planQuality = "actionable";
  let applyChange = true;
  const mutate = () => { if (applyChange) change(system, executor); };
  vi.spyOn(paperPlans, "buildCurrentPaperTradingPlan").mockImplementation(async () => {
    await Promise.resolve();
    if (stage === "research") mutate();
    return { plan, leaderboard, candidates, qualityStocks, marketRegimeResearch,
      realResearchDataFeed, externalMarketImpact, adaptiveRouting };
  });
  const notifier = { notify: vi.fn().mockImplementation(async () => {
    await Promise.resolve();
    if (stage === "notification") mutate();
    return { status: "disabled" as const };
  }), notifyOrderEvents: vi.fn().mockResolvedValue({ status: "disabled" }) };
  const executor = new PaperAutoExecutor({ system, config, enabled: true, intervalMs: 60_000,
    tradeWindowOnly: true, maxOrdersPerRun: 2, maxDailyOrders: 10, targetDailyOrders: 6,
    clock: now, planNotifier: notifier, onOrder: () => { if (stage === "after-first-order") mutate(); } });
  const submit = vi.spyOn(system.broker, "submitOrder");
  return { executor, system, notifier, submit, unchangedNextRun() { applyChange = false; } };
}

const changes = {
  profile: (s: TradingSystem) => { s.broker.setStrategyProfile("capital-preservation"); },
  strategy: (s: TradingSystem) => { s.broker.setExecutionStrategy("rsi"); },
  "pause-resume": (s: TradingSystem) => { s.broker.pause(); s.broker.resume(); },
  "strategy-ABA": (s: TradingSystem) => { s.broker.setExecutionStrategy("rsi"); s.broker.setExecutionStrategy("auto"); },
  "same-money-reset": (s: TradingSystem) => { s.broker.resetAccount({ startingCash: 20_000, strategyProfile: "growth" }); },
  stop: (_s: TradingSystem, executor: PaperAutoExecutor) => { executor.stop(); },
};

describe.each(["memory", "json"] as const)("%s asynchronous Paper control boundary", backend => {
  it.each(Object.entries(changes).flatMap(([name, change]) => (["research", "notification"] as const)
    .map(stage => ({ name, change, stage }))))("discards old plan after $name during $stage", async ({ change, stage }) => {
    const f = fixture(backend, stage, change);
    const result = await f.executor.runOnce();
    expect(result.submittedOrders).toEqual([]);
    expect(result.planQuality).toBe("watch-only");
    expect(result.skippedOperations).toEqual(expect.arrayContaining([expect.objectContaining({
      symbol: "SYSTEM", reason: expect.stringMatching(/控制|设置|停止|失效/),
    })]));
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.system.broker.getOrders()).toEqual([]);
    expect(f.system.broker.getAccount().cash).toBe(20_000);
    expect(f.notifier.notifyOrderEvents).not.toHaveBeenCalled();
    if (stage === "research") expect(f.notifier.notify).not.toHaveBeenCalled();
  });

  it("keeps unchanged controls and its own committed fills valid", async () => {
    const f = fixture(backend, "notification", s => {
      s.broker.setStrategyProfile("growth"); s.broker.setExecutionStrategy("auto"); s.broker.resume();
    });
    const result = await f.executor.runOnce();
    expect(result.submittedOrders.map(o => o.status)).toEqual(["filled", "filled"]);
    expect(f.system.broker.getAccount().cash).toBe(17_990);
    expect(f.system.broker.getPositions()).toHaveLength(2);
  });

  it("allows a new run after a pause-resume discarded the old one", async () => {
    const f = fixture(backend, "notification", changes["pause-resume"]);
    expect((await f.executor.runOnce()).submittedOrders).toEqual([]);
    f.unchangedNextRun();
    expect((await f.executor.runOnce()).submittedOrders.map(o => o.status)).toEqual(["filled", "filled"]);
  });

  it("preserves the first committed fill and skips the remainder after a control change", async () => {
    const f = fixture(backend, "after-first-order", changes.profile);
    const result = await f.executor.runOnce();
    expect(result.planQuality).toBe("watch-only");
    expect(result.submittedOrders.map(o => o.status)).toEqual(["filled"]);
    expect(f.system.broker.getOrders().map(o => o.status)).toEqual(["filled"]);
    expect(f.system.broker.getAccount().cash).toBe(18_995);
    expect(f.system.broker.getPositions()[0]).toMatchObject({ symbol: "600001", quantity: 100 });
    expect(f.submit).toHaveBeenCalledOnce();
  });
});
