/**
 * MockBrokerAdapter —— BrokerAdapter 契约的参考实现。
 *
 * 模拟券商网关行为，用于：
 * - BrokerAdapter 契约测试
 * - 前端开发调试（无需真实券商连接）
 * - 券商实现者的参考代码
 *
 * 与 PaperBroker 的区别：
 * - PaperBroker 在内存在本地撮合，不涉及网络
 * - MockBrokerAdapter 模拟网络行为（异步、延迟、认证），但仍在内存撮合
 * - 真实券商实现应继承此模式，将 submitOrder/cancelOrder 替换为真实 API 调用
 */
import { EventEmitter } from "node:events";
import type {
  AccountSnapshot,
  MarketQuote,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
  RiskLimits,
} from "../../shared/trading";
import type { BrokerAdapter, BrokerAdapterConfig } from "./BrokerAdapter";
import type { TradingStore } from "./TradingStore";

export class MockBrokerAdapter extends EventEmitter implements BrokerAdapter {
  private connected = false;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    private readonly config: BrokerAdapterConfig,
    private readonly store: TradingStore,
    private readonly getQuoteFn: (symbol: string) => MarketQuote | undefined,
    private readonly limits: RiskLimits,
    private readonly mode: "paper" | "live" = "paper",
  ) {
    super();
  }

  // ── 连接管理 ──

  async connect(): Promise<void> {
    if (this.connected) return;

    // 模拟认证延迟
    await this.delay(50);
    this.connected = true;

    // 启动心跳
    const heartbeatMs = this.config.heartbeatMs ?? 30_000;
    this.heartbeatInterval = setInterval(() => {
      this.emit("connection.status", {
        connected: this.connected,
        message: `heartbeat ok (${this.config.brokerId})`,
      });
    }, heartbeatMs);
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }

    this.emit("connection.status", {
      connected: true,
      message: `connected to ${this.config.brokerName}`,
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
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

    // 幂等检测
    const duplicate = this.store.findByClientOrderId(request.clientOrderId);
    if (duplicate) return duplicate;

    // 模拟网络延迟
    await this.delay(30);

    const quote = this.getQuoteFn(request.symbol);
    if (!quote) {
      const order = this.store.createOrder(request, 0);
      const rejected = this.store.rejectOrder(order, "未知标的", "UNKNOWN_SYMBOL");
      this.emit("order.updated", rejected);
      return rejected;
    }

    // 创建订单
    const order = this.store.createOrder(request, quote.price);

    // 市价单 / 可成交限价单：立即成交
    if (request.type === "limit") {
      if (this.store.checkLimitOrderFill(order, quote)) {
        const filled = this.fillOrder(order, quote);
        this.emit("order.updated", filled);
        this.emitAccountUpdate();
        return filled;
      }
      // 挂单
      this.emit("order.updated", { ...order });
      this.emitAccountUpdate();
      return { ...order };
    }

    // 市价单立即成交
    const filled = this.fillOrder(order, quote);
    this.emit("order.updated", filled);
    this.emitAccountUpdate();
    return filled;
  }

  async cancelOrder(orderId: string): Promise<OrderRecord> {
    this.ensureConnected();
    await this.delay(20);

    const order = this.store.findOrderById(orderId);
    if (!order) {
      throw new Error(`订单不存在: ${orderId}`);
    }

    const cancelled = this.store.cancelOrder(order);
    this.emit("order.updated", cancelled);
    this.emitAccountUpdate();
    return cancelled;
  }

  async getOrders(limit?: number): Promise<OrderRecord[]> {
    this.ensureConnected();
    await this.delay(10);
    return this.store.listOrders(limit);
  }

  // ── 持仓与账户 ──

  async getPositions(snapshot?: MarketSnapshot): Promise<PositionSnapshot[]> {
    this.ensureConnected();
    await this.delay(10);
    return this.store.getPositions(
      snapshot ?? { mode: this.mode, sequence: 0, marketTime: new Date().toISOString(), quotes: [] },
    );
  }

  async getAccount(snapshot?: MarketSnapshot): Promise<AccountSnapshot> {
    this.ensureConnected();
    await this.delay(10);
    return this.store.getAccount(
      this.mode,
      snapshot ?? { mode: this.mode, sequence: 0, marketTime: new Date().toISOString(), quotes: [] },
      this.limits,
    );
  }

  // ── 逐笔成交（mark-to-market） ──

  /**
   * 检查挂单是否成交（由行情更新驱动）。
   * 真实券商实现中，此逻辑由券商回调驱动。
   */
  async checkPendingOrders(snapshot: MarketSnapshot): Promise<void> {
    if (!this.connected) return;

    const pendingOrders = this.store.getPendingOrders();
    if (pendingOrders.length === 0) return;

    const quoteMap = new Map(snapshot.quotes.map((q) => [q.symbol, q]));
    let accountChanged = false;

    for (const order of pendingOrders) {
      const quote = quoteMap.get(order.symbol);
      if (!quote) continue;

      if (this.store.checkLimitOrderFill(order, quote)) {
        const filled = this.fillOrder(order, quote);
        this.emit("order.updated", filled);
        accountChanged = true;
      }
    }

    if (accountChanged) {
      this.emitAccountUpdate();
    }
  }

  // ── 私有方法 ──

  private fillOrder(order: OrderRecord, quote: MarketQuote): OrderRecord {
    const commissionRate = 0.0003;
    const minimumCommission = 5;
    const slippageBps = 5;

    const slippage = slippageBps / 10_000;
    let fillPrice =
      order.side === "buy"
        ? quote.price * (1 + slippage)
        : quote.price * (1 - slippage);

    if (order.type === "limit" && order.limitPrice !== undefined) {
      fillPrice =
        order.side === "buy"
          ? Math.min(fillPrice, order.limitPrice)
          : Math.max(fillPrice, order.limitPrice);
    }

    const roundedFillPrice = Number(fillPrice.toFixed(2));
    const notional = roundedFillPrice * order.quantity;
    const commission = Math.max(
      minimumCommission,
      notional * commissionRate,
    );

    return this.store.fillOrder(
      order,
      quote.name,
      roundedFillPrice,
      Number(commission.toFixed(2)),
    );
  }

  private emitAccountUpdate(): void {
    const account = this.store.getAccount(
      this.mode,
      { mode: this.mode, sequence: 0, marketTime: new Date().toISOString(), quotes: [] },
      this.limits,
    );
    this.emit("account.updated", account);
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(`Broker ${this.config.brokerId} not connected. Call connect() first.`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
