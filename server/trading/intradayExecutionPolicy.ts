import type {
  AdaptiveCapitalPacing,
  AdaptiveStrategyRouting,
} from "../research/adaptiveStrategyRouter";

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

const CHINA_TZ_OFFSET_MINUTES = 8 * 60;

const DEFAULT_PACING: AdaptiveCapitalPacing = {
  openingMaxInvestedRatio: 0.45,
  morningMaxInvestedRatio: 0.6,
  afternoonMaxInvestedRatio: 0.75,
  closingMaxInvestedRatio: 0.85,
};

const PHASE_LABELS: Record<AShareTradingPhase, string> = {
  opening: "开盘观察",
  "morning-confirmation": "上午确认",
  "afternoon-confirmation": "下午确认",
  "closing-risk-review": "尾盘风险复核",
  closed: "盘外手动复核",
};

function chinaParts(value: Date) {
  const shifted = new Date(value.getTime() + CHINA_TZ_OFFSET_MINUTES * 60_000);
  return {
    day: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export function getAshareTradingPhase(value = new Date()): AShareTradingPhase {
  const { day, minutes } = chinaParts(value);
  if (day === 0 || day === 6) return "closed";
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

function maxInvestedRatio(
  phase: AShareTradingPhase,
  pacing: AdaptiveCapitalPacing,
): number {
  switch (phase) {
    case "opening":
      return pacing.openingMaxInvestedRatio;
    case "morning-confirmation":
      return pacing.morningMaxInvestedRatio;
    case "afternoon-confirmation":
      return pacing.afternoonMaxInvestedRatio;
    case "closing-risk-review":
    case "closed":
      return pacing.closingMaxInvestedRatio;
  }
}

export function getIntradayExecutionPolicy(
  value: Date,
  routing: AdaptiveStrategyRouting | null,
): IntradayExecutionPolicy {
  const phase = getAshareTradingPhase(value);
  const pacing = routing?.capitalPacing ?? DEFAULT_PACING;
  return {
    phase,
    phaseLabel: PHASE_LABELS[phase],
    maxInvestedRatio: maxInvestedRatio(phase, pacing),
    source: routing ? "adaptive-routing" : "conservative-default",
  };
}
