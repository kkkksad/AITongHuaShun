export type TradingMode = "mock" | "paper" | "live";
export type OrderSide = "buy" | "sell";
export type OrderType = "market";
export type OrderStatus = "accepted" | "filled" | "rejected" | "cancelled";

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
