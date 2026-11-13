import { isDeepStrictEqual } from "node:util";
import type { OrderRecord } from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";

/** Controlled conflict, with no account identity or provider data in the message. */
export class PaperExecutionContextChangedError extends Error {
  readonly statusCode = 409;
  constructor(reason: "controls" | "ledger" = "controls") {
    super(reason === "ledger"
      ? "Paper 资金或订单账本已变化，当前计划失效，等待下一轮重新计算。"
      : "Paper 账户控制或执行设置已变化，当前计划失效，等待下一轮重新计算。");
    this.name = "PaperExecutionContextChangedError";
  }
}

export function assertPaperExecutionRevision(store: TradingStore, expectedRevision: number): void {
  if (store.getExecutionRevision() !== expectedRevision) throw new PaperExecutionContextChangedError();
}

export interface PaperLedgerContext {
  orders: OrderRecord[];
  pendingOrders: OrderRecord[];
  totalCash: number;
  availableCash: number;
}

export function capturePaperLedgerContext(store: TradingStore): PaperLedgerContext {
  return {
    orders: store.listOrders(10_000),
    // Older pending orders can fall outside recent history; the store's pending
    // records are mutable, so preserve independent flat copies.
    pendingOrders: store.getPendingOrders().map(order => ({ ...order })),
    totalCash: store.getCash(),
    availableCash: store.getAvailableCash(),
  };
}

export function assertPaperLedgerContext(store: TradingStore, expected: PaperLedgerContext): void {
  if (store.getCash() !== expected.totalCash ||
      store.getAvailableCash() !== expected.availableCash ||
      !isDeepStrictEqual(expected.orders, store.listOrders(10_000)) ||
      !isDeepStrictEqual(expected.pendingOrders, store.getPendingOrders())) {
    throw new PaperExecutionContextChangedError("ledger");
  }
}
