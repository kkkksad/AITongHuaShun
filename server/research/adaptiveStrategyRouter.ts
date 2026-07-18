import type { MarketRegimeResearchReport } from "./marketRegimeResearch";
import type { ExternalImpactBias } from "./externalMarketImpact";

export type AdaptiveMarketRegime =
  | "trend-up-low-volatility"
  | "trend-up-high-volatility"
  | "range-low-volatility"
  | "range-high-volatility"
  | "risk-off"
  | "unclear";

export type AdaptivePositionPosture = "accumulate" | "hold" | "reduce";

export interface AdaptiveStrategyPlaybook {
  primaryStrategyKeys: string[];
  useWhen: string;
  avoidWhen: string;
  recheckTriggers: string[];
}

export interface AdaptiveCapitalPacing {
  openingMaxInvestedRatio: number;
  morningMaxInvestedRatio: number;
  afternoonMaxInvestedRatio: number;
  closingMaxInvestedRatio: number;
}

export interface ExternalMarketShadowInput {
  bias: ExternalImpactBias;
  samples: number;
  windows: number;
  directionalHitRate: number | null;
}

export interface ExternalMarketShadowResult extends ExternalMarketShadowInput {
  status: "inactive" | "collecting" | "eligible";
  proposedConfidenceModifier: number;
  proposedConfidence: number;
  proposedAllowNewPositions: boolean;
  rationale: string;
}

