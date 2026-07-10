/**
 * 遗传算法优化器 —— 对连续参数空间进行进化搜索。
 *
 * 算法流程：
 * 1. 初始化种群：在参数范围内随机生成个体
 * 2. 评估适应度：对每个个体运行回测，计算加权得分
 * 3. 选择：锦标赛选择（tournament selection）
 * 4. 交叉：单点交叉（single-point crossover）
 * 5. 变异：高斯扰动（连续参数）或随机跳变（整数参数）
 * 6. 精英保留：前 N 个最优个体直接进入下一代
 * 7. 重复 2-6 直至达到最大代数
 */

import type { MarketSnapshot } from "../../shared/trading";
import type { BacktestMetrics } from "../../shared/backtest";
import { BacktestEngine } from "../backtest/backtestEngine";
import type {
  GeneticAlgorithmConfig,
  Individual,
  OptimizationReport,
  OptimizationTrial,
  ParameterRange,
  StrategyFactory,
} from "./types";
import { computeScore } from "./scoreUtils";

function randomValue(range: ParameterRange, rng: () => number): number {
  const raw = range.min + rng() * (range.max - range.min);
  if (range.type === "int") return Math.round(raw);
  return Number(raw.toFixed(6));
}

function initializePopulation(
  parameters: ParameterRange[],
  size: number,
  rng: () => number,
): Individual[] {
  const population: Individual[] = [];
  for (let i = 0; i < size; i++) {
    const params: Record<string, number> = {};
    const genes: Record<string, number> = {};
    for (const p of parameters) {
      const value = randomValue(p, rng);
      params[p.name] = value;
      genes[p.name] = p.max === p.min ? 0.5 : (value - p.min) / (p.max - p.min);
    }
    population.push({ genes, params, fitness: 0 });
  }
  return population;
}

function tournamentSelect(
  population: Individual[],
  tournamentSize: number,
  rng: () => number,
): Individual {
  let best: Individual | null = null;
  for (let i = 0; i < tournamentSize; i++) {
    const idx = Math.floor(rng() * population.length);
    const candidate = population[idx];
    if (!best || candidate.fitness > best.fitness) best = candidate;
  }
  return best!;
}

function crossover(
  parent1: Individual,
  parent2: Individual,
  paramNames: string[],
  rng: () => number,
): [Individual, Individual] {
  if (paramNames.length <= 1 || rng() > 0.8) {
    return [
      { genes: { ...parent1.genes }, params: { ...parent1.params }, fitness: 0 },
      { genes: { ...parent2.genes }, params: { ...parent2.params }, fitness: 0 },
    ];
  }
  const cp = Math.floor(rng() * (paramNames.length - 1)) + 1;
  const c1g: Record<string, number> = {};
  const c2g: Record<string, number> = {};
  for (let i = 0; i < paramNames.length; i++) {
    const n = paramNames[i];
    if (i < cp) { c1g[n] = parent1.genes[n]; c2g[n] = parent2.genes[n]; }
    else { c1g[n] = parent2.genes[n]; c2g[n] = parent1.genes[n]; }
  }
  return [
    { genes: c1g, params: {}, fitness: 0 },
    { genes: c2g, params: {}, fitness: 0 },
  ];
}

function mutate(
  individual: Individual,
  parameters: ParameterRange[],
  mutationRate: number,
  rng: () => number,
): void {
  for (const name of Object.keys(individual.genes)) {
    if (rng() < mutationRate) {
      const u1 = rng() || 1e-9;
      const u2 = rng();
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      individual.genes[name] = Math.max(0, Math.min(1, individual.genes[name] + gauss * 0.15));
    }
  }
  decodeGenes(individual, parameters);
}

function decodeGenes(individual: Individual, parameters: ParameterRange[]): void {
  const paramMap = new Map(parameters.map((p) => [p.name, p]));
  for (const [name, gene] of Object.entries(individual.genes)) {
    const range = paramMap.get(name);
    if (!range) continue;
    const value = range.min + gene * (range.max - range.min);
    individual.params[name] = range.type === "int" ? Math.round(value) : Number(value.toFixed(6));
  }
}

