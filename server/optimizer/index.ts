/**
 * 回测参数优化器 —— 统一入口。
 *
 * 提供：
 * - 8 种内置策略的参数空间定义和工厂函数
 * - 网格搜索和遗传算法两种优化方法
 * - 便捷的 runOptimization() 高层 API
 */

import type { MarketSnapshot } from "../../shared/trading";
import type {
  GeneticAlgorithmConfig,
  GridSearchConfig,
  OptimizationReport,
  ParameterRange,
  StrategyFactory,
} from "./types";
import { gridSearch } from "./gridSearch";
import { geneticAlgorithm } from "./geneticAlgorithm";

// 重新导出类型
export type {
  ParameterRange,
  StrategyFactory,
  ObjectiveFunction,
  GridSearchConfig,
  GeneticAlgorithmConfig,
  OptimizerConfig,
  OptimizationTrial,
  OptimizationReport,
  Individual,
} from "./types";

export { gridSearch } from "./gridSearch";
export { geneticAlgorithm } from "./geneticAlgorithm";
export { estimateGridSearchTrials } from "./gridSearch";
export { computeScore } from "./scoreUtils";

// ═══════════════════════════════════════════════
// 策略工厂定义
// ═══════════════════════════════════════════════

/**
 * 均线交叉策略参数空间
 */
export const movingAverageCrossFactory: StrategyFactory = {
  name: "均线交叉",
  parameters: [
    { name: "fastPeriod", type: "int", min: 3, max: 20, step: 1 },
    { name: "slowPeriod", type: "int", min: 10, max: 60, step: 5 },
    { name: "targetWeight", type: "float", min: 0.1, max: 1.0, step: 0.1 },
  ],
  create: async (params) => {
    const { MovingAverageCrossStrategy } = await import(
      "../backtest/strategies/MovingAverageCrossStrategy"
    );
    return new MovingAverageCrossStrategy(
      params.fastPeriod,
      params.slowPeriod,
      params.targetWeight,
    );
  },
};

export const rsiFactory: StrategyFactory = {
  name: "RSI",
  parameters: [
    { name: "period", type: "int", min: 5, max: 30, step: 1 },
    { name: "oversoldThreshold", type: "int", min: 20, max: 40, step: 5 },
    { name: "overboughtThreshold", type: "int", min: 60, max: 80, step: 5 },
    { name: "targetWeight", type: "float", min: 0.1, max: 1.0, step: 0.1 },
  ],
  create: async (params) => {
    const { RSIStrategy } = await import("../backtest/strategies/RSIStrategy");
    return new RSIStrategy(
      params.period,
      params.oversoldThreshold,
      params.overboughtThreshold,
      params.targetWeight,
    );
  },
};

export const bollingerBandsFactory: StrategyFactory = {
  name: "布林带",
  parameters: [
    { name: "period", type: "int", min: 10, max: 50, step: 5 },
    { name: "stdMultiplier", type: "float", min: 1.0, max: 3.0, step: 0.5 },
    { name: "targetWeight", type: "float", min: 0.1, max: 1.0, step: 0.1 },
  ],
  create: async (params) => {
    const { BollingerBandsStrategy } = await import(
      "../backtest/strategies/BollingerBandsStrategy"
    );
    return new BollingerBandsStrategy(
      params.period,
      params.stdMultiplier,
      params.targetWeight,
    );
  },
};

export const momentumFactory: StrategyFactory = {
  name: "动量突破",
  parameters: [
    { name: "entryPeriod", type: "int", min: 10, max: 50, step: 5 },
    { name: "exitPeriod", type: "int", min: 5, max: 30, step: 5 },
    { name: "targetWeight", type: "float", min: 0.1, max: 1.0, step: 0.1 },
  ],
  create: async (params) => {
    const { MomentumStrategy } = await import(
      "../backtest/strategies/MomentumStrategy"
    );
    return new MomentumStrategy(
      params.entryPeriod,
      params.exitPeriod,
      params.targetWeight,
    );
  },
};

