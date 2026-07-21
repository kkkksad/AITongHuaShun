import { describe, expect, it } from "vitest";
import { canResetPaperAccount, strategyProfileOptions } from "./Settings";

describe("Settings account controls", () => {
  it("exposes four bounded strategy profiles", () => {
    expect(strategyProfileOptions.map((profile) => profile.key)).toEqual([
      "capital-preservation",
      "defensive",
      "balanced",
      "growth",
    ]);
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
