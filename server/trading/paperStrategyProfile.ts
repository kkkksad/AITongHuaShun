import type { PaperStrategyProfile } from "../../shared/trading";

export interface PaperStrategyProfilePolicy {
  key: PaperStrategyProfile;
  label: string;
  summary: string;
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
    cashReserveFloor: 0.8,
    allowNewPositions: false,
    minDefensiveScore: 100,
    maxNewPositionsPerPlan: 0,
    newPositionScale: 0,
  },
  defensive: {
    key: "defensive",
    label: "稳健",
    summary: "高现金缓冲、严格候选门槛，每轮最多新增一只。",
    cashReserveFloor: 0.55,
    allowNewPositions: true,
    minDefensiveScore: 72,
    maxNewPositionsPerPlan: 1,
    newPositionScale: 0.55,
  },
  balanced: {
    key: "balanced",
    label: "均衡",
    summary: "在现金防守和机会参与之间保持中等节奏。",
    cashReserveFloor: 0.5,
    allowNewPositions: true,
    minDefensiveScore: 62,
    maxNewPositionsPerPlan: 2,
    newPositionScale: 0.85,
  },
  growth: {
    key: "growth",
    label: "进取",
    summary: "允许更高资金参与，但仍服从全部硬风控和市场路由。",
    cashReserveFloor: 0.2,
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
