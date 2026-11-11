import type { PaperAutoExecutionSkip } from "./paperAutoExecutor";

/** Bounded audit sample, never used for execution or complete-run decisions. */
export function selectPaperSkipEvidence(operations: readonly PaperAutoExecutionSkip[]) {
  const priority = (operation: PaperAutoExecutionSkip) => operation.action === "hold" ? 2 : operation.action === "observe" ? 1 : 0;
  const ordered = [...operations].sort((a, b) => priority(a) - priority(b));
  const selected: PaperAutoExecutionSkip[] = [];
  for (const level of [0, 1, 2]) {
    const rows = ordered.filter(row => priority(row) === level);
    const reasons = new Set<string>();
    const first: PaperAutoExecutionSkip[] = [], repeated: PaperAutoExecutionSkip[] = [];
    for (const row of rows) {
      const key = JSON.stringify([row.action, row.reason]);
      (reasons.has(key) ? repeated : first).push(row);
      reasons.add(key);
    }
    selected.push(...first, ...repeated);
  }
  const reasons = selected.slice(0, 8).map(operation => ({
    symbol: operation.symbol, action: operation.action, reason: operation.reason,
    strategy: operation.strategy, strategyKey: operation.strategyKey,
    quantity: operation.quantity, price: operation.price, estimatedNotional: operation.estimatedNotional,
  }));
  return { total: operations.length, omitted: operations.length - reasons.length, reasons };
}
