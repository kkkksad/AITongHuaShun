import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";
import { macd } from "./indicators";

/**
 * MACD 金叉死叉策略 —— 基于 MACD 线与信号线的交叉信号。
 *
 * 规则：
 * - MACD 线上穿信号线（金叉）且 histogram 由负转正 → 买入
 * - MACD 线下穿信号线（死叉）且 histogram 由正转负 → 卖出
 *
 * 参数：
 * - fastPeriod: 快线周期（默认 12）
 * - slowPeriod: 慢线周期（默认 26）
 * - signalPeriod: 信号线周期（默认 9）
 * - targetWeight: 目标仓位比例（默认 0.5）
 */
export class MACDStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private prevHistogram: number | null = null;
  private boundSymbol?: string;

  constructor(
    private readonly fastPeriod = 12,
    private readonly slowPeriod = 26,
    private readonly signalPeriod = 9,
    private readonly targetWeight = 0.5,
    customName?: string,
  ) {
    this.name =
      customName ??
      `MACD(${fastPeriod},${slowPeriod},${signalPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
    this.prevHistogram = null;
    this.boundSymbol = undefined;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = this.boundSymbol === undefined
      ? context.snapshot.quotes.find((q) => q.tradable)
      : context.snapshot.quotes.find((q) => q.symbol === this.boundSymbol && q.tradable);
    if (!quote) return [];
    this.boundSymbol ??= quote.symbol;

    this.prices.push(quote.price);

    const minLen = this.slowPeriod + this.signalPeriod;
    if (this.prices.length < minLen) return [];

    const { histogram } = macd(
      this.prices,
      this.fastPeriod,
      this.slowPeriod,
      this.signalPeriod,
    );

    if (isNaN(histogram)) return [];

    const prevH = this.prevHistogram;
    this.prevHistogram = histogram;

    if (prevH === null) return [];
    const position = context.positions.find((item) => item.symbol === quote.symbol);
    const inPosition = (position?.quantity ?? 0) > 0;

    // 金叉：histogram 由负转正
    if (!inPosition && prevH <= 0 && histogram > 0) {
      return [
        {
          symbol: quote.symbol,
          side: "buy",
          type: "market",
          targetWeight: this.targetWeight,
        },
      ];
    }

    // 死叉：histogram 由正转负
    if (position && inPosition && prevH >= 0 && histogram < 0) {
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