export const gridTradingFactory: StrategyFactory = {
  name: "网格交易",
  parameters: [
    { name: "gridCount", type: "int", min: 3, max: 10, step: 1 },
    { name: "gridSpacingPercent", type: "float", min: 1, max: 5, step: 0.5 },
    { name: "lotsPerGrid", type: "int", min: 100, max: 500, step: 100 },
  ],
  create: async (params) => {
    const { GridTradingStrategy } = await import(
      "../backtest/strategies/GridTradingStrategy"
    );
    return new GridTradingStrategy(
      params.gridCount,
      params.gridSpacingPercent,
      params.lotsPerGrid,
    );
  },
};

export const macdFactory: StrategyFactory = {
  name: "MACD",
  parameters: [
    { name: "fastPeriod", type: "int", min: 8, max: 20, step: 2 },
    { name: "slowPeriod", type: "int", min: 20, max: 40, step: 2 },
    { name: "signalPeriod", type: "int", min: 5, max: 15, step: 2 },
    { name: "targetWeight", type: "float", min: 0.1, max: 1.0, step: 0.1 },
  ],
  create: async (params) => {
    const { MACDStrategy } = await import("../backtest/strategies/MACDStrategy");
    return new MACDStrategy(
      params.fastPeriod,
      params.slowPeriod,
      params.signalPeriod,
      params.targetWeight,
    );
  },
};

export const turtleFactory: StrategyFactory = {
  name: "Turtle",
  parameters: [
    { name: "entryPeriod", type: "int", min: 10, max: 55, step: 5 },
    { name: "exitPeriod", type: "int", min: 5, max: 25, step: 5 },
    { name: "trendFilterPeriod", type: "int", min: 0, max: 100, step: 25 },
    { name: "targetWeight", type: "float", min: 0.1, max: 1.0, step: 0.1 },
  ],
  create: async (params) => {
    const { TurtleStrategy } = await import(
      "../backtest/strategies/TurtleStrategy"
    );
    return new TurtleStrategy(
      params.entryPeriod,
      params.exitPeriod,
      params.trendFilterPeriod,
      params.targetWeight,
    );
  },
};

/**
 * 定投策略参数空间
 *
 * 参数：intervalBars(1-20), investAmount(1000-100000), takeProfitPercent(0-50)
 */
export const dcaFactory: StrategyFactory = {
  name: "定投策略",
  parameters: [
    { name: "intervalBars", type: "int", min: 1, max: 20, step: 1 },
    { name: "investAmount", type: "int", min: 1000, max: 100000, step: 1000 },
    { name: "takeProfitPercent", type: "float", min: 0, max: 50, step: 5 },
  ],
  create: async (params) => {
    const { DCAStrategy } = await import(
      "../backtest/strategies/DCAStrategy"
    );
    return new DCAStrategy(
      params.intervalBars,
      params.investAmount,
      "", // auto-select first tradable symbol
      params.takeProfitPercent,
    );
  },
};

/**
 * 所有内置策略工厂映射。
 */
export const builtInFactories: Record<string, StrategyFactory> = {
  movingAverageCross: movingAverageCrossFactory,
  rsi: rsiFactory,
  bollingerBands: bollingerBandsFactory,
  momentum: momentumFactory,
  gridTrading: gridTradingFactory,
  macd: macdFactory,
  turtle: turtleFactory,
  dca: dcaFactory,
};

// ═══════════════════════════════════════════════
// 高层 API
// ═══════════════════════════════════════════════

export async function runOptimization(
  snapshots: MarketSnapshot[],
  factory: StrategyFactory,
  config: {
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
  },
): Promise<OptimizationReport> {
  if (config.method === "grid") {
    if (!config.grid) {
      throw new Error("网格搜索需要提供 grid 配置");
    }
    return gridSearch(snapshots, factory, {
      ...config.grid,
      backtest: config.backtest,
    });
  }

  if (config.method === "genetic") {
    if (!config.genetic) {
      throw new Error("遗传算法需要提供 genetic 配置");
    }
    return geneticAlgorithm(snapshots, factory, {
      ...config.genetic,
      backtest: config.backtest,
    });
  }

  throw new Error(`不支持的优化方法: ${config.method}`);
}
