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
  private boundSymbol?: string;

  constructor(
    private readonly fastPeriod = 5,
    private readonly slowPeriod = 20,
    private readonly targetWeight = 0.5,
    customName?: string,
  ) {
    this.name = customName ?? `均线交叉(${fastPeriod},${slowPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.boundSymbol = undefined;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = this.boundSymbol === undefined
      ? context.snapshot.quotes.find((q) => q.tradable)
      : context.snapshot.quotes.find((q) => q.symbol === this.boundSymbol && q.tradable);
    if (!quote) return [];
    this.boundSymbol ??= quote.symbol;

    this.prices.push(quote.price);

    if (this.prices.length < this.slowPeriod + 1) return [];

    const fastMa = sma(this.prices, this.fastPeriod);
    const slowMa = sma(this.prices, this.slowPeriod);
    const prevFastMa = sma(this.prices.slice(0, -1), this.fastPeriod);
    const prevSlowMa = sma(this.prices.slice(0, -1), this.slowPeriod);

    if (isNaN(fastMa) || isNaN(slowMa) || isNaN(prevFastMa) || isNaN(prevSlowMa)) {
      return [];
    }

    const position = context.positions.find((item) => item.symbol === quote.symbol);
    const inPosition = (position?.quantity ?? 0) > 0;

    // 金叉买入
    if (!inPosition && prevFastMa <= prevSlowMa && fastMa > slowMa) {
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
    if (position && inPosition && prevFastMa >= prevSlowMa && fastMa < slowMa) {
      const sellable = Math.min(position.quantity, position.availableQuantity ?? position.quantity);
      const quantity = Math.floor(sellable / 100) * 100;
      if (quantity <= 0) return [];
      return [
        {
          symbol: quote.symbol,
          side: "sell",
          type: "market",
          quantity,
        },
      ];
    }

    return [];
  }
}
