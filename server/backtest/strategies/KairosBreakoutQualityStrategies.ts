import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";
import { highest, sma } from "./indicators";

function firstTradableQuote(context: StrategyContext) {
  return context.snapshot.quotes.find((quote) => quote.tradable && quote.price > 0);
}

function average(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rollingVolatility(prices: number[], period: number): number {
  if (prices.length < period + 1 || period <= 1) return Number.NaN;
  const returns: number[] = [];
  for (let index = prices.length - period; index < prices.length; index += 1) {
    const previous = prices[index - 1];
    if (previous > 0) returns.push(prices[index] / previous - 1);
  }
  const mean = average(returns);
  if (!Number.isFinite(mean)) return Number.NaN;
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function currentVolumeRatio(volumes: number[], baselinePeriod: number): number {
  if (volumes.length < baselinePeriod + 1) return Number.NaN;
  const baseline = average(volumes.slice(-(baselinePeriod + 1), -1));
  return baseline > 0 ? volumes[volumes.length - 1] / baseline : Number.NaN;
}

function rangeAverage(
  highs: number[],
  lows: number[],
  start: number,
  end: number,
): number {
  if (start < 0 || end <= start) return Number.NaN;
  const ranges = highs.slice(start, end).map((high, index) => high - lows[start + index]);
  return average(ranges.filter((value) => Number.isFinite(value) && value >= 0));
}

function maxDrawdown(prices: number[], period: number): number {
  if (prices.length < period || period <= 0) return Number.NaN;
  const window = prices.slice(-period);
  let peak = window[0];
  let worst = 0;
  for (const price of window) {
    peak = Math.max(peak, price);
    if (peak > 0) worst = Math.max(worst, 1 - price / peak);
  }
  return worst;
}

function trendEfficiency(prices: number[], period: number): number {
  if (prices.length < period + 1 || period <= 0) return Number.NaN;
  const window = prices.slice(-(period + 1));
  const netMove = Math.abs(window[window.length - 1] - window[0]);
  let path = 0;
  for (let index = 1; index < window.length; index += 1) {
    path += Math.abs(window[index] - window[index - 1]);
  }
  return path > 0 ? netMove / path : Number.NaN;
}

/**
 * 波动收缩后放量突破。
 *
 * 收缩区间和前高只使用当前 bar 之前的数据；当根成交量只用于确认突破，
 * 不参与历史基准，避免未来数据或同根数据污染。
 */
export class KairosVolatilityContractionBreakoutStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private readonly highs: number[] = [];
  private readonly lows: number[] = [];
  private readonly volumes: number[] = [];
  private inPosition = false;
  private entryPrice = 0;

  constructor(
    private readonly contractionPeriod = 20,
    private readonly baselinePeriod = 40,
    private readonly maxContractionRatio = 0.62,
    private readonly breakoutPeriod = 20,
    private readonly minVolumeRatio = 1.4,
    private readonly trendPeriod = 50,
    private readonly maxEntryChangePercent = 4.8,
    private readonly takeProfitPercent = 0.08,
    private readonly stopLossPercent = 0.035,
    private readonly targetWeight = 0.16,
    customName?: string,
  ) {
    this.name = customName ??
      `KAIROS波动收缩突破(${contractionPeriod},${breakoutPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.highs.length = 0;
    this.lows.length = 0;
    this.volumes.length = 0;
    this.inPosition = false;
    this.entryPrice = 0;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = firstTradableQuote(context);
    if (!quote) return [];

    const price = quote.price;
    this.prices.push(price);
    this.highs.push(Math.max(quote.high ?? price, price));
    this.lows.push(Math.min(quote.low ?? price, price));
    this.volumes.push(Math.max(quote.volume, 1));

    const minBars = Math.max(
      this.baselinePeriod + this.contractionPeriod,
      this.breakoutPeriod + 2,
      this.trendPeriod + 2,
    );
    if (this.prices.length < minBars) return [];

    const trendMa = sma(this.prices, this.trendPeriod);
    const previousTrendMa = sma(this.prices.slice(0, -5), this.trendPeriod);
    if (!Number.isFinite(trendMa) || !Number.isFinite(previousTrendMa)) return [];

    if (this.inPosition) {
      const entryReturn = price / this.entryPrice - 1;
      const exitMa = sma(this.prices, 10);
      const failedBreakout = Number.isFinite(exitMa) && price < exitMa;
      if (
        entryReturn >= this.takeProfitPercent ||
        entryReturn <= -this.stopLossPercent ||
        failedBreakout ||
        trendMa < previousTrendMa
      ) {
        this.inPosition = false;
        this.entryPrice = 0;
        return [{
          symbol: quote.symbol,
          side: "sell",
          type: "market",
          targetWeight: 1,
        }];
      }
      return [];
    }

    // All regime inputs end before the current breakout bar. The current bar is
    // only allowed to confirm price/volume, never to define its own baseline.
    const historyEnd = this.prices.length - 1;
    const contractionStart = historyEnd - this.contractionPeriod;
    const baselineStart = contractionStart - this.baselinePeriod;
    const recentRange = rangeAverage(
      this.highs,
      this.lows,
      contractionStart,
      historyEnd,
    );
    const baselineRange = rangeAverage(
      this.highs,
      this.lows,
      baselineStart,
      contractionStart,
    );
    const volatilityContracted = Number.isFinite(recentRange) &&
      Number.isFinite(baselineRange) &&
      baselineRange > 0 &&
      recentRange / baselineRange <= this.maxContractionRatio;
    const previousHigh = highest(this.prices.slice(0, -1), this.breakoutPeriod);
    const volumeRatio = currentVolumeRatio(this.volumes, this.baselinePeriod);
    const priceBreakout = Number.isFinite(previousHigh) && price > previousHigh;
    const volumeConfirmed = Number.isFinite(volumeRatio) &&
      volumeRatio >= this.minVolumeRatio;
    const trendHealthy = price > trendMa && trendMa > previousTrendMa;
    const notOverheated = quote.changePercent >= 0 &&
      quote.changePercent <= this.maxEntryChangePercent;

    if (
      volatilityContracted &&
      priceBreakout &&
      volumeConfirmed &&
      trendHealthy &&
      notOverheated
    ) {
      this.inPosition = true;
      this.entryPrice = price;
      return [{
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        targetWeight: this.targetWeight,
      }];
    }
    return [];
  }
}

/**
 * 量价突破确认。
 *
 * 与单纯价格突破不同，本策略同时要求历史趋势、放量、收盘位于日内强势区和涨幅过滤。
 */
export class KairosVolumePriceBreakoutStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private readonly volumes: number[] = [];
  private inPosition = false;
  private entryPrice = 0;

  constructor(
    private readonly breakoutPeriod = 20,
    private readonly fastPeriod = 20,
    private readonly slowPeriod = 60,
    private readonly minVolumeRatio = 1.5,
    private readonly minIntradayPosition = 0.58,
    private readonly maxEntryChangePercent = 4.5,
    private readonly takeProfitPercent = 0.075,
    private readonly stopLossPercent = 0.03,
    private readonly targetWeight = 0.16,
    customName?: string,
  ) {
    this.name = customName ?? `KAIROS量价突破(${breakoutPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.volumes.length = 0;
    this.inPosition = false;
    this.entryPrice = 0;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = firstTradableQuote(context);
    if (!quote) return [];

    const price = quote.price;
    this.prices.push(price);
    this.volumes.push(Math.max(quote.volume, 1));
    if (this.prices.length < this.slowPeriod + 2) return [];

    const fastMa = sma(this.prices, this.fastPeriod);
    const slowMa = sma(this.prices, this.slowPeriod);
    const previousFastMa = sma(this.prices.slice(0, -5), this.fastPeriod);
    if ([fastMa, slowMa, previousFastMa].some((value) => !Number.isFinite(value))) {
      return [];
    }

    if (this.inPosition) {
      const entryReturn = price / this.entryPrice - 1;
      const structureFailed = price < fastMa * 0.98 || fastMa < previousFastMa;
      if (
        entryReturn >= this.takeProfitPercent ||
        entryReturn <= -this.stopLossPercent ||
        structureFailed
      ) {
        this.inPosition = false;
        this.entryPrice = 0;
        return [{
          symbol: quote.symbol,
          side: "sell",
          type: "market",
          targetWeight: 1,
        }];
      }
      return [];
    }

    const previousHigh = highest(this.prices.slice(0, -1), this.breakoutPeriod);
    const volumeRatio = currentVolumeRatio(this.volumes, this.slowPeriod);
    const position = quote.high && quote.low && quote.high > quote.low
      ? (price - quote.low) / (quote.high - quote.low)
      : quote.open && price >= quote.open
        ? 1
        : 0;
    const priceConfirmed = Number.isFinite(previousHigh) && price > previousHigh;
    const volumeConfirmed = Number.isFinite(volumeRatio) &&
      volumeRatio >= this.minVolumeRatio;
    const trendConfirmed = price > fastMa && fastMa > slowMa && fastMa > previousFastMa;
    const intradayConfirmed = position >= this.minIntradayPosition;
    const notOverheated = quote.changePercent >= 0 &&
      quote.changePercent <= this.maxEntryChangePercent;

    if (
      priceConfirmed &&
      volumeConfirmed &&
      trendConfirmed &&
      intradayConfirmed &&
      notOverheated
    ) {
      this.inPosition = true;
      this.entryPrice = price;
      return [{
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        targetWeight: this.targetWeight,
      }];
    }
    return [];
  }
}

/**
 * 质量低波趋势。
 *
 * 这里的“质量”仅指价格行为：趋势效率、回撤纪律、波动受控和均线结构，
 * 不读取财务数据，不代表基本面质量。
 */
export class KairosQualityLowVolTrendStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private inPosition = false;
  private entryPrice = 0;

  constructor(
    private readonly fastPeriod = 20,
    private readonly slowPeriod = 60,
    private readonly qualityPeriod = 20,
    private readonly maxDailyVolatility = 0.022,
    private readonly minTrendEfficiency = 0.38,
    private readonly maxRecentDrawdown = 0.055,
    private readonly takeProfitPercent = 0.07,
    private readonly stopLossPercent = 0.03,
    private readonly targetWeight = 0.18,
    customName?: string,
  ) {
    this.name = customName ?? `KAIROS质量低波趋势(${fastPeriod},${slowPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.inPosition = false;
    this.entryPrice = 0;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = firstTradableQuote(context);
    if (!quote) return [];

    const price = quote.price;
    this.prices.push(price);
    if (this.prices.length < this.slowPeriod + 6) return [];

    const fastMa = sma(this.prices, this.fastPeriod);
    const slowMa = sma(this.prices, this.slowPeriod);
    const previousFastMa = sma(this.prices.slice(0, -5), this.fastPeriod);
    const previousSlowMa = sma(this.prices.slice(0, -5), this.slowPeriod);
    const volatility = rollingVolatility(this.prices, this.qualityPeriod);
    if (
      [fastMa, slowMa, previousFastMa, previousSlowMa, volatility]
        .some((value) => !Number.isFinite(value))
    ) {
      return [];
    }

    if (this.inPosition) {
      const entryReturn = price / this.entryPrice - 1;
      const structureFailed = price < fastMa * 0.97 || fastMa < previousFastMa;
      const volatilityFailed = volatility > this.maxDailyVolatility * 1.8;
      if (
        entryReturn >= this.takeProfitPercent ||
        entryReturn <= -this.stopLossPercent ||
        structureFailed ||
        volatilityFailed
      ) {
        this.inPosition = false;
        this.entryPrice = 0;
        return [{
          symbol: quote.symbol,
          side: "sell",
          type: "market",
          targetWeight: 1,
        }];
      }
      return [];
    }

    const efficiency = trendEfficiency(this.prices, this.qualityPeriod);
    const drawdown = maxDrawdown(this.prices, this.qualityPeriod);
    const healthyStructure =
      price >= fastMa * 0.995 &&
      fastMa > slowMa &&
      fastMa > previousFastMa &&
      slowMa >= previousSlowMa;
    const qualityConfirmed =
      Number.isFinite(efficiency) &&
      efficiency >= this.minTrendEfficiency &&
      Number.isFinite(drawdown) &&
      drawdown <= this.maxRecentDrawdown;
    const volatilityControlled = volatility <= this.maxDailyVolatility;
    const notOverheated = quote.changePercent >= -0.8 && quote.changePercent <= 3.5;

    if (
      healthyStructure &&
      qualityConfirmed &&
      volatilityControlled &&
      notOverheated
    ) {
      this.inPosition = true;
      this.entryPrice = price;
      return [{
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        targetWeight: this.targetWeight,
      }];
    }
    return [];
  }
}
