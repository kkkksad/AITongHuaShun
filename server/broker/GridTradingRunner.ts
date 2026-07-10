/**
 * 网格交易运行器 —— 在模拟交易环境中自动执行网格策略。
 *
 * 与回测中的 GridTradingStrategy 共享相同的网格逻辑，
 * 但运行在实时的纸面交易环境中：监听行情快照，在价格穿过
 * 网格线时自动提交市价单到 PaperBroker。
 */
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { PaperBroker } from "./paperBroker";
import type { MarketSnapshot, OrderRequest } from "../../shared/trading";

export interface GridTradingConfig {
  /** 交易标的代码 */
  symbol: string;
  /** 网格层数（基准价格上下各 N 层，共 2N 层） */
  gridCount: number;
  /** 每层间距百分比（例如 2 表示 2%） */
  gridSpacingPercent: number;
  /** 每层下单数量（股） */
  lotsPerGrid: number;
}

export class GridTradingRunner {
  private enabled = false;
  private basePrice: number | null = null;
  private lastLevel: number | null = null;
  private readonly onSnapshotRef: (snapshot: MarketSnapshot) => void;

  constructor(
    private readonly market: MarketDataProvider,
    private readonly broker: PaperBroker,
    private readonly config: GridTradingConfig,
  ) {
    // 绑定监听器引用以便后续取消订阅
    this.onSnapshotRef = (snapshot: MarketSnapshot) => {
      if (!this.enabled) return;
      this.handleSnapshot(snapshot);
    };
  }

  /** 启动网格交易运行器 */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;

    // 获取初始基准价格
    const quote = this.market.getQuote(this.config.symbol);
    if (quote) {
      this.basePrice = quote.price;
      this.lastLevel = this.config.gridCount; // 初始认为在中间位置
    }

    // 订阅行情快照
    this.market.on("snapshot", this.onSnapshotRef);
  }

  /** 停止网格交易运行器 */
  stop(): void {
    this.enabled = false;
    this.market.off("snapshot", this.onSnapshotRef);
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this.enabled;
  }

  // ── 内部逻辑 ──────────────────────────────────────────────

  private handleSnapshot(snapshot: MarketSnapshot): void {
    const quote = snapshot.quotes.find((q) => q.symbol === this.config.symbol);
    if (!quote) return;

    // 首次初始化基准价
    if (this.basePrice === null) {
      this.basePrice = quote.price;
      this.lastLevel = this.config.gridCount;
      return;
    }

    // 计算当前价格所在的网格层级
    const priceRatio = quote.price / this.basePrice;
    const gridLevel = Math.round(
      this.config.gridCount -
        Math.log(priceRatio) / Math.log(1 + this.config.gridSpacingPercent / 100),
    );
    const clampedLevel = Math.max(
      0,
      Math.min(this.config.gridCount * 2, gridLevel),
    );

    if (this.lastLevel === null) {
      this.lastLevel = clampedLevel;
      return;
    }

    // 买入：价格下跌穿过网格线（层级增加）
    if (clampedLevel > this.lastLevel) {
      const levelsToFill = clampedLevel - this.lastLevel;
      for (let i = 0; i < levelsToFill; i++) {
        this.submitOrder("buy", this.config.lotsPerGrid);
      }
    }

    // 卖出：价格上涨穿过网格线（层级减少）
    if (clampedLevel < this.lastLevel) {
      const levelsToSell = this.lastLevel - clampedLevel;
      for (let i = 0; i < levelsToSell; i++) {
        this.submitOrder("sell", this.config.lotsPerGrid);
      }
    }

    this.lastLevel = clampedLevel;
  }

  private submitOrder(side: "buy" | "sell", quantity: number): void {
    const request: OrderRequest = {
      symbol: this.config.symbol,
      side,
      type: "market",
      quantity,
      clientOrderId: `grid-${side}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };

    try {
      this.broker.submitOrder(request);
    } catch (error) {
      // 网格交易中的个别订单失败不应中断整个网格
      console.warn(
        `[GridTrading] 订单提交失败: ${side} ${quantity} ${this.config.symbol}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
