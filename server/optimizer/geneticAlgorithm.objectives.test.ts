import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "../backtest/backtestEngine";
import { geneticAlgorithm } from "./geneticAlgorithm";
import { computeScore } from "./scoreUtils";
import type {
  GeneticAlgorithmConfig,
  OptimizationReport,
  StrategyFactory,
} from "./types";

const backtest = {
  initialCapital: 10_000,
  maxOrderNotional: 10_000,
  maxPositionWeight: 1,
  commissionRate: 0,
  minimumCommission: 0,
  slippageBps: 0,
};

const snapshots: MarketSnapshot[] = [10, 11, 12].map((price, index) => {
  const marketTime = new Date(Date.UTC(2026, 10, index + 2, 7)).toISOString();
  return {
    mode: "paper",
    sequence: index + 1,
    marketTime,
    quotes: [{
      symbol: "600001",
      name: "目标评分样本",
      tradable: true,
      price,
      previousClose: index === 0 ? price : price - 1,
      changePercent: 0,
      volume: 1_000_000,
      updatedAt: marketTime,
    }],
  };
});

function createFactory(created?: number[]): StrategyFactory {
  return {
    name: "确定性仓位样本",
    parameters: [{ name: "lots", type: "int", min: 1, max: 2 }],
    create: ({ lots }) => {
      created?.push(lots);
      return {
        name: `持有${lots}手`,
        onBar: ({ barIndex }) => barIndex === 0 ? [{
          symbol: "600001",
          side: "buy",
          type: "market",
          quantity: lots * 100,
        }] : [],
      };
    },
  };
}

function search(
  objectives: GeneticAlgorithmConfig["objectives"],
  factory = createFactory(),
): Promise<OptimizationReport> {
  return geneticAlgorithm(snapshots, factory, {
    populationSize: 8,
    generations: 4,
    mutationRate: 0.2,
    elitismCount: 1,
    objectives,
    backtest,
  });
}

function economicResult(report: OptimizationReport) {
  return {
    method: report.method,
    parameters: report.parameters,
    totalTrials: report.totalTrials,
    trials: report.trials.map(({ id, params, metrics, score }) => ({ id, params, metrics, score })),
    best: { params: report.best.params, metrics: report.best.metrics, score: report.best.score },
    convergenceCurve: report.convergenceCurve,
  };
}

describe("geneticAlgorithm 配置目标与真实引擎评分", () => {
  it("每个 trial 使用总收益目标评分，并选中该目标的最大值", async () => {
    const objectives: GeneticAlgorithmConfig["objectives"] = [{ metric: "totalReturn", weight: 1 }];
    const report = await search(objectives);

    expect(report.trials.map((trial) => trial.params.lots).sort()).toEqual([1, 2]);
    for (const trial of report.trials) {
      expect(trial.metrics.totalTrades).toBe(1);
      expect(trial.metrics.finalEquity).toBe(10_000 + trial.params.lots * 200);
      expect(trial.score).toBeCloseTo(trial.params.lots * 0.02);
      expect(trial.score).toBe(computeScore(trial.metrics, objectives));
    }
    expect(report.best.params.lots).toBe(2);
    expect(report.best.score).toBeCloseTo(0.04);
  });

  it("同一收益目标的正负权重选择相反 best，所有候选沿用对应得分", async () => {
    const positive = await search([{ metric: "totalReturn", weight: 1 }]);
    const negativeObjectives: GeneticAlgorithmConfig["objectives"] = [{ metric: "totalReturn", weight: -1 }];
    const negative = await search(negativeObjectives);

    expect(positive.best.params.lots).toBe(2);
    expect(negative.best.params.lots).toBe(1);
    for (const trial of negative.trials) {
      expect(trial.score).toBeCloseTo(-trial.params.lots * 0.02);
      expect(trial.score).toBe(computeScore(trial.metrics, negativeObjectives));
    }
    expect(negative.best.score).toBeCloseTo(-0.02);
  });

  it("多目标使用同一归一化与权重求和，保留负分候选的正确排序", async () => {
    const objectives: GeneticAlgorithmConfig["objectives"] = [
      { metric: "totalReturn", weight: 2 },
      { metric: "sharpeRatio", weight: -0.01 },
    ];
    const report = await search(objectives);

    for (const trial of report.trials) {
      expect(trial.metrics.sharpeRatio).toBeGreaterThan(10);
      expect(trial.score).toBeCloseTo(trial.params.lots * 0.04 - 0.1);
      expect(trial.score).toBe(computeScore(trial.metrics, objectives));
    }
    expect(report.best.params.lots).toBe(2);
    expect(report.best.score).toBeCloseTo(-0.02);
  });

  it("常用 Sharpe 单目标保留原评分，真实引擎的费用与滑点结果一致", async () => {
    const objectives: GeneticAlgorithmConfig["objectives"] = [{ metric: "sharpeRatio", weight: 1 }];
    const factory = createFactory();
    const costs = { ...backtest, minimumCommission: 5, slippageBps: 50 };
    const report = await geneticAlgorithm(snapshots, factory, {
      populationSize: 8,
      generations: 4,
      mutationRate: 0.2,
      elitismCount: 1,
      objectives,
      backtest: costs,
    });

    for (const trial of report.trials) {
      const direct = new BacktestEngine(snapshots, await factory.create(trial.params), costs).run();
      expect(trial.metrics).toEqual(direct.metrics);
      expect(trial.metrics.totalCommission).toBe(5);
      expect(trial.score).toBe(computeScore(direct.metrics, objectives));
      expect(trial.score).toBe(Math.max(-5, Math.min(10, direct.metrics.sharpeRatio)));
    }
  });

  it("缓存命中后的各代 best/avg 与配置目标使用同一分数", async () => {
    const created: number[] = [];
    const factory = createFactory(created);
    factory.parameters = [{ name: "lots", type: "int", min: 2, max: 2 }];
    const report = await search([{ metric: "totalReturn", weight: -1 }], factory);

    expect(created).toEqual([2]);
    expect(report.totalTrials).toBe(1);
    expect(report.best.score).toBeCloseTo(-0.04);
    expect(report.convergenceCurve).toHaveLength(4);
    for (const [index, point] of report.convergenceCurve!.entries()) {
      expect(point.generation).toBe(index + 1);
      expect(point.bestScore).toBeCloseTo(-0.04);
      expect(point.avgScore).toBeCloseTo(-0.04);
    }
  });

  it("固定种子重复搜索保留候选、缓存、指标、best 与收敛曲线的确定性", async () => {
    const firstCreated: number[] = [];
    const secondCreated: number[] = [];
    const objectives: GeneticAlgorithmConfig["objectives"] = [{ metric: "totalReturn", weight: -1 }];
    const first = await search(objectives, createFactory(firstCreated));
    const second = await search(objectives, createFactory(secondCreated));

    expect(economicResult(first)).toEqual(economicResult(second));
    expect(firstCreated).toEqual(secondCreated);
    expect(firstCreated).toHaveLength(first.totalTrials);
    expect(new Set(firstCreated).size).toBe(first.totalTrials);
    expect(first.best.score).toBeCloseTo(-0.02);
    const scores = first.trials.map((trial) => trial.score);
    for (const point of first.convergenceCurve!) {
      expect(point.bestScore).toBe(first.best.score);
      expect(point.avgScore).toBeGreaterThanOrEqual(Math.min(...scores) - 1e-12);
      expect(point.avgScore).toBeLessThanOrEqual(point.bestScore + 1e-12);
    }
  });
});
