export type StrategyId =
  | "momentum"
  | "mean-reversion"
  | "breakout"
  | "multi-factor"
  | "dca";

export type Sentiment = "positive" | "neutral" | "negative";

export interface StrategyDefinition {
  id: StrategyId;
  name: string;
  shortName: string;
  description: string;
  tag: string;
  color: string;
}

export interface StrategyParameters {
  lookback: number;
  entryThreshold: number;
  stopLoss: number;
  takeProfit: number;
  maxPosition: number;
  rebalanceDays: number;
}

/** 建仓计划 / 定投计划 */
export interface DcaPlan {
  id: string;
  name: string;
  symbol: string;
  symbolName: string;
  totalAmount: number; // 计划总投入
  perInvestAmount: number; // 每期投入
  interval: "daily" | "weekly" | "biweekly" | "monthly";
  startDate: string;
  endDate?: string;
  currentInvested: number; // 已投入金额
  currentShares: number; // 当前持有股数
  averageCost: number; // 平均成本
  currentValue: number; // 当前市值
  profitPercent: number; // 盈亏百分比
  status: "active" | "paused" | "completed";
  takeProfitPercent: number; // 止盈百分比（0=不止盈）
  stopLossPercent: number; // 止损百分比（0=不止损）
}

export interface EquityPoint {
  date: string;
  portfolio: number;
  benchmark: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpe: number;
  winRate: number;
  tradeCount: number;
}

export interface Trade {
  id: string;
  symbol: string;
  side: "买入" | "卖出";
  date: string;
  price: number;
  quantity: number;
  pnl: number;
}

export interface BacktestResult {
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  trades: Trade[];
}

export interface MarketIndex {
  symbol: string;
  name: string;
  value: number;
  change: number;
  turnover: string;
}

export interface IntradayPoint {
  time: string;
  price: number;
  average: number;
  volume: number;
}

export interface SectorFlow {
  name: string;
  flow: number;
  change: number;
}

export interface NewsItem {
  id: string;
  source: string;
  time: string;
  title: string;
  symbols: string[];
  sentiment: Sentiment;
}

export interface Position {
  symbol: string;
  name: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  weight: number;
}

export interface PaperOrder {
  id: string;
  time: string;
  symbol: string;
  side: "买入" | "卖出";
  quantity: number;
  price: number;
  status: "已成交" | "待成交";
}

export interface PipelineStage {
  name: string;
  description: string;
  status: "done" | "running" | "pending" | "review";
  detail: string;
}
