import type {
  AccountSnapshot,
  AuditEvent,
  OrderRecord,
  PositionSnapshot,
} from "../../shared/trading";

export type WeeklyPaperReviewEvidence =
  | "sufficient"
  | "limited"
  | "unavailable";

export type WeeklyPaperReviewWindow = "current" | "previous";

export type WeeklyPaperHistoryCoverage =
  | "within-retention"
  | "may-be-pruned"
  | "unknown";

export type WeeklyPaperBlockerCode =
  | "cash"
  | "risk"
  | "t1"
  | "phase-budget"
  | "strategy"
  | "history"
  | "lot-size"
  | "data"
  | "other";

export interface WeeklyPaperReview {
  generatedAt: string;
  period: {
    window: WeeklyPaperReviewWindow;
    startDate: string;
    endDate: string;
    tradingDays: string[];
    orderDays: string[];
  };
  sample: {
    evidence: WeeklyPaperReviewEvidence;
    orderCount: number;
    filledOrderCount: number;
    rejectedOrderCount: number;
    cancelledOrderCount: number;
    pendingOrderCount: number;
    automaticRunCount: number;
    activeDays: number;
    daysWithFills: number;
    planSnapshotDays: number;
    historyCoverage: {
      retentionDays: number | null;
      periodEndAgeDays: number;
      status: WeeklyPaperHistoryCoverage;
      summary: string;
    };
  };
  capital: {
    initialCapital: number;
    currentEquity: number;
    currentCash: number;
    currentMarketValue: number;
    currentDeployedRatio: number;
    currentCashRatio: number;
    grossBuyNotional: number;
    grossSellNotional: number;
    netBuyNotional: number;
    grossTurnover: number;
    buyCapitalRatio: number;
    averageFilledOrderNotional: number;
    averageOrderCapitalRatio: number;
    plannedBuyNotional: number;
    plannedSellNotional: number;
    plannedBuyCapitalRatio: number;
    automaticFilledBuyNotional: number;
    planRealizationRatio: number | null;
    maxDailyPlannedBuyNotional: number;
    maxSingleOrderNotional: number;
    maxOrderCapitalRatio: number;
    sizingConstraint:
      | "configured-cap"
      | "cash-or-reserve"
      | "phase-budget"
      | "lot-size"
      | "strategy-or-signal"
      | "sample-or-signal"
      | "not-observed";
    maxDailyBuyNotional: number;
    utilization: "low" | "small-ticket" | "balanced" | "high";
    summary: string;
  };
  performance: {
    evidence: "closed-fills-only" | "no-closed-trades";
    closedTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number | null;
    realizedPnl: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number | null;
    averageWin: number | null;
    averageLoss: number | null;
    commission: number;
    summary: string;
  };
  strategyBreakdown: Array<{
    strategyKey: string;
    strategyName: string;
    filledOrders: number;
    buyOrders: number;
    sellOrders: number;
    filledNotional: number;
    commission: number;
    closedTrades: number;
    winningTrades: number;
    winRate: number | null;
    realizedPnl: number;
  }>;
  daily: Array<{
    date: string;
    submitted: number;
    filled: number;
    rejected: number;
    buyNotional: number;
    sellNotional: number;
    plannedBuyNotional: number;
    plannedSellNotional: number;
    automaticFilledBuyNotional: number;
    planRealizationRatio: number | null;
    commission: number;
    averageFilledOrderNotional: number;
  }>;
  blockers: Array<{
    code: WeeklyPaperBlockerCode;
    label: string;
    count: number;
    examples: string[];
    estimatedNotional: number;
  }>;
  diagnosis: {
    grade: "needs-improvement" | "watch" | "insufficient-sample" | "disciplined";
    findings: string[];
    nextActions: string[];
    summary: string;
  };
  guardrails: string[];
}

interface WeeklyPaperReviewInput {
  now?: Date;
  period?: WeeklyPaperReviewWindow;
  initialCapital: number;
  maxSingleOrderNotional?: number;
  historyRetentionDays?: number;
  account: Pick<AccountSnapshot, "equity" | "cash" | "marketValue">;
  positions?: PositionSnapshot[];
  orders: OrderRecord[];
  auditEvents: AuditEvent[];
  maxDailyAutoOrders?: number;
}

interface DecisionContext {
  strategyKey: string | null;
  strategyName: string | null;
}

interface OpenLot {
  quantity: number;
  unitPrice: number;
  feePerShare: number;
  decision: DecisionContext;
}

interface ClosedTrade {
  strategy: DecisionContext;
  pnl: number;
  date: string;
}

