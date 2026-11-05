import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";

/**
 * 定投策略（Dollar Cost Averaging / 定期定额投资）
 *
 * 规则：
 * - 按固定周期（每 N 根 K 线）投入固定金额
 * - 无论市场价格高低，持续买入指定标的
 * - 可选止盈：按实际成交均价检查价格收益，卖出当前可卖的整手持仓
 *
 * 参数：
 * - intervalBars: 定投间隔（K 线数），默认 5 根（约每周）
 * - investAmount: 每次投入金额（元），默认 10000
 * - symbol: 定投标的代码，默认自动选择第一个可交易标的
 * - takeProfitPercent: 止盈百分比（0 表示不止盈），默认 20
 */
export class DCAStrategy implements BacktestStrategy {
  readonly name: string;
  private lastInvestBar = -1;

  constructor(
    private readonly intervalBars: number = 5,
    private readonly investAmount: number = 10000,
    private readonly symbol: string = "",
    private readonly takeProfitPercent: number = 20,
    customName?: string,
  ) {
    const symLabel = symbol ? `[${symbol}]` : "[自选]";
    this.name = customName ?? `定投${symLabel}每${intervalBars}K/${investAmount}元`;
  }

  reset(): void {
    this.lastInvestBar = -1;
  }

  onBar(context: StrategyContext): StrategySignal[] {
    // 找到目标标的
    const quote = this.symbol
      ? context.snapshot.quotes.find((q) => q.symbol === this.symbol)
      : context.snapshot.quotes.find((q) => q.tradable);

    if (!quote || quote.price <= 0) return [];

    // 成交均价包含滑点、不含佣金；只读取账户事实，不把信号视为已成交。
    const position = context.positions.find((p) => p.symbol === quote.symbol);
    if (position && position.quantity > 0 && position.averagePrice > 0 && this.takeProfitPercent > 0) {
      const currentValue = position.quantity * quote.price;
      const cost = position.quantity * position.averagePrice;
      const profitPercent =
        ((currentValue - cost) / cost) * 100;

      if (profitPercent >= this.takeProfitPercent) {
        const sellable = Math.min(position.quantity, position.availableQuantity ?? position.quantity);
        const sharesToSell = Math.floor(sellable / 100) * 100;
        // T+1 锁定或不足一手时等待；拒单或部分卖出后由下一根 bar 的持仓决定。
        if (sharesToSell <= 0) return [];
        return [
          {
            symbol: quote.symbol,
            side: "sell",
            type: "market",
            quantity: sharesToSell,
          },
        ];
      }
    }

    // 检查是否到达定投周期
    const barsSinceLastInvest = context.barIndex - this.lastInvestBar;
    if (barsSinceLastInvest < this.intervalBars) return [];

    // 检查资金是否足够
    if (context.cash < this.investAmount) return [];

    // 计算买入股数（整手：100 股）
    const rawShares = Math.floor(this.investAmount / quote.price / 100) * 100;
    if (rawShares <= 0) return [];

    // 保留发出买入意图的尝试间隔，无论订单最终是否被风控接受。
    this.lastInvestBar = context.barIndex;

    return [
      {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: rawShares,
      },
    ];
  }

  onStart(): void {
    this.reset();
  }
}
