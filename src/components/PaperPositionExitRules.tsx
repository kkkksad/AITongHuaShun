import { PAPER_POSITION_EXIT_POLICY } from "../../shared/paperPositionExitPolicy";

export function PaperPositionExitRules({ averagePrice }: { averagePrice: number }) {
  const policy = PAPER_POSITION_EXIT_POLICY;
  const stopPrice = averagePrice * policy.stopPriceMultiplier;
  const validCost = Number.isFinite(averagePrice) && averagePrice > 0 &&
    Number.isFinite(stopPrice) && stopPrice > 0;

  return (
    <details className="paper-position-exit-rules">
      <summary>退出规则</summary>
      <div>
        <p>
          共用成本止损参考价：{validCost
            ? <strong data-cost-stop-price>¥{stopPrice.toFixed(4)}</strong>
            : "成本无效，参考价未知"}。
          当前标价 ≤ 实际持仓均价 × {policy.stopPriceMultiplier * 100}% 时生成退出计划（不含费用）。
          参考价显示到四位小数，实际判断使用完整精度。
        </p>
        <p>
          市场要求减仓且个股趋势恶化的判定置信度 ≥ {policy.trendDeteriorationConfidence * 100}% 时，
          通常减仓 {policy.ordinaryReductionFraction * 100}%；这不是收益概率。
          普通减仓同股每日一次，硬止损优先；一手小仓可能全部卖出。
          风险仓位超过配置目标时还可能分阶段减仓。
        </p>
        <p>入场标签不代表专属退出规则：固定止盈、跟踪止盈和超时退出尚未接入。</p>
        <p>
          这是 Paper 自动计划的规则说明，不表示当前已触发或保证成交。
          执行仍取决于运行开关、有效报价和风控，并受 T+1、可卖数量与整手约束；实际净亏损可能超过止损比例。
        </p>
      </div>
    </details>
  );
}
