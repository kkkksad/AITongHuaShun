import type { AdaptiveStrategyRouting } from "../research/adaptiveStrategyRouter";
import {
  getChinaMinutes,
  isAshareTradingTime,
} from "./ashareTradingCalendar";

export type AShareTradingPhase =
  | "opening"
  | "morning-confirmation"
  | "afternoon-confirmation"
  | "closing-risk-review"
  | "closed";

export interface IntradayExecutionPolicy {
  phase: AShareTradingPhase;
  phaseLabel: string;
  maxInvestedRatio: number;
  source: "adaptive-routing" | "conservative-default";
}

const PHASE_LABELS: Record<AShareTradingPhase, string> = {
  opening: "开盘观察",
  "morning-confirmation": "上午确认",
  "afternoon-confirmation": "下午确认",
  "closing-risk-review": "尾盘风险复核",
  closed: "盘外手动复核",
};

const PHASE_ORDER_BUDGET_RATIO: Record<AShareTradingPhase, number> = {
  opening: 0.5,
  "morning-confirmation": 0.75,
  "afternoon-confirmation": 1,
  "closing-risk-review": 1,
  closed: 1,
};

export function getPhaseCumulativeOrderLimit(
  maxDailyOrders: number,
  phase: AShareTradingPhase,
): number {
  const boundedDailyOrders = Math.max(1, Math.floor(maxDailyOrders));
  return Math.min(
    boundedDailyOrders,
    Math.max(1, Math.ceil(boundedDailyOrders * PHASE_ORDER_BUDGET_RATIO[phase])),
  );
}

export function getAshareTradingPhase(value = new Date()): AShareTradingPhase {
  if (!isAshareTradingTime(value)) return "closed";
  const minutes = getChinaMinutes(value);
  if (minutes >= 9 * 60 + 30 && minutes < 10 * 60 + 15) return "opening";
  if (minutes >= 10 * 60 + 15 && minutes <= 11 * 60 + 30) {
    return "morning-confirmation";
  }
  if (minutes >= 13 * 60 && minutes < 14 * 60 + 15) {
    return "afternoon-confirmation";
  }
  if (minutes >= 14 * 60 + 15 && minutes <= 15 * 60) {
    return "closing-risk-review";
  }
  return "closed";
}

export function getIntradayExecutionPolicy(
  value: Date,
  routing: AdaptiveStrategyRouting | null,
): IntradayExecutionPolicy {
  const phase = getAshareTradingPhase(value);
  return {
    phase,
    phaseLabel: PHASE_LABELS[phase],
    // Keep the field for clients, but never recreate a cash floor from old
    // routing ratios. Fees, cash and broker risk limits govern affordability.
    maxInvestedRatio: 1,
    source: routing ? "adaptive-routing" : "conservative-default",
  };
}
