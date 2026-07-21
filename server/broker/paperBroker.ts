import { EventEmitter } from "node:events";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PaperStrategyProfile,
  PositionSnapshot,
  RiskLimits,
  TradingMode,
} from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import type { RiskEngine } from "../risk/riskEngine";

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

  submitOrder(request: OrderRequest): OrderRecord {
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
    const reservedSellQuantity = this.store
      .getPendingOrders()
      .filter((order) => order.symbol === request.symbol && order.side === "sell")
      .reduce((total, order) => total + order.quantity, 0);
    const decision = this.risk.evaluate({
      request,
      quote,
      account,
      position,
      reservedSellQuantity,
      mode: this.options.mode,
    });

    if (!decision.allowed || !quote) {
      // Create a minimal rejected order record
      const order = this.store.createOrder(request, quote?.price ?? 0, quote?.name);
      const rejected = this.store.rejectOrder(order, decision.message, decision.code);
      this.emit("order.updated", rejected);
      return rejected;
    }

    // Now create the order (cash will be blocked for limit orders)
    const order = this.store.createOrder(request, quote.price, quote.name);

    // Marketable limit orders fill immediately; otherwise they remain pending.
    if (request.type === "limit") {
      if (this.store.checkLimitOrderFill(order, quote)) {
        const filled = this.fillOrder(order, quote.name, quote.price);
        this.emit("order.updated", filled);
        this.emit("account.updated", this.getAccount());
        return filled;
      }

      this.emit("order.updated", { ...order });
      this.emit("account.updated", this.getAccount());
      return { ...order };
    }

    const filled = this.fillOrder(order, quote.name, quote.price);

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

  resetAccount(input: {
    startingCash: number;
    strategyProfile: PaperStrategyProfile;
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
      if (!quote) continue;

      if (this.store.checkLimitOrderFill(order, quote)) {
        const filled = this.fillOrder(order, quote.name, quote.price);
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
    return this.store.getAccount(this.options.mode, snapshot, this.options.limits);
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
  ): OrderRecord {
    const slippage = this.options.slippageBps / 10_000;
    let fillPrice =
      order.side === "buy"
        ? marketPrice * (1 + slippage)
        : marketPrice * (1 - slippage);

    if (order.type === "limit" && order.limitPrice !== undefined) {
      fillPrice =
        order.side === "buy"
          ? Math.min(fillPrice, order.limitPrice)
          : Math.max(fillPrice, order.limitPrice);
    }

    const roundedFillPrice = Number(fillPrice.toFixed(2));
    const notional = roundedFillPrice * order.quantity;
    const commission = Math.max(
      this.options.minimumCommission,
      notional * this.options.commissionRate,
    );

    return this.store.fillOrder(
      order,
      name,
      roundedFillPrice,
      Number(commission.toFixed(2)),
    );
  }
}
