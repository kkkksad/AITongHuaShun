import { afterEach, describe, expect, it, vi } from "vitest";
import { routeAdaptiveStrategies } from "../research/adaptiveStrategyRouter";
import { buildDailyCandidates } from "../research/dailyCandidates";
import { buildDailyQualityStocks } from "../research/dailyQualityStocks";
import { buildUnavailableExternalMarketImpact } from "../research/externalMarketImpact";
import { buildUnavailableMarketRegimeResearch } from "../research/marketRegimeResearch";
import { buildPaperTradingPlan } from "../research/paperTradingPlan";
import * as paperPlans from "../research/paperTradingPlanService";
import { buildUnavailableRealResearchDataFeed } from "../research/realResearchData";
import { buildUnavailableStrategyLeaderboard } from "../research/strategyLeaderboard";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { PaperAutoExecutor } from "./paperAutoExecutor";

afterEach(() => vi.restoreAllMocks());

async function blockedEntry(gate: "persistence" | "fees", legacy = false) {
  const now = new Date("2026-08-21T14:00:00+08:00");
  const config = createTestConfig({ MARKET_MODE: "paper", TRADING_STARTING_CASH: 10_000,
    TRADING_SEED_PORTFOLIO: false, MAX_ORDER_NOTIONAL: 2_000, MAX_POSITION_WEIGHT: 0.5,
    PAPER_AUTO_EXECUTION_ENABLED: true });
  const system = createTradingSystem(config, () => now);
  system.store.setStrategyProfile("growth");
  const price = gate === "fees" ? 2.15 : 10;
  const snapshot = { mode: "paper" as const, sequence: 1, marketTime: now.toISOString(),
    quotes: [{ symbol: "600010", name: "包钢股份", tradable: true, price,
      previousClose: price * 0.99, changePercent: 1.01, volume: 30_000_000,
      amount: price * 30_000_000, turnover: 2, amplitude: 2.5,
      open: price * 0.99, high: price * 1.01, low: price * 0.98, updatedAt: now.toISOString() }] };
  vi.spyOn(system.market, "getSnapshot").mockReturnValue(snapshot);
  vi.spyOn(system.market, "getQuote").mockImplementation(symbol => snapshot.quotes.find(q => q.symbol === symbol));
  const provider = "akshare";
  const input = { bridgeUrl: config.AKSHARE_BRIDGE_URL, marketDataProvider: provider,
    mode: config.MARKET_MODE, snapshot, timeoutMs: config.MARKET_DATA_TIMEOUT_MS };
  const leaderboard = buildUnavailableStrategyLeaderboard(snapshot, provider);
  const candidates = { ...buildDailyCandidates(snapshot, provider, 40), candidates: [] };
  const rawQuality = buildDailyQualityStocks(snapshot, provider, 1);
  const qualityStocks = { ...rawQuality, stocks: rawQuality.stocks.map(stock =>
    ({ ...stock, score: 96, action: "focus" as const })) };
  const marketRegimeResearch = buildUnavailableMarketRegimeResearch({ ...input, sectorLimit: 6, stockLimit: 6, days: 180 });
  const plan = buildPaperTradingPlan({ snapshot, provider, account: system.broker.getAccount(snapshot),
    positions: [], leaderboard, candidates, qualityStocks,
    ...(gate === "persistence" ? { marketRegimeResearch } : {}),
    initialCapital: 10_000, lotSize: 100, maxPositionWeight: 0.5,
    maxSingleOrderNotional: gate === "fees" ? 300 : 2_000,
    commissionRate: config.COMMISSION_RATE, minimumCommission: config.MIN_COMMISSION,
    cashReserveRatio: 0, strategyProfile: "growth" });
  const blocked = plan.operations.find(operation => operation.strategy === "隔夜持续性与费用纪律");
  expect(blocked).toBeDefined();
  if (legacy) delete blocked!.strategyKey;
  expect(blocked!.ruleChecks.some(check => check.startsWith(
    gate === "fees" ? "round-trip-fee-ratio: blocked" : "entry-persistence: blocked",
  ))).toBe(true);
  // The actual plan is passed to the actual executor. Only the unrelated
  // research-fetching boundary is replaced; no skip, audit or broker mocks.
  vi.spyOn(paperPlans, "buildCurrentPaperTradingPlan").mockResolvedValue({ leaderboard, candidates, qualityStocks,
    marketRegimeResearch, adaptiveRouting: routeAdaptiveStrategies(marketRegimeResearch), plan,
    realResearchDataFeed: buildUnavailableRealResearchDataFeed(input),
    externalMarketImpact: buildUnavailableExternalMarketImpact({ ...input, days: 500 }) });
  const before = system.broker.getAccount(snapshot);
  const checkpoint = system.store.getPaperRiskCheckpoint();
  const executor = new PaperAutoExecutor({ system, config, enabled: true, intervalMs: 60_000,
    tradeWindowOnly: true, maxOrdersPerRun: 2, maxDailyOrders: 4, targetDailyOrders: 2, clock: () => now });
  const result = await executor.runOnce();
  expect(result.submittedOrders).toEqual([]);
  expect(system.broker.getOrders()).toEqual([]);
  expect(system.broker.getPositions(snapshot)).toEqual([]);
  expect(system.broker.getAccount(snapshot)).toEqual(before);
  expect(system.store.getPaperRiskCheckpoint()).toEqual(checkpoint);
  const audits = system.store.listAudit(1_000);
  expect(paperPlans.summarizeRecentPaperStrategyUsage(audits, now)).toEqual({});
  return { result, audits };
}

describe("blocked entry strategy provenance in real paper execution", () => {
  it.each(["persistence", "fees"] as const)("preserves the actual source through the %s gate and persisted audit", async gate => {
    const { result, audits } = await blockedEntry(gate);
    const expected = { symbol: "600010", action: "blocked", strategyKey: "snapshot-candidate",
      quantity: 0, estimatedNotional: 0 };
    expect(result.skippedOperations).toContainEqual(expect.objectContaining(expected));
    expect(audits.find(audit => audit.action === "paper-auto-execution.run")?.data?.skippedReasons)
      .toContainEqual(expect.objectContaining(expected));
  });

  it("does not invent a strategy for a legacy blocked operation without recorded identity", async () => {
    const { result, audits } = await blockedEntry("persistence", true);
    expect(result.skippedOperations).toContainEqual(expect.objectContaining({ symbol: "600010", strategyKey: null }));
    expect(audits.find(audit => audit.action === "paper-auto-execution.run")?.data?.skippedReasons)
      .toContainEqual(expect.objectContaining({ symbol: "600010", strategyKey: null }));
  });
});
