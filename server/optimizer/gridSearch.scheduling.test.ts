import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BacktestStrategy } from "../../shared/backtest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "../backtest/backtestEngine";
import { gridSearch } from "./gridSearch";
import { computeScore } from "./scoreUtils";
import type { StrategyFactory } from "./types";

const snapshots: MarketSnapshot[] = [10, 12, 11, 14].map((price, index) => {
  const marketTime = `2024-01-0${index + 2}T15:00:00+08:00`;
  return {
    mode: "paper",
    sequence: index + 1,
    marketTime,
    quotes: [{
      symbol: "600001",
      name: "Scheduling fixture",
      tradable: true,
      price,
      previousClose: 10,
      changePercent: 0,
      volume: 1_000_000,
      updatedAt: marketTime,
    }],
  };
});

function spendCpu(milliseconds = 2): void {
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) {
    // Deterministic test workload: no asynchronous I/O can yield on our behalf.
  }
}

function strategy(params: Record<string, number>): BacktestStrategy {
  return {
    name: "Scheduling fixture",
    onBar: ({ barIndex }) => {
      if (barIndex === 0) {
        return [{ symbol: "600001", side: "buy", type: "market", quantity: params.units * 100 }];
      }
      if (barIndex === params.sellAt) {
        return [{ symbol: "600001", side: "sell", type: "market", quantity: params.units * 100 }];
      }
      return [];
    },
  };
}

const backtest = {
  initialCapital: 10_000,
  commissionRate: 0,
  minimumCommission: 0,
  slippageBps: 0,
  maxOrderNotional: 10_000,
  maxPositionWeight: 1,
};
const objectives = [{ metric: "totalReturn" as const, weight: 1 }];

afterEach(() => vi.restoreAllMocks());

describe("grid search event-loop scheduling", () => {
  it("lets a real timer run before a CPU-bound search completes", async () => {
    let completedTrials = 0;
    let observedTrials: number | undefined;
    const timer = setTimeout(() => { observedTrials = completedTrials; }, 0);
    const factory: StrategyFactory = {
      name: "CPU-bound fixture",
      parameters: [{ name: "iteration", type: "int", min: 1, max: 12 }],
      create: () => {
        spendCpu();
        completedTrials += 1;
        return { name: "No trades", onBar: () => [] };
      },
    };

    try {
      const report = await gridSearch(snapshots, factory, { objectives, backtest });
      expect(report.totalTrials).toBe(12);
      expect(observedTrials).toBeDefined();
      expect(observedTrials!).toBeLessThan(12);
    } finally {
      clearTimeout(timer);
    }
  });

  it("keeps every trial, score, stable order and best result identical to direct backtests", async () => {
    const factory: StrategyFactory = {
      name: "Scheduling fixture",
      parameters: [
        { name: "units", type: "int", min: 1, max: 3 },
        { name: "sellAt", type: "int", min: 1, max: 2 },
      ],
      create: (params) => {
        spendCpu();
        return strategy(params);
      },
    };
    const expected = [1, 2, 3].flatMap((units) => [1, 2].map((sellAt) => ({ units, sellAt })))
      .map((params, index) => {
        const metrics = new BacktestEngine(snapshots, strategy(params), backtest).run().metrics;
        return { id: index + 1, params, metrics, score: computeScore(metrics, objectives) };
      })
      .sort((left, right) => right.score - left.score);

    const report = await gridSearch(snapshots, factory, { objectives, backtest });
    const businessTrials = report.trials.map(({ executionTimeMs: _duration, ...trial }) => trial);

    expect(report.totalTrials).toBe(6);
    expect(businessTrials).toEqual(expected);
    expect(report.trials.map((trial) => trial.id)).toEqual([5, 3, 6, 1, 4, 2]);
    expect(report.best).toBe(report.trials[0]);
    expect(report.best.params).toEqual({ units: 3, sellAt: 1 });
    expect(report.best.metrics).toEqual(expected[0].metrics);
  });

  it("also yields while failed combinations are skipped and preserves later trial ids", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let attempted = 0;
    let observedAttempts: number | undefined;
    const timer = setTimeout(() => { observedAttempts = attempted; }, 0);
    const factory: StrategyFactory = {
      name: "Failing CPU-bound fixture",
      parameters: [{ name: "iteration", type: "int", min: 1, max: 19 }],
      create: ({ iteration }) => {
        spendCpu();
        attempted += 1;
        if (iteration < 19) throw new Error("Rejected fixture combination");
        return { name: "No trades", onBar: () => [] };
      },
    };

    try {
      const report = await gridSearch(snapshots, factory, { objectives, backtest });
      expect(warnings).toHaveBeenCalledTimes(18);
      expect(report.totalTrials).toBe(1);
      expect(report.best.id).toBe(19);
      expect(observedAttempts).toBeDefined();
      expect(observedAttempts!).toBeLessThan(19);
    } finally {
      clearTimeout(timer);
    }
  });
});
