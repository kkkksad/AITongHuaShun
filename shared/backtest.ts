import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
} from "./trading";

/** 策略在每根K线上的上下文信息 */
export interface StrategyContext {
  /** 当前行情快照 */
  snapshot: MarketSnapshot;
  /** 账户快照 */
  account: AccountSnapshot;
  /** 持仓明细 */
  positions: PositionSnapshot[];
  /** 当前权益 */
  equity: number;
  /** 可用现金 */
  cash: number;
  /** 当前bar索引（从0开始） */
  barIndex: number;
  /** 总bar数 */
  totalBars: number;
}

/** 策略信号 —— 策略返回的交易指令 */
export interface StrategySignal {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  /** 目标仓位比例（0-1），引擎根据当前权益计算实际下单数量 */
  targetWeight?: number;
  /** 直接指定数量（优先级高于 targetWeight） */
  quantity?: number;
  /** 限价单价格（仅限价单使用） */
  limitPrice?: number;
}

/** 回测策略接口 —— 所有策略必须实现此接口 */
export interface BacktestStrategy {
  /** 策略名称 */
  readonly name: string;
  /** 可选：重复运行同一回测引擎前重置策略内部状态 */
  reset?(): void;
  /**
   * 每根K线调用一次，返回交易信号数组。
   * 返回空数组表示本bar不交易。
   */
  onBar(context: StrategyContext): StrategySignal[];
  /** 可选：回测开始前调用 */
  onStart?(context: Omit<StrategyContext, "barIndex" | "totalBars">): void;
  /** 可选：回测结束后调用 */
  onEnd?(context: StrategyContext): void;
}

/** 权益曲线数据点 */
export interface EquityPoint {
  /** bar索引 */
  index: number;
  /** 行情时间 */
  time: string;
  /** 权益 */
  equity: number;
  /** 现金 */
  cash: number;
  /** 持仓市值 */
  marketValue: number;
  /** 累计收益率（相对初始资金） */
  cumulativeReturn: number;
}

/** 单笔交易记录 */
export interface TradeRecord {
  orderId: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  quantity: number;
  price: number;
  notional: number;
  commission: number;
  time: string;
  barIndex: number;
}

/** 回测绩效指标 */
export interface BacktestMetrics {
  /** 初始资金 */
  initialCapital: number;
  /** 最终权益 */
  finalEquity: number;
  /** 总收益率 */
  totalReturn: number;
  /** 总收益率（百分比） */
  totalReturnPercent: number;
  /** 年化收益率（假设252个交易日） */
  annualizedReturn: number;
  /** 年化波动率 */
  annualizedVolatility: number;
  /** 夏普比率（无风险利率假设为0） */
  sharpeRatio: number;
  /** 索提诺比率 */
  sortinoRatio: number;
  /** 最大回撤 */
  maxDrawdown: number;
  /** 最大回撤百分比 */
  maxDrawdownPercent: number;
  /** 卡尔玛比率（年化收益/最大回撤） */
  calmarRatio: number;
  /** 总交易次数 */
  totalTrades: number;
  /** 盈利交易次数 */
  winningTrades: number;
  /** 亏损交易次数 */
  losingTrades: number;
  /** 胜率 */
  winRate: number;
  /** 平均盈利 */
  avgWin: number;
  /** 平均亏损 */
  avgLoss: number;
  /** 盈亏比 */
  profitFactor: number;
  /** 总佣金 */
  totalCommission: number;
  /** 总滑点成本 */
  totalSlippage: number;
  /** bar数量 */
  barCount: number;
  /** 回测起止时间 */
  startTime: string;
  endTime: string;
}

/** 回测报告 */
export interface BacktestReport {
  /** 策略名称 */
  strategyName: string;
  /** 绩效指标 */
  metrics: BacktestMetrics;
  /** 权益曲线 */
  equityCurve: EquityPoint[];
  /** 所有订单 */
  orders: OrderRecord[];
  /** 所有交易（已成交） */
  trades: TradeRecord[];
  /** 最终账户快照 */
  finalAccount: AccountSnapshot;
  /** 最终持仓 */
  finalPositions: PositionSnapshot[];
  /** 回测配置 */
  config: BacktestConfig;
}

/** 回测配置 */
export interface BacktestConfig {
  /** 初始资金 */
  initialCapital: number;
  /** 佣金率 */
  commissionRate: number;
  /** 最低佣金 */
  minimumCommission: number;
  /** 滑点（bps） */
  slippageBps: number;
  /** 单笔最大金额 */
  maxOrderNotional: number;
  /** 单个标的最大仓位 */
  maxPositionWeight: number;
  /** 最大日亏损比例 */
  maxDailyLoss: number;
}