interface DailyPlanSnapshot {
  timestamp: string;
  buyNotional: number;
  sellNotional: number;
}

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const BLOCKER_LABELS: Record<WeeklyPaperBlockerCode, string> = {
  cash: "现金/现金缓冲",
  risk: "风险检查或熔断",
  t1: "T+1 卖出限制",
  "phase-budget": "阶段订单额度",
  strategy: "策略或候选门槛",
  history: "历史数据确认",
  "lot-size": "一手/金额不足",
  data: "行情或研究数据",
  other: "其他阻塞",
};

function chinaDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Date(date.getTime() + CHINA_OFFSET_MS).toISOString().slice(0, 10);
}

function dateFromParts(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  const result = dateFromParts(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function resolveWeekStart(endDate: string): string {
  const date = dateFromParts(endDate);
  const day = date.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  return addDays(endDate, -daysSinceMonday);
}

function resolveWeekWindow(
  endDate: string,
  window: WeeklyPaperReviewWindow,
): { startDate: string; endDate: string } {
  const currentWeekStart = resolveWeekStart(endDate);
  if (window === "previous") {
    return {
      startDate: addDays(currentWeekStart, -7),
      endDate: addDays(currentWeekStart, -3),
    };
  }
  return { startDate: currentWeekStart, endDate };
}

function listWeekdays(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const day = dateFromParts(date).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(date);
  }
  return dates;
}

function resolveHistoryCoverage(
  now: Date,
  periodEndDate: string,
  configuredRetentionDays?: number,
): WeeklyPaperReview["sample"]["historyCoverage"] {
  const periodEnd = dateFromParts(periodEndDate).getTime();
  const periodEndAgeDays = Math.max(
    0,
    Math.floor((now.getTime() - periodEnd) / DAY_MS),
  );
  const retentionDays = Number.isFinite(configuredRetentionDays) &&
    (configuredRetentionDays ?? 0) > 0
    ? Math.floor(configuredRetentionDays as number)
    : null;

  if (retentionDays === null) {
    return {
      retentionDays,
      periodEndAgeDays,
      status: "unknown",
      summary: "未提供交易历史留存配置，空记录不能区分零交易和历史已清理。",
    };
  }

  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const status: WeeklyPaperHistoryCoverage = periodEnd < cutoff
    ? "may-be-pruned"
    : "within-retention";
  return {
    retentionDays,
    periodEndAgeDays,
    status,
    summary: status === "may-be-pruned"
      ? `复盘周期末距现在约 ${periodEndAgeDays} 天，超过当前 ${retentionDays} 天留存窗口，部分历史可能已被清理。`
      : `复盘周期末距现在约 ${periodEndAgeDays} 天，处于当前 ${retentionDays} 天留存窗口内。`,
  };
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function filledQuantity(order: OrderRecord): number {
  return Math.max(0, order.filledQuantity || order.quantity || 0);
}

function filledPrice(order: OrderRecord): number {
  return Math.max(0, order.filledPrice ?? order.requestedPrice ?? 0);
}

function filledNotional(order: OrderRecord): number {
  const quantity = filledQuantity(order);
  return Math.max(0, order.notional || quantity * filledPrice(order));
}

function estimatedOrderNotional(order: OrderRecord): number {
  if (order.status === "filled") return filledNotional(order);
  const quantity = Math.max(0, order.quantity || 0);
  const price = Math.max(0, order.requestedPrice ?? order.filledPrice ?? 0);
  return quantity * price;
}

function isInPeriod(order: OrderRecord, startDate: string, endDate: string): boolean {
  const date = chinaDate(order.createdAt);
  return date >= startDate && date <= endDate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function planSnapshotFromAudit(
  audit: AuditEvent,
): DailyPlanSnapshot | null {
  if (!audit.data) return null;
  const snapshot = audit.data.planSnapshot;
  if (isRecord(snapshot)) {
    const buyNotional = nonNegativeNumber(snapshot.buyNotional);
    const sellNotional = nonNegativeNumber(snapshot.sellNotional);
    if (buyNotional !== null && sellNotional !== null) {
      return { timestamp: audit.timestamp, buyNotional, sellNotional };
    }
  }

  // Older run audits have no full plan snapshot; submitted estimates still
  // provide a lower-bound compatibility signal without inventing skipped work.
  const submitted = audit.data.submittedOrderStatuses;
  if (!Array.isArray(submitted)) return null;
  let buyNotional = 0;
  let sellNotional = 0;
  let foundEstimate = false;
  for (const item of submitted) {
    if (!isRecord(item)) continue;
    const estimate = nonNegativeNumber(item.estimatedNotional);
    if (estimate === null) continue;
    foundEstimate = true;
    if (item.side === "buy") buyNotional += estimate;
    if (item.side === "sell") sellNotional += estimate;
  }
  return foundEstimate
    ? { timestamp: audit.timestamp, buyNotional, sellNotional }
    : null;
}

function buildDailyPlanSnapshots(
  audits: AuditEvent[],
  startDate: string,
  endDate: string,
): Map<string, DailyPlanSnapshot> {
  const snapshots = new Map<string, DailyPlanSnapshot>();
  for (const audit of audits) {
    if (audit.action !== "paper-auto-execution.run") continue;
    const date = chinaDate(audit.timestamp);
    if (date < startDate || date > endDate) continue;
    const snapshot = planSnapshotFromAudit(audit);
    if (!snapshot) continue;
    const previous = snapshots.get(date);
    if (
      !previous ||
      snapshot.buyNotional > previous.buyNotional ||
      snapshot.buyNotional === previous.buyNotional &&
        snapshot.sellNotional > previous.sellNotional ||
      snapshot.buyNotional === previous.buyNotional &&
        snapshot.sellNotional === previous.sellNotional &&
        snapshot.timestamp > previous.timestamp
    ) {
      snapshots.set(date, snapshot);
    }
  }
  return snapshots;
}

function isAutomaticOrder(order: OrderRecord): boolean {
  return order.clientOrderId?.startsWith("kairos-auto-paper:") === true;
}

function decisionContextFromAudit(audit: AuditEvent | undefined): DecisionContext {
  const data = audit?.data;
  const explicitKey = data?.strategyKey;
  const explicitName = data?.strategy;
  let strategyKey = typeof explicitKey === "string" && explicitKey.length > 0
    ? explicitKey
    : null;
  if (!strategyKey && Array.isArray(data?.ruleChecks)) {
    for (const rule of data.ruleChecks) {
      if (typeof rule !== "string") continue;
      const match = /^strategy-route: pass \(([^)]+)\)$/.exec(rule);
      if (match?.[1]) {
        strategyKey = match[1];
        break;
      }
    }
  }
  return {
    strategyKey,
    strategyName: typeof explicitName === "string" && explicitName.length > 0
      ? explicitName
      : null,
  };
}

function buildDecisionMap(audits: AuditEvent[]): Map<string, DecisionContext> {
  const decisions = new Map<string, DecisionContext>();
  for (const audit of audits) {
    if (audit.action !== "paper-auto-execution.decision") continue;
    const data = audit.data;
    if (!data) continue;
    const context = decisionContextFromAudit(audit);
    for (const key of [data.orderId, data.clientOrderId]) {
      if (typeof key === "string" && key.length > 0) decisions.set(key, context);
    }
  }
  return decisions;
}

function decisionForOrder(
  order: OrderRecord,
  decisions: Map<string, DecisionContext>,
): DecisionContext {
  return decisions.get(order.id) ??
    (order.clientOrderId ? decisions.get(order.clientOrderId) : undefined) ?? {
      strategyKey: null,
      strategyName: null,
    };
}

function blockerCode(reason: string): WeeklyPaperBlockerCode {
  const value = reason.toLowerCase();
  if (value.includes("现金") || value.includes("资金") || value.includes("cash")) return "cash";
  if (value.includes("t+1") || value.includes("可卖") || value.includes("当日卖")) return "t1";
  if (value.includes("熔断") || value.includes("风控") || value.includes("风险") || value.includes("risk")) return "risk";
  if (value.includes("阶段") || value.includes("额度") || value.includes("phase") || value.includes("cap")) return "phase-budget";
  if (value.includes("策略") || value.includes("候选") || value.includes("signal") || value.includes("strategy")) return "strategy";
  if (value.includes("历史") || value.includes("持续性") || value.includes("history")) return "history";
  if (value.includes("一手") || value.includes("整手") || value.includes("lot") || value.includes("金额不足")) return "lot-size";
  if (value.includes("行情") || value.includes("数据") || value.includes("data") || value.includes("timeout")) return "data";
  return "other";
}

function addBlocker(
  blockers: Map<WeeklyPaperBlockerCode, {
    count: number;
    examples: string[];
    estimatedNotional: number;
  }>,
  reason: string,
  estimatedNotional = 0,
): void {
  const cleanReason = reason.trim().slice(0, 240);
  if (!cleanReason) return;
  const code = blockerCode(cleanReason);
  const current = blockers.get(code) ?? {
    count: 0,
    examples: [],
    estimatedNotional: 0,
  };
  current.count += 1;
  current.estimatedNotional += Math.max(0, estimatedNotional);
  if (!current.examples.includes(cleanReason) && current.examples.length < 3) {
    current.examples.push(cleanReason);
  }
  blockers.set(code, current);
}

function buildClosedTrades(
  allOrders: OrderRecord[],
  startDate: string,
  endDate: string,
  decisions: Map<string, DecisionContext>,
): ClosedTrade[] {
  const lotsBySymbol = new Map<string, OpenLot[]>();
  const closed: ClosedTrade[] = [];
  const sorted = [...allOrders]
    .filter((order) => order.status === "filled" && filledQuantity(order) > 0)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (const order of sorted) {
    const quantity = filledQuantity(order);
    const price = filledPrice(order);
    if (price <= 0) continue;
    const orderFee = Math.max(0, order.commission || 0);
    if (order.side === "buy") {
      const lots = lotsBySymbol.get(order.symbol) ?? [];
      lots.push({
        quantity,
        unitPrice: price,
        feePerShare: orderFee / quantity,
        decision: decisionForOrder(order, decisions),
      });
      lotsBySymbol.set(order.symbol, lots);
      continue;
    }

    let remaining = quantity;
    const lots = lotsBySymbol.get(order.symbol) ?? [];
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matchedQuantity = Math.min(remaining, lot.quantity);
      const sellFee = orderFee * matchedQuantity / quantity;
      const pnl = (price - lot.unitPrice) * matchedQuantity -
        lot.feePerShare * matchedQuantity - sellFee;
      const date = chinaDate(order.createdAt);
      if (date >= startDate && date <= endDate) {
        closed.push({ strategy: lot.decision, pnl, date });
      }
      remaining -= matchedQuantity;
      lot.quantity -= matchedQuantity;
      if (lot.quantity <= 0) lots.shift();
    }
    if (lots.length === 0) lotsBySymbol.delete(order.symbol);
  }

  return closed;
}

function strategyMapKey(context: DecisionContext): string {
  return context.strategyKey ?? "unknown";
}

function strategyName(context: DecisionContext): string {
  return context.strategyName ?? (context.strategyKey ? context.strategyKey : "未记录策略");
}

export function buildWeeklyPaperReview(input: WeeklyPaperReviewInput): WeeklyPaperReview {
  const now = input.now ?? new Date();
  const window = input.period ?? "current";
  const resolvedWindow = resolveWeekWindow(chinaDate(now), window);
  const { startDate, endDate } = resolvedWindow;
  const periodLabel = window === "previous" ? "上周" : "本周";
  const tradingDays = listWeekdays(startDate, endDate);
  const historyCoverage = resolveHistoryCoverage(
    now,
    endDate,
    input.historyRetentionDays,
  );
  const periodOrders = input.orders
    .filter((order) => isInPeriod(order, startDate, endDate))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const decisions = buildDecisionMap(input.auditEvents);
  const periodAudits = input.auditEvents.filter((audit) => {
    const date = chinaDate(audit.timestamp);
    return date >= startDate && date <= endDate;
  });
  const automaticRunCount = periodAudits.filter(
    (audit) => audit.action === "paper-auto-execution.run",
  ).length;
  const dailyPlanSnapshots = buildDailyPlanSnapshots(
    periodAudits,
    startDate,
    endDate,
  );
  const planSnapshotDays = dailyPlanSnapshots.size;
  const plannedBuyNotional = [...dailyPlanSnapshots.values()]
    .reduce((sum, snapshot) => sum + snapshot.buyNotional, 0);
  const plannedSellNotional = [...dailyPlanSnapshots.values()]
    .reduce((sum, snapshot) => sum + snapshot.sellNotional, 0);
  const maxDailyPlannedBuyNotional = Math.max(
    0,
    ...[...dailyPlanSnapshots.values()].map((snapshot) => snapshot.buyNotional),
  );

  const filled = periodOrders.filter((order) => order.status === "filled");
  const rejected = periodOrders.filter((order) => order.status === "rejected");
  const cancelled = periodOrders.filter((order) => order.status === "cancelled");
  const pending = periodOrders.filter((order) => order.status === "pending" || order.status === "accepted");
  const filledBuys = filled.filter((order) => order.side === "buy");
  const filledSells = filled.filter((order) => order.side === "sell");
  const grossBuyNotional = filledBuys.reduce((sum, order) => sum + filledNotional(order), 0);
  const grossSellNotional = filledSells.reduce((sum, order) => sum + filledNotional(order), 0);
  const grossTurnover = grossBuyNotional + grossSellNotional;
  const automaticFilledBuyNotional = filledBuys
    .filter(isAutomaticOrder)
    .reduce((sum, order) => sum + filledNotional(order), 0);
  const initialCapital = Math.max(0, input.initialCapital);
  const averageFilledOrderNotional = filled.length > 0 ? grossTurnover / filled.length : 0;
  const currentDeployedRatio = input.account.equity > 0
    ? input.account.marketValue / input.account.equity
    : 0;
  const currentCashRatio = input.account.equity > 0
    ? input.account.cash / input.account.equity
    : 0;
  const buyCapitalRatio = initialCapital > 0 ? grossBuyNotional / initialCapital : 0;
  const averageOrderCapitalRatio = initialCapital > 0
    ? averageFilledOrderNotional / initialCapital
    : 0;
  const plannedBuyCapitalRatio = initialCapital > 0
    ? plannedBuyNotional / initialCapital
    : 0;
  const planRealizationRatio = plannedBuyNotional > 0
    ? automaticFilledBuyNotional / plannedBuyNotional
    : null;
  const maxSingleOrderNotional = Math.max(0, input.maxSingleOrderNotional ?? 0);
  const maxOrderCapitalRatio = initialCapital > 0
    ? maxSingleOrderNotional / initialCapital
    : 0;
  const blockerCodes = new Set<WeeklyPaperBlockerCode>();
  for (const order of periodOrders) {
    if (order.status === "rejected") {
      blockerCodes.add(blockerCode(order.rejectionReason ?? ""));
    }
  }
  for (const audit of periodAudits) {
    if (audit.action !== "paper-auto-execution.run") continue;
    const skippedReasons = audit.data?.skippedReasons;
    if (!Array.isArray(skippedReasons)) continue;
    for (const item of skippedReasons) {
      if (isRecord(item) && typeof item.reason === "string") {
        blockerCodes.add(blockerCode(item.reason));
      }
    }
  }
  const sizingConstraint: WeeklyPaperReview["capital"]["sizingConstraint"] =
    maxSingleOrderNotional > 0 && maxOrderCapitalRatio <= 0.05
      ? "configured-cap"
      : blockerCodes.has("cash")
        ? "cash-or-reserve"
        : blockerCodes.has("phase-budget")
          ? "phase-budget"
          : blockerCodes.has("lot-size")
            ? "lot-size"
            : blockerCodes.has("strategy") || blockerCodes.has("history")
              ? "strategy-or-signal"
              : filled.length === 0
                ? "not-observed"
                : "sample-or-signal";
  const dailyBuyNotionals = new Map<string, number>();
  for (const order of filledBuys) {
    const date = chinaDate(order.createdAt);
    dailyBuyNotionals.set(date, (dailyBuyNotionals.get(date) ?? 0) + filledNotional(order));
  }
  const maxDailyBuyNotional = Math.max(0, ...dailyBuyNotionals.values());

  const utilization: WeeklyPaperReview["capital"]["utilization"] = filled.length === 0 || buyCapitalRatio < 0.15
    ? "low"
    : averageOrderCapitalRatio < 0.05
      ? "small-ticket"
      : buyCapitalRatio > 0.75 || currentDeployedRatio > 0.85
        ? "high"
        : "balanced";
  const utilizationSummary = utilization === "low"
    ? `${periodLabel}成交覆盖不足，资金大部分没有进入成交记录。`
    : utilization === "small-ticket"
      ? `${periodLabel}有成交，但平均单笔金额偏小，资金使用更像试探仓而不是完整风险预算。`
      : utilization === "high"
        ? `${periodLabel}资金使用偏高，后续仍需优先保留现金和阶段性调整空间。`
        : `${periodLabel}成交金额和当前仓位处于可观察的均衡区间。`;
  const initialCapitalLabel = initialCapital >= 10_000
    ? `${(initialCapital / 10_000).toLocaleString("zh-CN")} 万元`
    : `${initialCapital.toLocaleString("zh-CN")} 元`;
  const sizingSummary = maxSingleOrderNotional > 0
    ? `有效单笔风控上限 ${maxSingleOrderNotional.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} 元，占初始资金 ${initialCapitalLabel} 的 ${(maxOrderCapitalRatio * 100).toFixed(1)}%。`
    : "当前没有可用的单笔风控上限数据，不能判断订单金额是否被配置上限压缩。";
  const planSummary = planSnapshotDays === 0
    ? "该复盘周期没有可解析的自动计划金额快照。"
    : `已记录 ${planSnapshotDays} 天自动计划，日峰值计划买入额最高 ${maxDailyPlannedBuyNotional.toFixed(2)} 元，累计计划买入 ${plannedBuyNotional.toFixed(2)} 元，占初始资金 ${(plannedBuyCapitalRatio * 100).toFixed(1)}%；自动 Paper 买入成交 ${automaticFilledBuyNotional.toFixed(2)} 元，计划落地率 ${planRealizationRatio === null ? "暂无" : `${(planRealizationRatio * 100).toFixed(1)}%`}。`;

  const closedTrades = buildClosedTrades(input.orders, startDate, endDate, decisions);
  const winningTrades = closedTrades.filter((trade) => trade.pnl > 0);
  const losingTrades = closedTrades.filter((trade) => trade.pnl < 0);
  const grossProfit = winningTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = losingTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const realizedPnl = closedTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const winRate = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : null;
  const commission = filled.reduce((sum, order) => sum + Math.max(0, order.commission || 0), 0);
  const performanceSummary = closedTrades.length === 0
    ? `${periodLabel}没有买卖闭合样本，胜率暂不可用；未用未实现收益或合成回测结果替代。`
    : `${periodLabel}闭合 ${closedTrades.length} 笔，胜率 ${(winRate! * 100).toFixed(1)}%，已闭合盈亏 ${realizedPnl.toFixed(2)} 元。`;

  const strategyStats = new Map<string, WeeklyPaperReview["strategyBreakdown"][number]>();
  const ensureStrategy = (context: DecisionContext) => {
    const key = strategyMapKey(context);
    const current = strategyStats.get(key) ?? {
      strategyKey: key,
      strategyName: strategyName(context),
      filledOrders: 0,
      buyOrders: 0,
      sellOrders: 0,
      filledNotional: 0,
      commission: 0,
      closedTrades: 0,
      winningTrades: 0,
      winRate: null,
      realizedPnl: 0,
    };
    strategyStats.set(key, current);
    return current;
  };
  for (const order of filled) {
    const stat = ensureStrategy(decisionForOrder(order, decisions));
    stat.filledOrders += 1;
    stat.buyOrders += order.side === "buy" ? 1 : 0;
    stat.sellOrders += order.side === "sell" ? 1 : 0;
    stat.filledNotional += filledNotional(order);
    stat.commission += Math.max(0, order.commission || 0);
  }
  for (const trade of closedTrades) {
    const stat = ensureStrategy(trade.strategy);
    stat.closedTrades += 1;
    stat.winningTrades += trade.pnl > 0 ? 1 : 0;
    stat.realizedPnl += trade.pnl;
  }
  const strategyBreakdown = [...strategyStats.values()]
    .map((stat) => ({
      ...stat,
      filledNotional: round(stat.filledNotional),
      commission: round(stat.commission),
      winRate: stat.closedTrades > 0
        ? round(stat.winningTrades / stat.closedTrades, 4)
        : null,
      realizedPnl: round(stat.realizedPnl),
    }))
    .sort((left, right) => right.filledNotional - left.filledNotional || left.strategyKey.localeCompare(right.strategyKey));

  const daily = tradingDays.map((date) => {
    const orders = periodOrders.filter((order) => chinaDate(order.createdAt) === date);
    const dayFilled = orders.filter((order) => order.status === "filled");
    const dayPlan = dailyPlanSnapshots.get(date);
    const dayBuyNotional = dayFilled
      .filter((order) => order.side === "buy")
      .reduce((sum, order) => sum + filledNotional(order), 0);
    const daySellNotional = dayFilled
      .filter((order) => order.side === "sell")
      .reduce((sum, order) => sum + filledNotional(order), 0);
    const dayAutomaticFilledBuyNotional = dayFilled
      .filter((order) => order.side === "buy" && isAutomaticOrder(order))
      .reduce((sum, order) => sum + filledNotional(order), 0);
    const dayPlannedBuyNotional = dayPlan?.buyNotional ?? 0;
    return {
      date,
      submitted: orders.length,
      filled: dayFilled.length,
      rejected: orders.filter((order) => order.status === "rejected").length,
      buyNotional: round(dayBuyNotional),
      sellNotional: round(daySellNotional),
      plannedBuyNotional: round(dayPlannedBuyNotional),
      plannedSellNotional: round(dayPlan?.sellNotional ?? 0),
      automaticFilledBuyNotional: round(dayAutomaticFilledBuyNotional),
      planRealizationRatio: dayPlannedBuyNotional > 0
        ? round(dayAutomaticFilledBuyNotional / dayPlannedBuyNotional, 4)
        : null,
      commission: round(dayFilled.reduce((sum, order) => sum + Math.max(0, order.commission || 0), 0)),
      averageFilledOrderNotional: dayFilled.length > 0
        ? round((dayBuyNotional + daySellNotional) / dayFilled.length)
        : 0,
    };
  });

  const blockerMap = new Map<WeeklyPaperBlockerCode, {
    count: number;
    examples: string[];
    estimatedNotional: number;
  }>();
  for (const order of rejected) {
    addBlocker(
      blockerMap,
      order.rejectionReason ?? "订单被拒绝但未记录具体原因",
      estimatedOrderNotional(order),
    );
  }
  for (const audit of periodAudits) {
    if (audit.action !== "paper-auto-execution.run") continue;
    const skippedReasons = audit.data?.skippedReasons;
    if (!Array.isArray(skippedReasons)) continue;
    for (const item of skippedReasons) {
      if (!isRecord(item) || typeof item.reason !== "string") continue;
      addBlocker(
        blockerMap,
        item.reason,
        nonNegativeNumber(item.estimatedNotional) ?? 0,
      );
    }
  }
  const blockers = [...blockerMap.entries()]
    .map(([code, value]) => ({
      code,
      label: BLOCKER_LABELS[code],
      ...value,
      estimatedNotional: round(value.estimatedNotional),
    }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

  const orderDays = [...new Set(periodOrders.map((order) => chinaDate(order.createdAt)))].sort();
  const daysWithFills = new Set(filled.map((order) => chinaDate(order.createdAt))).size;
  const activeDays = orderDays.length;
  const evidence: WeeklyPaperReviewEvidence = periodOrders.length === 0
    ? "unavailable"
    : filled.length === 0 || closedTrades.length === 0
      ? "limited"
      : "sufficient";
  const findings: string[] = [];
  if (historyCoverage.status === "may-be-pruned") {
    findings.push(`${historyCoverage.summary}因此没有订单记录时，不能确认是否真的零交易。`);
  } else if (periodOrders.length === 0) {
    findings.push(`${periodLabel}没有本地 Paper 订单记录，无法评价成交金额或胜率。`);
  } else if (filled.length === 0) {
    findings.push(`${periodLabel}提交 ${periodOrders.length} 笔，但没有成交；先看阻塞原因，不把零成交解释为策略失败。`);
  }
  if (automaticRunCount > 0 && planSnapshotDays === 0) {
    findings.push(`${periodLabel}有 ${automaticRunCount} 次自动运行审计，但没有计划金额快照；当前无法区分没有计划、计划被过滤还是旧版本未留痕。`);
  }
  if (planSnapshotDays > 0 && automaticFilledBuyNotional <= 0) {
    findings.push(`${periodLabel}记录到计划买入 ${plannedBuyNotional.toFixed(2)} 元，但没有自动 Paper 买入成交；需要结合现金、阶段额度、T+1、数据和风控阻塞继续核对。`);
  } else if (
    plannedBuyNotional > 0 &&
    planRealizationRatio !== null &&
    planRealizationRatio < 0.5
  ) {
    findings.push(`${periodLabel}计划买入 ${plannedBuyNotional.toFixed(2)} 元，自动成交 ${automaticFilledBuyNotional.toFixed(2)} 元，计划落地率仅 ${(planRealizationRatio * 100).toFixed(1)}%；计划金额明显高于最终成交。`);
  }
  if (utilization === "low") {
    findings.push(`${periodLabel}买入成交额 ${grossBuyNotional.toFixed(2)} 元，占初始资金 ${(buyCapitalRatio * 100).toFixed(1)}%，资金部署偏低。`);
  } else if (utilization === "small-ticket") {
    findings.push(`${periodLabel}平均单笔成交 ${averageFilledOrderNotional.toFixed(2)} 元，占初始资金 ${(averageOrderCapitalRatio * 100).toFixed(1)}%，存在试探仓偏小问题。`);
  }
  if (closedTrades.length > 0 && winRate! < 0.5) {
    findings.push(`已闭合交易胜率 ${(winRate! * 100).toFixed(1)}%，低于 50%；需要按策略和市场状态降权复核。`);
  }
  if (strategyBreakdown.filter((stat) => stat.filledOrders > 0).length <= 1 && filled.length >= 2) {
    findings.push("成交集中在单一策略或旧记录缺少策略键，策略轮换证据不足。");
  }
  if (blockers.length > 0) {
    findings.push(`最常见阻塞是“${blockers[0].label}”，出现 ${blockers[0].count} 次；应先解决执行覆盖，再调整收益目标。`);
  }
  const nextActions: string[] = [
    "用周度成交金额、平均单笔金额和现金比例校准风险预算，不通过强制下单制造交易次数。",
    "保留手续费、现金、单票仓位、T+1、熔断和每日硬上限；低于费用效率的订单继续拦截。",
  ];
  if (utilization === "low" || utilization === "small-ticket") {
    nextActions.push("扩大合格候选的历史覆盖并按单票风险预算计算整手数量，让合格信号使用完整预算；没有合格信号时保持现金。");
  }
  if (automaticRunCount > 0 && planSnapshotDays === 0) {
    nextActions.push("升级自动执行审计或检查线上版本，确保每次运行都保留计划金额快照，再判断计划生成和执行层谁在减少金额。");
  }
  if (planSnapshotDays > 0 && automaticFilledBuyNotional <= 0) {
    nextActions.push("逐次对照计划快照与 skippedReasons、订单拒绝原因，先定位计划未落地的第一道硬约束，不直接放宽风控。");
  } else if (planRealizationRatio !== null && planRealizationRatio < 0.5) {
    nextActions.push("把计划金额按运行阶段和可执行订单逐层核对，减少重复计划造成的虚高统计，并验证实际成交是否被单轮额度或现金缓冲截断。");
  }
  if (historyCoverage.status === "may-be-pruned") {
    nextActions.unshift("将交易历史留存设置为覆盖完整复盘窗口，或持久化周度汇总；留存期外的空记录不能作为零交易证据。");
  }
  if (closedTrades.length > 0 && winRate! < 0.5) {
    nextActions.push("把已闭合胜率、盈亏和回撤按策略键拆开，连续亏损策略只降权或观察，不直接换成更激进仓位。");
  } else if (closedTrades.length === 0) {
    nextActions.push("继续积累买卖闭合样本后再评价胜率；当前只能评价成交和执行质量。");
  }
  if (blockers.length > 0) {
    nextActions.push(`优先处理“${blockers[0].label}”阻塞，并在下一轮 Paper 审计中验证是否减少。`);
  }

  const grade: WeeklyPaperReview["diagnosis"]["grade"] = evidence !== "sufficient"
    ? "insufficient-sample"
    : findings.length >= 3
      ? "needs-improvement"
      : findings.length > 0
        ? "watch"
        : "disciplined";

  return {
    generatedAt: now.toISOString(),
    period: { window, startDate, endDate, tradingDays, orderDays },
    sample: {
      evidence,
      orderCount: periodOrders.length,
      filledOrderCount: filled.length,
      rejectedOrderCount: rejected.length,
      cancelledOrderCount: cancelled.length,
      pendingOrderCount: pending.length,
      automaticRunCount,
      activeDays,
      daysWithFills,
      planSnapshotDays,
      historyCoverage,
    },
    capital: {
      initialCapital: round(initialCapital),
      currentEquity: round(input.account.equity),
      currentCash: round(input.account.cash),
      currentMarketValue: round(input.account.marketValue),
      currentDeployedRatio: round(currentDeployedRatio, 4),
      currentCashRatio: round(currentCashRatio, 4),
      grossBuyNotional: round(grossBuyNotional),
      grossSellNotional: round(grossSellNotional),
      netBuyNotional: round(grossBuyNotional - grossSellNotional),
      grossTurnover: round(grossTurnover),
      buyCapitalRatio: round(buyCapitalRatio, 4),
      averageFilledOrderNotional: round(averageFilledOrderNotional),
      averageOrderCapitalRatio: round(averageOrderCapitalRatio, 4),
      plannedBuyNotional: round(plannedBuyNotional),
      plannedSellNotional: round(plannedSellNotional),
      plannedBuyCapitalRatio: round(plannedBuyCapitalRatio, 4),
      automaticFilledBuyNotional: round(automaticFilledBuyNotional),
      planRealizationRatio: planRealizationRatio === null
        ? null
        : round(planRealizationRatio, 4),
      maxDailyPlannedBuyNotional: round(maxDailyPlannedBuyNotional),
      maxSingleOrderNotional: round(maxSingleOrderNotional),
      maxOrderCapitalRatio: round(maxOrderCapitalRatio, 4),
      sizingConstraint,
      maxDailyBuyNotional: round(maxDailyBuyNotional),
      utilization,
      summary: `${utilizationSummary}${sizingSummary}${planSummary}`,
    },
    performance: {
      evidence: closedTrades.length > 0 ? "closed-fills-only" : "no-closed-trades",
      closedTrades: closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: winRate === null ? null : round(winRate, 4),
      realizedPnl: round(realizedPnl),
      grossProfit: round(grossProfit),
      grossLoss: round(grossLoss),
      profitFactor: grossLoss < 0 ? round(grossProfit / Math.abs(grossLoss), 4) : null,
      averageWin: winningTrades.length > 0 ? round(grossProfit / winningTrades.length) : null,
      averageLoss: losingTrades.length > 0 ? round(grossLoss / losingTrades.length) : null,
      commission: round(commission),
      summary: performanceSummary,
    },
    strategyBreakdown,
    daily,
    blockers,
    diagnosis: {
      grade,
      findings,
      nextActions,
      summary: evidence === "unavailable"
        ? `${periodLabel}没有 Paper 成交样本，先修复运行覆盖和候选阻塞，再评价策略。`
        : evidence === "limited"
          ? `${periodLabel}样本不足以证明策略胜率，当前重点是提高可解释的执行覆盖和资金分配质量。`
          : `${periodLabel}完成 ${filled.length} 笔成交和 ${closedTrades.length} 笔闭合复盘，按策略、资金和阻塞原因继续迭代。`,
    },
    guardrails: [
      "只统计本地 Paper 订单和审计，不连接真实券商。",
      "胜率只按已成交且买卖闭合的 FIFO 样本计算；没有闭合样本时返回不可用。",
      "资金使用率是成交与当前账户状态的诊断指标，不是收益保证或目标成交保证。",
      `每日自动订单硬上限仍为 ${Math.min(10, Math.max(1, Math.floor(input.maxDailyAutoOrders ?? 10)))} 笔。`,
      "不绕过现金、手续费、仓位、T+1、熔断或数据质量检查来增加交易次数。",
    ],
  };
}
