import * as fs from "node:fs";
import * as path from "node:path";
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

interface PersistedState {
  version: 1;
  accountId: string;
  startingEquity: number;
  cash: number;
  blockedCash: number;
  paused: boolean;
  positions: MutablePosition[];
  orders: OrderRecord[];
  auditEvents: AuditEvent[];
  orderSequence: number;
  auditSequence: number;
}

interface JsonFileTradingStoreOptions {
  retentionDays?: number;
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const SEEDED_POSITIONS: MutablePosition[] = [
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

function computeSeededCost(): number {
  return SEEDED_POSITIONS.reduce(
    (total, position) => total + position.quantity * position.averagePrice,
    0,
  );
}

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

/**
 * JSON 文件持久化交易仓储。
 *
 * 当前实现面向本地单进程模拟交易，不提供多进程锁、事务或合规级审计。
 */
export class JsonFileTradingStore implements TradingStore {
  private readonly filePath: string;
  private readonly accountId = "PAPER-CN-01";
  private readonly retentionMs: number;
  private readonly now: () => Date;
  private startingEquity: number;
  private cash = 0;
  private blockedCash = 0;
  private paused = false;
  private readonly positions = new Map<string, MutablePosition>();
  private orders: OrderRecord[] = [];
  private auditEvents: AuditEvent[] = [];
  private orderSequence = 0;
  private auditSequence = 0;

  constructor(
    dataDir: string,
    startingCash: number,
    seed = true,
    options: JsonFileTradingStoreOptions = {},
  ) {
    const retentionDays = options.retentionDays ?? 7;
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error("JSON trading history retention must be a positive integer.");
    }
    this.retentionMs = retentionDays * DAY_MS;
    this.now = options.now ?? (() => new Date());
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, "paper-trading-state.json");
    this.startingEquity = startingCash;

    if (fs.existsSync(this.filePath)) {
      this.load();
    } else {
      this.initializeFresh(startingCash, seed);
    }
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
    this.flush();
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
    return this.orders
      .filter((order) => order.status === "pending")
      .map((order) => ({ ...order }));
  }

