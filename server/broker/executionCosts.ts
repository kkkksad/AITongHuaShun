import type { OrderRequest } from "../../shared/trading";

export interface ExecutionCostOptions {
  commissionRate: number;
  minimumCommission: number;
  slippageBps: number;
}

function commissionFor(notional: number, options: ExecutionCostOptions): number {
  return Number(Math.max(options.minimumCommission, notional * options.commissionRate).toFixed(2));
}

/** Keep the existing slippage, limit clamp, price rounding and commission rounding order. */
export function executionCosts(order: OrderRequest, marketPrice: number, options: ExecutionCostOptions) {
  const slippage = options.slippageBps / 10_000;
  let price = marketPrice * (order.side === "buy" ? 1 + slippage : 1 - slippage);
  if (order.type === "limit" && order.limitPrice !== undefined) {
    price = order.side === "buy" ? Math.min(price, order.limitPrice) : Math.max(price, order.limitPrice);
  }
  const fillPrice = Number(price.toFixed(2));
  const notional = fillPrice * order.quantity;
  const commission = commissionFor(notional, options);
  const cashDebit = order.side === "buy" ? notional + commission : Math.max(0, commission - notional);
  return { fillPrice, notional, commission, cashDebit };
}

/** Store still freezes raw cap principal; Broker reserves only the derived difference. */
export function limitBuyBudget(order: OrderRequest, options: ExecutionCostOptions): number {
  const cap = order.limitPrice!;
  const principal = cap * order.quantity;
  const roundedNotional = Number(cap.toFixed(2)) * order.quantity;
  return Math.max(principal, roundedNotional + commissionFor(roundedNotional, options));
}

/** Allow only binary floating arithmetic noise, never a rounded cent of extra funding. */
export function hasSufficientCash(available: number, required: number): boolean {
  if (!Number.isFinite(available) || !Number.isFinite(required)) return false;
  const tolerance = Math.min(1e-7, Number.EPSILON * 8 * Math.max(1, Math.abs(available), Math.abs(required)));
  return required <= available || required - available <= tolerance;
}