function makeEmptyMetrics(): BacktestMetrics {
  return {
    initialCapital: 0, finalEquity: 0, totalReturn: 0, totalReturnPercent: 0,
    annualizedReturn: 0, annualizedVolatility: 0, sharpeRatio: 0, sortinoRatio: 0,
    maxDrawdown: 1, maxDrawdownPercent: 1, calmarRatio: 0,
    totalTrades: 0, winningTrades: 0, losingTrades: 0,
    winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0,
    totalCommission: 0, totalSlippage: 0, barCount: 0,
    startTime: "", endTime: "",
  };
}

async function evaluateIndividual(
  individual: Individual,
  snapshots: MarketSnapshot[],
  factory: StrategyFactory,
  backtestConfig: Record<string, number>,
  trialId: number,
): Promise<Individual> {
  const trialStart = Date.now();
  let fitness = -Infinity;

  try {
    const strategy = await factory.create(individual.params);
    const engine = new BacktestEngine(snapshots, strategy, backtestConfig);
    const report = engine.run();
    fitness = computeScore(report.metrics, [{ metric: "sharpeRatio", weight: 1 }]);

    individual.trial = {
      id: trialId,
      params: { ...individual.params },
      metrics: report.metrics,
      score: fitness,
      executionTimeMs: Date.now() - trialStart,
    };
  } catch (err) {
    fitness = -1e6;
    individual.trial = {
      id: trialId,
      params: { ...individual.params },
      metrics: makeEmptyMetrics(),
      score: fitness,
      executionTimeMs: Date.now() - trialStart,
    };
  }

  individual.fitness = fitness;
  return individual;
}

export async function geneticAlgorithm(
  snapshots: MarketSnapshot[],
  factory: StrategyFactory,
  config: GeneticAlgorithmConfig & {
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

  let seed = 0xdeadbeef;
  const rng = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const paramNames = factory.parameters.map((p) => p.name);
  const btCfg = {
    initialCapital: config.backtest?.initialCapital ?? 1_000_000,
    commissionRate: config.backtest?.commissionRate ?? 0.0003,
    minimumCommission: config.backtest?.minimumCommission ?? 5,
    slippageBps: config.backtest?.slippageBps ?? 5,
    maxOrderNotional: config.backtest?.maxOrderNotional ?? 100_000,
    maxPositionWeight: config.backtest?.maxPositionWeight ?? 0.25,
  };

  let population = initializePopulation(factory.parameters, config.populationSize, rng);
  const allTrials: Map<string, OptimizationTrial> = new Map();
  let trialIdCounter = 0;
  const convergenceCurve: { generation: number; bestScore: number; avgScore: number }[] = [];

  for (let gen = 0; gen < config.generations; gen++) {
    // Evaluate
    for (const individual of population) {
      const key = JSON.stringify(individual.params);
      if (allTrials.has(key)) {
        const cached = allTrials.get(key)!;
        individual.fitness = cached.score;
        individual.trial = cached;
      } else if (individual.fitness === 0) {
        trialIdCounter++;
        await evaluateIndividual(individual, snapshots, factory, btCfg, trialIdCounter);
        if (individual.trial) allTrials.set(key, individual.trial);
      }
    }

    population.sort((a, b) => b.fitness - a.fitness);

    const bestScore = population[0].fitness;
    const avgScore = population.reduce((s, i) => s + i.fitness, 0) / population.length;
    convergenceCurve.push({ generation: gen + 1, bestScore, avgScore });

    if (gen === config.generations - 1) break;

    // Selection & reproduction
    const nextGen: Individual[] = population.slice(0, config.elitismCount);
    while (nextGen.length < config.populationSize) {
      const p1 = tournamentSelect(population, 3, rng);
      const p2 = tournamentSelect(population, 3, rng);
      const [c1, c2] = crossover(p1, p2, paramNames, rng);
      mutate(c1, factory.parameters, config.mutationRate, rng);
      mutate(c2, factory.parameters, config.mutationRate, rng);
      nextGen.push(c1);
      if (nextGen.length < config.populationSize) nextGen.push(c2);
    }
    population = nextGen;
  }

  const trials = Array.from(allTrials.values());
  trials.sort((a, b) => b.score - a.score);

  if (trials.length === 0) throw new Error("遗传算法未产生有效试验");

  return {
    strategyName: factory.name,
    method: "genetic",
    parameters: factory.parameters,
    totalTrials: trials.length,
    trials,
    best: trials[0],
    totalTimeMs: Date.now() - startTime,
    convergenceCurve,
  };
}
