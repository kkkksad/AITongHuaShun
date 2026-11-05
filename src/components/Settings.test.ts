import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PAPER_EXECUTION_STRATEGY_CHOICES } from "../../shared/trading";
import type { TradingBackend } from "../hooks/useTradingBackend";
import {
  Settings,
  canResetPaperAccount,
  groupExecutionStrategies,
  strategyProfileOptions,
} from "./Settings";

describe("Settings account controls", () => {
  it("exposes four bounded strategy profiles", () => {
    expect(strategyProfileOptions.map((profile) => profile.key)).toEqual([
      "capital-preservation",
      "defensive",
      "balanced",
      "growth",
    ]);
  });

  it("shows fee and risk constraints without a fixed profile cash reserve", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["paper-trading-plan"], {
      capitalPlan: {
        sizingDiagnostics: {
          effectiveOrderCap: 5_000,
          minimumFeeEfficientNotional: 1_000,
          plannedBuyOrderCount: 1,
          averagePlannedBuyNotional: 4_900,
          largestPlannedBuyNotional: 4_900,
          limitingConstraint: "risk-order-cap",
          plannedCashBudget: 10_000,
          cashReserveAmount: 0,
          summary: "必要费用在提交前复核。",
        },
      },
    });
    const trading: TradingBackend = {
      connectionState: "connected",
      realtimeState: "connected",
      mode: "paper",
      marketDataProvider: "mock",
      positions: [],
      orders: [],
      pendingAction: false,
      refresh: async () => undefined,
      submitOrder: async () => { throw new Error("unexpected submit"); },
      cancelOrder: async () => { throw new Error("unexpected cancel"); },
      setPaused: async () => undefined,
      resetAccount: async () => undefined,
      setStrategyProfile: async () => undefined,
      setExecutionStrategy: async () => undefined,
    };
    const html = renderToStaticMarkup(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Settings, { trading }),
    ));

    expect(html).toContain("默认不按固定比例预留现金");
    expect(html).toContain("必要手续费和滑点");
    expect(html).toContain("阶段订单笔数限制");
    expect(html).toContain("单笔/单股硬限额");
    expect(html).not.toContain("阶段仓位上限");
    expect(html).toContain("固定现金预留");
    expect(html).toContain("¥0");
    expect(html).toContain("¥10,000");
    expect(html).toContain("单笔风控上限");
    expect(html).not.toMatch(/至少 (20|50|55|80)% 现金/);
    queryClient.clear();
  });

  it("exposes seventeen manual paper strategies before the auto fallback", () => {
    expect(PAPER_EXECUTION_STRATEGY_CHOICES).toHaveLength(18);
    expect(PAPER_EXECUTION_STRATEGY_CHOICES[0].key).not.toBe("auto");
    expect(PAPER_EXECUTION_STRATEGY_CHOICES.at(-1)?.key).toBe("auto");
    expect(PAPER_EXECUTION_STRATEGY_CHOICES.map((option) => option.key))
      .not.toContain("kairosCapitalShield");
    expect(PAPER_EXECUTION_STRATEGY_CHOICES.map((option) => option.key))
      .not.toContain("kairosRiskOffRecovery");
    expect(PAPER_EXECUTION_STRATEGY_CHOICES.map((option) => option.key))
      .toEqual(expect.arrayContaining([
        "kairosQualityLowVolTrend",
        "kairosVolatilityContractionBreakout",
        "kairosVolumePriceBreakout",
      ]));
  });

  it("groups fixed strategies before the non-recommended auto fallback", () => {
    const groups = groupExecutionStrategies();
    expect(groups.map((group) => group.key)).toEqual([
      "trend",
      "breakout",
      "pullback",
      "range",
      "validation",
      "auto",
    ]);
    expect(groups.at(-1)?.options.map((option) => option.key)).toEqual(["auto"]);
    expect(groups.flatMap((group) => group.options)).toHaveLength(18);
  });

  it("requires paper mode, the confirmation phrase and acknowledgement", () => {
    expect(canResetPaperAccount({
      startingCash: 10_000,
      confirmation: "重置模拟账户",
      acknowledged: true,
      mode: "paper",
      pending: false,
    })).toBe(true);

    expect(canResetPaperAccount({
      startingCash: 10_000,
      confirmation: "确认",
      acknowledged: true,
      mode: "paper",
      pending: false,
    })).toBe(false);

    expect(canResetPaperAccount({
      startingCash: 10_000,
      confirmation: "重置模拟账户",
      acknowledged: true,
      mode: "mock",
      pending: false,
    })).toBe(false);
  });

  it("rejects starting cash outside the server contract", () => {
    expect(canResetPaperAccount({
      startingCash: 999,
      confirmation: "重置模拟账户",
      acknowledged: true,
      mode: "paper",
      pending: false,
    })).toBe(false);
    expect(canResetPaperAccount({
      startingCash: 100_000_001,
      confirmation: "重置模拟账户",
      acknowledged: true,
      mode: "paper",
      pending: false,
    })).toBe(false);
  });
});
