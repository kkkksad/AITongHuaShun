/**
 * 东方财富券商适配器。
 *
 * 实现 BrokerAdapter 契约的纸面交易演示。
 *
 * 当前版本只维护本地模拟账户，不发送任何外部订单请求。
 *
 * 安全约束：
 * - tradingEnabled 或 environment=live 会在构造阶段失败
 * - 不读取真实账户凭据，不包含真实下单端点
 * - 仅供研究界面和适配器契约验证使用
 */

import { EventEmitter } from "node:events";
import type {
  AccountSnapshot,
  MarketQuote,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
} from "../../../shared/trading";
import type {
  BrokerAdapter,
  BrokerAdapterConfig,
} from "../../contracts/BrokerAdapter";

/** 东方财富券商特定配置 */
export interface EastMoneyBrokerConfig extends BrokerAdapterConfig {
  /** 本地纸面账户展示 ID */
  accountId?: string;
  /** 已废弃；传入 true 会直接拒绝构造。 */
  tradingEnabled?: boolean;
  /** 初始资金（模拟模式） */
  initialCapital?: number;
}

export class EastMoneyBrokerAdapter
  extends EventEmitter
  implements BrokerAdapter
{
  private readonly config: {
    brokerId: string;
    brokerName: string;
    endpoint: string;
    environment: "paper" | "sandbox";
    credentialsRef: string;
    accountId: string;
    heartbeatMs: number;
    timeoutMs: number;
    initialCapital: number;
  };
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

    if (config.tradingEnabled || config.environment === "live") {
      throw new Error("东方财富真实交易未实现，当前适配器禁止实盘");
    }

    this.config = {
      brokerId: config.brokerId ?? "eastmoney",
      brokerName: config.brokerName ?? "东方财富",
      endpoint: config.endpoint ?? "https://trading.eastmoney.com/api",
      environment: config.environment ?? "paper",
      credentialsRef: config.credentialsRef ?? "",
      accountId: config.accountId ?? "EM-PAPER",
      heartbeatMs: config.heartbeatMs ?? 30000,
      timeoutMs: config.timeoutMs ?? 10000,
      initialCapital: config.initialCapital ?? 1_000_000,
    };

    this.mockCash = this.config.initialCapital;
  }

  // ── 连接管理 ──

  async connect(): Promise<void> {
    if (this.connected) return;

    // 模拟网络延迟
    await this.delay(200);

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
      message: `connected to ${this.config.brokerName} [PAPER]`,
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
      mode: "paper",
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

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        `Broker ${this.config.brokerId} not connected. Call connect() first.`,
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
