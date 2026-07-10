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
 * - 可选止盈：当持仓盈利超过止盈阈值时全部卖出
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
  private investedTotal = 0;
  private investedShares = 0;
  private averageCost = 0;

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

  onBar(context: StrategyContext): StrategySignal[] {
    // 找到目标标的
    const quote = this.symbol
      ? context.snapshot.quotes.find((q) => q.symbol === this.symbol)
      : context.snapshot.quotes.find((q) => q.tradable);

    if (!quote || quote.price <= 0) return [];

    // 检查止盈条件
    if (this.investedShares > 0 && this.takeProfitPercent > 0) {
      const currentValue = this.investedShares * quote.price;
      const profitPercent =
        ((currentValue - this.investedTotal) / this.investedTotal) * 100;

      if (profitPercent >= this.takeProfitPercent) {
        // 触发止盈：全部卖出
        const sharesToSell = this.investedShares;
        this.investedShares = 0;
        this.investedTotal = 0;
        this.averageCost = 0;
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

    const actualCost = rawShares * quote.price;

    // 更新持仓记录
    const newTotalShares = this.investedShares + rawShares;
    this.averageCost =
      (this.investedTotal + actualCost) / (newTotalShares || 1);
    this.investedTotal += actualCost;
    this.investedShares = newTotalShares;
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

  onStart?(context: Omit<StrategyContext, "barIndex" | "totalBars">): void {
    this.lastInvestBar = -1;
    this.investedTotal = 0;
    this.investedShares = 0;
    this.averageCost = 0;
  }
}
