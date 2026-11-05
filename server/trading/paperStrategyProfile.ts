import type { PaperStrategyProfile } from "../../shared/trading";

export interface PaperStrategyProfilePolicy {
  key: PaperStrategyProfile;
  label: string;
  summary: string;
  /** Compatibility field; profiles no longer impose a fixed cash reserve. */
  cashReserveFloor: number;
  allowNewPositions: boolean;
  minDefensiveScore: number;
  maxNewPositionsPerPlan: number;
  newPositionScale: number;
}

export const PAPER_STRATEGY_PROFILE_POLICIES: Record<
  PaperStrategyProfile,
  PaperStrategyProfilePolicy
> = {
  "capital-preservation": {
    key: "capital-preservation",
    label: "现金防守",
    summary: "不新增仓位，只处理持仓风险并等待市场状态恢复。",
    cashReserveFloor: 0,
    allowNewPositions: false,
    minDefensiveScore: 100,
    maxNewPositionsPerPlan: 0,
    newPositionScale: 0,
  },
  defensive: {
    key: "defensive",
    label: "稳健",
    summary: "严格候选门槛，每轮最多新增一只，资金仍受单票和阶段风险限制。",
    cashReserveFloor: 0,
    allowNewPositions: true,
    minDefensiveScore: 72,
    maxNewPositionsPerPlan: 1,
    newPositionScale: 0.55,
  },
  balanced: {
    key: "balanced",
    label: "均衡",
    summary: "保持中等参与节奏，不固定预留现金比例，继续服从全部风险限制。",
    cashReserveFloor: 0,
    allowNewPositions: true,
    minDefensiveScore: 62,
    maxNewPositionsPerPlan: 2,
    newPositionScale: 0.85,
  },
  growth: {
    key: "growth",
    label: "进取",
    summary: "允许更高资金参与，但仍服从全部硬风控和市场路由。",
    cashReserveFloor: 0,
    allowNewPositions: true,
    minDefensiveScore: 55,
    maxNewPositionsPerPlan: 3,
    newPositionScale: 1,
  },
};

export function getPaperStrategyProfilePolicy(
  profile: PaperStrategyProfile | undefined,
): PaperStrategyProfilePolicy {
  return PAPER_STRATEGY_PROFILE_POLICIES[profile ?? "balanced"];
}
