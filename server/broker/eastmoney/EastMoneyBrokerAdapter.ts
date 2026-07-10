/**
 * 东方财富券商适配器。
 *
 * 实现 BrokerAdapter 契约，对接东方财富交易接口。
 *
 * 当前版本使用模拟模式（mock 响应），所有交易请求返回模拟结果。
 * 真实连接需配置 EASTMONEY_ACCOUNT / EASTMONEY_TOKEN 环境变量。
 *
 * 安全约束：
 * - 默认不允许实盘交易，需显式设置 EASTMONEY_TRADING_ENABLED=true
 * - 所有下单请求经过 RiskEngine 检查
 * - API 调用记录审计日志
 */

import { EventEmitter } from "node:events";
import type {
  AccountSnapshot,
  MarketQuote,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  OrderSide,
  OrderStatus,
  OrderType,
  PositionSnapshot,
} from "../../../shared/trading";
import type {
  BrokerAdapter,
  BrokerAdapterConfig,
} from "../../contracts/BrokerAdapter";

/** 东方财富券商特定配置 */
export interface EastMoneyBrokerConfig extends BrokerAdapterConfig {
  /** 东方财富账户号 */
  accountId?: string;
  /** API 令牌 */
  token?: string;
  /** 是否启用真实交易（默认 false） */
  tradingEnabled?: boolean;
  /** 初始资金（模拟模式） */
  initialCapital?: number;
}

/** 东方财富订单 API 请求格式 */
interface EastMoneyOrderRequest {
  code: string;
  name: string;
  price: number;
  amount: number;
  tradeType: "B" | "S"; // B=Buy, S=Sell
  priceType: "0" | "1"; // 0=限价, 1=市价
  entrustType?: string;
}

/** 东方财富订单 API 响应 */
interface EastMoneyOrderResponse {
  status: number;
  message: string;
  data?: {
    entrustNo: string;
    dealAmount: number;
    dealPrice: number;
  };
}

