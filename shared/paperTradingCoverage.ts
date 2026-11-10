/** Describes which candidate coverage semantics a Paper plan used. */
export type PaperTradingStrategyCoverageMode =
  | "adaptive-routing"
  | "manual-strategy"
  | "snapshot-fallback"
  | "none";

/** Diagnostics for the bounded entry pool; these counts grant no order permission. */
export interface PaperNewPositionFunnel {
  scope: "ranked-top-12";
  /** Unique watch/focus/buy scanner symbols before selecting the ranked pool. */
  scannerCandidateCount: number;
  consideredCandidateCount: number;
  existingPositionCount: number;
  newSymbolCount: number;
  /** Strategy eligibility, or explicitly labelled snapshot fallback eligibility. */
  eligibleNewSymbolCount: number;
  /** Each eligible new symbol sized independently against the initial plan budget. */
  individuallySizedNewSymbolCount: number;
  plannedBuyCount: number;
  /** Global profile/routing permission, separate from the per-symbol counts. */
  allowNewPositions: boolean;
}
