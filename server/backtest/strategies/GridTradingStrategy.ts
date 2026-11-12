import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../../shared/backtest";

/**
 * 网格交易策略 —— 在价格区间内等距布网，低买高卖。
 *
 * 根据初始价格自动计算网格层级：
 * - basePrice: 初始基准价格（从第一根 bar 获取）
 * - gridCount: 网格层数（默认上下各 5 层，共 10 层）
 * - gridSpacingPercent: 每层间距百分比（默认 2%）
 * - lotsPerGrid: 每层下单手数（默认 100 股）
 *
 * 规则：
 * - 价格下跌穿过网格线 → 买入 lotsPerGrid 股
 * - 价格上涨穿过网格线 → 卖出 lotsPerGrid 股
 * - 卖出整层数不超过当前本股实际可卖持仓，T+1 仍由 Broker 兜底
 * - 在极端位置留有一定余量，不追涨杀跌
 * - 层级记录是行情穿越而非成交确认，拒单或不可卖的穿越不补单
 */
export class GridTradingStrategy implements BacktestStrategy {
  readonly name: string;
  private basePrice: number | null = null;
  private boundSymbol?: string;
  /** 上次可交易报价所在层级；不把发信号视为已经成交。 */
  private lastBuyLevel: number | null = null;
  private lastSellLevel: number | null = null;

  constructor(
    private readonly gridCount = 5,
    private readonly gridSpacingPercent = 2,
    private readonly lotsPerGrid = 100,
    customName?: string,
  ) {
    this.name =
      customName ?? `网格交易(${gridCount}层,${gridSpacingPercent}%)`;
  }

  reset(): void {
    this.basePrice = null;
    this.boundSymbol = undefined;
    this.lastBuyLevel = null;
    this.lastSellLevel = null;
  }

  onStart(ctx: Omit<StrategyContext, "barIndex" | "totalBars">): void {
    this.reset();
    // 从初始价格确定基准价
    const quote = ctx.snapshot.quotes.find(
      (q) => q.tradable,
    );
    if (quote) {
      this.boundSymbol = quote.symbol;
      this.basePrice = quote.price;
      this.lastBuyLevel = this.gridCount; // 初始认为在中间位置
      this.lastSellLevel = this.gridCount;
    }
  }

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = context.snapshot.quotes.find((q) => q.symbol === this.boundSymbol && q.tradable);
    if (!quote || this.basePrice === null) return [];

    const signals: StrategySignal[] = [];

    // 计算当前价格所在的网格层级
    // gridLevel: basePrice 为 gridCount 层级，价格每下降 gridSpacingPercent%，层级 +1
    const priceRatio = quote.price / this.basePrice;
    const gridLevel = Math.round(
      this.gridCount -
        Math.log(priceRatio) / Math.log(1 + this.gridSpacingPercent / 100),
    );
    const clampedLevel = Math.max(0, Math.min(this.gridCount * 2, gridLevel));

    // 买入：价格下跌穿过网格线（层级增加）
    if (this.lastBuyLevel !== null && clampedLevel > this.lastBuyLevel) {
      const levelsToFill = clampedLevel - this.lastBuyLevel;
      for (let i = 0; i < levelsToFill; i++) {
        signals.push({
          symbol: quote.symbol,
          side: "buy",
          type: "market",
          quantity: this.lotsPerGrid,
        });
      }
      this.lastBuyLevel = clampedLevel;
    }

    // 卖出：价格上涨穿过网格线（层级减少）
    if (this.lastSellLevel !== null && clampedLevel < this.lastSellLevel) {
      const position = context.positions.find((item) => item.symbol === quote.symbol);
      const sellable = position
        ? Math.min(position.quantity, position.availableQuantity ?? position.quantity)
        : 0;
      const availableGrids = Number.isFinite(sellable) && Number.isFinite(this.lotsPerGrid) && this.lotsPerGrid > 0
        ? Math.floor(Math.max(0, sellable) / this.lotsPerGrid)
        : 0;
      // Reserve the whole batch against the observed position, not once per signal.
      const levelsToSell = Math.min(this.lastSellLevel - clampedLevel, availableGrids);
      for (let i = 0; i < levelsToSell; i++) {
        signals.push({
          symbol: quote.symbol,
          side: "sell",
          type: "market",
          quantity: this.lotsPerGrid,
        });
      }
      this.lastSellLevel = clampedLevel;
    }

    // 同步两个方向的状态
    this.lastBuyLevel = clampedLevel;
    this.lastSellLevel = clampedLevel;

    return signals;
  }
}
