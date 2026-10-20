export type TradingMode = "mock" | "paper" | "live";
export type PaperStrategyProfile =
  | "capital-preservation"
  | "defensive"
  | "balanced"
  | "growth";

export const PAPER_EXECUTION_STRATEGY_KEYS = [
  "kairosLowVolTrend",
  "kairosTrendHealth",
  "kairosQualityLowVolTrend",
  "momentum",
  "kairosVolatilityContractionBreakout",
  "kairosVolumePriceBreakout",
  "kairosQuietPullback",
  "kairosWashoutRecovery",
  "aSharePullback",
  "movingAverageCross",
  "macd",
  "turtle",
  "rsi",
  "bollingerBands",
  "kairosRangeRotation",
  "kairosQualifiedProbe",
  "kairosValidationBasket",
] as const;

export type PaperManualExecutionStrategy = (typeof PAPER_EXECUTION_STRATEGY_KEYS)[number];
export const PAPER_EXECUTION_STRATEGY_VALUES = ["auto", ...PAPER_EXECUTION_STRATEGY_KEYS] as const;
export type PaperExecutionStrategy = (typeof PAPER_EXECUTION_STRATEGY_VALUES)[number];

export type PaperExecutionStrategyCategory =
  | "auto"
  | "trend"
  | "breakout"
  | "pullback"
  | "range"
  | "validation";

export interface PaperExecutionStrategyOption {
  key: PaperExecutionStrategy;
  label: string;
  description: string;
  category: PaperExecutionStrategyCategory;
}

export const PAPER_AUTO_EXECUTION_STRATEGY_OPTION: PaperExecutionStrategyOption = {
  key: "auto",
  label: "市场自动路由（非推荐）",
  description: "仅在明确需要跟随市场状态时使用；结果可随行情变化，不适合固定策略验证。",
  category: "auto",
};

export const PAPER_EXECUTION_STRATEGY_OPTIONS: readonly PaperExecutionStrategyOption[] = [
  {
    key: "kairosLowVolTrend",
    label: "KAIROS低波趋势",
    description: "健康趋势、低振幅和均线斜率向上时研究强势延续。",
    category: "trend",
  },
  {
    key: "kairosTrendHealth",
    label: "KAIROS趋势健康",
    description: "使用真实历史趋势健康度和回撤受控程度筛选候选。",
    category: "trend",
  },
  {
    key: "kairosQualityLowVolTrend",
    label: "KAIROS质量低波趋势",
    description: "用趋势效率、近期回撤、波动和均线结构确认低波趋势；质量仅指价格行为。",
    category: "trend",
  },
  {
    key: "momentum",
    label: "趋势动量确认",
    description: "在受控追高范围内确认价格和成交活跃度动量。",
    category: "breakout",
  },
  {
    key: "kairosVolatilityContractionBreakout",
    label: "KAIROS波动收缩突破",
    description: "先确认历史振幅收缩，再要求放量突破和历史趋势健康。",
    category: "breakout",
  },
  {
    key: "kairosVolumePriceBreakout",
    label: "KAIROS量价突破确认",
    description: "价格突破、量能放大、日内强势区与中期趋势同时确认。",
    category: "breakout",
  },
  {
    key: "kairosQuietPullback",
    label: "KAIROS安静回踩",
    description: "上升趋势中的缩量回踩形态，等待企稳后再评估。",
    category: "pullback",
  },
  {
    key: "kairosWashoutRecovery",
    label: "KAIROS洗盘恢复",
    description: "历史验证过的洗盘后恢复形态，要求足够样本和置信度。",
    category: "pullback",
  },
  {
    key: "aSharePullback",
    label: "A股强势回踩",
    description: "强势结构中回踩受控、尚未破坏中期趋势的候选。",
    category: "pullback",
  },
  {
    key: "movingAverageCross",
    label: "均线交叉确认",
    description: "趋势周期中的均线交叉与价格结构确认。",
    category: "trend",
  },
  {
    key: "macd",
    label: "MACD趋势确认",
    description: "使用趋势动量和 MACD 结构辅助确认。",
    category: "trend",
  },
  {
    key: "turtle",
    label: "海龟突破",
    description: "趋势突破结构，仍需通过追高、流动性和费用过滤。",
    category: "breakout",
  },
  {
    key: "rsi",
    label: "RSI超卖回归",
    description: "震荡市场中受控低位的 RSI 回归观察。",
    category: "range",
  },
  {
    key: "bollingerBands",
    label: "布林带下沿回归",
    description: "震荡区间下沿附近的均值回归研究候选。",
    category: "range",
  },
  {
    key: "kairosRangeRotation",
    label: "KAIROS区间轮动",
    description: "震荡市场中有历史样本支持的受控区间轮动。",
    category: "range",
  },
  {
    key: "kairosQualifiedProbe",
    label: "KAIROS合格样本验证",
    description: "活动目标未达标时，用合格历史样本进行有界 Paper 验证。",
    category: "validation",
  },
  {
    key: "kairosValidationBasket",
    label: "KAIROS验证篮子",
    description: "主策略无信号时，用受控验证篮子收集 Paper 样本。",
    category: "validation",
  },
];