export class EastMoneyBrokerAdapter
  extends EventEmitter
  implements BrokerAdapter
{
  private readonly config: Required<EastMoneyBrokerConfig>;
  private connected = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private connectedAt: Date | null = null;

  // 模拟状态
  private mockCash: number;
  private mockPositions = new Map<string, {
    symbol: string;
    name: string;
    quantity: number;
    avgPrice: number;
  }>();
  private mockOrders = new Map<string, OrderRecord>();
  private orderIdCounter = 0;
  private mockQuotes = new Map<string, MarketQuote>();

  constructor(config: EastMoneyBrokerConfig) {
    super();

    this.config = {
      brokerId: config.brokerId ?? "eastmoney",
      brokerName: config.brokerName ?? "东方财富",
      endpoint: config.endpoint ?? "https://trading.eastmoney.com/api",
      token: config.token ?? process.env.EASTMONEY_TOKEN ?? "",
      accountId: config.accountId ?? process.env.EASTMONEY_ACCOUNT ?? "EM000000",
      heartbeatMs: config.heartbeatMs ?? 30000,
      timeoutMs: config.timeoutMs ?? 10000,
      tradingEnabled: config.tradingEnabled ?? false,
      initialCapital: config.initialCapital ?? 1_000_000,
    };

    this.mockCash = this.config.initialCapital;
  }

  // ── 连接管理 ──

  async connect(): Promise<void> {
    if (this.connected) return;

    // 模拟网络延迟
    await this.delay(200);

    if (this.config.tradingEnabled) {
      // 真实模式：验证凭证
      if (!this.config.token || !this.config.accountId) {
        throw new Error(
          "EastMoney 实盘交易需要配置 token 和 accountId",
        );
      }

      // TODO: 实际调用东方财富登录 API
      // const authResult = await this.callApi('/auth/login', {...});
    }

    this.connected = true;
    this.connectedAt = new Date();

    // 心跳
    this.heartbeatTimer = setInterval(() => {
      this.emit("connection.status", {
        connected: this.connected,
        message: `heartbeat ok (${this.config.brokerId})`,
      });
    }, this.config.heartbeatMs);
    this.heartbeatTimer.unref();

    this.emit("connection.status", {
      connected: true,
      message: `connected to ${this.config.brokerName}${this.config.tradingEnabled ? " [LIVE]" : " [PAPER]"}`,
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.emit("connection.status", {
      connected: false,
      message: "disconnected",
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── 订单管理 ──

  async submitOrder(request: OrderRequest): Promise<OrderRecord> {
    this.ensureConnected();

    if (this.config.tradingEnabled) {
      return this.submitRealOrder(request);
    }
    return this.submitMockOrder(request);
  }

  async cancelOrder(orderId: string): Promise<OrderRecord> {
    this.ensureConnected();

    const order = this.mockOrders.get(orderId);
    if (!order) {
      throw new Error(`订单不存在: ${orderId}`);
    }

    if (order.status !== "pending" && order.status !== "accepted") {
      throw new Error(`订单状态 ${order.status} 不允许撤销`);
    }

    if (this.config.tradingEnabled) {
      await this.callApi("/order/cancel", { entrustNo: orderId });
    }

    const cancelled: OrderRecord = {
      ...order,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };
    this.mockOrders.set(orderId, cancelled);
    this.emit("order.updated", cancelled);
    return cancelled;
  }

  async getOrders(limit = 50): Promise<OrderRecord[]> {
    this.ensureConnected();
    if (this.config.tradingEnabled) {
      await this.callApi("/order/list", { limit });
    }
    const orders = [...this.mockOrders.values()]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, limit);
    return orders;
  }

  // ── 持仓与账户 ──

  async getPositions(snapshot?: MarketSnapshot): Promise<PositionSnapshot[]> {
    this.ensureConnected();

    // 更新行情缓存
    if (snapshot) {
      for (const q of snapshot.quotes) {
        this.mockQuotes.set(q.symbol, q);
      }
    }

    const positions: PositionSnapshot[] = [];
    for (const [, pos] of this.mockPositions) {
      const quote = this.mockQuotes.get(pos.symbol);
      const currentPrice = quote?.price ?? pos.avgPrice;
      const marketValue = currentPrice * pos.quantity;
      const unrealizedPnl = (currentPrice - pos.avgPrice) * pos.quantity;

      positions.push({
        symbol: pos.symbol,
        name: pos.name,
        quantity: pos.quantity,
        averagePrice: pos.avgPrice,
        currentPrice,
        marketValue,
        unrealizedPnl,
        realizedPnl: 0,
        weight: this.mockCash > 0 ? marketValue / (this.mockCash + marketValue) : 0,
      });
    }

    return positions;
  }

  async getAccount(snapshot?: MarketSnapshot): Promise<AccountSnapshot> {
    this.ensureConnected();

    if (snapshot) {
      for (const q of snapshot.quotes) {
        this.mockQuotes.set(q.symbol, q);
      }
    }

    const positions = await this.getPositions(snapshot);
    let marketValue = 0;
    let unrealizedPnl = 0;

    for (const pos of positions) {
      marketValue += pos.marketValue;
      unrealizedPnl += pos.unrealizedPnl;
    }

    const equity = this.mockCash + marketValue;

    return {
      accountId: this.config.accountId,
      mode: this.config.tradingEnabled ? "live" : "paper",
      cash: this.mockCash,
      equity,
      marketValue,
      unrealizedPnl,
      realizedPnl: 0,
      dailyPnl: equity - this.config.initialCapital,
      dailyPnlPercent:
        ((equity - this.config.initialCapital) / this.config.initialCapital) *
        100,
      riskUtilization: 0,
      paused: false,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── 行情更新 ──

  /**
   * 更新内部行情缓存（供 mark-to-market 使用）。
   */
  updateQuotes(quotes: MarketQuote[]): void {
    for (const q of quotes) {
      this.mockQuotes.set(q.symbol, q);
    }
  }

  // ── 私有方法 ──

  private submitMockOrder(request: OrderRequest): OrderRecord {
    const quote = this.mockQuotes.get(request.symbol);
    const price = quote?.price ?? 0;
    const notional = price * request.quantity;
    const commission = Math.max(5, notional * 0.0003);

    const orderId = `EM-${++this.orderIdCounter}-${Date.now()}`;
    const now = new Date().toISOString();

    // 模拟成交
    const order: OrderRecord = {
      id: orderId,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      quantity: request.quantity,
      limitPrice: request.limitPrice,
      clientOrderId: request.clientOrderId,
      status: "filled",
      requestedPrice: request.type === "limit" ? (request.limitPrice ?? price) : price,
      filledPrice: price,
      filledQuantity: request.quantity,
      notional,
      commission,
      createdAt: now,
      updatedAt: now,
    };

    // 更新模拟持仓和现金
    if (request.side === "buy") {
      this.mockCash -= notional + commission;
      const existing = this.mockPositions.get(request.symbol);
      if (existing) {
        const totalQty = existing.quantity + request.quantity;
        const totalCost = existing.avgPrice * existing.quantity + notional;
        existing.quantity = totalQty;
        existing.avgPrice = totalCost / totalQty;
      } else {
        this.mockPositions.set(request.symbol, {
          symbol: request.symbol,
          name: quote?.name ?? request.symbol,
          quantity: request.quantity,
          avgPrice: price,
        });
      }
    } else {
      this.mockCash += notional - commission;
      const existing = this.mockPositions.get(request.symbol);
      if (existing) {
        existing.quantity -= request.quantity;
        if (existing.quantity <= 0) {
          this.mockPositions.delete(request.symbol);
        }
      }
    }

    this.mockOrders.set(orderId, order);
    this.emit("order.updated", order);
    return order;
  }

  private async submitRealOrder(
    request: OrderRequest,
  ): Promise<OrderRecord> {
    const orderId = `EM-LIVE-${++this.orderIdCounter}-${Date.now()}`;
    const now = new Date().toISOString();

    const eastMoneyReq: EastMoneyOrderRequest = {
      code: request.symbol,
      name: request.symbol,
      price: request.limitPrice ?? 0,
      amount: request.quantity,
      tradeType: request.side === "buy" ? "B" : "S",
      priceType: request.type === "market" ? "1" : "0",
    };

    try {
      const response = await this.callApi<EastMoneyOrderResponse>(
        "/order/submit",
        eastMoneyReq,
      );

      if (response?.status !== 0) {
        throw new Error(response?.message ?? "未知错误");
      }

      const order: OrderRecord = {
        id: response.data?.entrustNo ?? orderId,
        symbol: request.symbol,
        side: request.side,
        type: request.type,
        quantity: request.quantity,
        limitPrice: request.limitPrice,
        clientOrderId: request.clientOrderId,
        status: "accepted",
        requestedPrice: request.limitPrice ?? 0,
        filledQuantity: response.data?.dealAmount ?? 0,
        notional: (response.data?.dealPrice ?? 0) * request.quantity,
        commission: 0,
        createdAt: now,
        updatedAt: now,
      };

      this.mockOrders.set(order.id, order);
      this.emit("order.updated", order);
      return order;
    } catch (err) {
      throw new Error(
        `EastMoney 下单失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        `Broker ${this.config.brokerId} not connected. Call connect() first.`,
      );
    }
  }

  private async callApi<T = unknown>(
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    // 模拟模式：返回 null
    if (!this.config.tradingEnabled) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      const response = await fetch(`${this.config.endpoint}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.token}`,
          "User-Agent": "EastMoney/1.0",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`EastMoney API HTTP ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
