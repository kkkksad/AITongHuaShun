import { describe, expect, it } from "vitest";
import { PAPER_EXECUTION_STRATEGY_CHOICES } from "../../shared/trading";
import {
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
