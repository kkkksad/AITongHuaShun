/**
 * 优化得分计算工具 —— gridSearch 和 geneticAlgorithm 共用。
 */

import type { BacktestMetrics } from "../../shared/backtest";
import type { ObjectiveFunction } from "./types";

export function computeScore(
  metrics: BacktestMetrics,
  objectives: { metric: ObjectiveFunction; weight: number }[],
): number {
  let score = 0;

  for (const { metric, weight } of objectives) {
    const raw = metrics[metric];
    let normalized: number;

    switch (metric) {
      case "sharpeRatio":
        normalized = Math.max(-5, Math.min(10, raw));
        break;
      case "totalReturn":
        normalized = Math.max(-1, Math.min(5, raw));
        break;
      case "calmarRatio":
        normalized = Math.max(-5, Math.min(20, raw));
        break;
      case "sortinoRatio":
        normalized = Math.max(-5, Math.min(10, raw));
        break;
      case "profitFactor":
        normalized = Math.max(0, Math.min(10, raw));
        break;
      case "winRate":
        normalized = raw;
        break;
    }

    score += normalized * weight;
  }

  return score;
}
