import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";
import { sma } from "./indicators";

/**
 * 均线交叉策略 —— 经典的双均线金叉/死叉策略。
 *
 * 规则：
 * - 金叉（快线上穿慢线）→ 买入
 * - 死叉（快线下穿慢线）→ 卖出
 *
 * 参数：
 * - fastPeriod: 快线周期（默认 5）
 * - slowPeriod: 慢线周期（默认 20）
 * - targetWeight: 每次交易的目标仓位比例（默认 0.5）
 */
export class MovingAverageCrossStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private inPosition = false;

  constructor(
    private readonly fastPeriod = 5,
    private readonly slowPeriod = 20,
    private readonly targetWeight = 0.5,
    customName?: string,
  ) {
    this.name = customName ?? `均线交叉(${fastPeriod},${slowPeriod})`;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = context.snapshot.quotes.find(
      (q) => q.tradable && q.symbol === context.snapshot.quotes[0]?.symbol,
    );
    if (!quote) return [];

    this.prices.push(quote.price);

    if (this.prices.length < this.slowPeriod + 1) return [];

    const fastMa = sma(this.prices, this.fastPeriod);
    const slowMa = sma(this.prices, this.slowPeriod);
    const prevFastMa = sma(this.prices.slice(0, -1), this.fastPeriod);
    const prevSlowMa = sma(this.prices.slice(0, -1), this.slowPeriod);

    if (isNaN(fastMa) || isNaN(slowMa) || isNaN(prevFastMa) || isNaN(prevSlowMa)) {
      return [];
    }

    // 金叉买入
    if (!this.inPosition && prevFastMa <= prevSlowMa && fastMa > slowMa) {
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

    // 死叉卖出
    if (this.inPosition && prevFastMa >= prevSlowMa && fastMa < slowMa) {
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

    return [];
  }
}