  getPositions(snapshot: MarketSnapshot): PositionSnapshot[] {
    const quoteMap = new Map(snapshot.quotes.map((quote) => [quote.symbol, quote]));
    const raw = [...this.positions.values()].map((position) => {
      const quote = quoteMap.get(position.symbol);
      const currentPrice = quote?.price ?? position.averagePrice;
      const marketValue = currentPrice * position.quantity;

      return {
        symbol: position.symbol,
        name: position.name,
        quantity: position.quantity,
        availableQuantity: position.quantity - getT1LockedQuantity(position),
        t1LockedQuantity: getT1LockedQuantity(position),
        averagePrice: position.averagePrice,
        currentPrice,
        marketValue,
        unrealizedPnl: (currentPrice - position.averagePrice) * position.quantity,
        realizedPnl: position.realizedPnl,
        weight: 0,
      };
    });
    const marketValue = raw.reduce(
      (total, position) => total + position.marketValue,
      0,
    );
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
    const marketValue = positions.reduce(
      (total, position) => total + position.marketValue,
      0,
    );
    const unrealizedPnl = positions.reduce(
      (total, position) => total + position.unrealizedPnl,
      0,
    );
    const realizedPnl = positions.reduce(
      (total, position) => total + position.realizedPnl,
      0,
    );
    const equity = this.cash + marketValue;
    const dailyPnl = equity - this.startingEquity;
    const baseline = Math.max(1, equity - dailyPnl);
    const exposureRatio = equity === 0 ? 0 : marketValue / equity;
    const lossRatio =
      dailyPnl >= 0
        ? 0
        : Math.abs(dailyPnl / baseline) / limits.maxDailyLoss;

    return {
      accountId: this.accountId,
      mode,
      cash: this.getAvailableCash(),
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
    const order = this.orders.find(
      (candidate) => candidate.clientOrderId === clientOrderId,
    );
    return order ? { ...order } : undefined;
  }

  findOrderById(id: string): OrderRecord | undefined {
    return this.orders.find((order) => order.id === id);
  }

  createOrder(request: OrderRequest, requestedPrice: number): OrderRecord {
    this.orderSequence += 1;
    const timestamp = this.now();
    const now = timestamp.toISOString();
    const isLimitOrder = request.type === "limit";
    const order: OrderRecord = {
      ...request,
      id: `PO-${timestamp.getTime()}-${String(this.orderSequence).padStart(4, "0")}`,
      status: isLimitOrder ? "pending" : "accepted",
      requestedPrice,
      filledQuantity: 0,
      notional: 0,
      commission: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.orders.unshift(order);
    if (
      isLimitOrder &&
      request.side === "buy" &&
      request.limitPrice !== undefined
    ) {
      this.blockedCash += request.limitPrice * request.quantity;
    }

    this.appendAudit(
      "order",
      "order.accepted",
      isLimitOrder ? "限价单已挂单" : "模拟订单已接收",
      {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        limitPrice: order.limitPrice,
      },
    );
    this.flush();
    return { ...order };
  }

  rejectOrder(order: OrderRecord, reason: string, code: string): OrderRecord {
    const stored = this.requireStoredOrder(order.id);
    stored.status = "rejected";
    stored.rejectionReason = reason;
    stored.updatedAt = this.now().toISOString();
    this.releaseBuyLimitCash(stored);
    this.appendAudit("risk", code, reason, { orderId: stored.id });
    this.flush();
    return { ...stored };
  }

  cancelOrder(order: OrderRecord): OrderRecord {
    const stored = this.requireStoredOrder(order.id);
    if (stored.status !== "pending") {
      throw new Error(`只能撤销挂单状态的订单，当前状态：${stored.status}`);
    }

    stored.status = "cancelled";
    stored.updatedAt = this.now().toISOString();
    this.releaseBuyLimitCash(stored);
    this.appendAudit("order", "order.cancelled", "限价单已撤销", {
      orderId: stored.id,
    });
    this.flush();
    return { ...stored };
  }

  checkLimitOrderFill(
    order: OrderRecord,
    quote: { symbol: string; name: string; price: number },
  ): boolean {
    if (
      order.status !== "pending" ||
      order.type !== "limit" ||
      order.limitPrice === undefined
    ) {
      return false;
    }

    return order.side === "buy"
      ? quote.price <= order.limitPrice
      : quote.price >= order.limitPrice;
  }

  fillOrder(
    order: OrderRecord,
    name: string,
    fillPrice: number,
    commission: number,
  ): OrderRecord {
    const stored = this.requireStoredOrder(order.id);
    const wasPending = stored.status === "pending";
    const notional = fillPrice * stored.quantity;
    const current = this.positions.get(stored.symbol);

    if (wasPending) {
      this.releaseBuyLimitCash(stored);
    }

    if (stored.side === "buy") {
      const previousQuantity = current?.quantity ?? 0;
      const previousCost = previousQuantity * (current?.averagePrice ?? 0);
      const currentLocked = current ? getT1LockedQuantity(current) : 0;
      const nextQuantity = previousQuantity + stored.quantity;

      this.positions.set(stored.symbol, withT1Lock({
        symbol: stored.symbol,
        name,
        quantity: nextQuantity,
        averagePrice: (previousCost + notional) / nextQuantity,
        realizedPnl: current?.realizedPnl ?? 0,
      }, currentLocked + stored.quantity));
      this.cash -= notional + commission;
    } else if (current) {
      const currentLocked = getT1LockedQuantity(current);
      const realizedPnl =
        (fillPrice - current.averagePrice) * stored.quantity - commission;
      const nextQuantity = current.quantity - stored.quantity;
      const nextLocked = Math.min(currentLocked, Math.max(0, nextQuantity));
      this.cash += notional - commission;

      if (nextQuantity === 0) {
        this.positions.delete(stored.symbol);
      } else {
        this.positions.set(stored.symbol, withT1Lock({
          symbol: current.symbol,
          name: current.name,
          quantity: nextQuantity,
          averagePrice: current.averagePrice,
          realizedPnl: current.realizedPnl + realizedPnl,
        }, nextLocked));
      }
    }

    stored.status = "filled";
    stored.filledPrice = fillPrice;
    stored.filledQuantity = stored.quantity;
    stored.notional = notional;
    stored.commission = commission;
    stored.updatedAt = this.now().toISOString();
    this.appendAudit(
      "order",
      "order.filled",
      wasPending ? "限价单已成交" : "模拟订单已成交",
      { orderId: stored.id, fillPrice, commission, notional },
    );
    this.flush();
    return { ...stored };
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
    const timestamp = this.now();
    this.auditEvents.unshift({
      id: `AE-${timestamp.getTime()}-${String(this.auditSequence).padStart(4, "0")}`,
      category,
      action,
      message,
      timestamp: timestamp.toISOString(),
      data,
    });
    this.flush();
  }

  private initializeFresh(startingCash: number, seed: boolean): void {
    const seededCost = seed ? computeSeededCost() : 0;
    if (seed && seededCost >= startingCash) {
      throw new Error("TRADING_STARTING_CASH must exceed the seeded portfolio cost.");
    }

    this.cash = startingCash - seededCost;
    if (seed) {
      for (const position of SEEDED_POSITIONS) {
        this.positions.set(position.symbol, { ...position });
      }
    }
    this.appendAudit(
      "system",
      "account.created",
      "模拟账户已创建（JSON 持久化）",
      { startingCash, seededCost, seed },
    );
    this.flush();
  }

  private load(): void {
    const state = JSON.parse(
      fs.readFileSync(this.filePath, "utf-8"),
    ) as PersistedState;
    if (state.version !== 1) {
      throw new Error(`Unsupported persisted state version: ${state.version}`);
    }

    this.startingEquity = state.startingEquity;
    this.cash = state.cash;
    this.paused = state.paused;
    this.orderSequence = state.orderSequence;
    this.auditSequence = state.auditSequence;
    this.orders = state.orders.map((order) => ({ ...order }));
    this.auditEvents = state.auditEvents.map((event) => ({ ...event }));
    const prunedHistory = this.pruneExpiredHistory();
    this.blockedCash = this.orders
      .filter(
        (order) =>
          order.status === "pending" &&
          order.type === "limit" &&
          order.side === "buy" &&
          order.limitPrice !== undefined,
      )
      .reduce(
        (total, order) => total + (order.limitPrice ?? 0) * order.quantity,
        0,
      );

    this.positions.clear();
    for (const position of state.positions) {
      this.positions.set(position.symbol, { ...position });
    }
    if (prunedHistory) {
      this.flush();
    }
  }

  private flush(): void {
    this.pruneExpiredHistory();
    const state: PersistedState = {
      version: 1,
      accountId: this.accountId,
      startingEquity: this.startingEquity,
      cash: this.cash,
      blockedCash: this.blockedCash,
      paused: this.paused,
      positions: [...this.positions.values()],
      orders: this.orders,
      auditEvents: this.auditEvents,
      orderSequence: this.orderSequence,
      auditSequence: this.auditSequence,
    };
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(temporaryPath, this.filePath);
  }

  private pruneExpiredHistory(): boolean {
    const cutoff = this.now().getTime() - this.retentionMs;
    const orderCount = this.orders.length;
    const auditCount = this.auditEvents.length;

    this.orders = this.orders.filter((order) => {
      if (order.status === "pending" || order.status === "accepted") {
        return true;
      }
      const timestamp = Date.parse(order.updatedAt || order.createdAt);
      return !Number.isFinite(timestamp) || timestamp >= cutoff;
    });
    this.auditEvents = this.auditEvents.filter((event) => {
      const timestamp = Date.parse(event.timestamp);
      return !Number.isFinite(timestamp) || timestamp >= cutoff;
    });

    return orderCount !== this.orders.length || auditCount !== this.auditEvents.length;
  }

  private requireStoredOrder(id: string): OrderRecord {
    const order = this.orders.find((candidate) => candidate.id === id);
    if (!order) {
      throw new Error(`订单不存在：${id}`);
    }
    return order;
  }

  private releaseBuyLimitCash(order: OrderRecord): void {
    if (
      order.type === "limit" &&
      order.side === "buy" &&
      order.limitPrice !== undefined
    ) {
      this.blockedCash = Math.max(
        0,
        this.blockedCash - order.limitPrice * order.quantity,
      );
    }
  }
}
