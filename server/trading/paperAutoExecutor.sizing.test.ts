import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaperStrategyProfile } from "../../shared/trading";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { PaperAutoExecutor } from "./paperAutoExecutor";

afterEach(() => vi.restoreAllMocks());

describe("unavailable-market plan sizing diagnostics", () => {
  it.each([
    { profile: "growth", cap: 4_000, weight: 0.5, reserve: 0, effective: 4_000, constraint: "risk-order-cap", label: "服务端单笔风控上限", scale: 1 },
    { profile: "defensive", cap: 4_000, weight: 0.5, reserve: 0, effective: 2_200, constraint: "strategy-profile-scale", label: "策略档位缩放", scale: 0.55 },
    { profile: "growth", cap: 4_000, weight: 0.1, reserve: 0, effective: 1_000, constraint: "position-weight-cap", label: "单票仓位权重", scale: 1 },
    { profile: "growth", cap: 4_000, weight: 0.5, reserve: 0.9, effective: 1_000, constraint: "planned-cash-budget", label: "可用于本轮买单的实际现金", scale: 1 },
    { profile: "capital-preservation", cap: 4_000, weight: 0.5, reserve: 0, effective: 0, constraint: "strategy-profile-scale", label: "策略档位停止新增仓位", scale: 0 },
    { profile: "growth", cap: 4_000, weight: 0.5, reserve: 1, effective: 0, constraint: "planned-cash-budget", label: "可用于本轮买单的实际现金", scale: 1 },
    { profile: "growth", cap: 0, weight: 0.5, reserve: 0, effective: 0, constraint: "risk-order-cap", label: "服务端单笔风控上限", scale: 1 },
    { profile: "growth", cap: 4_000, weight: 0, reserve: 0, effective: 0, constraint: "position-weight-cap", label: "单票仓位权重", scale: 1 },
  ])("attributes $profile / $constraint without generating orders", async (input) => {
    const now = new Date("2026-08-21T10:00:00+08:00");
    const config = createTestConfig({
      MARKET_MODE: "paper", TRADING_STARTING_CASH: 10_000,
      TRADING_SEED_PORTFOLIO: false, MAX_ORDER_NOTIONAL: input.cap,
      MAX_POSITION_WEIGHT: input.weight,
      PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO: input.reserve,
    });
    const system = createTradingSystem(config, () => now);
    system.store.setStrategyProfile(input.profile as PaperStrategyProfile);
    vi.spyOn(system.market, "getSnapshot").mockReturnValue({
      mode: "paper", sequence: 0, marketTime: now.toISOString(), quotes: [],
    });
    const submit = vi.spyOn(system.broker, "submitOrder");
    const before = system.broker.getAccount();
    const notifier = {
      notify: vi.fn().mockResolvedValue({ status: "disabled" }),
      notifyOrderEvents: vi.fn().mockResolvedValue({ status: "disabled" }),
    };
    const executor = new PaperAutoExecutor({
      system, config, enabled: true, intervalMs: 60_000,
      tradeWindowOnly: true, maxOrdersPerRun: 2, maxDailyOrders: 4,
      targetDailyOrders: 2, clock: () => now, planNotifier: notifier,
    });

    const run = await executor.runOnce();
    const plan = notifier.notify.mock.calls[0][0];

    expect(plan.capitalPlan.sizingDiagnostics).toMatchObject({
      profileNewPositionScale: input.scale,
      effectiveOrderCap: input.effective,
      limitingConstraint: input.constraint,
      limitingConstraintLabel: input.label,
      plannedBuyOrderCount: 0, plannedBuyNotional: 0,
    });
    expect(run.submittedOrders).toEqual([]);
    expect(run.planQuality).toBe("watch-only");
    expect(submit).not.toHaveBeenCalled();
    expect(system.broker.getAccount()).toEqual(before);
  });
});
