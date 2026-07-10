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
    const order = this.store.createOrder(request, quote?.price ?? 0);
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
      const rejected = this.store.rejectOrder(order, decision.message, decision.code);
      this.emit("order.updated", rejected);
      return rejected;
    }

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
