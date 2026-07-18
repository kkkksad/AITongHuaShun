import type {
  DailyMarketReview,
  PaperAutoExecutionSession,
  PaperAutoExecutionStatus,
  PaperTradingPlan,
} from "./tradingApi";

export type DailyTaskTone = "positive" | "neutral" | "warning" | "danger";
export type DailyTaskState = "done" | "current" | "pending" | "attention";

export interface DailyTaskCenterModel {
  phase: {
    key: PaperAutoExecutionSession | "unknown";
    label: string;
    detail: string;
  };
  tasks: Array<{
    id: "pre-market" | "intraday" | "review" | "exceptions";
    label: string;
    detail: string;
    state: DailyTaskState;
  }>;
  execution: {
    label: string;
    detail: string;
    tone: DailyTaskTone;
  };
  market: {
    label: string;
    detail: string;
    tone: DailyTaskTone;
    allowNewPositions: boolean | null;
  };
  plan: {
    label: string;
    detail: string;
    tone: DailyTaskTone;
    blockedReasons: string[];
  };
  account: {
    equity: number | null;
    cash: number | null;
    investedRatio: number | null;
    positionCount: number | null;
  };
  orders: {
    submitted: number | null;
    filled: number | null;
    rejected: number | null;
    commission: number | null;
    remaining: number | null;
  };
  review: {
    label: string;
    detail: string;
    tone: DailyTaskTone;
  };
  dataSources: {
    available: number;
    total: 3;
  };
  nextAction: string;
  updatedAt: string | null;
}

export interface DailyTaskCenterInput {
  plan?: PaperTradingPlan | null;
  review?: DailyMarketReview | null;
  execution?: PaperAutoExecutionStatus | null;
}

const phasePresentation: Record<PaperAutoExecutionSession, { label: string; detail: string }> = {
  "pre-market": {
    label: "盘前准备",
    detail: "核对行情源、资金、策略路由与当日 Paper 计划。",
  },
  open: {
    label: "盘中执行",
    detail: "只观察并执行通过本地风控的 Paper 计划。",
  },
  "lunch-break": {
    label: "午间休市",
    detail: "暂停提交订单，等待下午交易时段并复核上午状态。",
  },
  "after-hours": {
    label: "盘后复盘",
    detail: "核对成交、拒单、费用和策略纪律。",
  },
  weekend: {
    label: "非交易日",
    detail: "复核最近交易日，等待下一交易日前重新生成计划。",
  },
};

function taskStates(
  session: PaperAutoExecutionSession | undefined,
): [DailyTaskState, DailyTaskState, DailyTaskState] {
  if (session === "pre-market") return ["current", "pending", "pending"];
  if (session === "open" || session === "lunch-break") return ["done", "current", "pending"];
  if (session === "after-hours") return ["done", "done", "current"];
  if (session === "weekend") return ["pending", "done", "current"];
  return ["pending", "pending", "pending"];
}

function planPresentation(plan: PaperTradingPlan | null | undefined) {
  const quality = plan?.qualitySummary.planQuality;
  if (quality === "actionable") {
    return { label: "可执行计划", tone: "positive" as const };
  }
  if (quality === "watch-only") {
    return { label: "仅观察", tone: "warning" as const };
  }
  if (quality === "blocked") {
    return { label: "计划被拦截", tone: "danger" as const };
  }
  return { label: "等待计划", tone: "neutral" as const };
}

function marketPresentation(review: DailyMarketReview | null | undefined) {
  const tone = review?.market.tone;
  if (tone === "risk-on") return { label: "偏强可研究", tone: "positive" as const };
  if (tone === "balanced") return { label: "均衡观察", tone: "neutral" as const };
  if (tone === "risk-off") return { label: "风险偏弱", tone: "danger" as const };
  if (tone === "insufficient-data") return { label: "数据不足", tone: "warning" as const };
  return { label: "等待盘面", tone: "neutral" as const };
}

