import { z } from "zod";
import type { PaperNewPositionFunnel } from "../../shared/paperTradingCoverage";

const count = z.number().int().min(0).max(12);
const coverageSchema = z.object({
  newPositionFunnel: z.object({
    scope: z.literal("ranked-top-12"),
    scannerCandidateCount: z.number().int().min(0).max(1_000_000),
    consideredCandidateCount: count,
    existingPositionCount: count,
    newSymbolCount: count,
    eligibleNewSymbolCount: count,
    individuallySizedNewSymbolCount: count,
    plannedBuyCount: count,
    allowNewPositions: z.boolean(),
  }).refine(value =>
    value.existingPositionCount + value.newSymbolCount === value.consideredCandidateCount &&
    value.consideredCandidateCount <= value.scannerCandidateCount &&
    value.eligibleNewSymbolCount <= value.newSymbolCount &&
    value.individuallySizedNewSymbolCount <= value.eligibleNewSymbolCount &&
    value.plannedBuyCount <= value.newSymbolCount),
});

/** Only validated, whitelisted diagnostics may enter daily evidence. */
export function parseDailyEntryFunnel(coverage: unknown): PaperNewPositionFunnel | null {
  const parsed = coverageSchema.safeParse(coverage);
  return parsed.success ? parsed.data.newPositionFunnel : null;
}

/** Describe one run's bounded funnel without inferring account-wide permission. */
export function describeDailyEntryFunnel(coverage: unknown): string[] {
  const value = parseDailyEntryFunnel(coverage);
  if (!value) return [];
  const reasons = [
    `最新有效盘中运行的前12候选池：新标的 ${value.newSymbolCount} 个，策略资格 ${value.eligibleNewSymbolCount} 个，初始预算下独立可成整手 ${value.individuallySizedNewSymbolCount} 个，最终拟买 ${value.plannedBuyCount} 个。`,
  ];
  if (!value.allowNewPositions) {
    reasons.push("本轮全局新增许可关闭；逐股资格和金额计数不构成下单许可。");
  } else if (value.newSymbolCount === 0) {
    reasons.push("本轮前12候选池没有新标的，不能据此推断全市场没有机会。");
  } else if (value.eligibleNewSymbolCount === 0) {
    reasons.push("本轮新标的没有通过逐股策略资格；持仓命中不代表新股可买。");
  } else if (value.individuallySizedNewSymbolCount === 0) {
    reasons.push("本轮有新标的通过策略资格，但在初始预算与额度下未形成可买整手；不能仅凭这一步认定账户现金不足。");
  } else if (value.plannedBuyCount === 0) {
    reasons.push("本轮存在独立金额覆盖的新标的，但最终没有形成买单；具体费用、累计预算或其他准入原因需查看逐股证据。");
  } else {
    reasons.push("本轮已形成拟买计划；拟买数量不代表实际提交或成交。");
  }
  return reasons;
}
