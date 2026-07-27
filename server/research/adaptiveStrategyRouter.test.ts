import { describe, expect, it } from "vitest";
import type {
  MarketRegimeResearchReport,
  SectorOutlook,
  StockRegimeResult,
} from "./marketRegimeResearch";
import {
  evaluateExternalMarketShadow,
  routeAdaptiveStrategies,
  stabilizeAdaptiveStrategyRouting,
} from "./adaptiveStrategyRouter";

function sector(overrides: Partial<SectorOutlook> = {}): SectorOutlook {
  return {
    rank: 1,
    symbol: "BK0001",
    name: "测试行业",
    latestDate: "2026-07-15",
    barCount: 180,
    direction: "constructive",
    score: 72,
    confidence: 0.72,
    growthProbability3d: 68,
    growthProbability5d: 70,
    current: {
      changePercent: 1.2,
      mainNetInflow: 800_000_000,
      advancers: 60,
      decliners: 20,
      leaderName: "测试股份",
    },
    factors: {
      return5d: 0.03,
      return20d: 0.08,
      return60d: 0.16,
      ma20Slope5d: 0.025,
      annualizedVolatility20d: 0.22,
      volumeRatio5d: 1.05,
      breadthRatio: 0.75,
    },
    validation: {
      horizon3: {
        horizon: 3,
        samples: 80,
        directionalHitRate: 0.61,
        averageForwardReturn: 0.008,
        lastSignalDate: "2026-07-10",
        lastOutcomeDate: "2026-07-15",
      },
      horizon5: {
        horizon: 5,
        samples: 75,
        directionalHitRate: 0.6,
        averageForwardReturn: 0.012,
        lastSignalDate: "2026-07-08",
        lastOutcomeDate: "2026-07-15",
      },
    },
    evidence: ["中期趋势向上"],
    riskFlags: [],
    ...overrides,
  };
}

function stock(
  regime: StockRegimeResult["regime"],
  symbol = "600519",
): StockRegimeResult {
  return {
    rank: 1,
    symbol,
    name: "测试股票",
    latestDate: "2026-07-15",
    barCount: 180,
    regime,
    confidence: 0.72,
    features: {
      return5d: 0.01,
      return20d: regime === "trend-deterioration" ? -0.12 : 0.08,
      return60d: regime === "trend-deterioration" ? -0.18 : 0.16,
      pullbackFrom20DayHigh: 0.04,
      distanceFromMa20: 0.01,
      distanceFromMa60: 0.08,
      ma20Slope5d: regime === "trend-deterioration" ? -0.04 : 0.02,
      ma60Slope5d: regime === "trend-deterioration" ? -0.02 : 0.01,
      volumeRatio: regime === "trend-deterioration" ? 1.5 : 0.9,
    },
    validation: {
      samples: 30,
      hitRate5d: 0.6,
      averageForwardReturn5d: 0.01,
    },
    evidence: [],
    riskFlags: [],
  };
}

function report(input: {
  sourceStatus?: MarketRegimeResearchReport["sourceStatus"];
  sectors?: SectorOutlook[];
  stocks?: StockRegimeResult[];
} = {}): MarketRegimeResearchReport {
  const sectors = input.sectors ?? [sector(), sector({ symbol: "BK0002" })];
  const stocks = input.stocks ?? [stock("healthy-trend")];
  return {
    generatedAt: "2026-07-15T01:00:00.000Z",
    mode: "paper",
    provider: "akshare",
    sourceStatus: input.sourceStatus ?? "live-read-only",
    source: {
      sectorSource: "ths-industry-summary",
      sectorHistorySource: "ths-industry-history",
      stockHistorySource: "tencent-stock-history",
      fetchedAt: "2026-07-15T01:00:00.000Z",
      days: 180,
      sectorAdjustment: "none",
      stockAdjustment: "qfq",
      sectorCount: sectors.length,
      stockCount: stocks.length,
    },
    methodology: {
      version: "1.0.0",
      horizons: [3, 5],
      minimumBars: 60,
      walkForward: true,
      probabilityMeaning: "research score",
    },
    sectorOutlooks: sectors,
    stockRegimes: stocks,
    warnings: [],
    guardrails: [],
  };
}

