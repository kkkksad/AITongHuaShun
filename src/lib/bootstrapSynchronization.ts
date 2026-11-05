import type { OrderRecord, TradingEvent } from "../../shared/trading";
import type { TradingBootstrap } from "./tradingApi";

export type BootstrapDataEvent = Extract<TradingEvent, {
  type: "market.snapshot" | "account.snapshot" | "positions.snapshot" | "orders.snapshot" | "order.updated";
}>;

const ORDER_LIMIT = 50;
const DELTA_LIMIT = 100;

export function upsertOrder(orders: OrderRecord[], next: OrderRecord): OrderRecord[] {
  const index = orders.findIndex((order) => order.id === next.id);
  return index < 0
    ? [next, ...orders].slice(0, ORDER_LIMIT)
    : orders.map((order, current) => current === index ? next : order).slice(0, ORDER_LIMIT);
}

export function applyBootstrapEvent(current: TradingBootstrap, event: BootstrapDataEvent): TradingBootstrap {
  switch (event.type) {
    case "market.snapshot":
      return { ...current, health: { ...current.health, mode: event.data.mode }, market: event.data };
    case "account.snapshot": return { ...current, account: event.data };
    case "positions.snapshot": return { ...current, positions: event.data };
    case "orders.snapshot": return { ...current, orders: event.data.slice(0, ORDER_LIMIT) };
    case "order.updated": return { ...current, orders: upsertOrder(current.orders, event.data) };
  }
}

/** Latest records are deduplicated; the bounded ID journal retains FIFO upsert order. */
class OrderOverlay {
  revision = 0;
  overflow = false;
  private snapshot?: OrderRecord[];
  private records = new Map<string, OrderRecord>();
  private journal: string[] = [];

  record(event: BootstrapDataEvent, revision: number): void {
    if (event.type === "orders.snapshot") {
      this.revision = revision;
      this.snapshot = event.data.slice(0, ORDER_LIMIT);
      this.records.clear();
      this.journal = [];
      this.overflow = false;
    } else if (event.type === "order.updated") {
      this.revision = revision;
      if (this.snapshot) {
        this.snapshot = upsertOrder(this.snapshot, event.data);
        return;
      }
      this.records.set(event.data.id, event.data);
      if (this.journal.at(-1) !== event.data.id) this.journal.push(event.data.id);
      if (this.journal.length > DELTA_LIMIT) {
        this.journal.shift();
        this.overflow = true;
        const retained = new Set(this.journal);
        for (const id of this.records.keys()) if (!retained.has(id)) this.records.delete(id);
      }
    }
  }

  project(base: OrderRecord[]): OrderRecord[] {
    if (this.snapshot) return this.snapshot;
    return this.journal.reduce((orders, id) => upsertOrder(orders, this.records.get(id)!), base.slice(0, ORDER_LIMIT));
  }
}

interface Stamped<T> { revision: number; value: T }

class BootstrapOverlay {
  market?: Stamped<TradingBootstrap["market"]>;
  account?: Stamped<TradingBootstrap["account"]>;
  positions?: Stamped<TradingBootstrap["positions"]>;
  orders = new OrderOverlay();

  record(event: BootstrapDataEvent, revision: number): void {
    switch (event.type) {
      case "market.snapshot": this.market = { revision, value: event.data }; break;
      case "account.snapshot": this.account = { revision, value: event.data }; break;
      case "positions.snapshot": this.positions = { revision, value: event.data }; break;
      default: this.orders.record(event, revision);
    }
  }

  project(base: TradingBootstrap): TradingBootstrap {
    return {
      ...base,
      ...(this.market ? { market: this.market.value, health: { ...base.health, mode: this.market.value.mode } } : {}),
      ...(this.account ? { account: this.account.value } : {}),
      ...(this.positions ? { positions: this.positions.value } : {}),
      orders: this.orders.project(base.orders),
    };
  }
}

interface ReadToken<T> { epoch: number; startRevision: number; overlay: T }
export type BootstrapReadToken = ReadToken<BootstrapOverlay>;
export type OrdersReadToken = ReadToken<OrderOverlay>;

/** One initial/read overlay and one optional bounded order catchup; never a message-sized queue. */
export class BootstrapSynchronization {
  private epoch = 0;
  private revision = 0;
  private initial = new BootstrapOverlay();
  private bootstrapRead?: BootstrapReadToken;
  private ordersRead?: OrdersReadToken;
  private catchupPending = false;
  private incompleteOrders = false;

  get generation(): number { return this.epoch; }
  get ordersIncomplete(): boolean { return this.incompleteOrders; }

  invalidate(): void {
    this.epoch++;
    this.initial = new BootstrapOverlay();
    this.bootstrapRead = undefined;
    this.ordersRead = undefined;
    this.catchupPending = false;
    this.incompleteOrders = false;
  }

  beginBootstrap(hasCache: boolean): BootstrapReadToken {
    this.ordersRead = undefined;
    this.catchupPending = false;
    const token = { epoch: this.epoch, startRevision: this.revision, overlay: hasCache ? new BootstrapOverlay() : this.initial };
    this.bootstrapRead = token;
    return token;
  }

  isCurrentBootstrap(token: BootstrapReadToken): boolean {
    return token.epoch === this.epoch && token === this.bootstrapRead;
  }

  finishBootstrap(token: BootstrapReadToken, base: TradingBootstrap): TradingBootstrap {
    if (!this.isCurrentBootstrap(token)) throw new DOMException("Bootstrap read was cancelled", "AbortError");
    this.bootstrapRead = undefined;
    this.initial = new BootstrapOverlay();
    this.incompleteOrders = token.overlay.orders.overflow;
    this.catchupPending = this.incompleteOrders;
    return token.overlay.project(base);
  }

  failBootstrap(token: BootstrapReadToken): void {
    if (this.isCurrentBootstrap(token)) this.bootstrapRead = undefined;
  }

  record(event: BootstrapDataEvent, hasCache: boolean): void {
    const revision = ++this.revision;
    if (!hasCache) this.initial.record(event, revision);
    if (this.bootstrapRead && (hasCache || this.bootstrapRead.overlay !== this.initial)) {
      this.bootstrapRead.overlay.record(event, revision);
    }
    this.ordersRead?.overlay.record(event, revision);
    if (event.type === "orders.snapshot") {
      this.incompleteOrders = false;
      this.catchupPending = false;
    }
  }

  takeOrdersCatchup(): OrdersReadToken | undefined {
    if (!this.catchupPending || this.ordersRead) return undefined;
    this.catchupPending = false;
    const token = { epoch: this.epoch, startRevision: this.revision, overlay: new OrderOverlay() };
    this.ordersRead = token;
    return token;
  }

  isCurrentOrders(token: OrdersReadToken): boolean {
    return token.epoch === this.epoch && token === this.ordersRead;
  }

  finishOrders(token: OrdersReadToken, orders: OrderRecord[]): OrderRecord[] | undefined {
    if (!this.isCurrentOrders(token)) throw new DOMException("Order read was cancelled", "AbortError");
    this.ordersRead = undefined;
    if (token.overlay.overflow) return undefined;
    this.incompleteOrders = false;
    return token.overlay.project(orders);
  }

  cancelOrders(): void { this.ordersRead = undefined; }
}
