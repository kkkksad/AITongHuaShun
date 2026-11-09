export type PaperCandidatePoolTier = "observation" | "pending-confirmation" | "executable" | "holding" | "holding-exit";
export type PaperCandidateReasonSource = "symbol-plan" | "global-plan" | "scanner" | "unassessed";

export const PAPER_CANDIDATE_TIER_LABELS: Record<PaperCandidatePoolTier, string> = {
  observation: "观察区", "pending-confirmation": "待确认区", executable: "买入计划就绪",
  holding: "持仓区", "holding-exit": "待退出区",
};
export const PAPER_CANDIDATE_SOURCE_LABELS: Record<PaperCandidateReasonSource, string> = {
  "symbol-plan": "逐股计划", "global-plan": "全局计划限制", scanner: "扫描器", unassessed: "尚无逐股诊断",
};

export interface PaperCandidatePool {
  total: number;
  counts: Record<PaperCandidatePoolTier, number>;
  omitted: number;
  rows: Array<{
    symbol: string;
    name: string;
    tier: PaperCandidatePoolTier;
    reason: string;
    reasonSource: PaperCandidateReasonSource;
    nextCheck: string;
  }>;
}
