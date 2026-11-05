import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";
import { rsi } from "./indicators";

/**
 * RSI 超买超卖策略 —— 基于相对强弱指标的反转策略。
 *
 * 规则：
 * - RSI < oversoldThreshold → 买入（超卖反弹）
 * - RSI > overboughtThreshold → 卖出（超买回落）
 *
 * 参数：
 * - period: RSI 计算周期（默认 14）
 * - oversoldThreshold: 超卖阈值（默认 30）
 * - overboughtThreshold: 超买阈值（默认 70）
 * - targetWeight: 目标仓位比例（默认 0.5）
 */
export class RSIStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private boundSymbol?: string;

  constructor(
    private readonly period = 14,
    private readonly oversoldThreshold = 30,
    private readonly overboughtThreshold = 70,
    private readonly targetWeight = 0.5,
    customName?: string,
  ) {
    this.name =
      customName ??
      `RSI(${period},${oversoldThreshold}/${overboughtThreshold})`;
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

    if (this.prices.length < this.period + 1) return [];

    const currentRsi = rsi(this.prices, this.period);
    if (isNaN(currentRsi)) return [];

    const position = context.positions.find((item) => item.symbol === quote.symbol);
    const inPosition = (position?.quantity ?? 0) > 0;

    // 超卖买入
    if (!inPosition && currentRsi < this.oversoldThreshold) {
      return [
        {
          symbol: quote.symbol,
          side: "buy",
          type: "market",
          targetWeight: this.targetWeight,
        },
      ];
    }

    // 超买卖出
    if (position && inPosition && currentRsi > this.overboughtThreshold) {
      const sellable = Math.min(position.quantity, position.availableQuantity ?? position.quantity);
      const quantity = Math.floor(sellable / 100) * 100;
      // 锁定或不足一手时等待；后续 bar 始终重新读取实际持仓。
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