function executionPresentation(execution: PaperAutoExecutionStatus | null | undefined) {
  if (!execution) {
    return {
      label: "状态未知",
      detail: "尚未取得本地 Paper 自动执行器状态。",
      tone: "neutral" as const,
    };
  }
  if (!execution.enabled) {
    return {
      label: "未启用",
      detail: "自动执行关闭，仍可人工复核 Paper 计划。",
      tone: "warning" as const,
    };
  }
  if (execution.running) {
    return {
      label: "本轮运行中",
      detail: `今日已提交 ${execution.todaySubmittedOrders} 笔，阶段剩余 ${execution.phaseRemainingOrders} 笔。`,
      tone: "positive" as const,
    };
  }
  return {
    label: "已启用",
    detail: `今日已提交 ${execution.todaySubmittedOrders}/${execution.phaseDailyOrderLimit} 笔，阶段剩余 ${execution.phaseRemainingOrders} 笔。`,
    tone: "positive" as const,
  };
}

function reviewPresentation(review: DailyMarketReview | null | undefined) {
  const grade = review?.strategyReview.grade;
  if (grade === "disciplined") {
    return { label: "纪律正常", tone: "positive" as const };
  }
  if (grade === "watch") {
    return { label: "需要观察", tone: "warning" as const };
  }
  if (grade === "needs-improvement") {
    return { label: "需要改进", tone: "danger" as const };
  }
  return { label: "等待复盘", tone: "neutral" as const };
}

function blockedReasons(plan: PaperTradingPlan | null | undefined): string[] {
  return Object.entries(plan?.qualitySummary.blockedReasons ?? {})
    .sort(([leftReason, leftCount], [rightReason, rightCount]) =>
      rightCount - leftCount || leftReason.localeCompare(rightReason, "zh-CN"),
    )
    .slice(0, 3)
    .map(([reason, count]) => `${reason} ×${count}`);
}

function paperPlanSummary(plan: PaperTradingPlan | null | undefined): string {
  if (!plan) return "尚未取得当日 Paper 交易计划。";
  const quality = plan.qualitySummary;
  const buyCount = quality.actionCounts["paper-buy-plan"];
  const sellCount = quality.actionCounts["paper-sell-plan"];
  const blockedCount = quality.actionCounts.blocked;

  if (quality.planQuality === "blocked") {
    return `${blockedCount} 项计划被本地风控拦截，需要先处理主要原因。`;
  }
  if (quality.planQuality === "watch-only") {
    return `${quality.candidatePoolSize} 个候选当前仅观察，没有生成可提交的 Paper 订单。`;
  }
  if (buyCount + sellCount === 0) {
    return "计划已通过质量门槛，当前没有需要提交的 Paper 订单。";
  }
  if (buyCount === 0) {
    return `计划包含 ${sellCount} 笔模拟卖出，不新增 Paper 资金占用。`;
  }
  if (sellCount === 0) {
    return `计划包含 ${buyCount} 笔模拟买入，预计占用现金 ${Math.round(quality.plannedCashRequired).toLocaleString("zh-CN")} 元。`;
  }
  return `计划包含 ${buyCount} 笔模拟买入、${sellCount} 笔模拟卖出，预计占用现金 ${Math.round(quality.plannedCashRequired).toLocaleString("zh-CN")} 元。`;
}

function resolveNextAction(input: DailyTaskCenterInput): string {
  const { plan, review, execution } = input;
  const session = execution?.currentSession;

  if (session === "weekend") {
    return review?.strategyReview.nextActions[0]
      ?? "复核最近交易日的订单与策略记录，下一交易日前重新生成 Paper 计划。";
  }
  if (session === "after-hours") {
    return review?.strategyReview.nextActions[0]
      ?? "完成盘后订单复核，记录拒单与费用后再准备下一交易日计划。";
  }
  if (
    review?.market.tone === "risk-off"
    || plan?.adaptiveRouting?.allowNewPositions === false
    || plan?.qualitySummary.planQuality === "blocked"
  ) {
    return "暂停新增 Paper 仓位，优先检查风控拦截原因并继续观察盘面。";
  }
  if (session === "pre-market") {
    return "核对行情源、计划质量和资金余量，等待开盘后按风控规则观察。";
  }
  if (session === "lunch-break") {
    return "复核上午执行结果，午间不提交订单，等待下午交易时段。";
  }
  if (session === "open" && plan?.qualitySummary.planQuality === "actionable") {
    return execution?.enabled
      ? "继续观察候选与阶段额度，只提交通过本地风控的 Paper 订单。"
      : "自动执行器未启用，先人工复核计划与风险限制。";
  }
  if (plan?.qualitySummary.planQuality === "watch-only") {
    return "保持观察，不提交新的 Paper 买单，等待条件进一步确认。";
  }
  if (!plan && !review && !execution) {
    return "启动后端并刷新页面，取得计划、盘面复盘和 Paper 执行器状态。";
  }
  return "补齐缺失数据并复核当前 Paper 计划，不进行真实交易。";
}

