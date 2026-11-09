import type { OrderRecord } from "../../shared/trading";

/** Internal evidence, separate from averagePrice and account-wide realized PnL. */
export interface OpenPaperPositionCycle {
  openingOrderId: string;
  openedAt: string;
  boughtQuantity: number;
  soldQuantity: number;
  buyNotional: number;
  buyFees: number;
  sellNotional: number;
  sellFees: number;
}

interface ClosedCycleIdentity {
  sequence: number;
  symbol: string;
  closingOrderId: string;
  closedAt: string;
}

export type ClosedPaperPositionCycle = ClosedCycleIdentity & (
  | (OpenPaperPositionCycle & { evidence: "complete"; netPnl: number })
  | { evidence: "missing-entry"; netPnl: null; openingOrderId: null; openedAt: null }
);

export interface PaperFillLedger {
  lastSequence: number;
  /** Oldest first; independent of the order-history retention period. */
  results: ClosedPaperPositionCycle[];
}

export const PAPER_CYCLE_RESULT_LIMIT = 512;

export function emptyPaperFillLedger(): PaperFillLedger {
  return { lastSequence: 0, results: [] };
}

export function copyPaperFillLedger(ledger: PaperFillLedger): PaperFillLedger {
  return { lastSequence: ledger.lastSequence, results: ledger.results.map((result) => ({ ...result })) };
}

export function advancePaperPositionCycle(input: {
  order: OrderRecord; previousQuantity: number; previousCycle?: OpenPaperPositionCycle;
  notional: number; commission: number; filledAt: string;
}): { openCycle?: OpenPaperPositionCycle; closedCycle?: Omit<ClosedPaperPositionCycle, "sequence"> } {
  const { order, previousQuantity, notional, commission, filledAt } = input;
  const previous = input.previousCycle;
  if (order.side === "buy") {
    // An add to a legacy position cannot repair its unknown entry evidence.
    if (previousQuantity > 0 && !previous) return {};
    const cycle = previous ?? { openingOrderId: order.id, openedAt: filledAt, boughtQuantity: 0,
      soldQuantity: 0, buyNotional: 0, buyFees: 0, sellNotional: 0, sellFees: 0 };
    return { openCycle: { ...cycle, boughtQuantity: cycle.boughtQuantity + order.quantity,
      buyNotional: cycle.buyNotional + notional, buyFees: cycle.buyFees + commission } };
  }
  if (previousQuantity <= 0 || order.quantity > previousQuantity) return {};
  const cycle = previous && { ...previous, soldQuantity: previous.soldQuantity + order.quantity,
    sellNotional: previous.sellNotional + notional, sellFees: previous.sellFees + commission };
  if (order.quantity < previousQuantity) return { openCycle: cycle };
  const identity = { symbol: order.symbol, closingOrderId: order.id, closedAt: filledAt };
  if (!cycle) {
    return { closedCycle: { ...identity, evidence: "missing-entry", netPnl: null,
      openingOrderId: null, openedAt: null } };
  }
  // At flat, all entry cost has left the position. Summing actual cash flows
  // avoids rounding a buy-fee allocation at each partial exit.
  return { closedCycle: { ...identity, ...cycle, evidence: "complete",
    netPnl: Number((cycle.sellNotional - cycle.sellFees - cycle.buyNotional - cycle.buyFees).toFixed(8)) } };
}

export function appendPaperCycleResult(
  ledger: PaperFillLedger,
  result: Omit<ClosedPaperPositionCycle, "sequence">,
): void {
  ledger.lastSequence += 1;
  ledger.results.push({ ...result, sequence: ledger.lastSequence } as ClosedPaperPositionCycle);
  if (ledger.results.length > PAPER_CYCLE_RESULT_LIMIT) ledger.results.shift();
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateOpenPaperCycle(value: unknown, quantity: number): asserts value is OpenPaperPositionCycle {
  if (!record(value) || !validId(value.openingOrderId) || !validDate(value.openedAt) ||
      !Number.isSafeInteger(value.boughtQuantity) || Number(value.boughtQuantity) <= 0 ||
      !Number.isSafeInteger(value.soldQuantity) || Number(value.soldQuantity) < 0 ||
      Number(value.boughtQuantity) - Number(value.soldQuantity) !== quantity ||
      ![value.buyNotional, value.buyFees, value.sellNotional, value.sellFees].every(nonnegative) ||
      Number(value.buyNotional) <= 0 || (value.soldQuantity === 0 && (value.sellNotional !== 0 || value.sellFees !== 0)) ||
      (Number(value.soldQuantity) > 0 && Number(value.sellNotional) <= 0)) {
    throw new Error("Invalid persisted Paper position cycle.");
  }
}

/** Validate all additive evidence before any load-time pruning writes the file. */
export function validatePaperFillLedger(value: unknown): asserts value is PaperFillLedger {
  if (!record(value) || !Number.isSafeInteger(value.lastSequence) || Number(value.lastSequence) < 0 ||
      !Array.isArray(value.results) || value.results.length !== Math.min(PAPER_CYCLE_RESULT_LIMIT, Number(value.lastSequence))) {
    throw new Error("Invalid persisted Paper fill ledger.");
  }
  const closingIds = new Set<string>();
  for (let index = 0; index < value.results.length; index++) {
    const result: unknown = value.results[index];
    if (!record(result) || result.sequence !== Number(value.lastSequence) - value.results.length + index + 1 ||
        typeof result.symbol !== "string" || !/^\d{6}$/.test(result.symbol) ||
        !validId(result.closingOrderId) || !validDate(result.closedAt) || closingIds.has(result.closingOrderId)) {
      throw new Error("Invalid persisted Paper closed cycle.");
    }
    closingIds.add(result.closingOrderId);
    if (result.evidence === "missing-entry") {
      if (result.netPnl !== null || result.openingOrderId !== null || result.openedAt !== null) {
        throw new Error("Invalid persisted Paper missing-entry cycle.");
      }
    } else if (result.evidence === "complete") {
      validateOpenPaperCycle(result, 0);
      const netPnl = Number((Number(result.sellNotional) - Number(result.sellFees) - Number(result.buyNotional) - Number(result.buyFees)).toFixed(8));
      if (result.netPnl !== netPnl || String(result.openedAt) > result.closedAt) {
        throw new Error("Invalid persisted Paper cycle net PnL.");
      }
    } else {
      throw new Error("Invalid persisted Paper cycle evidence.");
    }
  }
}
