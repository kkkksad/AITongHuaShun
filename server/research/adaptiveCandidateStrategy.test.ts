import { describe, expect, it } from "vitest";
import type { MarketQuote } from "../../shared/trading";
import type { AdaptiveStrategyRouting } from "./adaptiveStrategyRouter";
import {
  rankAdaptiveCandidateStrategies,
  selectAdaptiveCandidateStrategy,
} from "./adaptiveCandidateStrategy";
import type { StockRegimeResult } from "./marketRegimeResearch";

const quote: MarketQuote = {
  symbol: "600519",
  name: "测试股票",
  tradable: true,
  price: 100,
  previousClose: 99.4,
  changePercent: 0.6,
  volume: 12_000_000,
  amount: 1_200_000_000,
  turnover: 2.1,
  amplitude: 3.2,
  open: 99.5,
  high: 100.8,
  low: 99.1,
  updatedAt: "2026-08-08T02:00:00.000Z",
};

function stock(
  regime: StockRegimeResult["regime"],
  overrides: Partial<StockRegimeResult> = {},
): StockRegimeResult {
  return {
    rank: 1,
    symbol: quote.symbol,
    name: quote.name,
    latestDate: "2026-08-07",
    barCount: 180,
    regime,
    confidence: 0.72,
    features: {
      return5d: 0.015,
      return20d: 0.08,
      return60d: 0.16,
      pullbackFrom20DayHigh: 0.035,
      distanceFromMa20: 0.012,
      distanceFromMa60: 0.09,
      ma20Slope5d: 0.02,
      ma60Slope5d: 0.01,
      volumeRatio: 0.88,
    },
    validation: {
      samples: 32,
      hitRate5d: 0.61,
      averageForwardReturn5d: 0.012,
    },
    evidence: ["真实历史趋势保持向上"],
    riskFlags: [],
    ...overrides,
  };
}

function routing(
  overrides: Partial<AdaptiveStrategyRouting> = {},
): AdaptiveStrategyRouting {
  return {
    version: "1.4.0",
    generatedAt: "2026-08-08T02:00:00.000Z",
    regime: "trend-up-low-volatility",
    confidence: 0.72,
    positionPosture: "accumulate",
    allowNewPositions: true,
    cashReserveRatio: 0.1,
    newPositionScale: 1,
    eligibleStrategyKeys: [
      "kairosLowVolTrend",
      "kairosTrendHealth",
      "momentum",
    ],
    disabledStrategyKeys: [],
    strategyPlaybook: {
      primaryStrategyKeys: ["kairosLowVolTrend", "kairosTrendHealth"],
      useWhen: "趋势和低波动确认",
      avoidWhen: "趋势转弱",
      recheckTriggers: ["宽度转弱"],
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
      rationale: "test",
    },
    evidence: [],
    riskFlags: [],
    metrics: {
      constructiveSectorRatio: 0.7,
      cautiousSectorRatio: 0.1,
      averageReturn20d: 0.08,
      averageReturn60d: 0.15,
      averageMa20Slope5d: 0.02,
      averageVolatility20d: 0.22,
      averageBreadthRatio: 0.65,
      averageCurrentChangePercent: 0.8,
      healthyStockRatio: 0.7,
      deterioratingStockRatio: 0.1,
    },
    ...overrides,
  };
}

