import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
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
import { PaperBroker } from "../broker/paperBroker";

afterEach(() => vi.restoreAllMocks());

function createExecutionFixture(input: {
  startedAt: string;
  researchFinishedAt?: string;
  notificationFinishedAt?: string;
  afterFirstOrderAt?: string;
  tradeWindowOnly?: boolean;
  operationCount?: number;
  quoteGuard?: boolean;
  maxOrdersPerRun?: number;
  maxDailyOrders?: number;
}) {
  let now = new Date(input.startedAt);
  const config = createTestConfig({
    MARKET_MODE: "paper",
    TRADING_STARTING_CASH: 10_000,
    TRADING_SEED_PORTFOLIO: false,
    MAX_ORDER_NOTIONAL: 10_000,
    MAX_POSITION_WEIGHT: 1,
    PAPER_AUTO_EXECUTION_ENABLED: true,
  });
  const system = createTradingSystem(config, () => now);
  if (input.quoteGuard) {
    system.broker = new PaperBroker(system.market, system.store, system.risk, {
      mode: config.MARKET_MODE, commissionRate: config.COMMISSION_RATE,
      minimumCommission: config.MIN_COMMISSION, slippageBps: config.SLIPPAGE_BPS,
      limits: system.limits, quoteMaxAgeMs: 120_000, clock: () => now,
    });
  }
  system.store.setStrategyProfile("growth");
  const snapshot: MarketSnapshot = {
    mode: "paper",
    sequence: 1,
    marketTime: now.toISOString(),
    quotes: ["600001", "600002"].map((symbol) => ({
      symbol,
      name: symbol,
      tradable: true,
      price: 10,
      previousClose: 10,
      changePercent: 0,
      volume: 10_000_000,
      updatedAt: now.toISOString(),
    })),
  };
  vi.spyOn(system.market, "getSnapshot").mockReturnValue(snapshot);
  vi.spyOn(system.market, "getQuote").mockImplementation((symbol) =>
    snapshot.quotes.find((quote) => quote.symbol === symbol),
  );
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
  // Eligible operations isolate execution timing from candidate selection.
  plan.operations = snapshot.quotes.slice(0, input.operationCount ?? 1).map((quote) => ({
    timestamp: input.startedAt,
    symbol: quote.symbol,
    name: quote.name,
    action: "paper-buy-plan",
    strategy: "deterministic execution-time fixture",
    quantity: 100,
    price: quote.price,
    estimatedNotional: quote.price * 100,
    reason: "qualified paper fixture",
    ruleChecks: ["paper-only", "cash-check: pass"],
  }));
  plan.qualitySummary.planQuality = "actionable";
  const orderReads = vi.spyOn(system.store, "listOrders");
  vi.spyOn(paperPlans, "buildCurrentPaperTradingPlan").mockImplementation(async () => {
    if (input.researchFinishedAt) now = new Date(input.researchFinishedAt);
    orderReads.mockClear();
    return {
      plan,
      leaderboard,
      candidates,
      qualityStocks,
      marketRegimeResearch,
      realResearchDataFeed,
      externalMarketImpact,
      adaptiveRouting,
    };
  });
  const notifier = {
    notify: vi.fn().mockImplementation(async () => {
      if (input.notificationFinishedAt) now = new Date(input.notificationFinishedAt);
      return { status: "disabled" as const };
    }),
    notifyOrderEvents: vi.fn().mockResolvedValue({ status: "disabled" }),
  };
  const submitOrder = vi.spyOn(system.broker, "submitOrder");
  const findByClientOrderId = vi.spyOn(system.store, "findByClientOrderId");
  let submittedCount = 0;
  const executor = new PaperAutoExecutor({
    system,
    config,
    enabled: true,
    intervalMs: 60_000,
    tradeWindowOnly: input.tradeWindowOnly ?? true,
    maxOrdersPerRun: input.maxOrdersPerRun ?? 2,
    maxDailyOrders: input.maxDailyOrders ?? 4,
    targetDailyOrders: Math.min(2, input.maxDailyOrders ?? 4),
    clock: () => now,
    planNotifier: notifier,
    onOrder: () => {
      submittedCount += 1;
      if (submittedCount === 1 && input.afterFirstOrderAt) {
        now = new Date(input.afterFirstOrderAt);
      }
    },
  });
  return { executor, system, plan, notifier, submitOrder, orderReads, findByClientOrderId, marketRegimeResearch, snapshot };
}

