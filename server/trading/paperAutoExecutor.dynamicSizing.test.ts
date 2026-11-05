import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaperStrategyProfile } from "../../shared/trading";
import type { PaperTradingPlan } from "../research/paperTradingPlan";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { PaperAutoExecutor } from "./paperAutoExecutor";

afterEach(() => vi.restoreAllMocks());

function fixture(input: {
  dynamic?: boolean;
  maxPositionWeight?: number;
  maxOrderNotional?: number;
  profile?: PaperStrategyProfile;
} = {}) {
  const now = new Date("2026-08-21T14:30:00+08:00");
  const config = createTestConfig({
    MARKET_MODE: "paper", TRADING_STARTING_CASH: 10_000,
    TRADING_SEED_PORTFOLIO: false,
    MAX_POSITION_WEIGHT: input.maxPositionWeight ?? 0.25,
    MAX_ORDER_NOTIONAL: input.maxOrderNotional ?? 4_000,
    DYNAMIC_POSITION_SCALING: input.dynamic ?? true,
  });
  const system = createTradingSystem(config, () => now);
  system.store.setStrategyProfile(input.profile ?? "growth");
  vi.spyOn(system.market, "getSnapshot").mockReturnValue({
    mode: "paper", sequence: 0, marketTime: now.toISOString(), quotes: [],
  });
  const submit = vi.spyOn(system.broker, "submitOrder");
  const notifier = {
    notify: vi.fn().mockResolvedValue({ status: "disabled" }),
    notifyOrderEvents: vi.fn().mockResolvedValue({ status: "disabled" }),
  };
  const executor = new PaperAutoExecutor({
    system, config, enabled: true, intervalMs: 60_000,
    tradeWindowOnly: true, maxOrdersPerRun: 2, maxDailyOrders: 4,
    targetDailyOrders: 2, clock: () => now, planNotifier: notifier,
  });

  function drawdown(equity = 9_600) {
    system.risk.setInitialEquity(10_000);
    system.risk.recordTradeResult(equity - 10_000, equity);
  }

  async function capturePlan() {
    const before = system.broker.getAccount();
    const riskBefore = system.risk.getState();
    const previousNotifications = notifier.notify.mock.calls.length;
    const run = await executor.runOnce();
    expect(notifier.notify).toHaveBeenCalledTimes(previousNotifications + 1);
    const plan = notifier.notify.mock.calls[previousNotifications][0] as PaperTradingPlan;
    expect(run.planQuality).toBe("watch-only");
    expect(run.submittedOrders).toEqual([]);
    expect(run.skippedOperations).toEqual([expect.objectContaining({
      symbol: "CASH", action: "observe", reason: expect.stringContaining("没有可交易行情"),
    })]);
    expect(plan.operations).toEqual([]);
    expect(plan.capitalPlan.cashReserveRatio).toBe(0);
    expect(plan.capitalPlan.cashReserveAmount).toBe(0);
    expect(plan.capitalPlan.sizingDiagnostics).toMatchObject({
      plannedBuyOrderCount: 0, plannedBuyNotional: 0,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(notifier.notifyOrderEvents).not.toHaveBeenCalled();
    expect(system.broker.getOrders()).toEqual([]);
    expect(system.broker.getPositions()).toEqual([]);
    expect(system.broker.getAccount()).toEqual(before);
    expect(system.risk.getState()).toEqual(riskBefore);
    return plan;
  }
  return { system, drawdown, capturePlan };
}

function expectSizing(plan: PaperTradingPlan, input: {
  weight: number; orderCap: number; positionCap: number; effective: number;
  constraint: string; scale?: number;
}) {
  expect(plan.capitalPlan.maxPositionWeight).toBeCloseTo(input.weight, 10);
  expect(plan.capitalPlan.maxSingleOrderNotional).toBe(input.effective);
  expect(plan.capitalPlan.sizingDiagnostics!.riskOrderCapBeforeScale).toBeCloseTo(input.orderCap, 8);
  expect(plan.capitalPlan.sizingDiagnostics).toMatchObject({
    profileNewPositionScale: input.scale ?? 1,
    positionWeightCapAfterScale: input.positionCap,
    effectiveOrderCap: input.effective,
    limitingConstraint: input.constraint,
  });
}

describe("unavailable-market plans use the current effective risk limits", () => {
  it.each([false, true])("keeps original limits before a drawdown with dynamic scaling %s", async (dynamic) => {
    const { capturePlan } = fixture({ dynamic });
    expectSizing(await capturePlan(), {
      weight: 0.25, orderCap: 4_000, positionCap: 2_500,
      effective: 2_500, constraint: "position-weight-cap",
    });
  });

  it("keeps configured limits during a drawdown when dynamic scaling is disabled", async () => {
    const { drawdown, capturePlan } = fixture({ dynamic: false });
    drawdown();
    expectSizing(await capturePlan(), {
      weight: 0.25, orderCap: 4_000, positionCap: 2_500,
      effective: 2_500, constraint: "position-weight-cap",
    });
  });

  it.each([
    { maxPositionWeight: 0.25, maxOrderNotional: 4_000, weight: 0.15625, orderCap: 2_500,
      positionCap: 1_562.5, effective: 1_562.5, constraint: "position-weight-cap" },
    { maxPositionWeight: 0.5, maxOrderNotional: 1_200, weight: 0.3125, orderCap: 750,
      positionCap: 3_125, effective: 750, constraint: "risk-order-cap" },
  ])("shows independently binding $constraint after a real risk-state drawdown", async (input) => {
    const { system, drawdown, capturePlan } = fixture(input);
    drawdown();
    expect(system.risk.getEffectiveMaxPositionWeight()).toBeCloseTo(input.weight, 10);
    expect(system.risk.getEffectiveMaxOrderNotional()).toBeCloseTo(input.orderCap, 8);
    expectSizing(await capturePlan(), input);
  });

  it.each([
    { profile: "balanced", scale: 0.85, positionCap: 2_656.25, effective: 2_125 },
    { profile: "defensive", scale: 0.55, positionCap: 1_718.75, effective: 1_375 },
  ] as const)("applies the existing $profile scale to the reduced risk limits", async (input) => {
    const { drawdown, capturePlan } = fixture({ profile: input.profile, maxPositionWeight: 0.5 });
    drawdown();
    const plan = await capturePlan();
    expectSizing(plan, { ...input, weight: 0.3125, orderCap: 2_500, constraint: "strategy-profile-scale" });
    expect(plan.capitalPlan.sizingDiagnostics!.riskOrderCapAfterScale).toBe(input.effective);
  });

  it("shows the dynamic reduction floor without changing the tripped risk state", async () => {
    const { system, drawdown, capturePlan } = fixture();
    drawdown(9_000);
    expect(system.risk.getState().circuitState).toBe("tripped");
    expectSizing(await capturePlan(), {
      weight: 0.0625, orderCap: 1_000, positionCap: 625,
      effective: 625, constraint: "position-weight-cap",
    });
  });

  it.each(["equity-recovery", "risk-reset"] as const)("refreshes the same executor's limits after %s", async (recovery) => {
    const { system, drawdown, capturePlan } = fixture();
    drawdown();
    const reduced = await capturePlan();
    if (recovery === "equity-recovery") system.risk.recordTradeResult(400, 10_000);
    else system.risk.resetCircuit();
    const restored = await capturePlan();
    expectSizing(reduced, {
      weight: 0.15625, orderCap: 2_500, positionCap: 1_562.5,
      effective: 1_562.5, constraint: "position-weight-cap",
    });
    expectSizing(restored, {
      weight: 0.25, orderCap: 4_000, positionCap: 2_500,
      effective: 2_500, constraint: "position-weight-cap",
    });
  });
});
