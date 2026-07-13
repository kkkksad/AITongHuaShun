import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";
import { highest, lowest, rsi, sma } from "./indicators";

function firstTradableQuote(context: StrategyContext) {
  return context.snapshot.quotes.find((quote) => quote.tradable && quote.price > 0);
}

function rollingVolatility(prices: number[], period: number): number {
  if (prices.length < period + 1 || period <= 1) return NaN;
  const returns: number[] = [];
  const start = prices.length - period;
  for (let index = start; index < prices.length; index++) {
    const previous = prices[index - 1];
    const current = prices[index];
    if (previous > 0) {
      returns.push(current / previous - 1);
    }
  }
  if (returns.length === 0) return NaN;
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    returns.length;
  return Math.sqrt(variance);
}

function average(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * KAIROS 低波趋势策略。
 *
 * 目标不是追求最高收益，而是在趋势仍然向上、波动没有失控时才小仓位参与。
 */
export class KairosLowVolTrendStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private inPosition = false;
  private entryPrice = 0;

  constructor(
    private readonly trendPeriod = 30,
    private readonly slowPeriod = 60,
    private readonly maxVolatility = 0.022,
    private readonly takeProfitPercent = 0.038,
    private readonly stopLossPercent = 0.018,
    private readonly targetWeight = 0.18,
    customName?: string,
  ) {
    this.name =
      customName ??
      `KAIROS低波趋势(${trendPeriod},${slowPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.inPosition = false;
    this.entryPrice = 0;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = firstTradableQuote(context);
    if (!quote) return [];

    this.prices.push(quote.price);
    const minBars = Math.max(this.slowPeriod, this.trendPeriod) + 2;
    if (this.prices.length < minBars) return [];

    const price = quote.price;
    const trendMa = sma(this.prices, this.trendPeriod);
    const previousTrendMa = sma(this.prices.slice(0, -1), this.trendPeriod);
    const slowMa = sma(this.prices, this.slowPeriod);
    const volatility = rollingVolatility(this.prices, Math.min(20, this.trendPeriod));
    if ([trendMa, previousTrendMa, slowMa, volatility].some((value) => isNaN(value))) {
      return [];
    }

    if (this.inPosition) {
      const entryReturn = price / this.entryPrice - 1;
      const trendBroken = price < trendMa || trendMa < previousTrendMa;
      const volatilityBroken = volatility > this.maxVolatility * 1.6;
      if (
        entryReturn >= this.takeProfitPercent ||
        entryReturn <= -this.stopLossPercent ||
        trendBroken ||
        volatilityBroken
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

    const trendIsUp = price > trendMa && trendMa > previousTrendMa && trendMa > slowMa;
    const notOverheated = quote.changePercent > -1.2 && quote.changePercent < 4.2;
    const notTooFarFromMean = price / trendMa - 1 <= 0.08;
    if (
      trendIsUp &&
      volatility <= this.maxVolatility &&
      notOverheated &&
      notTooFarFromMean
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
 * KAIROS 缩量回撤反弹策略。
 *
 * 只在中期趋势仍然有效、回撤幅度可控且没有恐慌放量时尝试反弹。
 */
export class KairosQuietPullbackStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private readonly volumes: number[] = [];
  private inPosition = false;
  private entryPrice = 0;

  constructor(
    private readonly trendPeriod = 30,
    private readonly pullbackPeriod = 8,
    private readonly minPullbackPercent = 0.012,
    private readonly maxPullbackPercent = 0.065,
    private readonly maxVolumeMultiplier = 1.35,
    private readonly takeProfitPercent = 0.034,
    private readonly stopLossPercent = 0.017,
    private readonly targetWeight = 0.16,
    customName?: string,
  ) {
    this.name =
      customName ??
      `KAIROS缩量回撤反弹(${trendPeriod},${pullbackPeriod})`;
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
    const minBars = Math.max(this.trendPeriod + 2, this.pullbackPeriod + 3);
    if (this.prices.length < minBars) return [];

    const price = quote.price;
    const previousPrice = this.prices[this.prices.length - 2];

    if (this.inPosition) {
      const entryReturn = price / this.entryPrice - 1;
      const trendMa = sma(this.prices, this.trendPeriod);
      if (
        entryReturn >= this.takeProfitPercent ||
        entryReturn <= -this.stopLossPercent ||
        (!isNaN(trendMa) && price < trendMa * 0.985)
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

    const trendMa = sma(this.prices, this.trendPeriod);
    const previousTrendMa = sma(this.prices.slice(0, -1), this.trendPeriod);
    if (isNaN(trendMa) || isNaN(previousTrendMa)) return [];

    const recentHigh = highest(
      this.prices.slice(-(this.pullbackPeriod + 1), -1),
      this.pullbackPeriod,
    );
    if (isNaN(recentHigh) || recentHigh <= 0) return [];

    const averageVolume = average(
      this.volumes.slice(-(this.pullbackPeriod + 1), -1),
    );
    const pullback = 1 - price / recentHigh;
    const rebound = previousPrice > 0 ? price / previousPrice - 1 : 0;
    const currentRsi = rsi(this.prices, Math.max(6, this.pullbackPeriod));

    const trendIntact = price > trendMa && trendMa >= previousTrendMa;
    const controlledPullback =
      pullback >= this.minPullbackPercent &&
      pullback <= this.maxPullbackPercent;
    const quietVolume =
      !isNaN(averageVolume) &&
      quote.volume <= averageVolume * this.maxVolumeMultiplier;
    const reboundConfirmed = rebound >= 0.003 && quote.changePercent < 4.5;
    const rsiRecovered = isNaN(currentRsi) || (currentRsi >= 38 && currentRsi <= 68);

    if (
      trendIntact &&
      controlledPullback &&
      quietVolume &&
      reboundConfirmed &&
      rsiRecovered
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
 * KAIROS 资金护城河策略。
 *
 * 只吃受控突破，仓位更小，并在亏损或趋势失败后进入冷却期。
 */
export class KairosCapitalShieldStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private inPosition = false;
  private entryPrice = 0;
  private lastExitBar = -Infinity;

  constructor(
    private readonly entryPeriod = 20,
    private readonly exitPeriod = 7,
    private readonly maxRecentDrawdown = 0.055,
    private readonly takeProfitPercent = 0.03,
    private readonly stopLossPercent = 0.015,
    private readonly cooldownBars = 5,
    private readonly targetWeight = 0.14,
    customName?: string,
  ) {
    this.name =
      customName ??
      `KAIROS资金护城河(${entryPeriod},${exitPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.inPosition = false;
    this.entryPrice = 0;
    this.lastExitBar = -Infinity;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = firstTradableQuote(context);
    if (!quote) return [];

    this.prices.push(quote.price);
    const minBars = Math.max(this.entryPeriod, this.exitPeriod) + 2;
    if (this.prices.length < minBars) return [];

    const price = quote.price;

    if (this.inPosition) {
      const entryReturn = price / this.entryPrice - 1;
      const exitLow = lowest(this.prices.slice(-this.exitPeriod), this.exitPeriod);
      const shouldExit =
        entryReturn >= this.takeProfitPercent ||
        entryReturn <= -this.stopLossPercent ||
        (!isNaN(exitLow) && price <= exitLow);
      if (shouldExit) {
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

    if (context.barIndex - this.lastExitBar < this.cooldownBars) {
      return [];
    }

    const previousHigh = highest(
      this.prices.slice(-(this.entryPeriod + 1), -1),
      this.entryPeriod,
    );
    const recentHigh = highest(this.prices, Math.min(15, this.entryPeriod));
    const recentLow = lowest(this.prices, Math.min(15, this.entryPeriod));
    if ([previousHigh, recentHigh, recentLow].some((value) => isNaN(value))) {
      return [];
    }

    const recentDrawdown = recentHigh > 0 ? 1 - recentLow / recentHigh : 1;
    const cashRatio = context.equity > 0 ? context.cash / context.equity : 0;
    const controlledBreakout =
      price >= previousHigh &&
      recentDrawdown <= this.maxRecentDrawdown &&
      quote.changePercent >= 0 &&
      quote.changePercent <= 4.2;

    if (controlledBreakout && cashRatio >= 0.2) {
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
