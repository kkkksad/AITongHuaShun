import { describe, expect, it } from "vitest";
import type { MarketQuote } from "../../shared/trading";
import type { AdaptiveStrategyRouting } from "./adaptiveStrategyRouter";
import {
  rankAdaptiveCandidateStrategies,
  selectAdaptiveCandidateStrategy,
  selectAdaptiveCandidateStrategyWithUsage,
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

  it("adds a controlled range-rotation signal in a high-volatility range", () => {
    const rangeQuote = {
      ...quote,
      price: 99.8,
      changePercent: -0.2,
      open: 100,
      high: 101,
      low: 98.6,
      amplitude: 3.4,
    };
    const rangeStock = stock("healthy-trend", {
      confidence: 0.64,
      features: {
        ...stock("healthy-trend").features,
        return20d: 0.025,
        return60d: 0.06,
        distanceFromMa20: 0.012,
        ma20Slope5d: 0.004,
      },
    });
    const rangeRouting = routing({
      regime: "range-high-volatility",
      eligibleStrategyKeys: ["kairosRangeRotation", "kairosQualifiedProbe", "rsi"],
      strategyPlaybook: {
        primaryStrategyKeys: ["kairosRangeRotation", "rsi"],
        useWhen: "高波震荡中的受控轮动",
        avoidWhen: "趋势恶化或追高",
        recheckTriggers: ["波动继续放大"],
      },
    });

    expect(rankAdaptiveCandidateStrategies({
      quote: rangeQuote,
      stockRegime: rangeStock,
      routing: rangeRouting,
      candidateScore: 78,
    }).map((signal) => signal.strategyKey)).toContain("kairosRangeRotation");

    const afternoonSignals = rankAdaptiveCandidateStrategies({
      quote: rangeQuote,
      stockRegime: rangeStock,
      routing: rangeRouting,
      candidateScore: 78,
      activityTargetActive: true,
    });
    expect(selectAdaptiveCandidateStrategyWithUsage(afternoonSignals, {
      kairosRangeRotation: 1,
      kairosQualifiedProbe: 0,
    })).toMatchObject({ strategyKey: "kairosQualifiedProbe" });
  });

  it("only emits a qualified probe when the afternoon activity target activates it", () => {
    const probeRouting = routing({
      regime: "range-high-volatility",
      eligibleStrategyKeys: ["kairosQualifiedProbe"],
      strategyPlaybook: {
        primaryStrategyKeys: ["kairosQualifiedProbe"],
        useWhen: "下午目标缺口",
        avoidWhen: "数据或风控不完整",
        recheckTriggers: ["目标已完成"],
      },
    });
    const input = {
      quote,
      stockRegime: stock("healthy-trend"),
      routing: probeRouting,
      candidateScore: 78,
    };

    expect(rankAdaptiveCandidateStrategies(input)).toEqual([]);
    expect(rankAdaptiveCandidateStrategies({
      ...input,
      activityTargetActive: true,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        strategyKey: "kairosQualifiedProbe",
        strategyName: "KAIROS合格样本验证",
      }),
    ]));
  });

  it("only emits the validation basket in validation-probe mode as a fallback", () => {
    const validationRouting = routing({
      regime: "range-high-volatility",
      eligibleStrategyKeys: ["kairosValidationBasket"],
      strategyPlaybook: {
        primaryStrategyKeys: ["kairosRangeRotation"],
        useWhen: "非 risk-off 的验证样本收集",
        avoidWhen: "数据、流动性或风控未通过",
        recheckTriggers: ["历史覆盖恢复"],
      },
    });
    const input = {
      quote: { ...quote, changePercent: -0.6, amplitude: 4.2 },
      stockRegime: stock("unclear", {
        confidence: 0.6,
        features: {
          ...stock("unclear").features,
          return20d: 0.01,
          distanceFromMa20: -0.02,
          ma20Slope5d: -0.002,
        },
      }),
      routing: validationRouting,
      candidateScore: 72,
      activityTargetActive: true,
    };

    expect(rankAdaptiveCandidateStrategies(input)).toEqual([]);
    expect(rankAdaptiveCandidateStrategies({
      ...input,
      validationProbeActive: true,
    })).toEqual([
      expect.objectContaining({
        strategyKey: "kairosValidationBasket",
        strategyName: "KAIROS验证篮子",
      }),
    ]);
  });

  it("rotates among near-top qualified strategies using recent filled usage", () => {
    const signals = [
      {
        strategyKey: "kairosLowVolTrend" as const,
        strategyName: "KAIROS低波趋势",
        score: 88,
        evidence: ["低波趋势"],
      },
      {
        strategyKey: "kairosTrendHealth" as const,
        strategyName: "KAIROS趋势健康",
        score: 84,
        evidence: ["趋势健康"],
      },
      {
        strategyKey: "momentum" as const,
        strategyName: "趋势动量确认",
        score: 72,
        evidence: ["动量"],
      },
    ];

    expect(selectAdaptiveCandidateStrategyWithUsage(signals, {
      kairosLowVolTrend: 3,
      kairosTrendHealth: 0,
    })).toMatchObject({ strategyKey: "kairosTrendHealth" });
    expect(selectAdaptiveCandidateStrategyWithUsage(signals, {
      kairosLowVolTrend: 3,
      kairosTrendHealth: 3,
    })).toMatchObject({ strategyKey: "kairosLowVolTrend" });
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
