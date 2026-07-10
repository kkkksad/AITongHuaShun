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
  private inPosition = false;

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

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = context.snapshot.quotes.find((q) => q.tradable);
    if (!quote) return [];

    this.prices.push(quote.price);

    if (this.prices.length < this.period + 1) return [];

    const currentRsi = rsi(this.prices, this.period);
    if (isNaN(currentRsi)) return [];

    // 超卖买入
    if (!this.inPosition && currentRsi < this.oversoldThreshold) {
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

    // 超买卖出
    if (this.inPosition && currentRsi > this.overboughtThreshold) {
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
