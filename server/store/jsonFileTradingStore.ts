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

const SEEDED_POSITIONS: MutablePosition[] = [
  { symbol: "600519", name: "贵州茅台", quantity: 100, averagePrice: 1468.2, realizedPnl: 0 },
  { symbol: "300750", name: "宁德时代", quantity: 400, averagePrice: 247.8, realizedPnl: 0 },
  { symbol: "688981", name: "中芯国际", quantity: 1200, averagePrice: 88.5, realizedPnl: 0 },
];

function computeSeededCost(): number {
  return SEEDED_POSITIONS.reduce(
    (total, p) => total + p.quantity * p.averagePrice,
    0,
  );
}

/**
 * JSON 文件持久化交易数据仓库。
 *
 * - 实现 TradingStore 契约，可替换 InMemoryTradingStore
 * - 每次写操作后自动 flush 到磁盘
 * - 服务重启后从文件恢复完整状态
 * - 首次启动时使用预设种子数据
 */
export class JsonFileTradingStore implements TradingStore {
  private readonly filePath: string;
  private readonly accountId = "PAPER-CN-01";
  private startingEquity: number;
  private cash: number = 0;
  private blockedCash = 0;
  private paused = false;
  private readonly positions = new Map<string, MutablePosition>();
  private orders: OrderRecord[] = [];
  private auditEvents: AuditEvent[] = [];
  private orderSequence = 0;
  private auditSequence = 0;

  constructor(dataDir: string, startingCash: number) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.filePath = path.join(dataDir, "paper-trading-state.json");
    this.startingEquity = startingCash;

