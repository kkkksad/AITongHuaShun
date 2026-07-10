/**
 * 回测参数优化器 —— 类型定义。
 */

import type { BacktestMetrics, BacktestStrategy } from "../../shared/backtest";

export interface ParameterRange {
  name: string;
  type: "int" | "float";
  min: number;
  max: number;
  step?: number;
}

export interface StrategyFactory {
  name: string;
  parameters: ParameterRange[];
  create: (params: Record<string, number>) => BacktestStrategy | Promise<BacktestStrategy>;
}

export type ObjectiveFunction =
  | "sharpeRatio"
  | "totalReturn"
  | "calmarRatio"
  | "sortinoRatio"
  | "profitFactor"
  | "winRate";

export interface GridSearchConfig {
  objectives: { metric: ObjectiveFunction; weight: number }[];
}

export interface GeneticAlgorithmConfig {
  populationSize: number;
  generations: number;
  mutationRate: number;
  elitismCount: number;
  objectives: { metric: ObjectiveFunction; weight: number }[];
}

export interface OptimizerConfig {
  method: "grid" | "genetic";
  grid?: GridSearchConfig;
  genetic?: GeneticAlgorithmConfig;
  backtest?: {
    initialCapital?: number;
    commissionRate?: number;
    minimumCommission?: number;
    slippageBps?: number;
    maxOrderNotional?: number;
    maxPositionWeight?: number;
  };
}

export interface OptimizationTrial {
  id: number;
  params: Record<string, number>;
  metrics: BacktestMetrics;
  score: number;
  executionTimeMs: number;
}

export interface OptimizationReport {
  strategyName: string;
  method: "grid" | "genetic";
  parameters: ParameterRange[];
  totalTrials: number;
  trials: OptimizationTrial[];
  best: OptimizationTrial;
  totalTimeMs: number;
  convergenceCurve?: { generation: number; bestScore: number; avgScore: number }[];
}

export interface Individual {
  genes: Record<string, number>;
  params: Record<string, number>;
  fitness: number;
  trial?: OptimizationTrial;
}
