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
    | "aSharePullback"
    | "movingAverageCross"
    | "macd"
    | "turtle"
    | "rsi"
    | "bollingerBands"
    | "kairosRiskOffRecovery"
    | "kairosRangeRotation"
    | "kairosQualifiedProbe"
    | "kairosValidationBasket";
  strategyName: string;
  score: number;
  evidence: string[];
}

export interface AdaptiveCandidateStrategyInput {
  quote: MarketQuote;
  stockRegime: StockRegimeResult | undefined;
  routing: AdaptiveStrategyRouting;
  candidateScore: number;
  activityTargetActive?: boolean;
  validationProbeActive?: boolean;
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

function isRangeRegime(routing: AdaptiveStrategyRouting): boolean {
  return routing.regime === "range-low-volatility" ||
    routing.regime === "range-high-volatility";
}

function hasControlledIntradayMove(quote: MarketQuote, maximumChange: number): boolean {
  return quote.changePercent >= -1.8 &&
    quote.changePercent <= maximumChange &&
    amplitude(quote) <= 5.5;
}

function hasControlledLiquidity(quote: MarketQuote): boolean {
  return (quote.amount ?? 0) >= 100_000_000 || quote.volume >= 5_000_000;
}

function hasQualifiedProbeHistory(stock: StockRegimeResult): boolean {
  if (stock.regime === "healthy-trend" && stock.confidence >= 0.55) return true;
  if (isValidatedWashout(stock)) return true;
  return stock.regime === "unclear" &&
    stock.barCount >= 120 &&
    stock.confidence >= 0.55 &&
    stock.features.return20d >= -0.06 &&
    stock.features.return20d <= 0.08 &&
    stock.features.distanceFromMa20 >= -0.1 &&
    stock.features.distanceFromMa20 <= 0.03 &&
    stock.features.ma20Slope5d >= -0.01;
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
    stock.features.return20d >= 0.02 &&
    stock.features.return60d >= 0.04 &&
    stock.features.ma20Slope5d > 0 &&
    stock.features.ma60Slope5d >= 0 &&
    stock.features.distanceFromMa20 >= -0.02 &&
    stock.features.distanceFromMa20 <= 0.08 &&
    hasControlledIntradayMove(quote, 3.2)
  ) {
    add(
      "movingAverageCross",
      "均线交叉确认",
      72 +
        stock.confidence * 7 +
        clamp(stock.features.ma20Slope5d * 100, 0, 5) +
        clamp(stock.features.return20d * 20, 0, 4),
      [
        "20/60 日历史收益为正，短中期均线斜率保持向上。",
        "价格距离 20 日均线受控，当前波动未触发追高过滤。",
      ],
    );
  }

  if (
    (stock.regime === "healthy-trend" || isValidatedWashout(stock)) &&
    stock.features.return20d > 0 &&
    stock.features.ma20Slope5d > 0 &&
    stock.features.ma60Slope5d >= -0.005 &&
    quote.open !== undefined &&
    quote.price >= quote.open &&
    quote.changePercent >= -0.2 &&
    quote.changePercent <= 3.5 &&
    currentAmplitude <= 5.5
  ) {
    add(
      "macd",
      "MACD趋势确认",
      69 +
        stock.confidence * 7 +
        clamp(stock.features.return20d * 28, 0, 7) +
        clamp(stock.features.ma20Slope5d * 100, 0, 4),
      [
        "用中期收益和均线斜率作为 MACD 方向代理，避免引入未确认的盘后数据。",
        "当前价格高于开盘且振幅受控，短线方向得到快照复核。",
      ],
    );
  }