/** 手动策略优先；自动市场路由始终放在最后，避免被误认为默认推荐。 */
export const PAPER_EXECUTION_STRATEGY_CHOICES: readonly PaperExecutionStrategyOption[] = [
  ...PAPER_EXECUTION_STRATEGY_OPTIONS,
  PAPER_AUTO_EXECUTION_STRATEGY_OPTION,
];

export function getPaperExecutionStrategyOption(
  key: PaperExecutionStrategy,
): PaperExecutionStrategyOption | undefined {
  return PAPER_EXECUTION_STRATEGY_CHOICES.find((option) => option.key === key);
}
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
  /** 疑似复权缺口标的数（前后复权未对齐导致的价格跳空） */
  adjustmentWarningCount: number;
  /** 异常价格标的数（超出板块涨跌停限制的非停牌波动） */
  anomalyPriceCount: number;
  /** 超过新鲜度阈值的标的数 */
  staleCount: number;
  /** 0-100，综合质量 */
  overall: number;
}

/** 数据质量标记 */
export interface DataQualityFlag {
  symbol: string;
  name: string;
  flag: "suspended" | "limit_up" | "limit_down" | "stale" | "zero_price" | "zero_volume" | "adjustment_gap" | "anomaly_price";
  detail: string;
}

/** 数据质量报告 */
export interface DataQualityReport {
  timestamp: string;
  provider: string;
  totalSymbols: number;
  requestedSymbols: number;
  validSymbols: number;
  qualityState: "healthy" | "degraded" | "unusable";
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
  /** A 股 T+1 规则下当前可卖数量；当日买入数量不计入可卖。 */
  availableQuantity?: number;
  /** A 股 T+1 规则下当日买入锁定数量。 */
  t1LockedQuantity?: number;
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
  /** Legacy names: these values are measured from the latest paper-account reset. */
  dailyPnl: number;
  dailyPnlPercent: number;
  riskUtilization: number;
  paused: boolean;
  startingEquity?: number;
  strategyProfile?: PaperStrategyProfile;
  executionStrategy?: PaperExecutionStrategy;
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
  /** 下单时的标的名称；旧版持久化订单可能不存在。 */
  name?: string;
  status: OrderStatus;
  requestedPrice: number;
  filledPrice?: number;
  filledQuantity: number;
  notional: number;
  commission: number;
  /** 成交完成时间；旧版持久化订单可能不存在。 */
  filledAt?: string;
  /** 服务端内部记录的策略名称；浏览器订单不得自行写入。 */
  strategy?: string;
  /** 服务端内部记录的策略键；浏览器订单不得自行写入。 */
  strategyKey?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** 仅供服务端下单链路写入的订单来源审计字段。 */
export interface OrderProvenance {
  strategy?: string;
  strategyKey?: string;
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
