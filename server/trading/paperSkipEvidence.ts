import type { PaperAutoExecutionSkip } from "./paperAutoExecutor";
import type { PaperTradingOperation } from "../research/paperTradingPlan";

export type PaperSkipBlockerStage = "execution" | "entry-discipline" | "order-sizing" |
  "new-position-permission" | "strategy-signal";

/** Fixed internal categories only; never persist arbitrary rule text. */
export function derivePaperSkipBlockerStage(operation: Pick<PaperTradingOperation, "action" | "ruleChecks">): PaperSkipBlockerStage | undefined {
  if (operation.action === "paper-buy-plan" || operation.action === "paper-sell-plan") return "execution";
  if (operation.action !== "blocked" && operation.action !== "observe") return undefined;
  const rules = operation.ruleChecks;
  if (operation.action === "blocked" && rules.some(rule =>
    /^(?:round-trip-fee-ratio|entry-persistence|same-day-reentry|defensive-score): blocked(?:$|[ (])/.test(rule))) {
    return "entry-discipline";
  }
  if (rules.some(rule => /^(?:plan-sizing|lot-size|cash-check|cash-reservation): blocked(?:$|[ (])/.test(rule) ||
    rule === "plan-sizing-constrained" || rule === "cash-constrained")) return "order-sizing";
  if (rules.some(rule => /^(?:strategy-profile|adaptive-new-position): blocked(?:$|[ (])/.test(rule))) {
    return "new-position-permission";
  }
  if (operation.action === "blocked" && rules.includes("strategy-route: blocked (no-qualified-signal)")) {
    return "strategy-signal";
  }
  return undefined;
}

function validStage(row: PaperAutoExecutionSkip): PaperSkipBlockerStage | undefined {
  if (row.blockerStage === "execution" && (row.action === "paper-buy-plan" || row.action === "paper-sell-plan")) return row.blockerStage;
  if ((row.blockerStage === "entry-discipline" || row.blockerStage === "strategy-signal") && row.action === "blocked") return row.blockerStage;
  if ((row.blockerStage === "order-sizing" || row.blockerStage === "new-position-permission") &&
    (row.action === "blocked" || row.action === "observe")) return row.blockerStage;
  return undefined;
}

/** Bounded audit sample, never used for execution or complete-run decisions. */
export function selectPaperSkipEvidence(operations: readonly PaperAutoExecutionSkip[]) {
  const priority = (operation: PaperAutoExecutionSkip) => {
    const stage = validStage(operation);
    if (stage === "execution") return 0;
    if (stage === "entry-discipline" || stage === "order-sizing" || stage === "new-position-permission") return 1;
    return operation.action === "hold" ? 4 : operation.action === "observe" ? 3 : 2;
  };
  const ordered = [...operations].sort((a, b) => priority(a) - priority(b));
  const selected: PaperAutoExecutionSkip[] = [];
  for (const level of [0, 1, 2, 3, 4]) {
    const rows = ordered.filter(row => priority(row) === level);
    const reasons = new Set<string>();
    const first: PaperAutoExecutionSkip[] = [], repeated: PaperAutoExecutionSkip[] = [];
    for (const row of rows) {
      const key = JSON.stringify([validStage(row), row.action, row.reason]);
      (reasons.has(key) ? repeated : first).push(row);
      reasons.add(key);
    }
    selected.push(...first, ...repeated);
  }
  const reasons = selected.slice(0, 8).map(operation => ({
    symbol: operation.symbol, action: operation.action, reason: operation.reason,
    strategy: operation.strategy, strategyKey: operation.strategyKey,
    quantity: operation.quantity, price: operation.price, estimatedNotional: operation.estimatedNotional,
    ...(validStage(operation) ? { blockerStage: validStage(operation) } : {}),
  }));
  return { total: operations.length, omitted: operations.length - reasons.length, reasons };
}
