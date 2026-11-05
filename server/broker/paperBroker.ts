import { EventEmitter } from "node:events";
import type {
  AccountSnapshot,
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
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import type { RiskEngine } from "../risk/riskEngine";
import { executionCosts, hasSufficientCash, limitBuyBudget } from "./executionCosts";

interface PaperBrokerOptions {
  mode: TradingMode;
  commissionRate: number;
  minimumCommission: number;
  slippageBps: number;
  limits: RiskLimits;
}

export class PaperBroker extends EventEmitter {
  constructor(
    private readonly market: MarketDataProvider,
    private readonly store: TradingStore,
    private readonly risk: RiskEngine,
    private readonly options: PaperBrokerOptions,
  ) {
    super();
  }

  submitOrder(request: OrderRequest, provenance?: OrderProvenance): OrderRecord {
    const duplicate = this.store.findByClientOrderId(request.clientOrderId);
    if (duplicate) {
      return duplicate;
    }

    const quote = this.market.getQuote(request.symbol);

    // Evaluate risk FIRST, before creating the order and blocking cash
    const snapshot = this.market.getSnapshot();
    const account = this.getAccount(snapshot);
    const position = this.getPositions(snapshot).find(
      (candidate) => candidate.symbol === request.symbol,
    );
    const pendingOrders = this.store.getPendingOrders();
    const reservedSellQuantity = pendingOrders
      .filter((order) => order.symbol === request.symbol && order.side === "sell")
      .reduce((total, order) => total + order.quantity, 0);
    const reservedBuyNotional = pendingOrders
      .filter((order) => order.symbol === request.symbol && order.side === "buy")
      .reduce((total, order) => total + order.quantity * (order.limitPrice ?? order.requestedPrice), 0);
    const decision = this.risk.evaluate({
      request,
      quote,
      account,
      position,
      reservedSellQuantity,
      reservedBuyNotional,
      mode: this.options.mode,
      requiredCash: request.side === "buy" && quote
        ? request.type === "limit" && request.limitPrice !== undefined && quote.price > request.limitPrice
          ? limitBuyBudget(request, this.options)
          : executionCosts(request, quote.price, this.options).cashDebit
        : undefined,
    });

    if (!decision.allowed || !quote) {
      // Create a minimal rejected order record
      const order = this.store.createOrder(
        request,
        quote?.price ?? 0,
        quote?.name,
        provenance,
      );
      const rejected = this.store.rejectOrder(order, decision.message, decision.code);
      this.emit("order.updated", rejected);
      return rejected;
    }

    // Now create the order (cash will be blocked for limit orders)
    const order = this.store.createOrder(request, quote.price, quote.name, provenance);

    // Marketable limit orders fill immediately; otherwise they remain pending.
    if (request.type === "limit") {
      if (this.store.checkLimitOrderFill(order, quote)) {
        const filled = this.fillOrder(order, quote.name, quote.price, snapshot);
        this.emit("order.updated", filled);
        this.emit("account.updated", this.getAccount());
        return filled;
      }

      this.emit("order.updated", { ...order });
      this.emit("account.updated", this.getAccount());
      return { ...order };
    }

    const filled = this.fillOrder(order, quote.name, quote.price, snapshot);

    this.emit("order.updated", filled);
    this.emit("account.updated", this.getAccount());
    return filled;
  }

  cancelOrder(orderId: string): OrderRecord {
    const order = this.store.findOrderById(orderId);
    if (!order) {
      throw new Error(`订单不存在: ${orderId}`);
    }

    const cancelled = this.store.cancelOrder(order);
    this.emit("order.updated", cancelled);
    this.emit("account.updated", this.getAccount());
    return cancelled;
  }

  pause(): AccountSnapshot {
    this.store.setPaused(true);
    const account = this.getAccount();
    this.emit("account.updated", account);
    return account;
  }

  resume(): AccountSnapshot {
    this.store.setPaused(false);
    const account = this.getAccount();
    this.emit("account.updated", account);
    return account;
  }

  setStrategyProfile(profile: PaperStrategyProfile): AccountSnapshot {
    this.store.setStrategyProfile(profile);
    const account = this.getAccount();
    this.emit("account.updated", account);
    return account;
  }

  setExecutionStrategy(strategy: PaperExecutionStrategy): AccountSnapshot {
    this.store.setExecutionStrategy(strategy);
    const account = this.getAccount();
    this.emit("account.updated", account);
    return account;
  }

  resetAccount(input: {
    startingCash: number;
    strategyProfile: PaperStrategyProfile;
    executionStrategy?: PaperExecutionStrategy;
  }): { account: AccountSnapshot; positions: PositionSnapshot[]; orders: OrderRecord[] } {
    this.store.resetAccount(input);
    this.risk.resetCircuit();
    const account = this.getAccount();
    const positions = this.getPositions();
    this.emit("account.updated", account);
    return { account, positions, orders: [] };
  }

  markToMarket(snapshot = this.market.getSnapshot()): AccountSnapshot {
    const account = this.getAccount(snapshot);

    // Check pending limit orders for fill
    const pendingOrders = this.store.getPendingOrders();
    const quoteMap = new Map(snapshot.quotes.map((q) => [q.symbol, q]));

    for (const order of pendingOrders) {
      const quote = quoteMap.get(order.symbol);
      if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) continue;

      if (this.store.checkLimitOrderFill(order, quote)) {
        const filled = this.fillOrder(order, quote.name, quote.price, snapshot);
        this.emit("order.updated", filled);
      }
    }

    if (pendingOrders.length > 0) {
      const updated = this.getAccount(snapshot);
      this.emit("account.updated", updated);
      return updated;
    }

    this.emit("account.updated", account);
    return account;
  }

  getAccount(snapshot = this.market.getSnapshot()): AccountSnapshot {
    const account = this.store.getAccount(this.options.mode, snapshot, this.options.limits);
    const pendingOrders = this.store.getPendingOrders();
    if (pendingOrders.length === 0) return account;
    let extraBudget = 0;
    for (const order of pendingOrders) {
      if (order.side === "buy" && order.type === "limit" && order.limitPrice !== undefined) {
        extraBudget += Math.max(0, limitBuyBudget(order, this.options) - order.limitPrice * order.quantity);
      }
    }
    if (extraBudget === 0 && account.cash >= 0) return account;
    return { ...account, cash: Math.max(0, account.cash - extraBudget) };
  }

  getPositions(snapshot = this.market.getSnapshot()): PositionSnapshot[] {
    return this.store.getPositions(snapshot);
  }

  getOrders(limit?: number): OrderRecord[] {
    const quoteNames = new Map(
      this.market.getSnapshot().quotes.map((quote) => [quote.symbol, quote.name]),
    );
    const positionNames = new Map(
      this.getPositions().map((position) => [position.symbol, position.name]),
    );
    return this.store.listOrders(limit).map((order) => ({
      ...order,
      name:
        order.name ?? quoteNames.get(order.symbol) ?? positionNames.get(order.symbol),
    }));
  }

  private fillOrder(
    order: OrderRecord,
    name: string,
    marketPrice: number,
    snapshot: MarketSnapshot,
  ): OrderRecord {
    const stored = this.store.findOrderById(order.id);
    if (!stored) throw new Error(`订单不存在：${order.id}`);
    if (stored.status !== "pending" && stored.status !== "accepted") return { ...stored };
    order = stored;
    const costs = executionCosts(order, marketPrice, this.options);
    let otherBuyBudgets = 0;
    for (const pending of this.store.getPendingOrders()) {
      if (pending.id !== order.id && pending.side === "buy" && pending.type === "limit" && pending.limitPrice !== undefined) {
        otherBuyBudgets += limitBuyBudget(pending, this.options);
      }
    }
    const spendable = Math.max(0, this.store.getCash() - otherBuyBudgets);
    if (!hasSufficientCash(spendable, costs.cashDebit)) {
      return this.store.rejectOrder(order, "可用资金不足", "INSUFFICIENT_CASH");
    }

    if (order.side === "buy") {
      const account = this.getAccount(snapshot);
      const position = this.getPositions(snapshot).find((candidate) => candidate.symbol === order.symbol);
      const addedValue = order.quantity * marketPrice;
      const decision = this.risk.evaluatePositionWeight({
        currentValue: position?.marketValue ?? 0,
        addedValue,
        equity: account.equity - costs.cashDebit + addedValue,
      });
      if (!decision.allowed) return this.store.rejectOrder(order, decision.message, decision.code);
    }

    return this.store.fillOrder(
      order,
      name,
      costs.fillPrice,
      costs.commission,
    );
  }
}
