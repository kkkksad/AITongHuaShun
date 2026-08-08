import { describe, expect, it } from "vitest";
import type { AdaptiveStrategyRouting } from "../research/adaptiveStrategyRouter";
import {
  getAshareTradingPhase,
  getPhaseCumulativeOrderLimit,
  getIntradayExecutionPolicy,
} from "./intradayExecutionPolicy";

function routing(): AdaptiveStrategyRouting {
  return {
    version: "1.4.0",
    generatedAt: "2026-07-17T01:30:00.000Z",
    regime: "trend-up-low-volatility",
    confidence: 0.72,
    positionPosture: "accumulate",
    allowNewPositions: true,
    cashReserveRatio: 0.1,
    newPositionScale: 1,
    eligibleStrategyKeys: ["kairosLowVolTrend"],
    disabledStrategyKeys: [],
    strategyPlaybook: {
      primaryStrategyKeys: ["kairosLowVolTrend"],
      useWhen: "trend confirmed",
      avoidWhen: "trend weakens",
      recheckTriggers: ["breadth weakens"],
    },
    capitalPacing: {
      openingMaxInvestedRatio: 0.55,
      morningMaxInvestedRatio: 0.7,
      afternoonMaxInvestedRatio: 0.82,
      closingMaxInvestedRatio: 0.9,
    },
    stability: {
      status: "direct",
      observedRegime: "trend-up-low-volatility",
      previousConfirmedRegime: null,
      previousConfirmedAt: null,
      rationale: "test fixture",
    },
    evidence: [],
    riskFlags: [],
    metrics: {
      constructiveSectorRatio: 0.7,
      cautiousSectorRatio: 0.1,
      averageReturn20d: 0.08,
      averageReturn60d: 0.16,
      averageMa20Slope5d: 0.02,
      averageVolatility20d: 0.22,
      averageBreadthRatio: 0.65,
      averageCurrentChangePercent: 1.2,
      healthyStockRatio: 0.6,
      deterioratingStockRatio: 0.1,
    },
  };
}

describe("intraday execution policy", () => {
  it.each([
    ["2026-07-17T09:30:00+08:00", "opening"],
    ["2026-07-17T10:15:00+08:00", "morning-confirmation"],
    ["2026-07-17T13:00:00+08:00", "afternoon-confirmation"],
    ["2026-07-17T14:15:00+08:00", "closing-risk-review"],
  ] as const)("classifies %s as %s", (value, expected) => {
    expect(getAshareTradingPhase(new Date(value))).toBe(expected);
  });

  it("uses the routing cap for each phase", () => {
    expect(getIntradayExecutionPolicy(
      new Date("2026-07-17T09:45:00+08:00"),
      routing(),
    ).maxInvestedRatio).toBe(0.55);
    expect(getIntradayExecutionPolicy(
      new Date("2026-07-17T14:30:00+08:00"),
      routing(),
    ).maxInvestedRatio).toBe(0.9);
  });

  it("uses conservative defaults without real adaptive routing", () => {
    const result = getIntradayExecutionPolicy(
      new Date("2026-07-17T09:45:00+08:00"),
      null,
    );

    expect(result.phase).toBe("opening");
    expect(result.maxInvestedRatio).toBe(0.45);
    expect(result.source).toBe("conservative-default");
  });

  it("uses the closing cap for an explicit out-of-session manual paper run", () => {
    const result = getIntradayExecutionPolicy(
      new Date("2026-07-17T20:00:00+08:00"),
      routing(),
    );

    expect(result.phase).toBe("closed");
    expect(result.maxInvestedRatio).toBe(0.9);
  });

  it("reserves automatic order capacity for later confirmation phases", () => {
    expect(getPhaseCumulativeOrderLimit(4, "opening")).toBe(2);
    expect(getPhaseCumulativeOrderLimit(4, "morning-confirmation")).toBe(3);
    expect(getPhaseCumulativeOrderLimit(4, "afternoon-confirmation")).toBe(4);
    expect(getPhaseCumulativeOrderLimit(4, "closing-risk-review")).toBe(4);
  });
});
