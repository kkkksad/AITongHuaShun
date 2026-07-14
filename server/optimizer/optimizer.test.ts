/**
 * 回测参数优化器测试。
 *
 * 测试网格搜索、遗传算法、得分计算和所有策略工厂。
 */

import { describe, it, expect } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import {
  gridSearch,
  geneticAlgorithm,
  estimateGridSearchTrials,
  computeScore,
  movingAverageCrossFactory,
  rsiFactory,
  bollingerBandsFactory,
  momentumFactory,
  gridTradingFactory,
  macdFactory,
  turtleFactory,
  kairosLowVolTrendFactory,
  kairosQuietPullbackFactory,
  kairosCapitalShieldFactory,
  kairosTrendHealthFactory,
  kairosWashoutRecoveryFactory,
  builtInFactories,
  runOptimization,
} from "./index";
import type { StrategyFactory } from "./types";

// ── 辅助函数 ──

function createSeededRandom(seed = 0x9e3779b9): () => number {
  let state = seed;
  return () => {
    let value = (state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    state = value ^ (value >>> 14);
    return (state >>> 0) / 4294967296;
  };
}

function generateSnapshots(count: number, seedPrice = 100, volatility = 0.02): MarketSnapshot[] {
  const snapshots: MarketSnapshot[] = [];
  let price = seedPrice;
  const random = createSeededRandom();

  for (let i = 0; i < count; i++) {
    price = price * (1 + (random() - 0.48) * volatility);
    price = Math.max(1, price);

    snapshots.push({
      mode: "paper",
      sequence: i + 1,
      marketTime: new Date(2024, 0, i + 1).toISOString(),
      quotes: [
        {
          symbol: "600519",
          name: "TestStock",
          tradable: true,
          price: Number(price.toFixed(2)),
          previousClose: Number((price * 0.99).toFixed(2)),
          changePercent: Number(((random() - 0.5) * 2).toFixed(2)),
          volume: 10_000_000,
          updatedAt: new Date(2024, 0, i + 1).toISOString(),
        },
      ],
    });
  }

  return snapshots;
}

// ── 自定义简单工厂（用于测试） ──

const testFactory: StrategyFactory = {
  name: "TestMA",
  parameters: [
    { name: "fastPeriod", type: "int" as const, min: 3, max: 9, step: 2 },
    { name: "slowPeriod", type: "int" as const, min: 15, max: 25, step: 5 },
    { name: "targetWeight", type: "float" as const, min: 0.3, max: 0.7, step: 0.2 },
  ],
  create: async (params) => {
    const { MovingAverageCrossStrategy } = await import(
      "../backtest/strategies/MovingAverageCrossStrategy"
    );
    return new MovingAverageCrossStrategy(
      params.fastPeriod,
      params.slowPeriod,
      params.targetWeight,
      `TestMA(${params.fastPeriod},${params.slowPeriod})`,
    );
  },
};

// ═══════════════════════════════════════════════
// 得分计算测试
// ═══════════════════════════════════════════════

describe("computeScore", () => {
  it("scores positive sharpe correctly", () => {
    const metrics = {
      initialCapital: 1_000_000, finalEquity: 1_200_000,
      totalReturn: 0.2, totalReturnPercent: 20,
      annualizedReturn: 0.15, annualizedVolatility: 0.1,
      sharpeRatio: 1.5, sortinoRatio: 2.0,
      maxDrawdown: 50000, maxDrawdownPercent: 0.05,
      calmarRatio: 3.0, totalTrades: 10,
      winningTrades: 6, losingTrades: 4,
      winRate: 0.6, avgWin: 1000, avgLoss: 500,
      profitFactor: 2.0, totalCommission: 100,
      totalSlippage: 0, barCount: 252,
      startTime: "2024-01-01", endTime: "2024-12-31",
    };
    const score = computeScore(metrics, [{ metric: "sharpeRatio", weight: 1 }]);
    expect(score).toBe(1.5);
  });

  it("clips extreme values", () => {
    const metrics = {
      initialCapital: 1_000_000, finalEquity: 10_000_000,
      totalReturn: 9, totalReturnPercent: 900,
      annualizedReturn: 20, annualizedVolatility: 0.05,
      sharpeRatio: 100, sortinoRatio: 100,
      maxDrawdown: 1000, maxDrawdownPercent: 0.001,
      calmarRatio: 50, totalTrades: 100,
      winningTrades: 90, losingTrades: 10,
      winRate: 0.9, avgWin: 5000, avgLoss: 1000,
      profitFactor: 20, totalCommission: 500,
      totalSlippage: 0, barCount: 252,
      startTime: "", endTime: "",
    };
    const score = computeScore(metrics, [
      { metric: "sharpeRatio", weight: 1 },
      { metric: "totalReturn", weight: 1 },
    ]);
    // sharpe clipped to 10, totalReturn clipped to 5
    expect(score).toBeCloseTo(15, 1);
  });

  it("weighted objectives combine correctly", () => {
    const metrics = {
      initialCapital: 1_000_000, finalEquity: 1_100_000,
      totalReturn: 0.1, totalReturnPercent: 10,
      annualizedReturn: 0.08, annualizedVolatility: 0.08,
      sharpeRatio: 1.0, sortinoRatio: 1.5,
      maxDrawdown: 30000, maxDrawdownPercent: 0.03,
      calmarRatio: 2.67, totalTrades: 20,
      winningTrades: 12, losingTrades: 8,
      winRate: 0.6, avgWin: 800, avgLoss: 400,
      profitFactor: 1.5, totalCommission: 200,
      totalSlippage: 0, barCount: 252,
      startTime: "", endTime: "",
    };
    const score = computeScore(metrics, [
      { metric: "sharpeRatio", weight: 2 },
      { metric: "winRate", weight: 1 },
    ]);
    expect(score).toBeCloseTo(2.6, 1); // 1.0*2 + 0.6*1
  });
});

// ═══════════════════════════════════════════════
// 网格搜索测试
// ═══════════════════════════════════════════════

describe("gridSearch", () => {
  it("runs grid search and returns best parameters", async () => {
    const snapshots = generateSnapshots(100, 100, 0.015);

    const report = await gridSearch(snapshots, testFactory, {
      objectives: [{ metric: "sharpeRatio", weight: 1 }],
    });

    expect(report.strategyName).toBe("TestMA");
    expect(report.method).toBe("grid");
    expect(report.totalTrials).toBeGreaterThan(0);
    expect(report.trials.length).toBe(report.totalTrials);
    expect(report.best).toBeDefined();
    expect(report.best.params).toHaveProperty("fastPeriod");
    expect(report.best.params).toHaveProperty("slowPeriod");
    expect(report.best.params).toHaveProperty("targetWeight");
    expect(typeof report.best.score).toBe("number");
    expect(report.best.score).not.toBeNaN();
    expect(report.totalTimeMs).toBeGreaterThan(0);
    expect(report.totalTimeMs).toBeLessThan(60000);

    // Trials should be sorted by score descending
    for (let i = 1; i < report.trials.length; i++) {
      expect(report.trials[i - 1].score).toBeGreaterThanOrEqual(report.trials[i].score);
    }
  });

  it("handles custom backtest config", async () => {
    const snapshots = generateSnapshots(80, 100, 0.015);

    const report = await gridSearch(snapshots, testFactory, {
      objectives: [{ metric: "totalReturn", weight: 1 }],
      backtest: { initialCapital: 500_000 },
    });

    expect(report.best.metrics.initialCapital).toBe(500_000);
  });

  it("estimateGridSearchTrials computes correctly", () => {
    const count = estimateGridSearchTrials(testFactory.parameters);
    // fastPeriod: 3,5,7,9 = 4; slowPeriod: 15,20,25 = 3; targetWeight: 0.3,0.5,0.7 = 3
    expect(count).toBe(4 * 3 * 3); // 36
  });
});

// ═══════════════════════════════════════════════
// 遗传算法测试
// ═══════════════════════════════════════════════

describe("geneticAlgorithm", () => {
  it("runs genetic algorithm and returns best parameters", async () => {
    const snapshots = generateSnapshots(100, 100, 0.015);

    const report = await geneticAlgorithm(snapshots, testFactory, {
      populationSize: 10,
      generations: 5,
      mutationRate: 0.1,
      elitismCount: 2,
      objectives: [{ metric: "sharpeRatio", weight: 1 }],
    });

    expect(report.strategyName).toBe("TestMA");
    expect(report.method).toBe("genetic");
    expect(report.totalTrials).toBeGreaterThan(0);
    expect(report.best).toBeDefined();
    expect(report.best.params).toHaveProperty("fastPeriod");
    expect(report.best.params).toHaveProperty("slowPeriod");
    expect(report.best.params).toHaveProperty("targetWeight");
    expect(typeof report.best.score).toBe("number");

    // Should have convergence curve
    expect(report.convergenceCurve).toBeDefined();
    expect(report.convergenceCurve!.length).toBe(5);
    for (const point of report.convergenceCurve!) {
      expect(point.generation).toBeGreaterThan(0);
      expect(typeof point.bestScore).toBe("number");
      expect(typeof point.avgScore).toBe("number");
    }

    expect(report.totalTimeMs).toBeGreaterThan(0);
    expect(report.totalTimeMs).toBeLessThan(120000);
  });

  it("improves best score over generations", async () => {
    const snapshots = generateSnapshots(80, 100, 0.02);

    const report = await geneticAlgorithm(snapshots, testFactory, {
      populationSize: 8,
      generations: 8,
      mutationRate: 0.15,
      elitismCount: 2,
      objectives: [{ metric: "sharpeRatio", weight: 1 }],
    });

    const curve = report.convergenceCurve!;
    // Best score should generally improve or stay the same (not get worse in last gen)
    expect(curve[curve.length - 1].bestScore).toBeGreaterThanOrEqual(curve[0].bestScore - 0.01);
  });

  it("creates a report that can be used to instantiate best strategy", async () => {
    const snapshots = generateSnapshots(80, 100, 0.015);

    const report = await geneticAlgorithm(snapshots, testFactory, {
      populationSize: 6,
      generations: 4,
      mutationRate: 0.1,
      elitismCount: 1,
      objectives: [{ metric: "sharpeRatio", weight: 1 }],
    });

    // Verify best params produce a working strategy
    const bestStrategy = await testFactory.create(report.best.params);
    expect(bestStrategy).toBeDefined();
    expect(typeof bestStrategy.onBar).toBe("function");
  });
});

// ═══════════════════════════════════════════════
// runOptimization 高层 API 测试
// ═══════════════════════════════════════════════

describe("runOptimization", () => {
  it("runs grid optimization via high-level API", async () => {
    const snapshots = generateSnapshots(80, 100, 0.015);

    const report = await runOptimization(snapshots, testFactory, {
      method: "grid",
      grid: { objectives: [{ metric: "sharpeRatio", weight: 1 }] },
    });

    expect(report.method).toBe("grid");
    expect(report.best).toBeDefined();
  });

  it("runs genetic optimization via high-level API", async () => {
    const snapshots = generateSnapshots(80, 100, 0.015);

    const report = await runOptimization(snapshots, testFactory, {
      method: "genetic",
      genetic: {
        populationSize: 8,
        generations: 4,
        mutationRate: 0.1,
        elitismCount: 2,
        objectives: [{ metric: "sharpeRatio", weight: 1 }],
      },
    });

    expect(report.method).toBe("genetic");
    expect(report.best).toBeDefined();
  });
});

// ═══════════════════════════════════════════════
// 所有内置策略工厂测试
// ═══════════════════════════════════════════════

describe("builtInFactories", () => {
  const factories: [string, StrategyFactory][] = [
    ["movingAverageCross", movingAverageCrossFactory],
    ["rsi", rsiFactory],
    ["bollingerBands", bollingerBandsFactory],
    ["momentum", momentumFactory],
    ["gridTrading", gridTradingFactory],
    ["macd", macdFactory],
    ["turtle", turtleFactory],
    ["kairosLowVolTrend", kairosLowVolTrendFactory],
    ["kairosQuietPullback", kairosQuietPullbackFactory],
    ["kairosCapitalShield", kairosCapitalShieldFactory],
    ["kairosWashoutRecovery", kairosWashoutRecoveryFactory],
    ["kairosTrendHealth", kairosTrendHealthFactory],
  ];

  for (const [key, factory] of factories) {
    it(`${key} factory creates strategy and can be optimized`, async () => {
      expect(factory.name).toBeTruthy();
      expect(factory.parameters.length).toBeGreaterThan(0);

      // Verify each parameter has required fields
      for (const p of factory.parameters) {
        expect(p.name).toBeTruthy();
        expect(["int", "float"]).toContain(p.type);
        expect(p.min).toBeLessThanOrEqual(p.max);
      }

      // Verify factory creates a working strategy
      const defaultParams: Record<string, number> = {};
      for (const p of factory.parameters) {
        defaultParams[p.name] = p.min + (p.max - p.min) * 0.5;
        if (p.type === "int") defaultParams[p.name] = Math.round(defaultParams[p.name]);
      }

      const strategy = await factory.create(defaultParams);
      expect(strategy).toBeDefined();
      expect(typeof strategy.onBar).toBe("function");

      // Quick grid search to verify optimization works
      const snapshots = generateSnapshots(60, 100, 0.015);
      const report = await gridSearch(snapshots, factory, {
        objectives: [{ metric: "sharpeRatio", weight: 1 }],
      });

      expect(report.totalTrials).toBeGreaterThan(0);
      expect(report.best).toBeDefined();
    }, 30000); // 30s timeout for optimization tests
  }

  it("builtInFactories contains all 14 strategies", () => {
    expect(Object.keys(builtInFactories)).toHaveLength(14);
    expect(builtInFactories.aSharePullback.name).toBe("A股强势回踩确认");
    expect(builtInFactories.kairosLowVolTrend.name).toBe("KAIROS低波趋势");
    expect(builtInFactories.kairosQuietPullback.name).toBe("KAIROS缩量回撤反弹");
    expect(builtInFactories.kairosCapitalShield.name).toBe("KAIROS资金护城河");
    expect(builtInFactories.kairosWashoutRecovery.name).toBe("KAIROS洗盘恢复");
    expect(builtInFactories.kairosTrendHealth.name).toBe("KAIROS趋势健康");
  });
});

// ═══════════════════════════════════════════════
// 边界情况测试
// ═══════════════════════════════════════════════

describe("edge cases", () => {
  it("gridSearch with single parameter combination works", async () => {
    const snapshots = generateSnapshots(60, 100, 0.01);
    const singleFactory: StrategyFactory = {
      name: "Single",
      parameters: [
        { name: "fast", type: "int", min: 5, max: 5 },
      ],
      create: async (params) => {
        const { MovingAverageCrossStrategy } = await import(
          "../backtest/strategies/MovingAverageCrossStrategy"
        );
        return new MovingAverageCrossStrategy(params.fast, 20, 0.5, "Single");
      },
    };

    const report = await gridSearch(snapshots, singleFactory, {
      objectives: [{ metric: "sharpeRatio", weight: 1 }],
    });

    expect(report.totalTrials).toBe(1);
  });

  it("geneticAlgorithm with small population converges", async () => {
    const snapshots = generateSnapshots(60, 100, 0.015);

    const report = await geneticAlgorithm(snapshots, testFactory, {
      populationSize: 4,
      generations: 3,
      mutationRate: 0.05,
      elitismCount: 1,
      objectives: [{ metric: "sharpeRatio", weight: 1 }],
    });

    expect(report.totalTrials).toBeGreaterThan(0);
    expect(report.convergenceCurve).toBeDefined();
  });

  it("strategy factory with float params rounds correctly", async () => {
    const snapshots = generateSnapshots(60, 100, 0.015);
    const floatFactory: StrategyFactory = {
      name: "FloatTest",
      parameters: [
        { name: "multiplier", type: "float", min: 1.0, max: 3.0, step: 1.0 },
        { name: "period", type: "int", min: 15, max: 25, step: 10 },
        { name: "weight", type: "float", min: 0.3, max: 0.7, step: 0.4 },
      ],
      create: async (params) => {
        const { BollingerBandsStrategy } = await import(
          "../backtest/strategies/BollingerBandsStrategy"
        );
        return new BollingerBandsStrategy(
          params.period,
          params.multiplier,
          params.weight,
          "FloatTest",
        );
      },
    };

    const report = await gridSearch(snapshots, floatFactory, {
      objectives: [{ metric: "sharpeRatio", weight: 1 }],
    });

    expect(report.totalTrials).toBeGreaterThan(0);
    // All params should be within bounds
    for (const trial of report.trials) {
      expect(trial.params.multiplier).toBeGreaterThanOrEqual(1.0);
      expect(trial.params.multiplier).toBeLessThanOrEqual(3.0);
      expect(trial.params.weight).toBeGreaterThanOrEqual(0.3);
      expect(trial.params.weight).toBeLessThanOrEqual(0.7);
    }
  });
});
