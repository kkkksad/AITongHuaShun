import type { StrategyId, StrategyParameters } from "../types";

export type StrategyWorkflowStage = "configure" | "backtest" | "validate" | "observe";

export function strategyParametersEqual(
  left: StrategyParameters,
  right: StrategyParameters,
): boolean {
  return left.lookback === right.lookback &&
    left.entryThreshold === right.entryThreshold &&
    left.stopLoss === right.stopLoss &&
    left.takeProfit === right.takeProfit &&
    left.maxPosition === right.maxPosition &&
    left.rebalanceDays === right.rebalanceDays;
}

export function getStrategyWorkflowState(input: {
  hasRun: boolean;
  selectedStrategy: StrategyId;
  committedStrategy: StrategyId;
  parameters: StrategyParameters;
  committedParameters: StrategyParameters;
}): { hasPendingChanges: boolean; backtestReady: boolean } {
  const hasPendingChanges = input.hasRun && (
    input.selectedStrategy !== input.committedStrategy ||
    !strategyParametersEqual(input.parameters, input.committedParameters)
  );

  return { hasPendingChanges, backtestReady: input.hasRun };
}