describe("automatic execution quote freshness before creating orders", () => {
  const startedAt = "2026-08-21T14:00:00+08:00";
  const oldTime = "2026-08-21T13:57:59+08:00";

  it("creates no rejected record when every trading quote is stale", async () => {
    const fixture = createExecutionFixture({ startedAt, quoteGuard: true });
    fixture.snapshot.quotes.forEach((quote) => { quote.updatedAt = oldTime; });
    const run = await fixture.executor.runOnce();
    expect(fixture.submitOrder).not.toHaveBeenCalled();
    expect(fixture.system.broker.getOrders()).toHaveLength(0);
    expect(fixture.system.broker.getAccount().cash).toBe(10_000);
    expect(run.skippedOperations.some((operation) => operation.reason.includes("陈旧"))).toBe(true);
  });

  it("does not spend the only run slot on an old quote while a fresh candidate can trade", async () => {
    const fixture = createExecutionFixture({ startedAt, quoteGuard: true, operationCount: 2, maxOrdersPerRun: 1 });
    fixture.snapshot.quotes[0].updatedAt = oldTime;
    const run = await fixture.executor.runOnce();
    expect(run.submittedOrders).toEqual([expect.objectContaining({ symbol: "600002", status: "filled" })]);
    expect(fixture.submitOrder).toHaveBeenCalledOnce();
    expect(fixture.notifier.notify.mock.calls[0][1].executableOperations.map((operation: { symbol: string }) => operation.symbol)).toEqual(["600002"]);
    expect(run.skippedOperations).toContainEqual(expect.objectContaining({ symbol: "600001", reason: expect.stringContaining("陈旧") }));
  });

  it.each(["", "invalid-time", "2026-08-21T14:00:06+08:00"])("skips invalid or future source time '%s' per symbol", async (timestamp) => {
    const fixture = createExecutionFixture({ startedAt, quoteGuard: true, operationCount: 2, maxOrdersPerRun: 1 });
    fixture.snapshot.quotes[0].updatedAt = timestamp;
    const run = await fixture.executor.runOnce();
    expect(run.submittedOrders).toEqual([expect.objectContaining({ symbol: "600002", status: "filled" })]);
    expect(fixture.system.broker.getOrders()).toHaveLength(1);
  });

  it("skips an explicitly non-tradable quote without blocking another symbol", async () => {
    const fixture = createExecutionFixture({ startedAt, quoteGuard: true, operationCount: 2, maxOrdersPerRun: 1 });
    fixture.snapshot.quotes[0].tradable = false;
    const run = await fixture.executor.runOnce();
    expect(run.submittedOrders).toEqual([expect.objectContaining({ symbol: "600002", status: "filled" })]);
    expect(fixture.system.broker.getOrders()).toHaveLength(1);
  });

  it("keeps the exact 120 second boundary executable", async () => {
    const fixture = createExecutionFixture({ startedAt, quoteGuard: true });
    fixture.snapshot.quotes[0].updatedAt = "2026-08-21T13:58:00+08:00";
    const run = await fixture.executor.runOnce();
    expect(run.submittedOrders).toEqual([expect.objectContaining({ status: "filled" })]);
  });

  it.each(["researchFinishedAt", "notificationFinishedAt"] as const)("rechecks age after %s without creating a rejected order", async (stage) => {
    const fixture = createExecutionFixture({ startedAt, quoteGuard: true, [stage]: "2026-08-21T14:02:01+08:00" });
    const run = await fixture.executor.runOnce();
    expect(fixture.submitOrder).not.toHaveBeenCalled();
    expect(fixture.system.broker.getOrders()).toHaveLength(0);
    expect(run.skippedOperations.some((operation) => operation.reason.includes("陈旧"))).toBe(true);
  });

  it("preserves the first actual fill and skips a quote that expires before the second submission", async () => {
    const fixture = createExecutionFixture({ startedAt, quoteGuard: true, operationCount: 2,
      afterFirstOrderAt: "2026-08-21T14:02:01+08:00" });
    const run = await fixture.executor.runOnce();
    expect(fixture.submitOrder).toHaveBeenCalledOnce();
    expect(run.submittedOrders).toEqual([expect.objectContaining({ symbol: "600001", status: "filled" })]);
    expect(fixture.system.broker.getOrders()).toHaveLength(1);
    expect(run.skippedOperations).toContainEqual(expect.objectContaining({ symbol: "600002", reason: expect.stringContaining("陈旧") }));
  });

  it("can execute the same intention after quote recovery without stale rejections using the daily cap", async () => {
    const fixture = createExecutionFixture({ startedAt, quoteGuard: true, maxDailyOrders: 1 });
    fixture.snapshot.quotes.forEach((quote) => { quote.updatedAt = oldTime; });
    const first = await fixture.executor.runOnce();
    expect(first.submittedOrders).toHaveLength(0);
    fixture.snapshot.quotes.forEach((quote) => { quote.updatedAt = new Date(startedAt).toISOString(); });
    const second = await fixture.executor.runOnce();
    expect(second.submittedOrders).toEqual([expect.objectContaining({ status: "filled" })]);
    expect(fixture.system.broker.getOrders()).toHaveLength(1);
  });

  it("keeps unguarded mock and historical timestamps compatible", async () => {
    const fixture = createExecutionFixture({ startedAt });
    fixture.snapshot.quotes.forEach((quote) => { quote.updatedAt = "2000-01-01T00:00:00Z"; });
    const run = await fixture.executor.runOnce();
    expect(run.submittedOrders).toEqual([expect.objectContaining({ status: "filled" })]);
  });
});

