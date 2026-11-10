import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { geneticAlgorithm } from "./geneticAlgorithm";
import type { OptimizationReport, StrategyFactory } from "./types";

const snapshots: MarketSnapshot[] = [10, 12, 11, 14].map((price, index) => {
  const marketTime = `2025-01-0${index + 2}T15:00:00+08:00`;
  return { mode: "paper", sequence: index + 1, marketTime, quotes: [{
    symbol: "600001", name: "scheduling fixture", tradable: true, price, previousClose: 10,
    changePercent: 0, volume: 1_000_000, updatedAt: marketTime,
  }] };
});
const config = { populationSize: 20, generations: 4, mutationRate: 0.2, elitismCount: 2,
  objectives: [{ metric: "totalReturn" as const, weight: 1 }],
  backtest: { initialCapital: 10_000, commissionRate: 0, minimumCommission: 0, slippageBps: 0,
    maxOrderNotional: 10_000, maxPositionWeight: 1 } };
function spendCpu() { const until = performance.now() + 2; while (performance.now() < until) { /* bounded offline workload */ } }
function factory(onCreate = () => {}, fail = false): StrategyFactory {
  return { name: "scheduling fixture", parameters: [
    { name: "units", type: "int", min: 1, max: 5 }, { name: "sellAt", type: "int", min: 1, max: 3 },
  ], create: params => {
    spendCpu(); onCreate(); if (fail) throw Error("expected fixture failure");
    return { name: "scheduling fixture", onBar: ({ barIndex }) => barIndex === 0
      ? [{ symbol: "600001", side: "buy", type: "market", quantity: params.units * 100 }]
      : barIndex === params.sellAt ? [{ symbol: "600001", side: "sell", type: "market", quantity: params.units * 100 }] : [] };
  } };
}
function economicResult(report: OptimizationReport) {
  const trial = ({ executionTimeMs: _duration, ...result }: OptimizationReport["best"]) => result;
  return { method: report.method, parameters: report.parameters, totalTrials: report.totalTrials,
    trials: report.trials.map(trial), best: trial(report.best), convergenceCurve: report.convergenceCurve };
}

describe("genetic algorithm cooperative scheduling", () => {
  it.each([false, true])("allows real timers to run during CPU-bound evaluations, failure=%s", async fail => {
    let completed = 0, observed: number | undefined;
    const timer = setTimeout(() => { observed = completed; }, 0);
    try {
      const report = await geneticAlgorithm(snapshots, factory(() => completed++, fail), config);
      expect(completed).toBeGreaterThan(4);
      expect(observed).toBeDefined(); expect(observed!).toBeLessThan(completed);
      expect(report.totalTrials).toBe(completed);
      if (fail) expect(report.trials.every(t => t.score === -1e6)).toBe(true);
    } finally { clearTimeout(timer); }
  });

  it("keeps seeded trials, cached deduplication, ranking, and convergence deterministic", async () => {
    let created = 0;
    const first = await geneticAlgorithm(snapshots, factory(() => created++), config);
    const second = await geneticAlgorithm(snapshots, factory(), config);
    expect(created).toBe(first.totalTrials);
    expect(economicResult(first)).toEqual(economicResult(second));
    expect(first.best).toBe(first.trials[0]);
    expect(new Set(first.trials.map(t => JSON.stringify(t.params))).size).toBe(first.totalTrials);
  });
});
