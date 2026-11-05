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

  constructor(
    private readonly entryPeriod = 20,
    private readonly exitPeriod = 10,
    private readonly targetWeight = 0.5,
    customName?: string,
  ) {
    this.name =
      customName ?? `动量突破(${entryPeriod},${exitPeriod})`;
  }

  reset(): void {
    this.prices.length = 0;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = context.snapshot.quotes.find((q) => q.tradable);
    if (!quote) return [];

    this.prices.push(quote.price);

    if (this.prices.length < this.entryPeriod + 1) return [];

    // 完整的过去 N 条观察值，不把当前判断价格计入通道。
    const entryPrices = this.prices.slice(-this.entryPeriod - 1, -1);
    const nDayHigh = highest(entryPrices, this.entryPeriod);
    if (isNaN(nDayHigh)) return [];

    const price = quote.price;
    const position = context.positions.find((item) => item.symbol === quote.symbol);
    const inPosition = (position?.quantity ?? 0) > 0;

    // 突破N日最高价买入
    if (!inPosition && price >= nDayHigh) {
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
    if (position && inPosition && this.prices.length >= this.exitPeriod + 1) {
      const exitPrices = this.prices.slice(-this.exitPeriod - 1, -1);
      const exitLow = Math.min(...exitPrices);
      if (price <= exitLow) {
        const sellable = Math.min(position.quantity, position.availableQuantity ?? position.quantity);
        const quantity = Math.floor(sellable / 100) * 100;
        // 锁定或不足一手时等待，后续 bar 重新读取真实持仓。
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
    }

    return [];
  }
}