describe("paper execution checks the actual submission time", () => {
  it("persists bounded historical evidence with a zero-order run", async () => {
    const fixture = createExecutionFixture({
      startedAt: "2026-08-21T09:35:00+08:00", operationCount: 0,
    });
    fixture.marketRegimeResearch.sourceStatus = "degraded";
    fixture.marketRegimeResearch.warnings = [
      "stock_zh_a_hist_tx() got an unexpected keyword argument 'timeout' https://x.test/?token=secret",
    ];
    const run = await fixture.executor.runOnce();
    const diagnostic = {
      sectorCount: 0, stockCount: 0, usableStockCount: 0,
      issues: ["provider-contract", "sector-history-insufficient", "stock-history-insufficient"],
    };
    expect(run.researchContext?.researchDiagnostics).toEqual(diagnostic);
    const audit = fixture.system.store.listAudit(20).find((event) => event.action === "paper-auto-execution.run");
    expect(audit?.data?.researchDiagnostics).toEqual(diagnostic);
    expect(JSON.stringify(audit?.data?.researchDiagnostics)).not.toContain("secret");
    expect(run.submittedOrders).toEqual([]);
    expect(fixture.submitOrder).not.toHaveBeenCalled();
    expect(fixture.system.broker.getAccount().cash).toBe(10_000);
  });

  it.each([
    ["lunch break", "2026-08-21T11:29:59+08:00", "2026-08-21T11:31:01+08:00", "lunch-break"],
    ["market close", "2026-08-21T14:59:59+08:00", "2026-08-21T15:01:01+08:00", "after-hours"],
  ])("stops before quotas or notification when research crosses %s", async (_, startedAt, researchFinishedAt, session) => {
    const fixture = createExecutionFixture({ startedAt, researchFinishedAt });

    const run = await fixture.executor.runOnce();

    expect(run.submittedOrders).toEqual([]);
    expect(run.planQuality).toBe("watch-only");
    expect(run.skippedOperations).toEqual([expect.objectContaining({
      action: "observe",
      reason: expect.stringContaining(session),
    })]);
    expect(fixture.orderReads).not.toHaveBeenCalled();
    expect(fixture.findByClientOrderId).not.toHaveBeenCalled();
    expect(fixture.notifier.notify).not.toHaveBeenCalled();
    expect(fixture.submitOrder).not.toHaveBeenCalled();
    expect(run.startedAt).toBe(new Date(startedAt).toISOString());
    expect(run.finishedAt).toBe(new Date(researchFinishedAt).toISOString());
  });

  it.each([true, false])("does not reuse a plan after research crosses a trading date (window restriction %s)", async (tradeWindowOnly) => {
    const fixture = createExecutionFixture({
      startedAt: "2026-08-21T14:59:59+08:00",
      researchFinishedAt: "2026-08-24T09:35:00+08:00",
      tradeWindowOnly,
    });

    const run = await fixture.executor.runOnce();

    expect(run.tradingDate).toBe("2026-08-21");
    expect(run.submittedOrders).toEqual([]);
    expect(run.skippedOperations[0].reason).toContain("2026-08-24");
    expect(run.skippedOperations[0].reason).toContain("2026-08-21");
    expect(fixture.orderReads).not.toHaveBeenCalled();
    expect(fixture.findByClientOrderId).not.toHaveBeenCalled();
    expect(fixture.notifier.notify).not.toHaveBeenCalled();
    expect(fixture.submitOrder).not.toHaveBeenCalled();
  });

  it("stops before submission when notification crosses market close", async () => {
    const fixture = createExecutionFixture({
      startedAt: "2026-08-21T14:59:59+08:00",
      notificationFinishedAt: "2026-08-21T15:01:01+08:00",
    });

    const run = await fixture.executor.runOnce();

    expect(fixture.notifier.notify).toHaveBeenCalledOnce();
    expect(fixture.notifier.notifyOrderEvents).not.toHaveBeenCalled();
    expect(fixture.submitOrder).not.toHaveBeenCalled();
    expect(run.submittedOrders).toEqual([]);
    expect(run.planQuality).toBe("watch-only");
    expect(run.skippedOperations[0].reason).toContain("after-hours");
    expect(fixture.system.broker.getAccount().cash).toBe(10_000);
  });

  it("does not reuse a plan when notification crosses to the next trading date", async () => {
    const fixture = createExecutionFixture({
      startedAt: "2026-08-21T14:30:00+08:00",
      notificationFinishedAt: "2026-08-24T09:35:00+08:00",
      tradeWindowOnly: false,
    });

    const run = await fixture.executor.runOnce();

    expect(fixture.notifier.notify).toHaveBeenCalledOnce();
    expect(fixture.submitOrder).not.toHaveBeenCalled();
    expect(run.submittedOrders).toEqual([]);
    expect(run.skippedOperations[0].reason).toContain("2026-08-24");
  });

  it("checks every order and preserves the first fill when the second crosses close", async () => {
    const fixture = createExecutionFixture({
      startedAt: "2026-08-21T14:59:59+08:00",
      afterFirstOrderAt: "2026-08-21T15:01:01+08:00",
      operationCount: 2,
    });

    const run = await fixture.executor.runOnce();

    expect(fixture.submitOrder).toHaveBeenCalledOnce();
    expect(run.planQuality).toBe("watch-only");
    expect(run.submittedOrders).toEqual([expect.objectContaining({ symbol: "600001", status: "filled" })]);
    expect(run.skippedOperations[0].reason).toContain("after-hours");
    expect(fixture.system.broker.getOrders()).toHaveLength(1);
    expect(fixture.system.broker.getAccount().cash).toBe(8_995);
    expect(fixture.notifier.notifyOrderEvents).toHaveBeenCalledOnce();
  });

  it("stops the second order when its submission date changes even without a window restriction", async () => {
    const fixture = createExecutionFixture({
      startedAt: "2026-08-21T14:30:00+08:00",
      afterFirstOrderAt: "2026-08-24T09:35:00+08:00",
      operationCount: 2,
      tradeWindowOnly: false,
    });

    const run = await fixture.executor.runOnce();

    expect(fixture.submitOrder).toHaveBeenCalledOnce();
    expect(run.submittedOrders).toHaveLength(1);
    expect(run.skippedOperations[0].reason).toContain("2026-08-24");
    expect(fixture.system.broker.getOrders()[0].clientOrderId).toContain("2026-08-21");
  });

  it("uses the phase when research finishes and executes matching-date operations", async () => {
    const fixture = createExecutionFixture({
      startedAt: "2026-08-21T09:35:00+08:00",
      researchFinishedAt: "2026-08-21T14:00:00+08:00",
      operationCount: 2,
    });

    const run = await fixture.executor.runOnce();

    expect(run.phase).toBe("afternoon-confirmation");
    expect(run.submittedOrders).toHaveLength(2);
    expect(run.submittedOrders.every((order) => order.status === "filled")).toBe(true);
    expect(fixture.system.broker.getOrders().map((order) => order.createdAt))
      .toEqual(["2026-08-21T06:00:00.000Z", "2026-08-21T06:00:00.000Z"]);
    expect(run.skippedOperations).toEqual([]);
  });

  it.each([
    ["2026-08-21T14:59:59+08:00", "2026-08-21T15:01:01+08:00"],
    ["2026-08-21T12:00:00+08:00", "2026-08-21T12:01:00+08:00"],
  ])("preserves explicit unrestricted same-date operation from %s", async (startedAt, researchFinishedAt) => {
    const fixture = createExecutionFixture({ startedAt, researchFinishedAt, tradeWindowOnly: false });

    const run = await fixture.executor.runOnce();

    expect(run.submittedOrders).toEqual([expect.objectContaining({ status: "filled" })]);
    expect(run.skippedOperations).toEqual([]);
  });
});
