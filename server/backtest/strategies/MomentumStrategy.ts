import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";
import { highest } from "./indicators";

/**
 * 动量突破策略 —— 当价格突破 N 日最高价时买入，跌破 M 日最低价时卖出。
 *
 * 规则：
 * - price >= N日最高价 → 买入（突破追涨）
 * - price <= M日最低价 → 卖出（止损/反转）
 *
 * 参数：
 * - entryPeriod: 入场突破周期（默认 20）
 * - exitPeriod: 离场周期（默认 10）
 * - targetWeight: 目标仓位比例（默认 0.5）
 */
export class MomentumStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private inPosition = false;

  constructor(
    private readonly entryPeriod = 20,
    private readonly exitPeriod = 10,
    private readonly targetWeight = 0.5,
    customName?: string,
  ) {
    this.name =
      customName ?? `动量突破(${entryPeriod},${exitPeriod})`;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = context.snapshot.quotes.find((q) => q.tradable);
    if (!quote) return [];

    this.prices.push(quote.price);

    if (this.prices.length < this.entryPeriod) return [];

    const nDayHigh = highest(this.prices, this.entryPeriod);
    if (isNaN(nDayHigh)) return [];

    const price = quote.price;

    // 突破N日最高价买入
    if (!this.inPosition && price >= nDayHigh) {
      this.inPosition = true;
      return [
        {
          symbol: quote.symbol,
          side: "buy",
          type: "market",
          targetWeight: this.targetWeight,
        },
      ];
    }

    // 跌破M日最低价卖出
    if (this.inPosition && this.prices.length >= this.exitPeriod) {
      // 使用 slice(-exitPeriod-1, -1) 来获取不包括当前bar的过去exitPeriod个最低价
      // 但我们想用当前bar价格判断，所以用 prices 包括当前bar
      const exitPrices = this.prices.slice(-this.exitPeriod);
      const exitLow = Math.min(...exitPrices);
      if (price <= exitLow) {
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
