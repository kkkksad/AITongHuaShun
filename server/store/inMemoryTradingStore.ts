import type {
  AccountSnapshot,
  AuditEvent,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
  RiskLimits,
  TradingMode,
} from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";

interface MutablePosition {
  symbol: string;
  name: string;
  quantity: number;
  t1LockedQuantity?: number;
  t1LockedDate?: string;
  averagePrice: number;
  realizedPnl: number;
}

const seededPositions: MutablePosition[] = [
  {
    symbol: "600519",
    name: "贵州茅台",
    quantity: 100,
    averagePrice: 1468.2,
    realizedPnl: 0,
  },
  {
    symbol: "300750",
    name: "宁德时代",
    quantity: 400,
    averagePrice: 247.8,
    realizedPnl: 0,
  },
  {
    symbol: "688981",
    name: "中芯国际",
    quantity: 1200,
    averagePrice: 88.5,
    realizedPnl: 0,
  },
];

function getChinaTradeDate(value = new Date()): string {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getT1LockedQuantity(position: MutablePosition, tradeDate = getChinaTradeDate()): number {
  if (position.t1LockedDate !== tradeDate) {
    return 0;
  }
  return Math.min(position.quantity, Math.max(0, position.t1LockedQuantity ?? 0));
}

function withT1Lock(
  position: Omit<MutablePosition, "t1LockedDate" | "t1LockedQuantity">,
  lockedQuantity: number,
  tradeDate = getChinaTradeDate(),
): MutablePosition {
  if (lockedQuantity <= 0) {
    return position;
  }
  return {
    ...position,
    t1LockedDate: tradeDate,
    t1LockedQuantity: Math.min(position.quantity, lockedQuantity),
  };
}

export class InMemoryTradingStore implements TradingStore {
  private readonly accountId = "PAPER-CN-01";
  private readonly startingEquity: number;
  private cash: number;
  private blockedCash = 0;
  private paused = false;
  private readonly positions = new Map<string, MutablePosition>();
  private readonly orders: OrderRecord[] = [];
  private readonly auditEvents: AuditEvent[] = [];
  private orderSequence = 0;
  private auditSequence = 0;

  /**
   * @param startingCash 初始总资金
   * @param seed 是否使用预设种子持仓（默认 true，向后兼容；false 用于回测从纯现金开始）
   */
  constructor(
    startingCash: number,
    seed = true,
    private readonly now: () => Date = () => new Date(),
  ) {
    let seededCost = 0;

    if (seed) {
      seededCost = seededPositions.reduce(
        (total, position) => total + position.quantity * position.averagePrice,
        0,
      );

      if (seededCost >= startingCash) {
        throw new Error("TRADING_STARTING_CASH must exceed the seeded portfolio cost.");
      }

      for (const position of seededPositions) {
        this.positions.set(position.symbol, { ...position });
      }
    }

    this.startingEquity = startingCash;
    this.cash = startingCash - seededCost;

    this.appendAudit("system", "account.created", seed ? "模拟账户已创建" : "回测账户已创建（纯现金）", {
      startingCash,
      seededCost,
    });
  }

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.appendAudit(
      "system",
      paused ? "trading.paused" : "trading.resumed",
      paused ? "模拟交易已暂停" : "模拟交易已恢复",
    );
  }

  getCash(): number {
    return this.cash;
  }

  getAvailableCash(): number {
    return this.cash - this.blockedCash;
  }

  getPositionQuantity(symbol: string): number {
    return this.positions.get(symbol)?.quantity ?? 0;
  }

  getPendingOrders(): OrderRecord[] {
    return this.orders.filter((o) => o.status === "pending");
  }

  getPositions(snapshot: MarketSnapshot): PositionSnapshot[] {
    const quoteMap = new Map(snapshot.quotes.map((quote) => [quote.symbol, quote]));
    const tradeDate = getChinaTradeDate(this.now());
    const raw = [...this.positions.values()].map((position) => {
      const quote = quoteMap.get(position.symbol);
      const currentPrice = quote?.price ?? position.averagePrice;
      const marketValue = currentPrice * position.quantity;

      return {
        symbol: position.symbol,
        name: position.name,
        quantity: position.quantity,
        availableQuantity: position.quantity - getT1LockedQuantity(position, tradeDate),
        t1LockedQuantity: getT1LockedQuantity(position, tradeDate),
        averagePrice: position.averagePrice,
        currentPrice,
        marketValue,
        unrealizedPnl: (currentPrice - position.averagePrice) * position.quantity,
        realizedPnl: position.realizedPnl,
        weight: 0,
      };
    });

    const marketValue = raw.reduce((total, position) => total + position.marketValue, 0);
    const equity = this.cash + marketValue;

    return raw.map((position) => ({
      ...position,
      weight: equity === 0 ? 0 : position.marketValue / equity,
    }));
  }

  getAccount(
    mode: TradingMode,
    snapshot: MarketSnapshot,
    limits: RiskLimits,
  ): AccountSnapshot {
    const positions = this.getPositions(snapshot);
    const marketValue = positions.reduce((total, position) => total + position.marketValue, 0);
    const unrealizedPnl = positions.reduce(
      (total, position) => total + position.unrealizedPnl,
      0,
    );
    const realizedPnl = positions.reduce(
      (total, position) => total + position.realizedPnl,
      0,
    );
    const availableCash = this.cash - this.blockedCash;
    const equity = this.cash + marketValue;
    const dailyPnl = equity - this.startingEquity;
    const baseline = Math.max(1, equity - dailyPnl);
    const exposureRatio = equity === 0 ? 0 : marketValue / equity;
    const lossRatio = dailyPnl >= 0 ? 0 : Math.abs(dailyPnl / baseline) / limits.maxDailyLoss;

    return {
      accountId: this.accountId,
      mode,
      cash: availableCash,
      equity,
      marketValue,
      unrealizedPnl,
      realizedPnl,
      dailyPnl,
      dailyPnlPercent: dailyPnl / baseline,
      riskUtilization: Math.min(1, Math.max(exposureRatio, lossRatio)),
      paused: this.paused,
      updatedAt: this.now().toISOString(),
    };
  }

  findByClientOrderId(clientOrderId?: string): OrderRecord | undefined {
    if (!clientOrderId) {
      return undefined;
    }

    return this.orders.find((order) => order.clientOrderId === clientOrderId);
  }

  findOrderById(id: string): OrderRecord | undefined {
    return this.orders.find((order) => order.id === id);
  }

  createOrder(request: OrderRequest, requestedPrice: number): OrderRecord {
    this.orderSequence += 1;
    const now = this.now().toISOString();
    const isLimitOrder = request.type === "limit";

    const order: OrderRecord = {
      ...request,
      id: `PO-${this.now().getTime()}-${String(this.orderSequence).padStart(4, "0")}`,
      status: isLimitOrder ? "pending" : "accepted",
      requestedPrice,
      filledQuantity: 0,
      notional: 0,
      commission: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.orders.unshift(order);

    if (isLimitOrder && request.limitPrice !== undefined) {
      const notional = request.limitPrice * request.quantity;
      this.blockedCash += notional;
    }

    this.appendAudit("order", "order.accepted", isLimitOrder ? "限价单已挂单" : "模拟订单已接收", {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      limitPrice: order.limitPrice,
    });
    return order;
  }

  rejectOrder(order: OrderRecord, reason: string, code: string): OrderRecord {
    order.status = "rejected";
    order.rejectionReason = reason;
    order.updatedAt = this.now().toISOString();

    if (order.type === "limit" && order.limitPrice !== undefined) {
      this.blockedCash -= order.limitPrice * order.quantity;
    }

    this.appendAudit("risk", code, reason, { orderId: order.id });
    return { ...order };
  }

  cancelOrder(order: OrderRecord): OrderRecord {
    if (order.status !== "pending") {
      throw new Error(`只能撤销挂单状态的订单，当前状态: ${order.status}`);
    }

    order.status = "cancelled";
    order.updatedAt = this.now().toISOString();

    if (order.limitPrice !== undefined) {
      this.blockedCash -= order.limitPrice * order.quantity;
    }

    this.appendAudit("order", "order.cancelled", "限价单已撤销", { orderId: order.id });
    return { ...order };
  }

  checkLimitOrderFill(
    order: OrderRecord,
    quote: { symbol: string; name: string; price: number },
  ): boolean {
    if (order.status !== "pending" || order.type !== "limit") {
      return false;
    }

    const limitPrice = order.limitPrice!;

    const shouldFill =
      order.side === "buy"
        ? quote.price <= limitPrice
        : quote.price >= limitPrice;

    return shouldFill;
  }

  fillOrder(
    order: OrderRecord,
    name: string,
    fillPrice: number,
    commission: number,
  ): OrderRecord {
    const wasPending = order.status === "pending";
    const notional = fillPrice * order.quantity;
    const current = this.positions.get(order.symbol);

    if (wasPending && order.limitPrice !== undefined) {
      this.blockedCash -= order.limitPrice * order.quantity;
    }

    if (order.side === "buy") {
      const previousQuantity = current?.quantity ?? 0;
      const previousCost = previousQuantity * (current?.averagePrice ?? 0);
      const tradeDate = getChinaTradeDate(this.now());
      const currentLocked = current ? getT1LockedQuantity(current, tradeDate) : 0;
      const nextQuantity = previousQuantity + order.quantity;

      this.positions.set(order.symbol, withT1Lock({
        symbol: order.symbol,
        name,
        quantity: nextQuantity,
        averagePrice: (previousCost + notional) / nextQuantity,
        realizedPnl: current?.realizedPnl ?? 0,
      }, currentLocked + order.quantity, tradeDate));
      this.cash -= notional + commission;
    } else if (current) {
      const tradeDate = getChinaTradeDate(this.now());
      const currentLocked = getT1LockedQuantity(current, tradeDate);
      const realizedPnl = (fillPrice - current.averagePrice) * order.quantity - commission;
      const nextQuantity = current.quantity - order.quantity;
      const nextLocked = Math.min(currentLocked, Math.max(0, nextQuantity));
      this.cash += notional - commission;

      if (nextQuantity === 0) {
        this.positions.delete(order.symbol);
      } else {
        this.positions.set(order.symbol, withT1Lock({
          symbol: current.symbol,
          name: current.name,
          quantity: nextQuantity,
          averagePrice: current.averagePrice,
          realizedPnl: current.realizedPnl + realizedPnl,
        }, nextLocked, tradeDate));
      }
    }

    order.status = "filled";
    order.filledPrice = fillPrice;
    order.filledQuantity = order.quantity;
    order.notional = notional;
    order.commission = commission;
    order.updatedAt = this.now().toISOString();
    this.appendAudit("order", "order.filled", wasPending ? "限价单已成交" : "模拟订单已成交", {
      orderId: order.id,
      fillPrice,
      commission,
      notional,
    });
    return { ...order };
  }

  listOrders(limit = 100): OrderRecord[] {
    return this.orders.slice(0, limit).map((order) => ({ ...order }));
  }

  listAudit(limit = 200): AuditEvent[] {
    return this.auditEvents.slice(0, limit).map((event) => ({ ...event }));
  }

  appendAudit(
    category: AuditEvent["category"],
    action: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.auditSequence += 1;
    this.auditEvents.unshift({
      id: `AE-${this.now().getTime()}-${String(this.auditSequence).padStart(4, "0")}`,
      category,
      action,
      message,
      timestamp: this.now().toISOString(),
      data,
    });
  }
}
