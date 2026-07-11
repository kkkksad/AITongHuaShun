import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";
import { highest, sma } from "./indicators";

/**
 * A 股强势回踩确认策略。
 *
 * 设计目标不是预测“必胜”，而是在研究排行榜里提供一个偏高胜率、
 * 交易频率较低、风控边界清晰的候选战法：
 * - 只在中期均线向上且价格站上趋势均线时考虑买入。
 * - 等待近期高点回撤到可控幅度后，再出现放量反包确认。
 * - 入场后使用固定止盈/止损，避免把回测胜率建立在无限持仓上。
 */
export class ASharePullbackConfirmationStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private readonly volumes: number[] = [];
  private inPosition = false;
  private entryPrice = 0;

  constructor(
    private readonly trendPeriod = 30,
    private readonly pullbackPeriod = 8,
    private readonly maxPullbackPercent = 0.08,
    private readonly minReboundPercent = 0.006,
    private readonly volumeMultiplier = 1.05,
    private readonly takeProfitPercent = 0.045,
    private readonly stopLossPercent = 0.03,
    private readonly targetWeight = 0.35,
    customName?: string,
  ) {
    this.name =
      customName ??
      `A股强势回踩确认(${trendPeriod},${pullbackPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.volumes.length = 0;
    this.inPosition = false;
    this.entryPrice = 0;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = context.snapshot.quotes.find((item) => item.tradable);
    if (!quote || quote.price <= 0) return [];

    this.prices.push(quote.price);
    this.volumes.push(Math.max(quote.volume, 1));

    const minBars = Math.max(this.trendPeriod + 2, this.pullbackPeriod + 3);
    if (this.prices.length < minBars) return [];

    const price = quote.price;
    const previousPrice = this.prices[this.prices.length - 2];

    if (this.inPosition) {
      const changeFromEntry = price / this.entryPrice - 1;
      if (
        changeFromEntry >= this.takeProfitPercent ||
        changeFromEntry <= -this.stopLossPercent
      ) {
        this.inPosition = false;
        this.entryPrice = 0;
        return [
          {
            symbol: quote.symbol,
            side: "sell",
            type: "market",
            targetWeight: 1,
          },
        ];
      }
      return [];
    }

    const trendMa = sma(this.prices, this.trendPeriod);
    const previousTrendMa = sma(this.prices.slice(0, -1), this.trendPeriod);
    if (isNaN(trendMa) || isNaN(previousTrendMa)) return [];

    const trendIsUp = trendMa > previousTrendMa && price > trendMa;
    if (!trendIsUp) return [];

    const recentPricesBeforeToday = this.prices.slice(
      -(this.pullbackPeriod + 1),
      -1,
    );
    const recentHigh = highest(recentPricesBeforeToday, this.pullbackPeriod);
    if (isNaN(recentHigh) || recentHigh <= 0) return [];

    const pullbackFromHigh = 1 - price / recentHigh;
    const hasControlledPullback =
      pullbackFromHigh > 0 && pullbackFromHigh <= this.maxPullbackPercent;
    const reboundConfirmed =
      previousPrice > 0 && price / previousPrice - 1 >= this.minReboundPercent;

    const recentVolumesBeforeToday = this.volumes.slice(
      -(this.pullbackPeriod + 1),
      -1,
    );
    const averageVolume =
      recentVolumesBeforeToday.reduce((sum, value) => sum + value, 0) /
      recentVolumesBeforeToday.length;
    const volumeConfirmed = quote.volume >= averageVolume * this.volumeMultiplier;

    if (hasControlledPullback && reboundConfirmed && volumeConfirmed) {
      this.inPosition = true;
      this.entryPrice = price;
      return [
        {
          symbol: quote.symbol,
          side: "buy",
          type: "market",
          targetWeight: this.targetWeight,
        },
      ];
    }

    return [];
  }
}
