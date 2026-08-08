import type { MarketQuote } from "../../shared/trading";
import type { AdaptiveStrategyRouting } from "./adaptiveStrategyRouter";
import type { StockRegimeResult } from "./marketRegimeResearch";

export interface AdaptiveCandidateStrategySignal {
  strategyKey:
    | "kairosLowVolTrend"
    | "kairosTrendHealth"
    | "momentum"
    | "kairosQuietPullback"
    | "kairosWashoutRecovery"
    | "aSharePullback";
  strategyName: string;
  score: number;
  evidence: string[];
}

export interface AdaptiveCandidateStrategyInput {
  quote: MarketQuote;
  stockRegime: StockRegimeResult | undefined;
  routing: AdaptiveStrategyRouting;
  candidateScore: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function amplitude(quote: MarketQuote): number {
  if (quote.amplitude !== undefined && Number.isFinite(quote.amplitude)) {
    return quote.amplitude;
  }
  if (quote.high && quote.low && quote.previousClose > 0) {
    return ((quote.high - quote.low) / quote.previousClose) * 100;
  }
  return Math.abs(quote.changePercent) * 1.8;
}

function intradayPosition(quote: MarketQuote): number | null {
  if (!quote.high || !quote.low || quote.high <= quote.low) return null;
  return (quote.price - quote.low) / (quote.high - quote.low);
}

function isValidatedWashout(stock: StockRegimeResult): boolean {
  return stock.regime === "washout-candidate" &&
    stock.confidence >= 0.65 &&
    stock.validation.samples >= 20 &&
    stock.validation.hitRate5d !== null &&
    stock.validation.hitRate5d >= 0.55;
}

export function rankAdaptiveCandidateStrategies(
  input: AdaptiveCandidateStrategyInput,
): AdaptiveCandidateStrategySignal[] {
  const { quote, routing, stockRegime: stock } = input;
  if (
    !routing.allowNewPositions ||
    !quote.tradable ||
    quote.price <= 0 ||
    !stock ||
    stock.regime === "insufficient-data" ||
    stock.regime === "trend-deterioration"
  ) {
    return [];
  }

  const eligible = new Set(routing.eligibleStrategyKeys);
  const primaryIndexes = new Map(
    routing.strategyPlaybook.primaryStrategyKeys.map((key, index) => [key, index]),
  );
  const signals: AdaptiveCandidateStrategySignal[] = [];
  const currentAmplitude = amplitude(quote);
  const currentPosition = intradayPosition(quote);
  const primaryBoost = (key: string): number => {
    const index = primaryIndexes.get(key);
    if (index === 0) return 6;
    if (index === 1) return 3;
    return 0;
  };
  const add = (
    strategyKey: AdaptiveCandidateStrategySignal["strategyKey"],
    strategyName: string,
    score: number,
    evidence: string[],
  ) => {
    if (!eligible.has(strategyKey)) return;
    signals.push({
      strategyKey,
      strategyName,
      score: round(clamp(score + primaryBoost(strategyKey), 0, 100)),
      evidence,
    });
  };

  if (
    stock.regime === "healthy-trend" &&
    stock.confidence >= 0.55 &&
    stock.features.return20d > 0 &&
    stock.features.ma20Slope5d > 0 &&
    currentAmplitude <= 5.5 &&
    quote.changePercent >= -0.5 &&
    quote.changePercent <= 3.5
  ) {
    add(
      "kairosLowVolTrend",
      "KAIROS低波趋势",
      78 + stock.confidence * 8 + clamp((5.5 - currentAmplitude) * 1.5, 0, 6),
      [
        "真实历史形态为健康趋势，20 日均线斜率向上。",
        `当前振幅 ${currentAmplitude.toFixed(2)}%，符合低波趋势纪律。`,
      ],
    );
  }

  if (
    stock.regime === "healthy-trend" &&
    stock.confidence >= 0.55 &&
    stock.features.return20d >= 0.03 &&
    stock.features.return60d >= 0.06 &&
    stock.features.ma20Slope5d > 0 &&
    stock.features.ma60Slope5d >= 0
  ) {
    add(
      "kairosTrendHealth",
      "KAIROS趋势健康",
      74 + stock.confidence * 8 + clamp(stock.features.return60d * 30, 0, 8),
      [
        "真实历史 20/60 日收益和双均线斜率共同确认趋势健康。",
        `历史形态置信度 ${(stock.confidence * 100).toFixed(0)}%。`,
      ],
    );
  }

  if (
    stock.regime === "healthy-trend" &&
    stock.features.return20d >= 0.05 &&
    stock.features.return60d >= 0.08 &&
    quote.changePercent >= 0.3 &&
    quote.changePercent <= 4.5 &&
    quote.price > quote.previousClose &&
    quote.volume > 0
  ) {
    add(
      "momentum",
      "趋势动量确认",
      70 +
        stock.confidence * 6 +
        clamp(stock.features.return20d * 35, 0, 8) +
        clamp(quote.changePercent * 1.5, 0, 6),
      [
        "真实历史中期动量为正，当前价格和成交量继续确认。",
        "当前涨幅未进入追涨禁区。",
      ],
    );
  }

  if (
    isValidatedWashout(stock) &&
    stock.features.pullbackFrom20DayHigh >= 0.025 &&
    stock.features.pullbackFrom20DayHigh <= 0.12 &&
    stock.features.volumeRatio <= 0.9 &&
    quote.changePercent >= -1.5 &&
    quote.changePercent <= 2.5
  ) {
    add(
      "kairosQuietPullback",
      "KAIROS安静回踩",
      76 +
        stock.confidence * 8 +
        (stock.validation.hitRate5d ?? 0) * 6 +
        clamp((0.9 - stock.features.volumeRatio) * 10, 0, 4),
      [
        "真实历史识别为缩量洗盘候选，回踩幅度和量能收缩均在规则内。",
        `5 日历史命中率 ${((stock.validation.hitRate5d ?? 0) * 100).toFixed(0)}%。`,
      ],
    );
  }

  if (
    isValidatedWashout(stock) &&
    quote.changePercent >= 0.2 &&
    quote.changePercent <= 4 &&
    quote.open !== undefined &&
    quote.price >= quote.open &&
    (currentPosition === null || currentPosition >= 0.45)
  ) {
    add(
      "kairosWashoutRecovery",
      "KAIROS洗盘恢复",
      78 +
        stock.confidence * 6 +
        (stock.validation.hitRate5d ?? 0) * 8 +
        clamp(quote.changePercent * 2, 0, 6),
      [
        "真实历史洗盘候选出现当日恢复确认，价格位于日内中上区间。",
        "该信号仍受隔夜持续性、现金和费用纪律二次检查。",
      ],
    );
  }

  if (
    (stock.regime === "healthy-trend" || isValidatedWashout(stock)) &&
    input.candidateScore >= 72 &&
    quote.changePercent >= 0.4 &&
    quote.changePercent <= 4.5 &&
    quote.volume >= 5_000_000
  ) {
    add(
      "aSharePullback",
      "A股强势回踩确认",
      68 + input.candidateScore * 0.15 + stock.confidence * 5,
      [
        "实时快照回踩评分通过，并由真实历史形态复核。",
        "涨幅和流动性处于受控确认区间。",
      ],
    );
  }

  return signals.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftPrimary = primaryIndexes.get(left.strategyKey) ?? 99;
    const rightPrimary = primaryIndexes.get(right.strategyKey) ?? 99;
    return leftPrimary - rightPrimary ||
      left.strategyKey.localeCompare(right.strategyKey);
  });
}

export function selectAdaptiveCandidateStrategy(
  input: AdaptiveCandidateStrategyInput,
): AdaptiveCandidateStrategySignal | null {
  return rankAdaptiveCandidateStrategies(input)[0] ?? null;
}