  if (
    stock.regime === "healthy-trend" &&
    stock.confidence >= 0.58 &&
    stock.features.return20d >= 0.025 &&
    stock.features.return60d >= 0.05 &&
    stock.features.distanceFromMa60 > 0 &&
    currentPosition !== null &&
    currentPosition >= 0.48 &&
    currentPosition <= 0.86 &&
    quote.changePercent >= 0 &&
    quote.changePercent <= 3.8 &&
    currentAmplitude <= 6
  ) {
    add(
      "turtle",
      "海龟趋势突破",
      67 +
        stock.confidence * 8 +
        clamp(stock.features.return60d * 22, 0, 7) +
        currentPosition * 3,
      [
        "60 日历史趋势和价格相对中期均线保持正向。",
        "价格位于日内中上区间，但涨幅仍低于追涨阈值。",
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

  if (
    isRangeRegime(routing) &&
    (stock.regime === "healthy-trend" || stock.regime === "unclear") &&
    currentPosition !== null &&
    currentPosition <= 0.4 &&
    stock.features.return20d >= -0.06 &&
    stock.features.return20d <= 0.08 &&
    stock.features.distanceFromMa20 >= -0.08 &&
    stock.features.distanceFromMa20 <= 0.02 &&
    hasControlledIntradayMove(quote, 0.8)
  ) {
    add(
      "rsi",
      "RSI区间回归",
      61 +
        clamp((0.4 - currentPosition) * 18, 0, 6) +
        clamp((0.08 - stock.features.return20d) * 12, 0, 4),
      [
        "当前被路由为震荡市场，价格靠近日内下沿且中期偏离受控。",
        "RSI 仅作为区间回归观察代理，不在趋势恶化标的上使用。",
      ],
    );
  }

  if (
    isRangeRegime(routing) &&
    stock.barCount >= 120 &&
    stock.confidence >= 0.55 &&
    (stock.regime === "healthy-trend" || stock.regime === "unclear") &&
    input.candidateScore >= 65 &&
    stock.features.return20d >= -0.04 &&
    stock.features.return20d <= 0.1 &&
    stock.features.ma20Slope5d >= -0.005 &&
    stock.features.distanceFromMa20 >= -0.06 &&
    stock.features.distanceFromMa20 <= 0.05 &&
    currentPosition !== null &&
    currentPosition >= 0.18 &&
    currentPosition <= 0.72 &&
    quote.changePercent >= -1.5 &&
    quote.changePercent <= 2 &&
    currentAmplitude <= 6.5 &&
    hasControlledLiquidity(quote)
  ) {
    add(
      "kairosRangeRotation",
      "KAIROS区间轮动",
      66 +
        input.candidateScore * 0.12 +
        stock.confidence * 6 +
        clamp((0.72 - currentPosition) * 5, 0, 2.5),
      [
        "真实历史样本、均线斜率和价格偏离处于受控区间。",
        "当前价格未进入追高区，流动性满足小仓位 Paper 轮动观察。",
      ],
    );
  }

  if (
    input.activityTargetActive === true &&
    input.validationProbeActive !== true &&
    routing.regime !== "risk-off" &&
    routing.regime !== "risk-off-recovery" &&
    routing.regime !== "unclear" &&
    hasQualifiedProbeHistory(stock) &&
    input.candidateScore >= 65 &&
    quote.changePercent >= -2.2 &&
    quote.changePercent <= 2.2 &&
    currentAmplitude <= 6.5 &&
    hasControlledLiquidity(quote)
  ) {
    add(
      "kairosQualifiedProbe",
      "KAIROS合格样本验证",
      66 + input.candidateScore * 0.12 + stock.confidence * 5,
      [
        "下午 Paper 活跃目标仍有缺口，仅启用最低费用有效整手的合格样本验证。",
        "真实历史、流动性和追价过滤已通过，仍需费用、现金、仓位和 PaperBroker 风控复核。",
      ],
    );
  }

  if (
    input.validationProbeActive === true &&
    input.activityTargetActive === true &&
    signals.length === 0 &&
    routing.regime !== "risk-off" &&
    routing.regime !== "risk-off-recovery" &&
    routing.regime !== "unclear" &&
    stock.barCount >= 120 &&
    stock.confidence >= 0.55 &&
    hasQualifiedProbeHistory(stock) &&
    input.candidateScore >= 65 &&
    quote.changePercent >= -2.2 &&
    quote.changePercent <= 2.2 &&
    currentAmplitude <= 6.5 &&
    hasControlledLiquidity(quote)
  ) {
    add(
      "kairosValidationBasket",
      "KAIROS验证篮子",
      64 + input.candidateScore * 0.12 + stock.confidence * 5,
      [
        "主策略信号暂未形成，但真实历史至少覆盖 120 根且形态通过验证篮子门槛。",
        "当前价格波动和流动性受控，仅用于收集 Paper 样本，不代表收益保证。",
      ],
    );
  }

  if (
    isRangeRegime(routing) &&
    (stock.regime === "healthy-trend" || stock.regime === "unclear") &&
    currentPosition !== null &&
    currentPosition <= 0.35 &&
    stock.features.distanceFromMa20 >= -0.1 &&
    stock.features.distanceFromMa20 <= 0.025 &&
    currentAmplitude <= 5 &&
    quote.changePercent >= -1.8 &&
    quote.changePercent <= 0.5
  ) {
    add(
      "bollingerBands",
      "布林带下沿回归",
      59 +
        clamp((0.35 - currentPosition) * 16, 0, 5) +
        clamp((5 - currentAmplitude) * 1.2, 0, 4),
      [
        "价格位于日内低位、振幅受控，符合震荡下沿的研究条件。",
        "布林带只用于小仓位 paper 观察，跌破风险需重新评估。",
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

export function selectAdaptiveCandidateStrategyWithUsage(
  signals: AdaptiveCandidateStrategySignal[],
  usage: Record<string, number> = {},
): AdaptiveCandidateStrategySignal | null {
  const topScore = signals[0]?.score;
  if (topScore === undefined) return null;
  return signals
    .filter((signal) => signal.score >= topScore - 10)
    .sort((left, right) => {
      const usageDifference = (usage[left.strategyKey] ?? 0) -
        (usage[right.strategyKey] ?? 0);
      if (usageDifference !== 0) return usageDifference;
      if (right.score !== left.score) return right.score - left.score;
      return left.strategyKey.localeCompare(right.strategyKey);
    })[0] ?? null;
}
