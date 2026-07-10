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
  private inPosition = false;

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
    this.inPosition = false;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = context.snapshot.quotes.find((q) => q.tradable);
    if (!quote) return [];

    this.prices.push(quote.price);

    if (this.prices.length < this.period) return [];

    const bb = bollingerBands(this.prices, this.period, this.stdMultiplier);
    if (isNaN(bb.lower) || isNaN(bb.middle) || isNaN(bb.upper)) return [];

    const price = quote.price;

    // 触及下轨买入
    if (!this.inPosition && price <= bb.lower) {
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

    // 回归中轨或触及上轨卖出
    if (this.inPosition && (price >= bb.middle || price >= bb.upper)) {
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