describe("routeAdaptiveStrategies", () => {
  it("keeps external-market research inactive before the shadow gate", () => {
    const shadow = evaluateExternalMarketShadow({
      bias: "restrictive",
      samples: 249,
      windows: 3,
      directionalHitRate: 0.58,
      officialConfidence: 0.72,
      officialAllowNewPositions: true,
    });

    expect(shadow.status).toBe("collecting");
    expect(shadow.proposedConfidenceModifier).toBe(0);
    expect(shadow.proposedConfidence).toBe(0.72);
  });

  it("records a bounded restrictive modifier without changing the official route", () => {
    const result = routeAdaptiveStrategies(report(), {
      bias: "restrictive",
      samples: 300,
      windows: 3,
      directionalHitRate: 0.55,
    });

    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.allowNewPositions).toBe(true);
    expect(result.shadow?.externalMarket).toMatchObject({
      status: "eligible",
      proposedConfidenceModifier: -0.05,
      proposedAllowNewPositions: true,
    });
    expect(result.shadow!.externalMarket.proposedConfidence).toBeLessThan(
      result.confidence,
    );
  });

  it("never lets a supportive shadow signal enable forbidden positions", () => {
    const shadow = evaluateExternalMarketShadow({
      bias: "supportive",
      samples: 300,
      windows: 3,
      directionalHitRate: 0.55,
      officialConfidence: 0,
      officialAllowNewPositions: false,
    });

    expect(shadow.status).toBe("eligible");
    expect(shadow.proposedConfidenceModifier).toBe(0.05);
    expect(shadow.proposedAllowNewPositions).toBe(false);
  });

  it("enables trend strategies in a constructive low-volatility market", () => {
    const result = routeAdaptiveStrategies(report());

    expect(result.regime).toBe("trend-up-low-volatility");
    expect(result.positionPosture).toBe("accumulate");
    expect(result.allowNewPositions).toBe(true);
    expect(result.eligibleStrategyKeys).toEqual(expect.arrayContaining([
      "kairosLowVolTrend",
      "kairosTrendHealth",
      "movingAverageCross",
      "momentum",
      "turtle",
    ]));
    expect(result.cashReserveRatio).toBe(0.1);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.version).toBe("1.3.0");
    expect(result.strategyPlaybook.primaryStrategyKeys).toEqual([
      "kairosLowVolTrend",
      "kairosTrendHealth",
    ]);
    expect(result.strategyPlaybook.useWhen).toContain("趋势");
    expect(result.capitalPacing.openingMaxInvestedRatio).toBeLessThan(
      result.capitalPacing.closingMaxInvestedRatio,
    );
  });

  it("prefers pullback and defensive strategies when an uptrend is volatile", () => {
    const volatileSectors = [
      sector({ factors: { ...sector().factors, annualizedVolatility20d: 0.52 } }),
      sector({
        symbol: "BK0002",
        factors: { ...sector().factors, annualizedVolatility20d: 0.48 },
      }),
    ];

    const result = routeAdaptiveStrategies(report({ sectors: volatileSectors }));

    expect(result.regime).toBe("trend-up-high-volatility");
    expect(result.positionPosture).toBe("hold");
    expect(result.eligibleStrategyKeys).toEqual(expect.arrayContaining([
      "kairosQuietPullback",
      "kairosWashoutRecovery",
      "aSharePullback",
      "kairosCapitalShield",
    ]));
    expect(result.newPositionScale).toBeLessThan(1);
    expect(result.cashReserveRatio).toBeGreaterThanOrEqual(0.25);
    expect(result.strategyPlaybook.avoidWhen).toContain("追高");
    expect(result.capitalPacing.openingMaxInvestedRatio).toBeLessThanOrEqual(0.4);
  });

  it("switches to capital protection when trends and breadth deteriorate", () => {
    const weak = sector({
      direction: "cautious",
      score: 28,
      growthProbability3d: 25,
      growthProbability5d: 24,
      factors: {
        ...sector().factors,
        return20d: -0.09,
        return60d: -0.15,
        ma20Slope5d: -0.035,
        annualizedVolatility20d: 0.46,
        breadthRatio: 0.22,
      },
    });
    const result = routeAdaptiveStrategies(report({
      sectors: [weak, { ...weak, symbol: "BK0002" }],
      stocks: [
        stock("trend-deterioration", "600519"),
        stock("trend-deterioration", "000001"),
      ],
    }));

    expect(result.regime).toBe("risk-off");
    expect(result.positionPosture).toBe("reduce");
    expect(result.allowNewPositions).toBe(false);
    expect(result.eligibleStrategyKeys).toEqual(["kairosCapitalShield"]);
    expect(result.cashReserveRatio).toBeGreaterThanOrEqual(0.5);
    expect(result.strategyPlaybook.primaryStrategyKeys).toEqual([
      "kairosCapitalShield",
    ]);
  });

  it("separates a broad intraday recovery from a confirmed medium-term trend", () => {
    const recoveringWeakSector = sector({
      direction: "cautious",
      score: 38,
      current: {
        ...sector().current,
        changePercent: 3.2,
        advancers: 68,
        decliners: 32,
      },
      factors: {
        ...sector().factors,
        return20d: -0.08,
        return60d: -0.14,
        ma20Slope5d: -0.03,
        annualizedVolatility20d: 0.48,
        breadthRatio: 0.68,
      },
    });

    const result = routeAdaptiveStrategies(report({
      sectors: [
        recoveringWeakSector,
        { ...recoveringWeakSector, symbol: "BK0002", name: "测试行业二" },
      ],
      stocks: [
        stock("trend-deterioration", "600519"),
        stock("trend-deterioration", "000001"),
      ],
    }));

    expect(result.regime).toBe("risk-off-recovery");
    expect(result.positionPosture).toBe("hold");
    expect(result.allowNewPositions).toBe(false);
    expect(result.cashReserveRatio).toBeGreaterThanOrEqual(0.55);
    expect(result.eligibleStrategyKeys).toEqual([
      "kairosRiskOffRecovery",
      "kairosCapitalShield",
    ]);
    expect(result.evidence.join(" ")).toContain("单日修复");
    expect(result.riskFlags.join(" ")).toContain("不能直接覆盖");
    expect(result.metrics.averageCurrentChangePercent).toBe(3.2);
  });

  it("falls back to cash when real history is degraded", () => {
    const result = routeAdaptiveStrategies(report({
      sourceStatus: "degraded",
      sectors: [],
      stocks: [],
    }));

    expect(result.regime).toBe("unclear");
    expect(result.allowNewPositions).toBe(false);
    expect(result.positionPosture).toBe("hold");
    expect(result.eligibleStrategyKeys).toEqual(["kairosCapitalShield"]);
    expect(result.evidence.join(" ")).toContain("降级");
    expect(result.strategyPlaybook.useWhen).toContain("数据");
  });

  it("retains the last confirmed risk-off label during a transient data downgrade without selling", () => {
    const degraded = routeAdaptiveStrategies(report({
      sourceStatus: "degraded",
      sectors: [],
      stocks: [],
    }));

    const result = stabilizeAdaptiveStrategyRouting({
      current: degraded,
      sourceStatus: "degraded",
      previousConfirmed: {
        regime: "risk-off",
        confirmedAt: "2026-07-22T06:54:47.616Z",
      },
    });

    expect(result.regime).toBe("risk-off");
    expect(result.allowNewPositions).toBe(false);
    expect(result.positionPosture).toBe("hold");
    expect(result.newPositionScale).toBe(0);
    expect(result.eligibleStrategyKeys).toEqual(["kairosCapitalShield"]);
    expect(result.stability).toMatchObject({
      status: "degraded-defensive-hold",
      observedRegime: "unclear",
      previousConfirmedRegime: "risk-off",
      previousConfirmedAt: "2026-07-22T06:54:47.616Z",
    });
    expect(result.evidence.join(" ")).toContain("保留上一条已确认防守状态");
    expect(result.riskFlags.join(" ")).toContain("暂停新增和数据不足下的减仓");
  });

  it("does not reuse a previous defensive label after live research recovers", () => {
    const current = routeAdaptiveStrategies(report());
    const result = stabilizeAdaptiveStrategyRouting({
      current,
      sourceStatus: "live-read-only",
      previousConfirmed: {
        regime: "risk-off",
        confirmedAt: "2026-07-22T06:54:47.616Z",
      },
    });

    expect(result).toBe(current);
    expect(result.regime).toBe("trend-up-low-volatility");
    expect(result.allowNewPositions).toBe(true);
    expect(result.stability.status).toBe("direct");
  });

  it("does not reuse a live defensive label when real research is disabled", () => {
    const unavailable = routeAdaptiveStrategies(report({
      sourceStatus: "mock-disabled",
      sectors: [],
      stocks: [],
    }));
    const result = stabilizeAdaptiveStrategyRouting({
      current: unavailable,
      sourceStatus: "mock-disabled",
      previousConfirmed: {
        regime: "risk-off",
        confirmedAt: "2026-07-22T06:54:47.616Z",
      },
    });

    expect(result).toBe(unavailable);
    expect(result.regime).toBe("unclear");
    expect(result.stability.status).toBe("direct");
  });

  it("uses mean reversion only in a low-volatility range", () => {
    const quietRange = sector({
      factors: {
        ...sector().factors,
        return20d: 0.01,
        return60d: 0.02,
        ma20Slope5d: 0.003,
        annualizedVolatility20d: 0.2,
        breadthRatio: 0.52,
      },
    });
    const result = routeAdaptiveStrategies(report({
      sectors: [quietRange, { ...quietRange, symbol: "BK0002" }],
    }));

    expect(result.regime).toBe("range-low-volatility");
    expect(result.strategyPlaybook.primaryStrategyKeys).toEqual([
      "rsi",
      "bollingerBands",
    ]);
    expect(result.strategyPlaybook.avoidWhen).toContain("突破");
  });

  it("uses defensive pullback logic in a high-volatility range", () => {
    const volatileRange = sector({
      factors: {
        ...sector().factors,
        return20d: 0,
        return60d: 0.01,
        ma20Slope5d: -0.002,
        annualizedVolatility20d: 0.48,
        breadthRatio: 0.45,
      },
    });
    const result = routeAdaptiveStrategies(report({
      sectors: [volatileRange, { ...volatileRange, symbol: "BK0002" }],
    }));

    expect(result.regime).toBe("range-high-volatility");
    expect(result.strategyPlaybook.primaryStrategyKeys).toEqual([
      "kairosCapitalShield",
      "kairosQuietPullback",
    ]);
    expect(result.capitalPacing.closingMaxInvestedRatio).toBeLessThanOrEqual(0.6);
  });

  it("requires available breadth to confirm an otherwise positive trend", () => {
    const narrowTrend = sector({
      factors: {
        ...sector().factors,
        breadthRatio: 0.32,
      },
    });
    const result = routeAdaptiveStrategies(report({
      sectors: [narrowTrend, { ...narrowTrend, symbol: "BK0002" }],
    }));

    expect(result.regime).toBe("range-low-volatility");
    expect(result.riskFlags.join(" ")).toContain("宽度");
  });
});