    if (fs.existsSync(this.filePath)) {
      this.load();
    } else {
      this.initializeFresh(startingCash);
    }
  }

  // ── Persistence ──

  private flush(): void {
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

    // Atomic write: write to temp file, then rename
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }

  private load(): void {
    const raw = fs.readFileSync(this.filePath, "utf-8");
    const state = JSON.parse(raw) as PersistedState;

    if (state.version !== 1) {
      throw new Error(`Unsupported persisted state version: ${state.version}`);
    }

    this.startingEquity = state.startingEquity;
    this.cash = state.cash;
    this.blockedCash = state.blockedCash;
    this.paused = state.paused;
    this.orderSequence = state.orderSequence;
    this.auditSequence = state.auditSequence;
    this.orders = state.orders;
    this.auditEvents = state.auditEvents;

    this.positions.clear();
    for (const pos of state.positions) {
      this.positions.set(pos.symbol, { ...pos });
    }
  }

  private initializeFresh(startingCash: number): void {
    const seededCost = computeSeededCost();

    if (seededCost >= startingCash) {
      throw new Error("TRADING_STARTING_CASH must exceed the seeded portfolio cost.");
    }

    this.cash = startingCash - seededCost;

    for (const pos of SEEDED_POSITIONS) {
      this.positions.set(pos.symbol, { ...pos });
    }

    this.appendAudit("system", "account.created", "模拟账户已创建（JSON 持久化）", {
      startingCash,
      seededCost,
    });

    this.flush();
  }

  // ── Account ──

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

  // ── Positions ──

  getPositionQuantity(symbol: string): number {
    return this.positions.get(symbol)?.quantity ?? 0;
  }

  getPositions(snapshot: MarketSnapshot): PositionSnapshot[] {
    const quoteMap = new Map(snapshot.quotes.map((q) => [q.symbol, q]));
    const raw = [...this.positions.values()].map((pos) => {
      const quote = quoteMap.get(pos.symbol);
      const currentPrice = quote?.price ?? pos.averagePrice;
      const marketValue = currentPrice * pos.quantity;

      return {
        symbol: pos.symbol,
        name: pos.name,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        currentPrice,
        marketValue,
        unrealizedPnl: (currentPrice - pos.averagePrice) * pos.quantity,
        realizedPnl: pos.realizedPnl,
        weight: 0,
      };
    });

    const totalMv = raw.reduce((t, p) => t + p.marketValue, 0);
    const equity = this.cash + totalMv;

    return raw.map((p) => ({
      ...p,
      weight: equity === 0 ? 0 : p.marketValue / equity,
    }));
  }

  getAccount(
    mode: TradingMode,
    snapshot: MarketSnapshot,
    limits: RiskLimits,
  ): AccountSnapshot {
    const positions = this.getPositions(snapshot);
    const marketValue = positions.reduce((t, p) => t + p.marketValue, 0);
    const unrealizedPnl = positions.reduce((t, p) => t + p.unrealizedPnl, 0);
    const realizedPnl = positions.reduce((t, p) => t + p.realizedPnl, 0);
    const availableCash = this.cash - this.blockedCash;
    const equity = this.cash + marketValue;
    const dailyPnl = equity - this.startingEquity;
    const baseline = Math.max(1, equity - dailyPnl);
    const exposureRatio = equity === 0 ? 0 : marketValue / equity;
    const lossRatio =
      dailyPnl >= 0 ? 0 : Math.abs(dailyPnl / baseline) / limits.maxDailyLoss;

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
      updatedAt: new Date().toISOString(),
    };
  }

  // ── Orders ──

  findByClientOrderId(clientOrderId?: string): OrderRecord | undefined {
    if (!clientOrderId) return undefined;
    return this.orders.find((o) => o.clientOrderId === clientOrderId);
  }

  findOrderById(id: string): OrderRecord | undefined {
    return this.orders.find((o) => o.id === id);
  }

  getPendingOrders(): OrderRecord[] {
    return this.orders.filter((o) => o.status === "pending");
  }

  createOrder(request: OrderRequest, requestedPrice: number): OrderRecord {
    this.orderSequence += 1;
    const now = new Date().toISOString();
    const isLimitOrder = request.type === "limit";

    const order: OrderRecord = {
      ...request,
      id: `PO-${Date.now()}-${String(this.orderSequence).padStart(4, "0")}`,
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
      this.blockedCash += request.limitPrice * request.quantity;
    }

    this.appendAudit(
      "order",
      "order.accepted",
      isLimitOrder ? "限价单已挂单" : "模拟订单已接收",
      { orderId: order.id, symbol: order.symbol, side: order.side, type: order.type },
    );
    this.flush();
    return order;
  }

  rejectOrder(order: OrderRecord, reason: string, code: string): OrderRecord {
    order.status = "rejected";
    order.rejectionReason = reason;
    order.updatedAt = new Date().toISOString();

    if (order.type === "limit" && order.limitPrice !== undefined) {
      this.blockedCash -= order.limitPrice * order.quantity;
    }

    this.appendAudit("risk", code, reason, { orderId: order.id });
    this.flush();
    return { ...order };
  }

  cancelOrder(order: OrderRecord): OrderRecord {
    if (order.status !== "pending") {
      throw new Error(`只能撤销挂单状态的订单，当前状态: ${order.status}`);
    }

    order.status = "cancelled";
    order.updatedAt = new Date().toISOString();

    if (order.limitPrice !== undefined) {
      this.blockedCash -= order.limitPrice * order.quantity;
    }

    this.appendAudit("order", "order.cancelled", "限价单已撤销", { orderId: order.id });
    this.flush();
    return { ...order };
  }

  checkLimitOrderFill(
    order: OrderRecord,
    quote: { symbol: string; name: string; price: number },
  ): boolean {
    if (order.status !== "pending" || order.type !== "limit") return false;

    const limitPrice = order.limitPrice!;
    return order.side === "buy"
      ? quote.price <= limitPrice
      : quote.price >= limitPrice;
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
      const prevQty = current?.quantity ?? 0;
      const prevCost = prevQty * (current?.averagePrice ?? 0);
      const nextQty = prevQty + order.quantity;

      this.positions.set(order.symbol, {
        symbol: order.symbol,
        name,
        quantity: nextQty,
        averagePrice: (prevCost + notional) / nextQty,
        realizedPnl: current?.realizedPnl ?? 0,
      });
      this.cash -= notional + commission;
    } else if (current) {
      const realizedPnl =
        (fillPrice - current.averagePrice) * order.quantity - commission;
      const nextQty = current.quantity - order.quantity;
      this.cash += notional - commission;

      if (nextQty === 0) {
        this.positions.delete(order.symbol);
      } else {
        this.positions.set(order.symbol, {
          ...current,
          quantity: nextQty,
          realizedPnl: current.realizedPnl + realizedPnl,
        });
      }
    }

    order.status = "filled";
    order.filledPrice = fillPrice;
    order.filledQuantity = order.quantity;
    order.notional = notional;
    order.commission = commission;
    order.updatedAt = new Date().toISOString();

    this.appendAudit(
      "order",
      "order.filled",
      wasPending ? "限价单已成交" : "模拟订单已成交",
      { orderId: order.id, fillPrice, commission, notional },
    );
    this.flush();
    return { ...order };
  }

  listOrders(limit = 100): OrderRecord[] {
    return this.orders.slice(0, limit).map((o) => ({ ...o }));
  }

  // ── Audit ──

  listAudit(limit = 200): AuditEvent[] {
    return this.auditEvents.slice(0, limit).map((e) => ({ ...e }));
  }

  appendAudit(
    category: AuditEvent["category"],
    action: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.auditSequence += 1;
    this.auditEvents.unshift({
      id: `AE-${Date.now()}-${String(this.auditSequence).padStart(4, "0")}`,
      category,
      action,
      message,
      timestamp: new Date().toISOString(),
      data,
    });
  }
}
