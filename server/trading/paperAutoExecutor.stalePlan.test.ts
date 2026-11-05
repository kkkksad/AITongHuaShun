import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaperAutoExecutorOptions } from "./paperAutoExecutor";
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

function createPlanFixture(planTimestamp: string, runTimestamp: string) {
  let now = new Date(planTimestamp);
  const config = createTestConfig({
    MARKET_MODE: "paper",
    TRADING_STARTING_CASH: 10_000,
    TRADING_SEED_PORTFOLIO: false,
    MAX_ORDER_NOTIONAL: 10_000,
    MAX_POSITION_WEIGHT: 1,
    PAPER_AUTO_EXECUTION_ENABLED: true,
  });
  const system = createTradingSystem(config, () => now);
  system.store.setStrategyProfile("growth");
  const snapshot = system.market.getSnapshot();
  const provider = system.marketDataProvider;
  const reportInput = {
    bridgeUrl: config.AKSHARE_BRIDGE_URL,
    marketDataProvider: provider,
    mode: config.MARKET_MODE,
    snapshot,
    timeoutMs: config.MARKET_DATA_TIMEOUT_MS,
  };
  const leaderboard = buildUnavailableStrategyLeaderboard(snapshot, provider);
  const candidates = buildDailyCandidates(snapshot, provider, 40);
  const qualityStocks = buildDailyQualityStocks(snapshot, provider, 60);
  const marketRegimeResearch = buildUnavailableMarketRegimeResearch({
    ...reportInput,
    sectorLimit: 6,
    stockLimit: 6,
    days: 180,
  });
  const realResearchDataFeed = buildUnavailableRealResearchDataFeed(reportInput);
  const externalMarketImpact = buildUnavailableExternalMarketImpact({ ...reportInput, days: 500 });
  const adaptiveRouting = routeAdaptiveStrategies(marketRegimeResearch);
  const plan = buildPaperTradingPlan({
    snapshot,
    provider,
    account: system.broker.getAccount(snapshot),
    positions: system.broker.getPositions(snapshot),
    leaderboard,
    candidates,
    qualityStocks,
    initialCapital: config.TRADING_STARTING_CASH,
    lotSize: system.limits.lotSize,
    maxPositionWeight: system.risk.getEffectiveMaxPositionWeight(),
    maxSingleOrderNotional: system.risk.getEffectiveMaxOrderNotional(),
    commissionRate: config.COMMISSION_RATE,
    minimumCommission: config.MIN_COMMISSION,
    cashReserveRatio: config.PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO,
    strategyProfile: system.store.getStrategyProfile(),
    executionStrategy: system.store.getExecutionStrategy(),
  });
  const quote = system.market.getQuote("601318")!;
  // A deterministic eligible operation isolates the date gate from selection.
  plan.operations = [{
    timestamp: planTimestamp,
    symbol: quote.symbol,
    name: quote.name,
    action: "paper-buy-plan",
    strategy: "deterministic plan-date fixture",
    quantity: 100,
    price: quote.price,
    estimatedNotional: quote.price * 100,
    reason: "qualified paper fixture",
    ruleChecks: ["paper-only", "cash-check: pass"],
  }];
  plan.qualitySummary.planQuality = "actionable";
  const research = {
    plan,
    leaderboard,
    candidates,
    qualityStocks,
    marketRegimeResearch,
    realResearchDataFeed,
    externalMarketImpact,
    adaptiveRouting,
  };
  const orderReads = vi.spyOn(system.store, "listOrders");
  vi.spyOn(paperPlans, "buildCurrentPaperTradingPlan").mockImplementation(async () => {
    // Reads before research use the current run date. No plan-date quota or
    // execution-summary reads may happen after a mismatched plan is returned.
    orderReads.mockClear();
    return research;
  });
  const notifier: NonNullable<PaperAutoExecutorOptions["planNotifier"]> = {
    notify: vi.fn().mockResolvedValue({ status: "disabled" }),
    notifyOrderEvents: vi.fn().mockResolvedValue({ status: "disabled" }),
  };
  const submitOrder = vi.spyOn(system.broker, "submitOrder");
  const findByClientOrderId = vi.spyOn(system.store, "findByClientOrderId");
  const executor = new PaperAutoExecutor({
    system,
    config,
    enabled: true,
    intervalMs: 60_000,
    tradeWindowOnly: true,
    maxOrdersPerRun: 2,
    maxDailyOrders: 4,
    targetDailyOrders: 2,
    clock: () => now,
    planNotifier: notifier,
  });
  now = new Date(runTimestamp);
  return { executor, system, plan, snapshot, notifier, submitOrder, orderReads, findByClientOrderId };
}

describe("paper execution plan trading-date boundary", () => {
  it.each([
    ["previous", "2026-08-20T14:30:00+08:00"],
    ["future", "2026-08-24T14:30:00+08:00"],
  ])("observes a %s-date plan before quotas, idempotency, notification or submission", async (_, planTimestamp) => {
    const fixture = createPlanFixture(planTimestamp, "2026-08-21T14:30:00+08:00");
    const { executor, system, plan, notifier, submitOrder, orderReads, findByClientOrderId } = fixture;

    const result = await executor.runOnce();

    expect(result).toMatchObject({
      tradingDate: "2026-08-21",
      planQuality: "watch-only",
      submittedOrders: [],
      skippedOperations: [{
        symbol: "SYSTEM",
        action: "observe",
        reason: expect.stringContaining("计划交易日期与本轮交易日期不一致"),
      }],
    });
    expect(result.skippedOperations[0].reason).toContain(plan.tradingDate);
    expect(result.skippedOperations[0].reason).toContain("2026-08-21");
    expect(orderReads).not.toHaveBeenCalled();
    expect(findByClientOrderId).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(notifier.notifyOrderEvents).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
    expect(system.broker.getOrders()).toEqual([]);
    expect(system.broker.getAccount().cash).toBe(10_000);
    expect(system.market.getSnapshot()).toEqual(fixture.snapshot);
    expect(executor.getStatus()).toMatchObject({ todaySubmittedOrders: 0, todayFilledOrders: 0 });
    expect(system.store.listAudit().filter((event) => event.action === "paper-auto-execution.run"))
      .toEqual([expect.objectContaining({ data: expect.objectContaining({ tradingDate: "2026-08-21" }) })]);
  });

  it("executes a matching-date plan with current-date idempotency and independent store time", async () => {
    const { executor, system, snapshot, notifier } = createPlanFixture(
      "2026-08-21T09:35:00+08:00",
      "2026-08-21T14:30:00+08:00",
    );

    const result = await executor.runOnce();
    const order = system.broker.getOrders()[0];

    expect(result.submittedOrders).toEqual([
      expect.objectContaining({
        status: "filled",
        clientOrderId: "kairos-auto-paper:2026-08-21:601318:paper-buy-plan:100",
      }),
    ]);
    expect(order.createdAt).toBe("2026-08-21T06:30:00.000Z");
    expect(system.market.getSnapshot().marketTime).toBe(snapshot.marketTime);
    expect(system.broker.getPositions()[0]).toMatchObject({ quantity: 100, availableQuantity: 0 });
    expect(notifier.notify).toHaveBeenCalledOnce();
    expect(notifier.notifyOrderEvents).toHaveBeenCalledOnce();
    expect(executor.getStatus()).toMatchObject({ todaySubmittedOrders: 1, todayFilledOrders: 1 });
  });
});
