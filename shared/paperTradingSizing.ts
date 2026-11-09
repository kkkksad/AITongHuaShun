export type PaperTradingPlanSizingConstraint =
  | "risk-order-cap"
  | "strategy-profile-scale"
  | "position-weight-cap"
  | "planned-cash-budget"
  | "none";

/** Static market-fill estimate; reference quotation amounts are kept separately. */
export interface PaperBuyExecutionProjection {
  fillPrice: number;
  notional: number;
  commission: number;
  cashRequired: number;
  equityAfterFill: number;
}

export interface PaperTradingPlanSizingDiagnostics {
  /** The profile ratio before any automatic market routing is applied. */
  profileNewPositionScale?: number;
  riskOrderCapBeforeScale: number;
  riskOrderCapAfterScale: number;
  positionWeightCapAfterScale: number;
  cashReserveAmount: number;
  plannedCashBudget: number;
  effectiveOrderCap: number;
  minimumFeeEfficientNotional: number;
  plannedBuyOrderCount: number;
  plannedBuyNotional: number;
  averagePlannedBuyNotional: number;
  largestPlannedBuyNotional: number;
  /** Legacy scale code covers both profile and market routing reductions. */
  limitingConstraint: PaperTradingPlanSizingConstraint;
  limitingConstraintLabel?: string;
  summary: string;
}
