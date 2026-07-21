/**
 * 回测参数优化器 —— 统一入口。
 *
 * 提供：
 * - 15 种内置策略的参数空间定义和工厂函数
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
 * A 股强势回踩确认策略参数空间
 *
 * 偏向高胜率研究：趋势过滤 + 温和回踩 + 放量反包确认 + 固定止盈止损。
 */
export const aSharePullbackFactory: StrategyFactory = {
  name: "A股强势回踩确认",
  parameters: [
    { name: "trendPeriod", type: "int", min: 20, max: 40, step: 10 },
    { name: "pullbackPeriod", type: "int", min: 5, max: 11, step: 3 },
    { name: "maxPullbackPercent", type: "float", min: 0.05, max: 0.09, step: 0.02 },
    { name: "minReboundPercent", type: "float", min: 0.004, max: 0.012, step: 0.004 },
    { name: "volumeMultiplier", type: "float", min: 1.0, max: 1.3, step: 0.15 },
    { name: "takeProfitPercent", type: "float", min: 0.03, max: 0.07, step: 0.02 },
    { name: "stopLossPercent", type: "float", min: 0.02, max: 0.05, step: 0.015 },
    { name: "targetWeight", type: "float", min: 0.2, max: 0.5, step: 0.15 },
  ],
  create: async (params) => {
    const { ASharePullbackConfirmationStrategy } = await import(
      "../backtest/strategies/ASharePullbackConfirmationStrategy"
    );
    return new ASharePullbackConfirmationStrategy(
      params.trendPeriod,
      params.pullbackPeriod,
      params.maxPullbackPercent,
      params.minReboundPercent,
      params.volumeMultiplier,
      params.takeProfitPercent,
      params.stopLossPercent,
      params.targetWeight,
    );
  },
};

/**
 * KAIROS 低波趋势策略参数空间。
 *
 * 防守目标：只在趋势向上且波动受控时小仓位参与。
 */
export const kairosLowVolTrendFactory: StrategyFactory = {
  name: "KAIROS低波趋势",
  parameters: [
    { name: "trendPeriod", type: "int", min: 20, max: 30, step: 10 },
    { name: "slowPeriod", type: "int", min: 50, max: 60, step: 10 },
    { name: "maxVolatility", type: "float", min: 0.018, max: 0.026, step: 0.008 },
    { name: "takeProfitPercent", type: "float", min: 0.03, max: 0.045, step: 0.015 },
    { name: "stopLossPercent", type: "float", min: 0.014, max: 0.022, step: 0.008 },
    { name: "targetWeight", type: "float", min: 0.12, max: 0.2, step: 0.08 },
  ],
  create: async (params) => {
    const { KairosLowVolTrendStrategy } = await import(
      "../backtest/strategies/KairosDefensiveStrategies"
    );
    return new KairosLowVolTrendStrategy(
      params.trendPeriod,
      params.slowPeriod,
      params.maxVolatility,
      params.takeProfitPercent,
      params.stopLossPercent,
      params.targetWeight,
    );
  },
};

/**
 * KAIROS 缩量回撤反弹策略参数空间。
 *
 * 防守目标：趋势未坏、回撤不深、没有恐慌放量时才尝试反弹。
 */
export const kairosQuietPullbackFactory: StrategyFactory = {
  name: "KAIROS缩量回撤反弹",
  parameters: [
    { name: "trendPeriod", type: "int", min: 20, max: 30, step: 10 },
    { name: "pullbackPeriod", type: "int", min: 6, max: 9, step: 3 },
    { name: "minPullbackPercent", type: "float", min: 0.01, max: 0.018, step: 0.008 },
    { name: "maxPullbackPercent", type: "float", min: 0.05, max: 0.07, step: 0.02 },
    { name: "maxVolumeMultiplier", type: "float", min: 1.2, max: 1.4, step: 0.2 },
    { name: "takeProfitPercent", type: "float", min: 0.028, max: 0.04, step: 0.012 },
    { name: "stopLossPercent", type: "float", min: 0.014, max: 0.02, step: 0.006 },
    { name: "targetWeight", type: "float", min: 0.12, max: 0.18, step: 0.06 },
  ],
  create: async (params) => {
    const { KairosQuietPullbackStrategy } = await import(
      "../backtest/strategies/KairosDefensiveStrategies"
    );
    return new KairosQuietPullbackStrategy(
      params.trendPeriod,
      params.pullbackPeriod,
      params.minPullbackPercent,
      params.maxPullbackPercent,
      params.maxVolumeMultiplier,
      params.takeProfitPercent,
      params.stopLossPercent,
      params.targetWeight,
    );
  },
};

/**
 * KAIROS 资金护城河策略参数空间。
 *
 * 防守目标：只吃受控突破，失败后冷却，避免连续追错。
 */
export const kairosCapitalShieldFactory: StrategyFactory = {
  name: "KAIROS资金护城河",
  parameters: [
    { name: "entryPeriod", type: "int", min: 18, max: 24, step: 6 },
    { name: "exitPeriod", type: "int", min: 5, max: 8, step: 3 },
    { name: "maxRecentDrawdown", type: "float", min: 0.045, max: 0.06, step: 0.015 },
    { name: "takeProfitPercent", type: "float", min: 0.025, max: 0.035, step: 0.01 },
    { name: "stopLossPercent", type: "float", min: 0.012, max: 0.018, step: 0.006 },
    { name: "cooldownBars", type: "int", min: 4, max: 6, step: 2 },
    { name: "targetWeight", type: "float", min: 0.1, max: 0.16, step: 0.06 },
  ],
  create: async (params) => {
    const { KairosCapitalShieldStrategy } = await import(
      "../backtest/strategies/KairosDefensiveStrategies"
    );
    return new KairosCapitalShieldStrategy(
      params.entryPeriod,
      params.exitPeriod,
      params.maxRecentDrawdown,
      params.takeProfitPercent,
      params.stopLossPercent,
      params.cooldownBars,
      params.targetWeight,
    );
  },
};

