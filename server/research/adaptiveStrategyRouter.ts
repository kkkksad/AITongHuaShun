import type { MarketRegimeResearchReport } from "./marketRegimeResearch";

export type AdaptiveMarketRegime =
  | "trend-up-low-volatility"
  | "trend-up-high-volatility"
  | "range-low-volatility"
  | "range-high-volatility"
  | "risk-off"
  | "unclear";

export type AdaptivePositionPosture = "accumulate" | "hold" | "reduce";

export interface AdaptiveStrategyRouting {
  version: "1.0.0";
  generatedAt: string;
  regime: AdaptiveMarketRegime;
  confidence: number;
  positionPosture: AdaptivePositionPosture;
  allowNewPositions: boolean;
  cashReserveRatio: number;
  newPositionScale: number;
  eligibleStrategyKeys: string[];
  disabledStrategyKeys: string[];
  evidence: string[];
  riskFlags: string[];
  metrics: {
    constructiveSectorRatio: number;
    cautiousSectorRatio: number;
    averageReturn20d: number;
    averageReturn60d: number;
    averageMa20Slope5d: number;
    averageVolatility20d: number;
    averageBreadthRatio: number | null;
    healthyStockRatio: number;
    deterioratingStockRatio: number;
  };
}

const ALL_STRATEGY_KEYS = [
  "kairosLowVolTrend",
  "kairosQuietPullback",
  "kairosCapitalShield",
  "kairosWashoutRecovery",
  "kairosTrendHealth",
  "aSharePullback",
  "movingAverageCross",
  "momentum",
  "macd",
  "turtle",
  "rsi",
  "bollingerBands",
] as const;

