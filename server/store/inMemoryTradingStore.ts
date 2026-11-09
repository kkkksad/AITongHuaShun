import type {
  AccountSnapshot,
  AuditEvent,
  MarketSnapshot,
  OrderRecord,
  OrderProvenance,
  OrderRequest,
  PaperExecutionStrategy,
  PaperStrategyProfile,
  PositionSnapshot,
  RiskLimits,
  TradingMode,
} from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";
import { hasSufficientCash } from "../broker/executionCosts";
import { calculateTradingDayPerformance } from "./tradingDayPerformance";
import { copyPaperRiskCheckpoint, validatePaperRiskCheckpoint, type PaperRiskCheckpoint } from "../risk/paperRiskCheckpoint";
import { advancePaperPositionCycle, appendPaperCycleResult, copyPaperFillLedger, emptyPaperFillLedger,
  type OpenPaperPositionCycle, type PaperFillLedger } from "./paperPositionCycles";

interface MutablePosition {
  symbol: string;
  name: string;
  quantity: number;
  t1LockedQuantity?: number;
  t1LockedDate?: string;
  averagePrice: number;
  realizedPnl: number;
  paperCycle?: OpenPaperPositionCycle;
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
  getAccountEpoch(): null { return null; }
  private readonly accountId = "PAPER-CN-01";
  private startingEquity: number;
  private strategyProfile: PaperStrategyProfile = "balanced";
  private executionStrategy: PaperExecutionStrategy = "auto";
  private cash: number;
  private blockedCash = 0;
  private paused = false;
  private readonly positions = new Map<string, MutablePosition>();
  private readonly orders: OrderRecord[] = [];
  private readonly auditEvents: AuditEvent[] = [];
  private orderSequence = 0;
  private auditSequence = 0;
  private paperFillLedger: PaperFillLedger = emptyPaperFillLedger();
  private paperRiskCheckpoint?: PaperRiskCheckpoint;
  private lastTradeDateTime?: number;
  private lastTradeDate = "";

  private currentTradeDate(): string {
    const now = this.now();
    const timestamp = now.getTime();
    if (timestamp !== this.lastTradeDateTime) {
      this.lastTradeDate = getChinaTradeDate(now);
      this.lastTradeDateTime = timestamp;
    }
    return this.lastTradeDate;
  }

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

  getStrategyProfile(): PaperStrategyProfile {
    return this.strategyProfile;
  }

  setStrategyProfile(profile: PaperStrategyProfile): void {
    this.strategyProfile = profile;
    this.appendAudit("system", "account.strategy-profile.updated", "Paper 策略档位已更新", {
      strategyProfile: profile,
    });
  }

  getExecutionStrategy(): PaperExecutionStrategy {
    return this.executionStrategy;
  }

  setExecutionStrategy(strategy: PaperExecutionStrategy): void {
    this.executionStrategy = strategy;
    this.appendAudit("system", "account.execution-strategy.updated", "Paper 执行策略已更新", {
      executionStrategy: strategy,
    });
  }

