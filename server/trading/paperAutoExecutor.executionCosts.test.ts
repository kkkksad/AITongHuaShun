import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { parseServerConfig } from "../config";
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

function fixture(input: {
  cash: number; price: number; count?: number; minimumCommission?: number;
  slippageBps?: number; startedAt?: string; maxOrdersPerRun?: number; maxDailyOrders?: number;
}) {
  const now = new Date(input.startedAt ?? "2026-08-21T14:30:00+08:00");
  const config = createTestConfig({
    MARKET_MODE: "paper", TRADING_STARTING_CASH: input.cash,
    TRADING_SEED_PORTFOLIO: false, MAX_ORDER_NOTIONAL: 1_000_000,
    MAX_POSITION_WEIGHT: 1, MAX_DAILY_LOSS: 1,
    MIN_COMMISSION: input.minimumCommission ?? 5, SLIPPAGE_BPS: input.slippageBps ?? 5,
    PAPER_AUTO_EXECUTION_ENABLED: true, PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO: 0,
  });
  const system = createTradingSystem(config, () => now);
  system.store.setStrategyProfile("growth");
  const snapshot: MarketSnapshot = {
    mode: "paper", sequence: 1, marketTime: now.toISOString(),
    quotes: Array.from({ length: input.count ?? 1 }, (_, index) => ({
      symbol: String(600001 + index), name: `费用边界${index + 1}`,
      tradable: true, price: input.price, previousClose: input.price,
      changePercent: 0, volume: 10_000_000, updatedAt: now.toISOString(),
    })),
  };
  vi.spyOn(system.market, "getSnapshot").mockReturnValue(snapshot);
  vi.spyOn(system.market, "getQuote").mockImplementation((symbol) =>
    snapshot.quotes.find((quote) => quote.symbol === symbol),
  );
  const provider = system.marketDataProvider;
  const reportInput = {
    bridgeUrl: config.AKSHARE_BRIDGE_URL, marketDataProvider: provider,
    mode: config.MARKET_MODE, snapshot, timeoutMs: config.MARKET_DATA_TIMEOUT_MS,
  };
  const leaderboard = buildUnavailableStrategyLeaderboard(snapshot, provider);
  const candidates = buildDailyCandidates(snapshot, provider, 40);
  const qualityStocks = buildDailyQualityStocks(snapshot, provider, 60);
  const marketRegimeResearch = buildUnavailableMarketRegimeResearch({
    ...reportInput, sectorLimit: 6, stockLimit: 6, days: 180,
  });
  const realResearchDataFeed = buildUnavailableRealResearchDataFeed(reportInput);
  const externalMarketImpact = buildUnavailableExternalMarketImpact({ ...reportInput, days: 500 });
  const adaptiveRouting = routeAdaptiveStrategies(marketRegimeResearch);
  const plan = buildPaperTradingPlan({
    snapshot, provider, account: system.broker.getAccount(snapshot),
    positions: system.broker.getPositions(snapshot), leaderboard, candidates, qualityStocks,
    initialCapital: config.TRADING_STARTING_CASH, lotSize: system.limits.lotSize,
    maxPositionWeight: system.risk.getEffectiveMaxPositionWeight(),
    maxSingleOrderNotional: system.risk.getEffectiveMaxOrderNotional(),
    commissionRate: config.COMMISSION_RATE, minimumCommission: config.MIN_COMMISSION,
    cashReserveRatio: 0, strategyProfile: "growth", executionStrategy: "auto",
  });
  // Qualified operations isolate real execution budgeting from research selection.
  plan.operations = snapshot.quotes.map((quote) => ({
    timestamp: now.toISOString(), symbol: quote.symbol, name: quote.name,
    action: "paper-buy-plan", strategy: "deterministic execution-cost fixture",
    quantity: 100, price: quote.price, estimatedNotional: quote.price * 100,
    reason: "qualified paper cost-boundary fixture",
    ruleChecks: ["paper-only", "cash-check: pass"],
  }));
  plan.qualitySummary.planQuality = "actionable";
  vi.spyOn(paperPlans, "buildCurrentPaperTradingPlan").mockResolvedValue({
    leaderboard, candidates, qualityStocks, marketRegimeResearch,
    realResearchDataFeed, externalMarketImpact, adaptiveRouting, plan,
  });
  const submitOrder = vi.spyOn(system.broker, "submitOrder");
  const executor = new PaperAutoExecutor({
    system, config, enabled: true, intervalMs: 60_000, tradeWindowOnly: true,
    maxOrdersPerRun: input.maxOrdersPerRun ?? 2, maxDailyOrders: input.maxDailyOrders ?? 4,
    targetDailyOrders: 2, clock: () => now,
  });
  return { system, config, plan, executor, submitOrder };
}

