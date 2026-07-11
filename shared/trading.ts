export type TradingMode = "mock" | "paper" | "live";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type OrderStatus = "accepted" | "filled" | "rejected" | "cancelled" | "pending";
export type CircuitState = "normal" | "warning" | "tripped";

export interface MarketQuote {
  symbol: string;
  name: string;
  tradable: boolean;
  price: number;
  previousClose: number;
  changePercent: number;
  volume: number;
  updatedAt: string;
  /** 开盘价（可选，来自行情源） */
  open?: number;
  /** 最高价（可选） */
  high?: number;
  /** 最低价（可选） */
  low?: number;
  /** 成交额（可选） */
  amount?: number;
  /** 换手率（可选，百分比） */
  turnover?: number;
  /** 振幅（可选，百分比） */
  amplitude?: number;
}

/** 数据质量评分 */
export interface DataQualityScore {
  /** 0-100，数据新鲜度（基于更新时间） */
  freshness: number;
  /** 0-100，数据完整度（有报价的符号比例） */
  completeness: number;
  /** 0-1，疑似停牌比例 */
  suspensionRate: number;
  /** 涨停数量 */
  limitUpCount: number;
  /** 跌停数量 */
  limitDownCount: number;
  /** 0-100，综合质量 */
  overall: number;
}

/** 数据质量标记 */
export interface DataQualityFlag {
  symbol: string;
  name: string;
  flag: "suspended" | "limit_up" | "limit_down" | "stale" | "zero_price" | "zero_volume";
  detail: string;
}

/** 数据质量报告 */
export interface DataQualityReport {
  timestamp: string;
  provider: string;
  totalSymbols: number;
  score: DataQualityScore;
  flags: DataQualityFlag[];
  missingSymbols: string[];
  cacheAgeSec: number | null;
}

export interface MarketSnapshot {
  mode: TradingMode;
  sequence: number;
  marketTime: string;
  quotes: MarketQuote[];
}

export interface PositionSnapshot {
  symbol: string;
  name: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  weight: number;
}

export interface AccountSnapshot {
  accountId: string;
  mode: TradingMode;
  cash: number;
  equity: number;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  riskUtilization: number;
  paused: boolean;
  updatedAt: string;
}

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  clientOrderId?: string;
}

export interface OrderRecord extends OrderRequest {
  id: string;
  status: OrderStatus;
  requestedPrice: number;
  filledPrice?: number;
  filledQuantity: number;
  notional: number;
  commission: number;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RiskLimits {
  maxOrderNotional: number;
  maxPositionWeight: number;
  maxDailyLoss: number;
  lotSize: number;
  realTradingEnabled: boolean;
}

/** 熔断器配置 */
export interface CircuitBreakerConfig {
  /** 连续亏损次数阈值（触发熔断） */
  maxConsecutiveLosses: number;
  /** 日内最大回撤比例（触发熔断，例如 0.05 = 5%） */
  maxDailyDrawdown: number;
  /** 熔断冷却时间（分钟） */
  cooldownMinutes: number;
  /** 恢复观察期（分钟），冷却后需观察此时间方可解除 */
  recoveryMinutes: number;
}

/** 增强型风控限额 */
export interface EnhancedRiskLimits extends RiskLimits {
  circuitBreaker: CircuitBreakerConfig;
  /** 启用动态仓位缩放（根据回撤调整最大仓位权重） */
  dynamicPositionScaling: boolean;
  /** 最大回撤时仓位缩减至原始权重的比例（0.2 = 回撤最大时仅允许原始20%仓位） */
  maxDrawdownReductionFactor: number;
}

/** 风控运行时状态 */
export interface RiskState {
  circuitState: CircuitState;
  consecutiveLosses: number;
  dailyDrawdown: number;
  peakDailyEquity: number;
  trippedAt: string | null;
  warningAt: string | null;
  tradeCount: number;
  lossCount: number;
  lastTradeTime: string | null;
  lastEvaluationTime: string | null;
}

export interface RiskDecision {
  allowed: boolean;
  code: string;
  message: string;
}

export interface AuditEvent {
  id: string;
  category: "market" | "order" | "risk" | "account" | "system";
  action: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export type TradingEvent =
  | { type: "market.snapshot"; data: MarketSnapshot }
  | { type: "account.snapshot"; data: AccountSnapshot }
  | { type: "positions.snapshot"; data: PositionSnapshot[] }
  | { type: "order.updated"; data: OrderRecord }
  | { type: "system.status"; data: { connected: boolean; message: string } }
  | { type: "signal"; data: TradingSignal };

// ── 策略信号 ─────────────────────────────────────────────

/** 信号方向 */
export type SignalDirection = "buy" | "sell" | "hold";

/** 信号强度（0-1），1 表示最强信号 */
export type SignalStrength = number;

/** 策略交易信号 */
export interface TradingSignal {
  /** 信号唯一ID */
  id: string;
  /** 策略ID */
  strategyId: string;
  /** 策略名称 */
  strategyName: string;
  /** 标的代码 */
  symbol: string;
  /** 信号方向 */
  direction: SignalDirection;
  /** 信号强度 0-1 */
  strength: SignalStrength;
  /** 建议仓位占比 */
  positionSize: number;
  /** 触发价格 */
  price: number;
  /** 信号原因/描述 */
  reason: string;
  /** 信号生成时间 */
  timestamp: string;
  /** 信号有效期（秒），0 表示无限制 */
  ttlSeconds: number;
  /** 置信度 0-1 */
  confidence: number;
  /** 附加指标数据 */
  indicators?: Record<string, number>;
  /** 信号状态 */
  status: "active" | "expired" | "executed" | "cancelled";
}

/** 信号订阅筛选条件 */
export interface SignalSubscription {
  /** 订阅的策略ID列表（空 = 全部） */
  strategyIds?: string[];
  /** 订阅的标的列表（空 = 全部） */
  symbols?: string[];
  /** 最低信号强度（0-1），低于此强度不推送 */
  minStrength?: SignalStrength;
  /** 最低置信度（0-1） */
  minConfidence?: number;
}

/** WebSocket 订阅请求 */
export interface WsSubscriptionRequest {
  type: "subscribe";
  topic: "signals" | "market" | "account" | "orders";
  filter?: SignalSubscription;
}

/** WebSocket 取消订阅请求 */
export interface WsUnsubscribeRequest {
  type: "unsubscribe";
  topic: "signals" | "market" | "account" | "orders";
}
