import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";
import { donchianChannel, sma } from "./indicators";

/**
 * 海龟交易策略（Turtle Trading） —— 基于唐奇安通道突破的经典趋势跟踪策略。
 *
 * 规则：
 * - 价格突破 N 日最高价（上轨）→ 买入
 * - 价格跌破 N 日最低价（下轨）→ 卖出
 * - 使用 M 日低点作为止损
 * - 使用均线过滤趋势方向（可选）
 *
 * 参数：
 * - entryPeriod: 突破周期（默认 20，经典海龟）
 * - exitPeriod: 退出周期（默认 10）
 * - trendFilterPeriod: 趋势过滤均线周期（默认 50，0 表示不过滤）
 * - targetWeight: 目标仓位比例（默认 0.5）
 */
export class TurtleStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private readonly highs: number[] = [];
  private readonly lows: number[] = [];
  private inPosition = false;
  private entryPrice = 0;

  constructor(
    private readonly entryPeriod = 20,
    private readonly exitPeriod = 10,
    private readonly trendFilterPeriod = 50,
    private readonly targetWeight = 0.5,
    customName?: string,
  ) {
    this.name =
      customName ?? `Turtle(${entryPeriod}/${exitPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.highs.length = 0;
    this.lows.length = 0;
    this.inPosition = false;
    this.entryPrice = 0;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = context.snapshot.quotes.find((q) => q.tradable);
    if (!quote) return [];

    const price = quote.price;
    this.prices.push(price);

    // 模拟日内高低点（用价格 ± 2% 估算）
    const dayHigh = price * (1 + 0.01);
    const dayLow = price * (1 - 0.01);
    this.highs.push(dayHigh);
    this.lows.push(dayLow);

    if (this.prices.length < Math.max(this.entryPeriod, this.trendFilterPeriod)) {
      return [];
    }

    // 趋势过滤：价格必须在均线上方才做多
    if (this.trendFilterPeriod > 0) {
      const ma = sma(this.prices, this.trendFilterPeriod);
      if (!isNaN(ma) && price < ma) {
        // 价格在均线下方，如果持有多头则考虑退出
        if (this.inPosition) {
          const channel = donchianChannel(this.highs, this.lows, this.exitPeriod);
          if (price <= channel.lower) {
            this.inPosition = false;
            return [
              {
                symbol: quote.symbol,
                side: "sell",
                type: "market",
                targetWeight: 1.0,
              },
            ];
          }
        }
        return [];
      }
    }

    const entryChannel = donchianChannel(this.highs, this.lows, this.entryPeriod);

    // 突破上轨买入
    if (!this.inPosition && price >= entryChannel.upper) {
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

    // 跌破下轨卖出
    if (this.inPosition) {
      const exitChannel = donchianChannel(this.highs, this.lows, this.exitPeriod);
      if (price <= exitChannel.lower) {
        this.inPosition = false;
        return [
          {
            symbol: quote.symbol,
            side: "sell",
            type: "market",
            targetWeight: 1.0,
          },
        ];
      }
    }

    return [];
  }
}
