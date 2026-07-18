import { describe, expect, it } from "vitest";
import type { StrategyParameters } from "../types";
import { getStrategyWorkflowState, strategyParametersEqual } from "./strategyWorkflow";

const committedParameters: StrategyParameters = {
  lookback: 20,
  entryThreshold: 1.4,
  stopLoss: 6,
  takeProfit: 15,
  maxPosition: 35,
  rebalanceDays: 5,
};

describe("策略实验室阶段状态", () => {
  it("运行前不产生可用回测结果", () => {
    expect(getStrategyWorkflowState({
      hasRun: false,
      selectedStrategy: "momentum",
      committedStrategy: "momentum",
      parameters: committedParameters,
      committedParameters,
    })).toEqual({ hasPendingChanges: false, backtestReady: false });
  });

  it("运行后参数或策略变化会把结果标记为过期", () => {
    expect(getStrategyWorkflowState({
      hasRun: true,
      selectedStrategy: "mean-reversion",
      committedStrategy: "momentum",
      parameters: { ...committedParameters, stopLoss: 7 },
      committedParameters,
    })).toEqual({ hasPendingChanges: true, backtestReady: true });
  });

  it("恢复到已提交配置后结果保持最新", () => {
    const sameParameters = { ...committedParameters };
    expect(strategyParametersEqual(sameParameters, committedParameters)).toBe(true);
    expect(getStrategyWorkflowState({
      hasRun: true,
      selectedStrategy: "momentum",
      committedStrategy: "momentum",
      parameters: sameParameters,
      committedParameters,
    })).toEqual({ hasPendingChanges: false, backtestReady: true });
  });
});
