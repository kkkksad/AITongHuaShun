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
  | { type: "system.status"; data: { connected: boolean; message: string } };
