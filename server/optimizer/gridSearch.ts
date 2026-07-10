/**
 * 网格搜索优化器 —— 对离散参数空间进行穷举搜索。
 */

import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "../backtest/backtestEngine";
import type {
  GridSearchConfig,
  OptimizationReport,
  OptimizationTrial,
  ParameterRange,
  StrategyFactory,
} from "./types";
import { computeScore } from "./scoreUtils";

function enumerateValues(range: ParameterRange): number[] {
  const step = range.step ?? 1;
  // Use Math.round to handle floating point in (max-min)/step
  const count = Math.round((range.max - range.min) / step) + 1;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = range.min + i * step;
    if (range.type === "int") {
      values.push(Math.round(v));
    } else {
      values.push(Number(v.toFixed(6)));
    }
  }
  return values.filter((v) => v >= range.min - 1e-9 && v <= range.max + 1e-9);
}

function cartesianProduct(ranges: ParameterRange[]): Record<string, number>[] {
  const valueSets = ranges.map((r) => enumerateValues(r));
  const names = ranges.map((r) => r.name);
  if (valueSets.length === 0) return [{}];
  let combinations: Record<string, number>[] = [{}];
  for (let i = 0; i < valueSets.length; i++) {
    const name = names[i];
    const values = valueSets[i];
    const next: Record<string, number>[] = [];
    for (const combo of combinations) {
      for (const value of values) {
        next.push({ ...combo, [name]: value });
      }
    }
    combinations = next;
  }
  return combinations;
}

export async function gridSearch(
  snapshots: MarketSnapshot[],
  factory: StrategyFactory,
  config: GridSearchConfig & {
    backtest?: {
      initialCapital?: number;
      commissionRate?: number;
      minimumCommission?: number;
      slippageBps?: number;
      maxOrderNotional?: number;
      maxPositionWeight?: number;
    };
  },
): Promise<OptimizationReport> {
  const startTime = Date.now();
  const combinations = cartesianProduct(factory.parameters);

  if (combinations.length === 0) {
    throw new Error("参数空间为空");
  }

  const trials: OptimizationTrial[] = [];
  let trialId = 0;

  for (const params of combinations) {
    const trialStart = Date.now();
    trialId++;

    try {
      const strategy = await factory.create(params);
      const engine = new BacktestEngine(snapshots, strategy, {
        initialCapital: config.backtest?.initialCapital ?? 1_000_000,
        commissionRate: config.backtest?.commissionRate ?? 0.0003,
        minimumCommission: config.backtest?.minimumCommission ?? 5,
        slippageBps: config.backtest?.slippageBps ?? 5,
        maxOrderNotional: config.backtest?.maxOrderNotional ?? 100_000,
        maxPositionWeight: config.backtest?.maxPositionWeight ?? 0.25,
      });

      const report = engine.run();
      const score = computeScore(report.metrics, config.objectives);
      const executionTimeMs = Date.now() - trialStart;

      trials.push({
        id: trialId,
        params: { ...params },
        metrics: report.metrics,
        score,
        executionTimeMs,
      });
    } catch (err) {
      console.warn(
        `[GridSearch] params ${JSON.stringify(params)} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  trials.sort((a, b) => b.score - a.score);

  if (trials.length === 0) {
    throw new Error("所有参数组合均失败");
  }

  return {
    strategyName: factory.name,
    method: "grid",
    parameters: factory.parameters,
    totalTrials: trials.length,
    trials,
    best: trials[0],
    totalTimeMs: Date.now() - startTime,
  };
}

export function estimateGridSearchTrials(parameters: ParameterRange[]): number {
  return parameters.reduce((total, range) => {
    const step = range.step ?? 1;
    const count = Math.round((range.max - range.min) / step) + 1;
    return total * count;
  }, 1);
}
