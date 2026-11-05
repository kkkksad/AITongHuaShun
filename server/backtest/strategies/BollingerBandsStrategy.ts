import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";
import { bollingerBands } from "./indicators";

/**
 * 布林带均值回归策略 —— 价格触及下轨买入，回归中轨或触及上轨卖出。
 *
 * 规则：
 * - price <= lowerBand → 买入（超卖反弹预期）
 * - price >= middleBand 且持仓 → 卖出（回归中轨）
 * - 或者 price >= upperBand 且持仓 → 卖出（超买）
 *
 * 参数：
 * - period: 布林带计算周期（默认 20）
 * - stdMultiplier: 标准差倍数（默认 2）
 * - targetWeight: 目标仓位比例（默认 0.5）
 */
export class BollingerBandsStrategy implements BacktestStrategy {
  readonly name: string;
  private readonly prices: number[] = [];
  private boundSymbol?: string;

  constructor(
    private readonly period = 20,
    private readonly stdMultiplier = 2,
    private readonly targetWeight = 0.5,
    customName?: string,
  ) {
    this.name =
      customName ?? `布林带(${period},${stdMultiplier}σ)`;
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

    if (this.prices.length < this.period) return [];

    const bb = bollingerBands(this.prices, this.period, this.stdMultiplier);
    if (isNaN(bb.lower) || isNaN(bb.middle) || isNaN(bb.upper)) return [];

    const price = quote.price;
    const position = context.positions.find((item) => item.symbol === quote.symbol);
    const inPosition = (position?.quantity ?? 0) > 0;

    // 触及下轨买入
    if (!inPosition && price <= bb.lower) {
      return [
        {
          symbol: quote.symbol,
          side: "buy",
          type: "market",
          targetWeight: this.targetWeight,
        },
      ];
    }

    // 回归中轨或触及上轨卖出
    if (position && inPosition && (price >= bb.middle || price >= bb.upper)) {
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