export interface AdaptiveStrategyRouting {
  version: "1.1.0";
  generatedAt: string;
  regime: AdaptiveMarketRegime;
  confidence: number;
  positionPosture: AdaptivePositionPosture;
  allowNewPositions: boolean;
  cashReserveRatio: number;
  newPositionScale: number;
  eligibleStrategyKeys: string[];
  disabledStrategyKeys: string[];
  strategyPlaybook: AdaptiveStrategyPlaybook;
  capitalPacing: AdaptiveCapitalPacing;
  shadow?: {
    externalMarket: ExternalMarketShadowResult;
  };
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

const STRATEGY_PLAYBOOKS: Record<AdaptiveMarketRegime, AdaptiveStrategyPlaybook> = {
  "trend-up-low-volatility": {
    primaryStrategyKeys: ["kairosLowVolTrend", "kairosTrendHealth"],
    useWhen: "板块中期趋势、上涨宽度和低波动同步确认时，顺势分批建立 paper 仓位。",
    avoidWhen: "均线斜率转负、上涨宽度跌破确认线或趋势恶化个股快速增加时停止新增。",
    recheckTriggers: ["上涨宽度低于 50%", "20 日波动升至 38%", "趋势恶化占比达到 50%"],
  },
  "trend-up-high-volatility": {
    primaryStrategyKeys: ["kairosQuietPullback", "kairosWashoutRecovery", "aSharePullback"],
    useWhen: "中期趋势仍向上但波动偏高时，只等待缩量回踩和重新确认。",
    avoidWhen: "避免追高、放量急涨和未确认反包，单次新增仓位减半。",
    recheckTriggers: ["回踩后重新站稳", "波动回落", "板块趋势转弱"],
  },
  "range-low-volatility": {
    primaryStrategyKeys: ["rsi", "bollingerBands"],
    useWhen: "趋势共振不足且波动较低时，仅在区间边缘做小仓位均值回归研究。",
    avoidWhen: "避免把单次突破当成趋势启动，也不在区间中部追价。",
    recheckTriggers: ["区间边缘确认", "趋势与宽度同步转强", "波动显著放大"],
  },
  "range-high-volatility": {
    primaryStrategyKeys: ["kairosCapitalShield", "kairosQuietPullback"],
    useWhen: "无趋势且波动较高时优先现金防守，只观察高质量回踩确认。",
    avoidWhen: "避免网格加仓、逆势摊薄和高波动反弹追入。",
    recheckTriggers: ["波动回落", "板块宽度恢复", "趋势恶化占比上升"],
  },
  "risk-off": {
    primaryStrategyKeys: ["kairosCapitalShield"],
    useWhen: "收益、均线斜率和市场宽度同步转弱时，以减仓和保留现金为主。",
    avoidWhen: "禁止新增 paper 仓位，不因短线反弹取消既定风险检查。",
    recheckTriggers: ["趋势恶化持仓", "硬止损", "市场宽度恢复并持续"],
  },
  unclear: {
    primaryStrategyKeys: ["kairosCapitalShield"],
    useWhen: "数据源降级、样本不足或结论冲突时保持现金和原仓观察。",
    avoidWhen: "禁止使用不完整数据生成新增 paper 仓位。",
    recheckTriggers: ["数据源恢复", "历史样本完整", "警告清零"],
  },
};

const CAPITAL_PACING: Record<AdaptiveMarketRegime, AdaptiveCapitalPacing> = {
  "trend-up-low-volatility": {
    openingMaxInvestedRatio: 0.55,
    morningMaxInvestedRatio: 0.7,
    afternoonMaxInvestedRatio: 0.82,
    closingMaxInvestedRatio: 0.9,
  },
  "trend-up-high-volatility": {
    openingMaxInvestedRatio: 0.4,
    morningMaxInvestedRatio: 0.5,
    afternoonMaxInvestedRatio: 0.65,
    closingMaxInvestedRatio: 0.75,
  },
  "range-low-volatility": {
    openingMaxInvestedRatio: 0.35,
    morningMaxInvestedRatio: 0.45,
    afternoonMaxInvestedRatio: 0.55,
    closingMaxInvestedRatio: 0.65,
  },
  "range-high-volatility": {
    openingMaxInvestedRatio: 0.3,
    morningMaxInvestedRatio: 0.38,
    afternoonMaxInvestedRatio: 0.48,
    closingMaxInvestedRatio: 0.58,
  },
  "risk-off": {
    openingMaxInvestedRatio: 0.35,
    morningMaxInvestedRatio: 0.35,
    afternoonMaxInvestedRatio: 0.35,
    closingMaxInvestedRatio: 0.35,
  },
  unclear: {
    openingMaxInvestedRatio: 0.3,
    morningMaxInvestedRatio: 0.3,
    afternoonMaxInvestedRatio: 0.3,
    closingMaxInvestedRatio: 0.3,
  },
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function evaluateExternalMarketShadow(
  input: ExternalMarketShadowInput & {
    officialConfidence: number;
    officialAllowNewPositions: boolean;
  },
): ExternalMarketShadowResult {
  const directionalImprovement = (input.directionalHitRate ?? 0) - 0.5;
  const eligible = input.samples >= 250 &&
    input.windows >= 3 &&
    directionalImprovement >= 0.03;
  let modifier = 0;
  if (eligible) {
    if (input.bias === "supportive") modifier = 0.05;
    if (input.bias === "restrictive") modifier = -0.05;
    if (input.bias === "conflicted") modifier = -0.03;
  }
  const status = input.samples === 0
    ? "inactive"
    : eligible
      ? "eligible"
      : "collecting";
  return {
    bias: input.bias,
    samples: input.samples,
    windows: input.windows,
    directionalHitRate: input.directionalHitRate,
    status,
    proposedConfidenceModifier: modifier,
    proposedConfidence: round(
      clamp(input.officialConfidence + modifier, 0, 0.9),
      2,
    ),
    proposedAllowNewPositions: input.officialAllowNewPositions,
    rationale: eligible
      ? "外盘样本通过 shadow 门槛，仅记录置信度假设，不修改正式路由或仓位。"
      : "外盘样本尚未通过 250 样本、3 窗口和 3 个百分点增量门槛。",
  };
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
  externalMarket?: ExternalMarketShadowInput,
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
      (averageBreadthRatio === null || averageBreadthRatio >= 0.5) &&
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
      if (averageBreadthRatio < 0.45) {
        riskFlags.push("上涨宽度低于 45%，趋势缺少多数标的确认。 ");
      }
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
  const officialConfidence = round(confidence, 2);
  const externalMarketShadow = evaluateExternalMarketShadow({
    bias: externalMarket?.bias ?? "neutral",
    samples: externalMarket?.samples ?? 0,
    windows: externalMarket?.windows ?? 0,
    directionalHitRate: externalMarket?.directionalHitRate ?? null,
    officialConfidence,
    officialAllowNewPositions: profile.allowNewPositions,
  });

  return {
    version: "1.1.0",
    generatedAt: new Date().toISOString(),
    regime,
    confidence: officialConfidence,
    ...profile,
    eligibleStrategyKeys,
    disabledStrategyKeys,
    strategyPlaybook: {
      ...STRATEGY_PLAYBOOKS[regime],
      primaryStrategyKeys: [...STRATEGY_PLAYBOOKS[regime].primaryStrategyKeys],
      recheckTriggers: [...STRATEGY_PLAYBOOKS[regime].recheckTriggers],
    },
    capitalPacing: { ...CAPITAL_PACING[regime] },
    shadow: {
      externalMarket: externalMarketShadow,
    },
    evidence,
    riskFlags,
    metrics,
  };
}