const STRATEGIES: Record<AdaptiveMarketRegime, string[]> = {
  "trend-up-low-volatility": [
    "kairosLowVolTrend",
    "kairosTrendHealth",
    "movingAverageCross",
    "momentum",
    "macd",
    "turtle",
  ],
  "trend-up-high-volatility": [
    "kairosQuietPullback",
    "kairosWashoutRecovery",
    "aSharePullback",
    "kairosCapitalShield",
  ],
  "range-low-volatility": [
    "rsi",
    "bollingerBands",
    "kairosCapitalShield",
  ],
  "range-high-volatility": [
    "kairosQuietPullback",
    "rsi",
    "kairosCapitalShield",
  ],
  "risk-off": ["kairosCapitalShield"],
  unclear: ["kairosCapitalShield"],
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function riskProfile(regime: AdaptiveMarketRegime): Pick<
  AdaptiveStrategyRouting,
  "positionPosture" | "allowNewPositions" | "cashReserveRatio" | "newPositionScale"
> {
  switch (regime) {
    case "trend-up-low-volatility":
      return {
        positionPosture: "accumulate",
        allowNewPositions: true,
        cashReserveRatio: 0.1,
        newPositionScale: 1,
      };
    case "trend-up-high-volatility":
      return {
        positionPosture: "hold",
        allowNewPositions: true,
        cashReserveRatio: 0.25,
        newPositionScale: 0.5,
      };
    case "range-low-volatility":
      return {
        positionPosture: "hold",
        allowNewPositions: true,
        cashReserveRatio: 0.25,
        newPositionScale: 0.45,
      };
    case "range-high-volatility":
      return {
        positionPosture: "hold",
        allowNewPositions: true,
        cashReserveRatio: 0.4,
        newPositionScale: 0.25,
      };
    case "risk-off":
      return {
        positionPosture: "reduce",
        allowNewPositions: false,
        cashReserveRatio: 0.55,
        newPositionScale: 0,
      };
    case "unclear":
      return {
        positionPosture: "hold",
        allowNewPositions: false,
        cashReserveRatio: 0.7,
        newPositionScale: 0,
      };
  }
}

export function routeAdaptiveStrategies(
  report: MarketRegimeResearchReport,
): AdaptiveStrategyRouting {
  const sectors = report.sectorOutlooks;
  const stocks = report.stockRegimes.filter(
    (stock) => stock.regime !== "insufficient-data",
  );
  const constructiveSectorRatio = ratio(
    sectors.filter((sector) => sector.direction === "constructive").length,
    sectors.length,
  );
  const cautiousSectorRatio = ratio(
    sectors.filter((sector) => sector.direction === "cautious").length,
    sectors.length,
  );
  const averageReturn20d = average(sectors.map((sector) => sector.factors.return20d));
  const averageReturn60d = average(sectors.map((sector) => sector.factors.return60d));
  const averageMa20Slope5d = average(
    sectors.map((sector) => sector.factors.ma20Slope5d),
  );
  const averageVolatility20d = average(
    sectors.map((sector) => sector.factors.annualizedVolatility20d),
  );
  const breadthValues = sectors.flatMap((sector) =>
    sector.factors.breadthRatio === null ? [] : [sector.factors.breadthRatio],
  );
  const averageBreadthRatio = breadthValues.length > 0
    ? average(breadthValues)
    : null;
  const healthyStockRatio = ratio(
    stocks.filter((stock) =>
      stock.regime === "healthy-trend" || stock.regime === "washout-candidate"
    ).length,
    stocks.length,
  );
  const deterioratingStockRatio = ratio(
    stocks.filter((stock) => stock.regime === "trend-deterioration").length,
    stocks.length,
  );

  const metrics: AdaptiveStrategyRouting["metrics"] = {
    constructiveSectorRatio: round(constructiveSectorRatio),
    cautiousSectorRatio: round(cautiousSectorRatio),
    averageReturn20d: round(averageReturn20d),
    averageReturn60d: round(averageReturn60d),
    averageMa20Slope5d: round(averageMa20Slope5d),
    averageVolatility20d: round(averageVolatility20d),
    averageBreadthRatio:
      averageBreadthRatio === null ? null : round(averageBreadthRatio),
    healthyStockRatio: round(healthyStockRatio),
    deterioratingStockRatio: round(deterioratingStockRatio),
  };

  let regime: AdaptiveMarketRegime;
  const evidence: string[] = [];
  const riskFlags: string[] = [];

  if (
    report.sourceStatus !== "live-read-only" ||
    sectors.length < 2 ||
    report.warnings.length > 0
  ) {
    regime = "unclear";
    evidence.push("真实历史研究处于降级或样本不足状态，策略路由回退到现金等待。");
    riskFlags.push(...report.warnings);
  } else {
    const riskOff =
      averageReturn20d <= -0.04 &&
      averageMa20Slope5d < 0 &&
      (cautiousSectorRatio >= 0.5 || deterioratingStockRatio >= 0.5);
    const uptrend =
      averageReturn20d >= 0.025 &&
      averageReturn60d >= 0.04 &&
      averageMa20Slope5d > 0 &&
      constructiveSectorRatio >= 0.5 &&
      deterioratingStockRatio < 0.5;
    const highVolatility = averageVolatility20d >= 0.38;

    if (riskOff) {
      regime = "risk-off";
      evidence.push("板块 20 日收益与均线斜率同步转弱，风险状态优先减仓。");
    } else if (uptrend) {
      regime = highVolatility
        ? "trend-up-high-volatility"
        : "trend-up-low-volatility";
      evidence.push("多数样本板块保持正向 20/60 日趋势和上升均线斜率。");
      if (highVolatility) {
        riskFlags.push("20 日年化波动偏高，趋势策略降仓并改用回踩确认。");
      }
    } else {
      regime = highVolatility
        ? "range-high-volatility"
        : "range-low-volatility";
      evidence.push("趋势共振不足，当前按区间市场管理策略资格。");
      if (cautiousSectorRatio >= 0.5) {
        riskFlags.push("谨慎板块占比较高，区间策略继续降低新增仓位。");
      }
    }

    if (averageBreadthRatio !== null) {
      evidence.push(`样本板块平均上涨宽度为 ${(averageBreadthRatio * 100).toFixed(1)}%。`);
    }
    evidence.push(`趋势恶化个股占比为 ${(deterioratingStockRatio * 100).toFixed(1)}%。`);
  }

  const profile = riskProfile(regime);
  const eligibleStrategyKeys = [...STRATEGIES[regime]];
  const disabledStrategyKeys = ALL_STRATEGY_KEYS.filter(
    (key) => !eligibleStrategyKeys.includes(key),
  );
  const sampleConfidence = Math.min(0.2, sectors.length / 50);
  const agreement = Math.max(
    constructiveSectorRatio,
    cautiousSectorRatio,
    deterioratingStockRatio,
    1 - Math.abs(0.5 - constructiveSectorRatio) * 2,
  );
  const confidence = regime === "unclear"
    ? 0
    : clamp(0.45 + sampleConfidence + agreement * 0.2, 0, 0.9);

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    regime,
    confidence: round(confidence, 2),
    ...profile,
    eligibleStrategyKeys,
    disabledStrategyKeys,
    evidence,
    riskFlags,
    metrics,
  };
}
