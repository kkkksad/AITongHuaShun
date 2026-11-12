import { PAPER_EXECUTION_STRATEGY_KEYS, type OrderRecord, type PaperManualExecutionStrategy } from "../../shared/trading";

export type PaperCycleEntryStrategyEvidence =
  | { status: "single"; strategyKey: PaperManualExecutionStrategy }
  | { status: "mixed" }
  | { status: "unknown" };

const entryStrategyKeys = new Set<string>(PAPER_EXECUTION_STRATEGY_KEYS);

function filledBuyStrategy(order: OrderRecord): PaperCycleEntryStrategyEvidence {
  return typeof order.strategyKey === "string" && entryStrategyKeys.has(order.strategyKey)
    ? { status: "single", strategyKey: order.strategyKey as PaperManualExecutionStrategy }
    : { status: "unknown" };
}

function addedBuyStrategy(
  previous: PaperCycleEntryStrategyEvidence | undefined, current: PaperCycleEntryStrategyEvidence,
): PaperCycleEntryStrategyEvidence {
  // A later known add cannot repair a missing earlier buy identity.
  if (!previous || previous.status === "unknown" || current.status === "unknown") return { status: "unknown" };
  if (previous.status === "mixed" || current.status === "mixed" || previous.strategyKey !== current.strategyKey) return { status: "mixed" };
  return { ...previous };
}

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
  /** Actual filled buy origins; legacy absence is unknown, not the current selection. */
  entryStrategyEvidence?: PaperCycleEntryStrategyEvidence;
  /** Coverage guard: older writers must not silently preserve stale single attribution after adding shares. */
  entryStrategyBoughtQuantity?: number;
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
  return { lastSequence: ledger.lastSequence, results: ledger.results.map((result) =>
    result.evidence === "complete" ? copyOpenPaperCycle(result) : { ...result }) };
}

export function copyOpenPaperCycle<T extends OpenPaperPositionCycle>(cycle: T): T {
  return { ...cycle, ...(cycle.entryStrategyEvidence === undefined ? {} : {
    entryStrategyEvidence: { ...cycle.entryStrategyEvidence },
  }) };
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
      buyNotional: cycle.buyNotional + notional, buyFees: cycle.buyFees + commission,
      entryStrategyBoughtQuantity: cycle.boughtQuantity + order.quantity,
      entryStrategyEvidence: previous
        ? addedBuyStrategy(previous.entryStrategyEvidence, filledBuyStrategy(order)) : filledBuyStrategy(order) } };
  }
  if (previousQuantity <= 0 || order.quantity > previousQuantity) return {};
  const cycle = previous && { ...copyOpenPaperCycle(previous), soldQuantity: previous.soldQuantity + order.quantity,
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
  const recorded = { ...result, sequence: ledger.lastSequence } as ClosedPaperPositionCycle;
  ledger.results.push(recorded.evidence === "complete" ? copyOpenPaperCycle(recorded) : { ...recorded });
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

function validEntryStrategyEvidence(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.status === "single") {
    return Object.keys(value).length === 2 && typeof value.strategyKey === "string" && entryStrategyKeys.has(value.strategyKey);
  }
  return (value.status === "unknown" || value.status === "mixed") && Object.keys(value).length === 1;
}

export function validateOpenPaperCycle(value: unknown, quantity: number): asserts value is OpenPaperPositionCycle {
  if (!record(value) || !validId(value.openingOrderId) || !validDate(value.openedAt) ||
      !Number.isSafeInteger(value.boughtQuantity) || Number(value.boughtQuantity) <= 0 ||
      !Number.isSafeInteger(value.soldQuantity) || Number(value.soldQuantity) < 0 ||
      Number(value.boughtQuantity) - Number(value.soldQuantity) !== quantity ||
      ![value.buyNotional, value.buyFees, value.sellNotional, value.sellFees].every(nonnegative) ||
      Number(value.buyNotional) <= 0 || (value.soldQuantity === 0 && (value.sellNotional !== 0 || value.sellFees !== 0)) ||
      (Number(value.soldQuantity) > 0 && Number(value.sellNotional) <= 0) ||
      ((value.entryStrategyEvidence !== undefined || value.entryStrategyBoughtQuantity !== undefined) &&
        (!validEntryStrategyEvidence(value.entryStrategyEvidence) || value.entryStrategyBoughtQuantity !== value.boughtQuantity))) {
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
      if (result.netPnl !== null || result.openingOrderId !== null || result.openedAt !== null ||
          result.entryStrategyEvidence !== undefined || result.entryStrategyBoughtQuantity !== undefined) {
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
