import { describe, expect, it } from "vitest";
import {
  getPaperStrategyProfilePolicy,
  PAPER_STRATEGY_PROFILE_POLICIES,
} from "./paperStrategyProfile";

describe("paper strategy profile policies", () => {
  it("defaults legacy accounts to balanced", () => {
    expect(getPaperStrategyProfilePolicy(undefined).key).toBe("balanced");
  });

  it("keeps the growth profile inside the configured hard policy range", () => {
    const growth = PAPER_STRATEGY_PROFILE_POLICIES.growth;

    expect(growth.cashReserveFloor).toBe(0);
    expect(growth.newPositionScale).toBeLessThanOrEqual(1);
    expect(growth.maxNewPositionsPerPlan).toBeLessThanOrEqual(3);
  });

  it("does not impose a fixed cash reserve in any profile", () => {
    for (const policy of Object.values(PAPER_STRATEGY_PROFILE_POLICIES)) {
      expect(policy.cashReserveFloor, policy.key).toBe(0);
    }
  });

  it("prevents the capital-preservation profile from opening positions", () => {
    const policy = PAPER_STRATEGY_PROFILE_POLICIES["capital-preservation"];

    expect(policy.allowNewPositions).toBe(false);
    expect(policy.maxNewPositionsPerPlan).toBe(0);
    expect(policy.newPositionScale).toBe(0);
  });
});