  resetAccount(input: {
    startingCash: number;
    strategyProfile: PaperStrategyProfile;
    executionStrategy?: PaperExecutionStrategy;
  }): void {
    if (!Number.isFinite(input.startingCash) || input.startingCash <= 0) {
      throw new Error("Paper account starting cash must be positive.");
    }
    const executionStrategy = input.executionStrategy ?? "auto";
    this.startingEquity = input.startingCash;
    this.strategyProfile = input.strategyProfile;
    this.executionStrategy = executionStrategy;
    this.cash = input.startingCash;
    this.blockedCash = 0;
    this.paused = false;
    this.positions.clear();
    this.orders.length = 0;
    this.auditEvents.length = 0;
    this.orderSequence = 0;
    this.auditSequence = 0;
    this.paperFillLedger = emptyPaperFillLedger();
    this.paperRiskCheckpoint = undefined;
    this.appendAudit("system", "account.reset", "已开始新的纯现金 Paper 模拟", {
      startingCash: input.startingCash,
      strategyProfile: input.strategyProfile,
      executionStrategy,
      previousStateDeleted: true,
    });
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
    if (this.positions.size === 0) return [];
    const quoteMap = new Map(snapshot.quotes.map((quote) => [quote.symbol, quote]));
    const tradeDate = this.currentTradeDate();
    const raw = [...this.positions.values()].map((position) => {
      const quote = quoteMap.get(position.symbol);
      const currentPrice = quote && Number.isFinite(quote.price) && quote.price > 0
        ? quote.price
        : position.averagePrice;
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
    const remainingCost = positions.reduce(
      (total, position) => total + position.quantity * position.averagePrice,
      0,
    );
    // Total cash includes reservations; only paid costs reduce the net result.
    const realizedPnl = this.cash + remainingCost - this.startingEquity;
    const availableCash = this.cash - this.blockedCash;
    const equity = this.cash + marketValue;
    const dailyPnl = equity - this.startingEquity;
    const baseline = Math.max(1, equity - dailyPnl);
    const tradingDayPerformance = calculateTradingDayPerformance({
      now: this.now(), cash: this.cash, equity, startingEquity: this.startingEquity,
      positions, orders: this.orders, auditEvents: this.auditEvents, snapshot,
    });
    const exposureRatio = equity === 0 ? 0 : marketValue / equity;
    const dayPnlPercent = tradingDayPerformance.pnlPercent ?? 0;
    const lossRatio = dayPnlPercent >= 0 ? 0 : Math.abs(dayPnlPercent) / limits.maxDailyLoss;

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
      tradingDayPerformance,
      riskUtilization: Math.min(1, Math.max(exposureRatio, lossRatio)),
      paused: this.paused,
      startingEquity: this.startingEquity,
      strategyProfile: this.strategyProfile,
      executionStrategy: this.executionStrategy,
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

  createOrder(
    request: OrderRequest,
    requestedPrice: number,
    name?: string,
    provenance?: OrderProvenance,
  ): OrderRecord {
    this.orderSequence += 1;
    const now = this.now().toISOString();
    const isLimitOrder = request.type === "limit";

    const order: OrderRecord = {
      ...request,
      ...(name ? { name } : {}),
      ...(provenance?.strategy ? { strategy: provenance.strategy } : {}),
      ...(provenance?.strategyKey ? { strategyKey: provenance.strategyKey } : {}),
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

    if (isLimitOrder && request.side === "buy" && request.limitPrice !== undefined) {
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
    const stored = this.findOrderById(order.id);
    if (!stored) throw new Error(`订单不存在：${order.id}`);
    order = stored;
    if (order.status !== "pending" && order.status !== "accepted") return { ...order };
    order.status = "rejected";
    order.rejectionReason = reason;
    order.updatedAt = this.now().toISOString();

    if (order.type === "limit" && order.side === "buy" && order.limitPrice !== undefined) {
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

    if (order.side === "buy" && order.limitPrice !== undefined) {
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

    if (!Number.isFinite(quote.price) || quote.price <= 0) {
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
    const stored = this.findOrderById(order.id);
    if (!stored) throw new Error(`订单不存在：${order.id}`);
    order = stored;
    if (order.status !== "pending" && order.status !== "accepted") return { ...order };
    const wasPending = order.status === "pending";
    const notional = fillPrice * order.quantity;
    const current = this.positions.get(order.symbol);
    const ownPrincipal = wasPending && order.side === "buy" && order.type === "limit" && order.limitPrice !== undefined
      ? order.limitPrice * order.quantity : 0;
    const cashDebit = order.side === "buy" ? notional + commission : Math.max(0, commission - notional);
    if (!hasSufficientCash(Math.max(0, this.getAvailableCash() + ownPrincipal), cashDebit)) {
      return this.rejectOrder(order, "可用资金不足", "INSUFFICIENT_CASH");
    }

    const filledAt = this.now().toISOString();
    const cycle = advancePaperPositionCycle({ order, previousQuantity: current?.quantity ?? 0,
      previousCycle: current?.paperCycle, notional, commission, filledAt });

    if (wasPending && order.side === "buy" && order.limitPrice !== undefined) {
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
        ...(cycle.openCycle ? { paperCycle: cycle.openCycle } : {}),
      }, currentLocked + order.quantity, tradeDate));
      this.cash = Math.max(0, this.cash - (notional + commission));
    } else if (current) {
      const tradeDate = getChinaTradeDate(this.now());
      const currentLocked = getT1LockedQuantity(current, tradeDate);
      const realizedPnl = (fillPrice - current.averagePrice) * order.quantity - commission;
      const nextQuantity = current.quantity - order.quantity;
      const nextLocked = Math.min(currentLocked, Math.max(0, nextQuantity));
      const nextCash = this.cash + (notional - commission);
      this.cash = notional < commission ? Math.max(0, nextCash) : nextCash;

      if (nextQuantity === 0) {
        this.positions.delete(order.symbol);
      } else {
        this.positions.set(order.symbol, withT1Lock({
          symbol: current.symbol,
          name: current.name,
          quantity: nextQuantity,
          averagePrice: current.averagePrice,
          realizedPnl: current.realizedPnl + realizedPnl,
          ...(cycle.openCycle ? { paperCycle: cycle.openCycle } : {}),
        }, nextLocked, tradeDate));
      }
    }

    order.status = "filled";
    order.filledAt = filledAt;
    order.filledPrice = fillPrice;
    order.filledQuantity = order.quantity;
    order.notional = notional;
    order.commission = commission;
    order.updatedAt = this.now().toISOString();
    if (cycle.closedCycle) appendPaperCycleResult(this.paperFillLedger, cycle.closedCycle);
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

  getPaperFillLedger(): PaperFillLedger {
    return copyPaperFillLedger(this.paperFillLedger);
  }

  getPaperRiskCheckpoint(): PaperRiskCheckpoint | undefined {
    return this.paperRiskCheckpoint && copyPaperRiskCheckpoint(this.paperRiskCheckpoint);
  }

  setPaperRiskCheckpoint(checkpoint: PaperRiskCheckpoint): void {
    validatePaperRiskCheckpoint(checkpoint, this.paperFillLedger.lastSequence);
    this.paperRiskCheckpoint = copyPaperRiskCheckpoint(checkpoint);
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
