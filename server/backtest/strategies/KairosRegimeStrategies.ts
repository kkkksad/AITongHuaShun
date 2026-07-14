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

function volumeRatio(volumes: number[], recentPeriod = 5, baselinePeriod = 30): number {
  if (volumes.length < recentPeriod + baselinePeriod) return Number.NaN;
  const recent = average(volumes.slice(-recentPeriod));
  const baseline = average(
    volumes.slice(-(recentPeriod + baselinePeriod), -recentPeriod),
  );
  return baseline > 0 ? recent / baseline : Number.NaN;
}

/**
 * KAIROS 洗盘恢复策略。
 *
 * “洗盘”只作为研究候选：中期趋势、受控回撤、缩量和当根企稳必须同时成立。
 */
export class KairosWashoutRecoveryStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private readonly volumes: number[] = [];
  private inPosition = false;
  private entryPrice = 0;

  constructor(
    private readonly trendPeriod = 60,
    private readonly pullbackPeriod = 20,
    private readonly minPullbackPercent = 0.025,
    private readonly maxPullbackPercent = 0.12,
    private readonly maxVolumeRatio = 0.8,
    private readonly minReboundPercent = 0.004,
    private readonly takeProfitPercent = 0.06,
    private readonly stopLossPercent = 0.025,
    private readonly targetWeight = 0.16,
    customName?: string,
  ) {
    this.name = customName ?? `KAIROS洗盘恢复(${trendPeriod},${pullbackPeriod})`;
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

    this.prices.push(quote.price);
    this.volumes.push(Math.max(quote.volume, 1));
    const minBars = Math.max(
      this.trendPeriod + 6,
      this.pullbackPeriod + 36,
    );
    if (this.prices.length < minBars) return [];

    const price = quote.price;
    const trendMa = sma(this.prices, this.trendPeriod);
    const previousTrendMa = sma(this.prices.slice(0, -5), this.trendPeriod);
    const currentVolumeRatio = volumeRatio(this.volumes);
    if ([trendMa, previousTrendMa, currentVolumeRatio].some(Number.isNaN)) return [];

    if (this.inPosition) {
      const entryReturn = price / this.entryPrice - 1;
      const trendFailed = price < trendMa * 0.97 || trendMa < previousTrendMa;
      if (
        entryReturn >= this.takeProfitPercent ||
        entryReturn <= -this.stopLossPercent ||
        trendFailed
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

    const recentHigh = highest(this.prices, this.pullbackPeriod);
    const previousPrice = this.prices[this.prices.length - 2];
    const pullback = recentHigh > 0 ? 1 - price / recentHigh : 1;
    const rebound = previousPrice > 0 ? price / previousPrice - 1 : 0;
    const trendIntact =
      trendMa > previousTrendMa &&
      price >= trendMa * 0.97;
    const controlledPullback =
      pullback >= this.minPullbackPercent &&
      pullback <= this.maxPullbackPercent;
    const quietPullback = currentVolumeRatio <= this.maxVolumeRatio;
    const reboundConfirmed =
      rebound >= this.minReboundPercent &&
      quote.changePercent < 5;

    if (trendIntact && controlledPullback && quietPullback && reboundConfirmed) {
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
 * KAIROS 趋势健康策略。
 *
 * 只在双均线健康时持仓，放量跌破后退出并冷却，避免把趋势恶化当作抄底机会。
 */
export class KairosTrendHealthStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private readonly volumes: number[] = [];
  private inPosition = false;
  private entryPrice = 0;
  private lastExitBar = -Infinity;

  constructor(
    private readonly fastPeriod = 20,
    private readonly slowPeriod = 60,
    private readonly breakdownVolumeRatio = 1.3,
    private readonly takeProfitPercent = 0.08,
    private readonly stopLossPercent = 0.035,
    private readonly cooldownBars = 5,
    private readonly targetWeight = 0.18,
    customName?: string,
  ) {
    this.name = customName ?? `KAIROS趋势健康(${fastPeriod},${slowPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.volumes.length = 0;
    this.inPosition = false;
    this.entryPrice = 0;
    this.lastExitBar = -Infinity;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = firstTradableQuote(context);
    if (!quote) return [];

    this.prices.push(quote.price);
    this.volumes.push(Math.max(quote.volume, 1));
    if (this.prices.length < Math.max(this.slowPeriod + 6, 65)) return [];

    const price = quote.price;
    const fastMa = sma(this.prices, this.fastPeriod);
    const slowMa = sma(this.prices, this.slowPeriod);
    const previousFastMa = sma(this.prices.slice(0, -5), this.fastPeriod);
    const previousSlowMa = sma(this.prices.slice(0, -5), this.slowPeriod);
    const currentVolumeRatio = volumeRatio(this.volumes);
    if (
      [fastMa, slowMa, previousFastMa, previousSlowMa, currentVolumeRatio]
        .some(Number.isNaN)
    ) {
      return [];
    }

    if (this.inPosition) {
      const entryReturn = price / this.entryPrice - 1;
      const highVolumeBreakdown =
        price < fastMa * 0.98 &&
        currentVolumeRatio >= this.breakdownVolumeRatio;
      const structuralBreakdown =
        price < slowMa &&
        fastMa < previousFastMa;
      if (
        entryReturn >= this.takeProfitPercent ||
        entryReturn <= -this.stopLossPercent ||
        highVolumeBreakdown ||
        structuralBreakdown
      ) {
        this.inPosition = false;
        this.entryPrice = 0;
        this.lastExitBar = context.barIndex;
        return [{
          symbol: quote.symbol,
          side: "sell",
          type: "market",
          targetWeight: 1,
        }];
      }
      return [];
    }

    if (context.barIndex - this.lastExitBar < this.cooldownBars) return [];
    const healthyTrend =
      price > fastMa &&
      fastMa > slowMa &&
      fastMa > previousFastMa &&
      slowMa >= previousSlowMa;
    const orderlyVolume = currentVolumeRatio < this.breakdownVolumeRatio;
    const notOverheated = quote.changePercent >= -1 && quote.changePercent <= 4.5;
    if (healthyTrend && orderlyVolume && notOverheated) {
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
