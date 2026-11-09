import type { TradingStore } from "../contracts/TradingStore";

/** Controlled conflict, with no account identity or provider data in the message. */
export class PaperExecutionContextChangedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Paper 账户控制或执行设置已变化，当前计划失效，等待下一轮重新计算。");
    this.name = "PaperExecutionContextChangedError";
  }
}

export function assertPaperExecutionRevision(store: TradingStore, expectedRevision: number): void {
  if (store.getExecutionRevision() !== expectedRevision) throw new PaperExecutionContextChangedError();
}