/** KAIROS 风险收缩修复研究策略参数空间。 */
export const kairosRiskOffRecoveryFactory: StrategyFactory = {
  name: "KAIROS风险收缩修复",
  parameters: [
    { name: "fastPeriod", type: "int", min: 8, max: 10, step: 2 },
    { name: "slowPeriod", type: "int", min: 30, max: 40, step: 10 },
    { name: "recoveryLookback", type: "int", min: 15, max: 15, step: 5 },
    { name: "minimumDrawdown", type: "float", min: 0.06, max: 0.08, step: 0.02 },
    { name: "minimumRebound", type: "float", min: 0.025, max: 0.025, step: 0.01 },
    { name: "minimumVolumeMultiplier", type: "float", min: 1.1, max: 1.2, step: 0.1 },
    { name: "takeProfitPercent", type: "float", min: 0.04, max: 0.04, step: 0.01 },
    { name: "stopLossPercent", type: "float", min: 0.02, max: 0.02, step: 0.005 },
    { name: "targetWeight", type: "float", min: 0.08, max: 0.12, step: 0.02 },
  ],
  create: async (params) => {
    const { KairosRiskOffRecoveryStrategy } = await import(
      "../backtest/strategies/KairosDefensiveStrategies"
    );
    return new KairosRiskOffRecoveryStrategy(
      params.fastPeriod,
      params.slowPeriod,
      params.recoveryLookback,
      params.minimumDrawdown,
      params.minimumRebound,
      params.minimumVolumeMultiplier,
      params.takeProfitPercent,
      params.stopLossPercent,
      params.targetWeight,
    );
  },
};

/** KAIROS 洗盘恢复研究策略参数空间。 */
export const kairosWashoutRecoveryFactory: StrategyFactory = {
  name: "KAIROS洗盘恢复",
  parameters: [
    { name: "trendPeriod", type: "int", min: 50, max: 70, step: 20 },
    { name: "pullbackPeriod", type: "int", min: 15, max: 25, step: 10 },
    { name: "minPullbackPercent", type: "float", min: 0.02, max: 0.04, step: 0.02 },
    { name: "maxPullbackPercent", type: "float", min: 0.09, max: 0.12, step: 0.03 },
    { name: "maxVolumeRatio", type: "float", min: 0.7, max: 0.9, step: 0.2 },
    { name: "minReboundPercent", type: "float", min: 0.003, max: 0.007, step: 0.004 },
    { name: "takeProfitPercent", type: "float", min: 0.04, max: 0.07, step: 0.03 },
    { name: "stopLossPercent", type: "float", min: 0.02, max: 0.035, step: 0.015 },
    { name: "targetWeight", type: "float", min: 0.12, max: 0.2, step: 0.08 },
  ],
  create: async (params) => {
    const { KairosWashoutRecoveryStrategy } = await import(
      "../backtest/strategies/KairosRegimeStrategies"
    );
    return new KairosWashoutRecoveryStrategy(
      params.trendPeriod,
      params.pullbackPeriod,
      params.minPullbackPercent,
      params.maxPullbackPercent,
      params.maxVolumeRatio,
      params.minReboundPercent,
      params.takeProfitPercent,
      params.stopLossPercent,
      params.targetWeight,
    );
  },
};

/** KAIROS 趋势健康研究策略参数空间。 */
export const kairosTrendHealthFactory: StrategyFactory = {
  name: "KAIROS趋势健康",
  parameters: [
    { name: "fastPeriod", type: "int", min: 15, max: 25, step: 10 },
    { name: "slowPeriod", type: "int", min: 50, max: 70, step: 20 },
    { name: "breakdownVolumeRatio", type: "float", min: 1.2, max: 1.5, step: 0.3 },
    { name: "takeProfitPercent", type: "float", min: 0.05, max: 0.08, step: 0.03 },
    { name: "stopLossPercent", type: "float", min: 0.025, max: 0.04, step: 0.015 },
    { name: "cooldownBars", type: "int", min: 4, max: 8, step: 4 },
    { name: "targetWeight", type: "float", min: 0.12, max: 0.2, step: 0.08 },
  ],
  create: async (params) => {
    const { KairosTrendHealthStrategy } = await import(
      "../backtest/strategies/KairosRegimeStrategies"
    );
    return new KairosTrendHealthStrategy(
      params.fastPeriod,
      params.slowPeriod,
      params.breakdownVolumeRatio,
      params.takeProfitPercent,
      params.stopLossPercent,
      params.cooldownBars,
      params.targetWeight,
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
  aSharePullback: aSharePullbackFactory,
  kairosLowVolTrend: kairosLowVolTrendFactory,
  kairosQuietPullback: kairosQuietPullbackFactory,
  kairosCapitalShield: kairosCapitalShieldFactory,
  kairosRiskOffRecovery: kairosRiskOffRecoveryFactory,
  kairosWashoutRecovery: kairosWashoutRecoveryFactory,
  kairosTrendHealth: kairosTrendHealthFactory,
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
