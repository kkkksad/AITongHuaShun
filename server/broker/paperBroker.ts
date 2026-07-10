import { EventEmitter } from "node:events";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
  RiskLimits,
  TradingMode,
} from "../../shared/trading";
import type { MockMarket } from "../market/mockMarket";
import type { RiskEngine } from "../risk/riskEngine";
import type { InMemoryTradingStore } from "../store/inMemoryTradingStore";

interface PaperBrokerOptions {
  mode: TradingMode;
  commissionRate: number;
  minimumCommission: number;
  slippageBps: number;
  limits: RiskLimits;
}

export class PaperBroker extends EventEmitter {
  constructor(
    private readonly market: MockMarket,
    private readonly store: InMemoryTradingStore,
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
    const decision = this.risk.evaluate({
      request,
      quote,
      account,
      position,
      mode: this.options.mode,
    });

    if (!decision.allowed || !quote) {
      // Create a minimal rejected order record
      const order = this.store.createOrder(request, quote?.price ?? 0);
      const rejected = this.store.rejectOrder(order, decision.message, decision.code);
      this.emit("order.updated", rejected);
      return rejected;
    }

    // Now create the order (cash will be blocked for limit orders)
    const order = this.store.createOrder(request, quote.price);

    // Limit orders: accept and pend; fill on next tick
    if (request.type === "limit") {
      this.emit("order.updated", { ...order });
      this.emit("account.updated", this.getAccount());
      return { ...order };
    }

    // Market orders: fill immediately
    const slippage = this.options.slippageBps / 10_000;
    const fillPrice =
      request.side === "buy" ? quote.price * (1 + slippage) : quote.price * (1 - slippage);
    const roundedFillPrice = Number(fillPrice.toFixed(2));
    const notional = roundedFillPrice * request.quantity;
    const commission = Math.max(
      this.options.minimumCommission,
      notional * this.options.commissionRate,
    );
    const filled = this.store.fillOrder(
      order,
      quote.name,
      roundedFillPrice,
      Number(commission.toFixed(2)),
    );

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

  markToMarket(snapshot = this.market.getSnapshot()): AccountSnapshot {
    const account = this.getAccount(snapshot);

    // Check pending limit orders for fill
    const pendingOrders = this.store.getPendingOrders();
    const quoteMap = new Map(snapshot.quotes.map((q) => [q.symbol, q]));

    for (const order of pendingOrders) {
      const quote = quoteMap.get(order.symbol);
      if (!quote) continue;

      if (this.store.checkLimitOrderFill(order, quote)) {
        const slippage = this.options.slippageBps / 10_000;
        const fillPrice =
          order.side === "buy"
            ? quote.price * (1 + slippage)
            : quote.price * (1 - slippage);
        const roundedPrice = Number(fillPrice.toFixed(2));
        const notional = roundedPrice * order.quantity;
        const commission = Math.max(
          this.options.minimumCommission,
          notional * this.options.commissionRate,
        );
        const filled = this.store.fillOrder(
          order,
          quote.name,
          roundedPrice,
          Number(commission.toFixed(2)),
        );
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
    return this.store.listOrders(limit);
  }
}