export function buildDailyTaskCenterModel(input: DailyTaskCenterInput): DailyTaskCenterModel {
  const { plan, review, execution } = input;
  const phase = execution?.currentSession
    ? { key: execution.currentSession, ...phasePresentation[execution.currentSession] }
    : { key: "unknown" as const, label: "阶段未知", detail: "等待本地执行器返回交易时段。" };
  const stages = taskStates(execution?.currentSession);
  const planView = planPresentation(plan);
  const marketView = marketPresentation(review);
  const executionView = executionPresentation(execution);
  const reviewView = reviewPresentation(review);
  const planSummary = paperPlanSummary(plan);
  const availableSources = [plan, review, execution].filter(Boolean).length;
  const hasException = availableSources < 3
    || plan?.qualitySummary.planQuality === "blocked"
    || (review?.trades.rejected ?? 0) > 0
    || execution?.enabled === false;
  const account = review?.account ?? plan?.account;
  const equity = account?.equity ?? null;
  const marketValue = account?.marketValue ?? null;
  const investedRatio = equity && equity > 0 && marketValue !== null
    ? marketValue / equity
    : null;
  const timestamps = [plan?.generatedAt, review?.generatedAt, execution?.lastRunAt]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left));

  return {
    phase,
    tasks: [
      {
        id: "pre-market",
        label: "盘前检查",
        detail: plan ? `${plan.provider} · ${planSummary}` : "等待当日 Paper 计划。",
        state: stages[0],
      },
      {
        id: "intraday",
        label: "盘中观察",
        detail: review?.market.summary ?? "等待真实只读行情与市场宽度。",
        state: stages[1],
      },
      {
        id: "review",
        label: "盘后复盘",
        detail: review?.strategyReview.summary ?? "等待成交、拒单、费用和策略复盘。",
        state: stages[2],
      },
      {
        id: "exceptions",
        label: "异常处理",
        detail: hasException
          ? "存在缺失数据、拦截计划或拒单，需要复核。"
          : "接口、计划和订单状态未发现待处理项。",
        state: hasException ? "attention" : "done",
      },
    ],
    execution: executionView,
    market: {
      ...marketView,
      detail: review?.market.summary ?? "尚未取得每日盘面复盘。",
      allowNewPositions: plan?.adaptiveRouting?.allowNewPositions ?? null,
    },
    plan: {
      ...planView,
      detail: planSummary,
      blockedReasons: blockedReasons(plan),
    },
    account: {
      equity,
      cash: account?.cash ?? null,
      investedRatio,
      positionCount: review?.account.positionCount ?? null,
    },
    orders: {
      submitted: review?.trades.submitted ?? execution?.todaySubmittedOrders ?? null,
      filled: review?.trades.filled ?? null,
      rejected: review?.trades.rejected ?? null,
      commission: review?.trades.commission ?? null,
      remaining: execution?.phaseRemainingOrders ?? null,
    },
    review: {
      ...reviewView,
      detail: review?.strategyReview.summary ?? "尚未生成盘后策略复盘。",
    },
    dataSources: { available: availableSources, total: 3 },
    nextAction: resolveNextAction(input),
    updatedAt: timestamps[0] ?? null,
  };
}