describe("adaptive candidate strategy routing", () => {
  it("ranks several evidence-backed trend strategies for a healthy stock", () => {
    const signals = rankAdaptiveCandidateStrategies({
      quote,
      stockRegime: stock("healthy-trend"),
      routing: routing(),
      candidateScore: 84,
    });

    expect(signals.map((signal) => signal.strategyKey)).toEqual(
      expect.arrayContaining([
        "kairosLowVolTrend",
        "kairosTrendHealth",
        "momentum",
      ]),
    );
    expect(selectAdaptiveCandidateStrategy({
      quote,
      stockRegime: stock("healthy-trend"),
      routing: routing(),
      candidateScore: 84,
    })).toMatchObject({
      strategyKey: "kairosLowVolTrend",
      strategyName: "KAIROS低波趋势",
    });
  });

  it("uses validated washout and quiet-pullback strategies in a volatile uptrend", () => {
    const washout = stock("washout-candidate", {
      features: {
        ...stock("washout-candidate").features,
        return5d: -0.018,
        pullbackFrom20DayHigh: 0.065,
        volumeRatio: 0.72,
      },
    });
    const volatileRouting = routing({
      regime: "trend-up-high-volatility",
      eligibleStrategyKeys: [
        "kairosQuietPullback",
        "kairosWashoutRecovery",
        "aSharePullback",
      ],
      strategyPlaybook: {
        primaryStrategyKeys: ["kairosQuietPullback", "kairosWashoutRecovery"],
        useWhen: "缩量回踩确认",
        avoidWhen: "追高",
        recheckTriggers: ["重新站稳"],
      },
    });

    expect(rankAdaptiveCandidateStrategies({
      quote,
      stockRegime: washout,
      routing: volatileRouting,
      candidateScore: 82,
    }).map((signal) => signal.strategyKey)).toEqual(expect.arrayContaining([
      "kairosQuietPullback",
      "kairosWashoutRecovery",
      "aSharePullback",
    ]));
  });

  it("does not create a buy strategy when the market route forbids new positions", () => {
    expect(selectAdaptiveCandidateStrategy({
      quote,
      stockRegime: stock("healthy-trend"),
      routing: routing({
        regime: "risk-off",
        allowNewPositions: false,
        positionPosture: "reduce",
        eligibleStrategyKeys: ["kairosCapitalShield"],
      }),
      candidateScore: 95,
    })).toBeNull();
  });

  it("adds trend coverage for moving average, MACD, and Turtle rules", () => {
    const trendRouting = routing({
      eligibleStrategyKeys: ["movingAverageCross", "macd", "turtle"],
      strategyPlaybook: {
        primaryStrategyKeys: ["movingAverageCross", "macd"],
        useWhen: "趋势确认",
        avoidWhen: "追高",
        recheckTriggers: ["均线转弱"],
      },
    });

    const keys = rankAdaptiveCandidateStrategies({
      quote,
      stockRegime: stock("healthy-trend"),
      routing: trendRouting,
      candidateScore: 84,
    }).map((signal) => signal.strategyKey);

    expect(keys).toEqual(expect.arrayContaining([
      "movingAverageCross",
      "macd",
      "turtle",
    ]));
  });

  it("adds small range-only RSI and Bollinger coverage near the lower intraday area", () => {
    const rangeQuote = {
      ...quote,
      price: 99.2,
      changePercent: -0.8,
      open: 100,
      high: 101,
      low: 98.8,
      amplitude: 2.2,
    };
    const rangeStock = stock("unclear", {
      confidence: 0.6,
      features: {
        ...stock("unclear").features,
        return5d: -0.012,
        return20d: -0.008,
        return60d: 0.01,
        distanceFromMa20: -0.025,
        ma20Slope5d: -0.002,
      },
    });
    const rangeRouting = routing({
      regime: "range-low-volatility",
      eligibleStrategyKeys: ["rsi", "bollingerBands"],
      strategyPlaybook: {
        primaryStrategyKeys: ["rsi", "bollingerBands"],
        useWhen: "区间边缘",
        avoidWhen: "趋势恶化",
        recheckTriggers: ["突破确认"],
      },
    });

    expect(rankAdaptiveCandidateStrategies({
      quote: rangeQuote,
      stockRegime: rangeStock,
      routing: rangeRouting,
      candidateScore: 76,
    }).map((signal) => signal.strategyKey)).toEqual(expect.arrayContaining([
      "rsi",
      "bollingerBands",
    ]));
  });

  it("blocks range signals for a deteriorating stock even when the route allows them", () => {
    expect(rankAdaptiveCandidateStrategies({
      quote: { ...quote, changePercent: -0.6 },
      stockRegime: stock("trend-deterioration"),
      routing: routing({
        regime: "range-low-volatility",
        eligibleStrategyKeys: ["rsi", "bollingerBands"],
      }),
      candidateScore: 90,
    })).toEqual([]);
  });

  it("requires a tradable quote and an explicitly eligible strategy key", () => {
    expect(rankAdaptiveCandidateStrategies({
      quote: { ...quote, tradable: false },
      stockRegime: stock("healthy-trend"),
      routing: routing(),
      candidateScore: 90,
    })).toEqual([]);
    expect(rankAdaptiveCandidateStrategies({
      quote,
      stockRegime: stock("healthy-trend"),
      routing: routing({ eligibleStrategyKeys: ["kairosCapitalShield"] }),
      candidateScore: 90,
    })).toEqual([]);
  });
});