describe("PaperAutoExecutor uses the Broker's complete rounded execution budget", () => {
  it("fills a default-cost buy when the cash covers rounded commission exactly", async () => {
    const { executor, system, plan, submitOrder } = fixture({ cash: 16_685, price: 166.72 });
    const run = await executor.runOnce();
    expect(run.submittedOrders).toEqual([expect.objectContaining({
      symbol: "600001", status: "filled", quantity: 100, estimatedNotional: 16_672,
      reason: plan.operations[0].reason, ruleChecks: plan.operations[0].ruleChecks,
    })]);
    expect(run.skippedOperations).toEqual([]);
    expect(system.broker.getOrders()).toMatchObject([{ filledPrice: 166.8, commission: 5 }]);
    expect(system.broker.getAccount().cash).toBe(0);
    expect(submitOrder).toHaveBeenCalledWith({
      symbol: "600001", side: "buy", type: "market", quantity: 100,
      clientOrderId: "kairos-auto-paper:2026-08-21:600001:paper-buy-plan:100",
    }, { strategy: plan.operations[0].strategy, strategyKey: undefined });
  });

  it("deducts the same rounded cash debit cumulatively across two default-cost buys", async () => {
    const { executor, system } = fixture({ cash: 33_370, price: 166.72, count: 2 });
    const run = await executor.runOnce();
    expect(run.submittedOrders.map(({ symbol, status }) => [symbol, status]))
      .toEqual([["600001", "filled"], ["600002", "filled"]]);
    expect(run.skippedOperations).toEqual([]);
    expect(system.broker.getOrders().map((order) => order.commission)).toEqual([5, 5]);
    expect(system.broker.getAccount().cash).toBe(0);
  });

  it("skips the second buy before submission when rounded commissions leave it one cent short", async () => {
    const { executor, system, submitOrder } = fixture({ cash: 33_378.01, price: 166.76, count: 2 });
    const run = await executor.runOnce();
    expect(run.submittedOrders).toEqual([expect.objectContaining({ symbol: "600001", status: "filled" })]);
    expect(run.skippedOperations).toEqual([expect.objectContaining({
      symbol: "600002", action: "paper-buy-plan", quantity: 100, price: 166.76,
      estimatedNotional: 16_676,
      reason: "累计订单后可用资金不足，需 16689.01 元，可用于新买单 16689.00 元；未创建订单",
    })]);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(system.broker.getOrders()).toMatchObject([{ status: "filled", commission: 5.01 }]);
    expect(system.broker.getAccount().cash).toBeCloseTo(16_689, 8);
  });

  it.each([1_004.99, 1_004.9995])("skips a true cash deficit at %s before creating a rejected order", async (cash) => {
    const { executor, system, submitOrder } = fixture({ cash, price: 10, slippageBps: 0 });
    const run = await executor.runOnce();
    expect(run.submittedOrders).toEqual([]);
    expect(run.skippedOperations).toEqual([expect.objectContaining({
      symbol: "600001", reason: expect.stringContaining("累计订单后可用资金不足"),
    })]);
    expect(submitOrder).not.toHaveBeenCalled();
    expect(system.broker.getOrders()).toEqual([]);
    expect(system.broker.getAccount().cash).toBe(cash);
  });

  it("rounds a legally configured fractional minimum commission before budgeting", async () => {
    expect(parseServerConfig({ NODE_ENV: "test", AUTH_ENABLED: "false", MIN_COMMISSION: "5.004" }).MIN_COMMISSION).toBe(5.004);
    const { executor, system } = fixture({ cash: 1_005, price: 10, minimumCommission: 5.004, slippageBps: 0 });
    const run = await executor.runOnce();
    expect(run.submittedOrders).toEqual([expect.objectContaining({ status: "filled" })]);
    expect(run.skippedOperations).toEqual([]);
    expect(system.broker.getOrders()).toMatchObject([{ commission: 5 }]);
    expect(system.broker.getAccount().cash).toBe(0);
  });

  it("skips a fractional-minimum buy whose unrounded fee fits but rounded debit does not", async () => {
    const { executor, system, submitOrder } = fixture({
      cash: 1_005.0052, price: 10, minimumCommission: 5.0052, slippageBps: 0,
    });
    const run = await executor.runOnce();
    expect(run.submittedOrders).toEqual([]);
    expect(run.skippedOperations).toEqual([expect.objectContaining({
      reason: "累计订单后可用资金不足，需 1005.01 元，可用于新买单 1005.01 元；未创建订单",
    })]);
    expect(submitOrder).not.toHaveBeenCalled();
    expect(system.broker.getOrders()).toEqual([]);
    expect(system.broker.getAccount().cash).toBe(1_005.0052);
  });

  it.each([1, 2])("tolerates only binary arithmetic noise for %s exact-fit slipped buys", async (count) => {
    const { executor, system } = fixture({ cash: 1_010 * count, price: 10, slippageBps: 50, count });
    const run = await executor.runOnce();
    expect(run.submittedOrders).toHaveLength(count);
    expect(run.submittedOrders.every((order) => order.status === "filled")).toBe(true);
    expect(run.skippedOperations).toEqual([]);
    expect(system.broker.getOrders().every((order) => order.filledPrice === 10.05 && order.commission === 5)).toBe(true);
    expect(system.broker.getAccount().cash).toBe(0);
  });

  it("keeps per-run order caps ahead of the next operation's cost check", async () => {
    const { executor, submitOrder } = fixture({ cash: 33_370, price: 166.72, count: 2, maxOrdersPerRun: 1 });
    const run = await executor.runOnce();
    expect(run.submittedOrders).toHaveLength(1);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(run.skippedOperations).toEqual([expect.objectContaining({
      symbol: "600002", reason: "per-run auto paper order cap reached",
    })]);
  });

  it("keeps phase order caps ahead of cost checks while preserving the whole-portfolio policy", async () => {
    const { executor } = fixture({
      cash: 33_370, price: 166.72, count: 2, maxDailyOrders: 2,
      startedAt: "2026-08-21T09:40:00+08:00",
    });
    const run = await executor.runOnce();
    expect(run.phase).toBe("opening");
    expect(run.phaseMaxInvestedRatio).toBe(1);
    expect(run.submittedOrders).toHaveLength(1);
    expect(run.skippedOperations).toEqual([expect.objectContaining({
      symbol: "600002", reason: "开盘观察阶段自动订单额度已用完，保留额度给后续确认阶段",
    })]);
  });

  it("retains idempotency before a repeated operation's now-unaffordable cash check", async () => {
    const { executor, system, submitOrder } = fixture({ cash: 16_685, price: 166.72 });
    const first = await executor.runOnce();
    expect(first.submittedOrders[0]?.status).toBe("filled");
    const repeated = await executor.runOnce();
    expect(repeated.submittedOrders).toEqual([]);
    expect(repeated.skippedOperations).toEqual([expect.objectContaining({
      symbol: "600001", reason: "operation was already submitted for this trading date",
    })]);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(system.broker.getOrders()).toHaveLength(1);
    expect(system.broker.getAccount().cash).toBe(0);
  });
});
