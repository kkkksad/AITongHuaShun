import { createHash } from "node:crypto";
import type {
  AccountSnapshot,
  AuditEvent,
  OrderRecord,
  PositionSnapshot,
} from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";
import type {
  PaperTradingOperation,
  PaperTradingPlan,
} from "../research/paperTradingPlan";
import type { DailyMarketTone } from "../research/dailyMarketReview";
import type {
  AShareTradingPhase,
  IntradayExecutionPolicy,
} from "../trading/intradayExecutionPolicy";
import {
  getAshareMarketSession,
  getAshareTradingDayStatus,
  getChinaDateKey,
  getChinaMinutes,
} from "../trading/ashareTradingCalendar";
import type { WxPusherMessage } from "./wxPusherClient";

export interface PaperPlanMessageSender {
  send(message: WxPusherMessage): Promise<unknown>;
}

export interface PaperPlanNotificationSector {
  name: string;
  direction: "constructive" | "neutral" | "cautious";
  score: number;
  changePercent: number;
}

export interface PaperPlanNotificationContext {
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  executableOperations: PaperTradingOperation[];
  executionSummary: PaperPlanExecutionSummary;
  policy: IntradayExecutionPolicy;
  /** False means the scheduler is sending briefings while order submission is disabled. */
  executionEnabled?: boolean;
  marketContext: {
    sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
    tone: DailyMarketTone;
    summary: string;
    breadth?: {
      total: number;
      advancers: number;
      decliners: number;
      flat: number;
      averageChangePercent: number;
      advanceDeclineRatio: number;
      holdingQuotes?: Array<{
        symbol: string;
        name: string;
        changePercent: number;
      }>;
    };
    sectors: PaperPlanNotificationSector[];
    warnings: string[];
    newsHighlights?: Array<{ source: string; title: string }>;
    globalImpact?: {
      direction: "risk-on" | "neutral" | "risk-off";
      summary: string;
      drivers: string[];
    };
  };
}

export interface ExternalMarketNotificationInput {
  bias: "supportive" | "neutral" | "restrictive" | "conflicted";
  evidenceGrade: "snapshot-only" | "historically-observed" | "walk-forward-validated";
  samples: number;
  groups: Array<{
    key: "us-overnight" | "asia" | "crypto";
    tone: "positive" | "neutral" | "negative" | "unavailable";
  }>;
  rationale: string[];
}

export function buildExternalMarketNotificationImpact(
  input: ExternalMarketNotificationInput,
): NonNullable<PaperPlanNotificationContext["marketContext"]["globalImpact"]> {
  const toneLabels = {
    positive: "偏强",
    neutral: "中性",
    negative: "偏弱",
    unavailable: "不可用",
  } as const;
  const biasLabels = {
    supportive: "偏支持",
    neutral: "中性",
    restrictive: "偏约束",
    conflicted: "方向冲突",
  } as const;
  const evidenceLabels = {
    "snapshot-only": "快照观察",
    "historically-observed": "历史观察",
    "walk-forward-validated": "滚动验证",
  } as const;
  const tone = (key: ExternalMarketNotificationInput["groups"][number]["key"]) =>
    toneLabels[input.groups.find((group) => group.key === key)?.tone ?? "unavailable"];

  return {
    direction: input.bias === "supportive"
      ? "risk-on"
      : input.bias === "restrictive"
        ? "risk-off"
        : "neutral",
    summary: [
      `美股隔夜${tone("us-overnight")}`,
      `亚洲${tone("asia")}`,
      `BTC/ETH${tone("crypto")}`,
    ].join("；") +
      `｜对A股：${biasLabels[input.bias]}（${evidenceLabels[input.evidenceGrade]}，样本${input.samples}）`,
    drivers: [...new Set(input.rationale.map((item) => item.trim()).filter(Boolean))]
      .slice(0, 3),
  };
}

export interface PaperPlanNotifierOptions {
  enabled: boolean;
  sender?: PaperPlanMessageSender;
  store: TradingStore;
  /** Hard daily cap shared by six scheduled briefings and four event messages. */
  dailyMessageLimit: number;
  clock?: () => Date;
}

export interface PaperPlanExecutionSummary {
  filledOrders: number;
  rejectedOrders: number;
  pendingOrders: number;
  cancelledOrders: number;
  buyNotional: number;
  sellNotional: number;
  commission: number;
  executedOrders: PaperPlanExecutedOrder[];
  unfilledOrders: PaperPlanUnfilledOrder[];
}

export interface PaperPlanExecutedOrder {
  orderId: string;
  symbol: string;
  name: string;
  side: OrderRecord["side"];
  quantity: number;
  filledPrice: number;
  notional: number;
  commission: number;
  strategy: string;
  reason: string;
  reasonSource: "order-record" | "decision-audit" | "historical-fallback";
}

export interface PaperPlanUnfilledOrder {
  orderId: string;
  symbol: string;
  name: string;
  side: OrderRecord["side"];
  quantity: number;
  status: OrderRecord["status"];
  strategy: string;
  reason: string;
  reasonSource: "order-record" | "decision-audit" | "historical-fallback";
}

export interface PaperPlanBriefingSlot {
  phase: Exclude<AShareTradingPhase, "closed">;
  sequence: number;
  scheduledAt: string;
  minuteOfDay: number;
  label: string;
  purpose: string;
}

export type PaperPlanMessageKind =
  | "scheduled-briefing"
  | "order-event"
  | "market-anomaly";

export interface PaperPlanMessageDelivery {
  messageKind: PaperPlanMessageKind;
  scheduledAt: string;
  actualAt?: string;
  sequence?: number;
  totalBriefings?: number;
  eventKey?: string;
}

export type PaperPlanNotificationResult =
  | { status: "disabled" }
  | { status: "not-actionable" }
  | { status: "scheduled-wait"; scheduledAt: string }
  | { status: "outside-session" }
  | { status: "window-closed" }
  | { status: "phase-used"; signature: string }
  | { status: "daily-limit" }
  | { status: "event-limit" }
  | { status: "no-event" }
  | { status: "duplicate"; eventKey: string }
  | { status: "sent"; signature: string; messageKind: PaperPlanMessageKind }
  | { status: "failed"; signature: string; messageKind: PaperPlanMessageKind };

export const PAPER_PLAN_BRIEFING_SLOTS: readonly PaperPlanBriefingSlot[] = [
  {
    phase: "opening",
    sequence: 1,
    scheduledAt: "09:35",
    minuteOfDay: 9 * 60 + 35,
    label: "开盘基线",
    purpose: "避开开盘第一分钟噪音，记录账户、持仓和当日首个 Paper 计划。",
  },
  {
    phase: "morning-confirmation",
    sequence: 2,
    scheduledAt: "10:15",
    minuteOfDay: 10 * 60 + 15,
    label: "上午确认",
    purpose: "复核开盘后信号、成交和市场宽度是否发生实质变化。",
  },
  {
    phase: "morning-confirmation",
    sequence: 3,
    scheduledAt: "11:00",
    minuteOfDay: 11 * 60,
    label: "午前收口",
    purpose: "记录上午最终执行状态，避免午休后误用旧结论。",
  },
  {
    phase: "afternoon-confirmation",
    sequence: 4,
    scheduledAt: "13:30",
    minuteOfDay: 13 * 60 + 30,
    label: "午后重启",
    purpose: "下午重新读取行情与策略信号，不沿用上午未确认计划。",
  },
  {
    phase: "afternoon-confirmation",
    sequence: 5,
    scheduledAt: "14:15",
    minuteOfDay: 14 * 60 + 15,
    label: "尾盘前复核",
    purpose: "复核持仓风险、可用现金和尾盘前仍有效的 Paper 计划。",
  },
  {
    phase: "closing-risk-review",
    sequence: 6,
    scheduledAt: "14:50",
    minuteOfDay: 14 * 60 + 50,
    label: "收盘前摘要",
    purpose: "给出当日最终持仓、盈亏、成交和市场风险摘要。",
  },
] as const;

const SCHEDULED_BRIEFING_COUNT = PAPER_PLAN_BRIEFING_SLOTS.length;
export const PAPER_EVENT_MESSAGE_LIMIT = 4;
const PROVIDER_ATTEMPT_ACTIONS = new Set([
  "wxpusher.paper-plan.sent",
  "wxpusher.paper-plan.failed",
  "wxpusher.paper-event.sent",
  "wxpusher.paper-event.failed",
]);
const MARKET_ANOMALY_AVERAGE_DELTA = 1.2;
const MARKET_ANOMALY_HOLDING_DELTA = 2;
const MARKET_ANOMALY_COOLDOWN_MINUTES = 20;
const ASHARE_MARKET_CLOSE_MINUTE = 15 * 60;

const SIZING_CONSTRAINT_LABELS = {
  "risk-order-cap": "单笔风控上限",
  "strategy-profile-scale": "策略档位缩放",
  "position-weight-cap": "单标的仓位上限",
  "planned-cash-budget": "本轮计划资金预算",
  none: "暂无金额限制",
} as const;

const BLOCKED_REASON_LABELS: Record<string, string> = {
  "minimum-lot-not-affordable": "最小整手金额超过可用预算",
  "single-order-cap": "单笔金额上限",
  "position-cap": "单标的仓位上限",
  "cash-reserve": "现金保留线",
  "cooldown": "重复交易冷却",
  "liquidity": "流动性不足",
  "strategy-no-signal": "策略未产生信号",
  "manual-strategy-no-match": "所选固定策略没有匹配候选",
};

function chinaDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

export function summarizePaperOrders(
  orders: OrderRecord[],
  tradingDate: string,
  auditEvents: AuditEvent[] = [],
): PaperPlanExecutionSummary {
  const today = orders.filter((order) => chinaDate(order.createdAt) === tradingDate);
  const filled = today.filter((order) => order.status === "filled");
  const roundMoney = (value: number) => Number(value.toFixed(2));
  const decisionByOrderId = new Map(
    auditEvents
      .filter((event) => (
        event.action === "paper-auto-execution.decision" &&
        typeof event.data?.orderId === "string"
      ))
      .map((event) => [event.data?.orderId as string, event.data ?? {}]),
  );
  const orderExplanation = (order: OrderRecord) => {
    const decision = decisionByOrderId.get(order.id);
    const recordedStrategy = order.strategy?.trim();
    const decisionStrategy = typeof decision?.strategy === "string"
      ? decision.strategy.trim()
      : "";
    const strategy = recordedStrategy || decisionStrategy || "历史订单未记录策略";
    const decisionReason = typeof decision?.reason === "string"
      ? decision.reason.trim()
      : "";
    const orderReason = order.rejectionReason?.trim() ?? "";
    const reason = orderReason || decisionReason ||
      "历史订单未保存决策理由";
    return {
      strategy,
      reason,
      reasonSource: orderReason
        ? "order-record" as const
        : decisionReason
          ? "decision-audit" as const
          : "historical-fallback" as const,
    };
  };

  return {
    filledOrders: filled.length,
    rejectedOrders: today.filter((order) => order.status === "rejected").length,
    pendingOrders: today.filter((order) => (
      order.status === "pending" || order.status === "accepted"
    )).length,
    cancelledOrders: today.filter((order) => order.status === "cancelled").length,
    buyNotional: roundMoney(filled
      .filter((order) => order.side === "buy")
      .reduce((total, order) => total + order.notional, 0)),
    sellNotional: roundMoney(filled
      .filter((order) => order.side === "sell")
      .reduce((total, order) => total + order.notional, 0)),
    commission: roundMoney(filled.reduce((total, order) => total + order.commission, 0)),
    executedOrders: filled.map((order) => ({
      orderId: order.id,
      symbol: order.symbol,
      name: order.name ?? order.symbol,
      side: order.side,
      quantity: order.filledQuantity,
      filledPrice: order.filledPrice ?? order.requestedPrice,
      notional: roundMoney(order.notional),
      commission: roundMoney(order.commission),
      ...orderExplanation(order),
    })),
    unfilledOrders: today
      .filter((order) => order.status !== "filled")
      .map((order) => ({
        orderId: order.id,
        symbol: order.symbol,
        name: order.name ?? order.symbol,
        side: order.side,
        quantity: order.quantity,
        status: order.status,
        ...orderExplanation(order),
      })),
  };
}

export function getPaperPlanBriefingSlot(
  value: Date,
  _phase?: AShareTradingPhase,
): PaperPlanBriefingSlot | null {
  if (!getAshareTradingDayStatus(value).isTradingDay) return null;
  if (getAshareMarketSession(value) !== "open") return null;
  const minute = getChinaMinutes(value);
  if (minute >= ASHARE_MARKET_CLOSE_MINUTE) return null;
  return [...PAPER_PLAN_BRIEFING_SLOTS]
    .reverse()
    .find((slot) => minute >= slot.minuteOfDay) ?? null;
}

function materialSignature(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      tradingDate: plan.tradingDate,
      strategy: plan.executionStrategy?.key ?? plan.topStrategy?.strategyKey ?? "unavailable",
      sourceStatus: context.marketContext.sourceStatus,
      marketTone: context.marketContext.tone,
      positions: context.positions
        .filter((position) => position.quantity > 0)
        .map((position) => [position.symbol, position.quantity])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
      operations: context.executableOperations
        .map((operation) => [
          operation.symbol,
          operation.action,
          operation.quantity,
          operation.estimatedNotional,
        ])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    }))
    .digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function uniqueText(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
}

function isUnavailableText(value: string): boolean {
  return /暂不可用|不可用|未取得|unavailable|数据降级|源失败|请求失败|超时|为空/i.test(value);
}

function dailyRiskEvents(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
): string[] {
  const events: string[] = [];
  if (context.marketContext.sourceStatus !== "live-read-only") {
    events.push("market-data-not-live");
  }
  if (context.marketContext.tone === "insufficient-data") {
    events.push("market-data-insufficient");
  }
  if (context.marketContext.tone === "risk-off") events.push("market-risk-off");
  if (context.account.paused) events.push("paper-account-paused");
  if (context.executionSummary.rejectedOrders > 0) events.push("paper-order-rejected");
  if (
    plan.adaptiveRouting?.regime === "risk-off" &&
    plan.adaptiveRouting.allowNewPositions === false
  ) {
    events.push("routing-risk-off");
  }
  return [...new Set(events)];
}

const RISK_EVENT_LABELS: Record<string, string> = {
  "market-data-not-live": "行情不是实时只读源，结论必须按降级数据处理",
  "market-data-insufficient": "当前没有足够可交易报价，无法形成可靠盘面结论",
  "market-risk-off": "观察池盘面处于风险偏高状态",
  "paper-account-paused": "Paper 账户当前暂停",
  "paper-order-rejected": "今日已有 Paper 拒单",
  "routing-risk-off": "市场路由暂停新增 Paper 仓位",
};

function primaryBlocker(plan: PaperTradingPlan): string {
  const sorted = Object.entries(plan.qualitySummary?.blockedReasons ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((left, right) => right[1] - left[1]);
  if (sorted.length === 0) return "无新的阻塞原因";
  const [key, count] = sorted[0];
  return `${BLOCKED_REASON_LABELS[key] ?? key}（${count} 次）`;
}

function conclusionFor(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
): { label: string; detail: string; color: string; background: string } {
  if (context.account.paused) {
    return {
      label: "Paper 暂停",
      detail: "账户暂停或风险限制生效；本轮只展示状态，不新增风险。",
      color: "#b42318",
      background: "#fff1f0",
    };
  }
  if (plan.qualitySummary?.planQuality === "blocked") {
    return {
      label: "风控暂停",
      detail: "本轮没有新增风险，优先保留现金并等待阻塞条件解除。",
      color: "#b42318",
      background: "#fff1f0",
    };
  }
  if (context.executionEnabled === false) {
    return {
      label: "通知模式",
      detail: "自动执行已关闭；本消息只展示计划、持仓与风险，不会提交订单。",
      color: "#175cd3",
      background: "#eff8ff",
    };
  }
  if (context.executableOperations.length > 0) {
    return {
      label: "可操作",
      detail: `${context.executableOperations.length} 项 Paper 动作通过前置检查，最终仍以模拟撮合为准。`,
      color: "#067647",
      background: "#ecfdf3",
    };
  }
  return {
    label: "观察",
    detail: "没有达到执行条件，不为交易次数强行下单。",
    color: "#b54708",
    background: "#fffaeb",
  };
}

function formatMoney(value: number): string {
  return `${value.toFixed(2)} 元`;
}

function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function chinaTimeLabel(value: Date): string {
  const shifted = new Date(value.getTime() + 8 * 60 * 60_000);
  return shifted.toISOString().slice(11, 16);
}

function availableQuantity(position: PositionSnapshot): number {
  if (typeof position.availableQuantity === "number") {
    return Math.max(0, position.availableQuantity);
  }
  return Math.max(0, position.quantity - Math.max(0, position.t1LockedQuantity ?? 0));
}

function positionPnlPercent(position: PositionSnapshot): number {
  const costBasis = position.averagePrice * position.quantity;
  return costBasis > 0 ? position.unrealizedPnl / costBasis * 100 : 0;
}

function formatPosition(position: PositionSnapshot): string {
  return [
    `<strong>${escapeHtml(position.symbol)} ${escapeHtml(position.name)}</strong>`,
    `${position.quantity} 股（可卖 ${availableQuantity(position)}）· 成本 ${position.averagePrice.toFixed(2)} · 现价 ${position.currentPrice.toFixed(2)}`,
    `市值 ${formatMoney(position.marketValue)} · 浮动盈亏 ${formatMoney(position.unrealizedPnl)}（${formatPercent(positionPnlPercent(position))}）· 权重 ${formatPercent(position.weight * 100)}`,
  ].join("<br />");
}

function holdingsHtml(context: PaperPlanNotificationContext): string {
  const visible = context.positions.filter((position) => position.quantity > 0);
  if (visible.length === 0) return "<p>当前没有 Paper 持仓。</p>";
  return `<ol>${visible.map((position) => `<li>${formatPosition(position)}</li>`).join("")}</ol>`;
}

function accountHtml(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
): string {
  const { account } = context;
  const investedRatio = account.equity > 0
    ? account.marketValue / account.equity * 100
    : 0;
  const startingEquity = account.startingEquity ?? plan.capitalPlan?.initialCapital ?? 0;
  const sinceReset = account.dailyPnl;
  const sinceResetPercent = account.dailyPnlPercent !== 0
    ? account.dailyPnlPercent * 100
    : startingEquity > 0
      ? sinceReset / startingEquity * 100
      : 0;
  return [
    `<p>权益 ${formatMoney(account.equity)} · 现金 ${formatMoney(account.cash)} · 持仓市值 ${formatMoney(account.marketValue)} · 仓位 ${formatPercent(investedRatio)}</p>`,
    `<p>浮动盈亏 ${formatMoney(account.unrealizedPnl)} · 已实现盈亏 ${formatMoney(account.realizedPnl)} · 自 Paper 重置累计盈亏 ${formatMoney(sinceReset)}（${formatPercent(sinceResetPercent)}）</p>`,
    `<p style="color:#667085;"><small>“自 Paper 重置累计盈亏”沿用现有 dailyPnl 字段，但该字段不是自然日日内收益。</small></p>`,
  ].join("");
}

function plannedPositionLabel(
  operation: PaperTradingOperation,
  positions: PositionSnapshot[],
  equity: number,
): string {
  const current = positions.find((position) => position.symbol === operation.symbol);
  const currentQuantity = current?.quantity ?? 0;
  const currentMarketValue = current?.marketValue ?? 0;
  const deltaQuantity = operation.action === "paper-buy-plan"
    ? operation.quantity
    : -operation.quantity;
  const plannedQuantity = Math.max(0, currentQuantity + deltaQuantity);
  const plannedMarketValue = Math.max(
    0,
    currentMarketValue + (operation.action === "paper-buy-plan"
      ? operation.estimatedNotional
      : -operation.estimatedNotional),
  );
  const plannedWeight = equity > 0 ? plannedMarketValue / equity * 100 : 0;
  return `计划后约 ${plannedQuantity} 股 · 权重约 ${formatPercent(plannedWeight)}`;
}

function formatOperation(
  operation: PaperTradingOperation,
  positions: PositionSnapshot[],
  equity: number,
): string {
  const direction = operation.action === "paper-buy-plan" ? "买入" : "卖出";
  const strategy = operation.strategy || operation.strategyKey || "策略未记录";
  return [
    `<strong>${direction} ${escapeHtml(operation.symbol)} ${escapeHtml(operation.name)}</strong>`,
    `${operation.quantity} 股 · ${formatMoney(operation.estimatedNotional)} · ${escapeHtml(strategy)}`,
    `${plannedPositionLabel(operation, positions, equity)} · 依据：${escapeHtml(operation.reason)}`,
  ].join("<br />");
}

function formatExecuted(order: PaperPlanExecutedOrder): string {
  const direction = order.side === "buy" ? "买入" : "卖出";
  const reasonNote = order.reasonSource === "historical-fallback"
    ? "（历史字段未记录，不推断原因）"
    : "";
  return [
    `<strong>${direction} ${escapeHtml(order.symbol)} ${escapeHtml(order.name)}</strong> ${order.quantity} 股 · 成交价 ${order.filledPrice.toFixed(2)} · 金额 ${formatMoney(order.notional)} · 手续费 ${formatMoney(order.commission)}`,
    `策略：${escapeHtml(order.strategy)} · 依据：${escapeHtml(order.reason)}${reasonNote}`,
  ].join("<br />");
}

function formatUnfilled(order: PaperPlanUnfilledOrder): string {
  const direction = order.side === "buy" ? "买入" : "卖出";
  const reasonNote = order.reasonSource === "historical-fallback"
    ? "（历史字段未记录，不推断原因）"
    : "";
  return `${direction} ${escapeHtml(order.symbol)} ${escapeHtml(order.name)} · ${escapeHtml(order.status)} · ${escapeHtml(order.reason)}${reasonNote}`;
}

function riskHtml(plan: PaperTradingPlan, context: PaperPlanNotificationContext): string {
  const events = dailyRiskEvents(plan, context);
  const labels = events.map((event) => RISK_EVENT_LABELS[event] ?? event);
  return labels.length > 0
    ? `<p>${labels.map((label) => escapeHtml(label)).join("<br />")}</p>`
    : "<p>当前没有额外的数据、账户或路由风险标记；这不代表市场没有风险。</p>";
}

function marketHtml(context: PaperPlanNotificationContext): string {
  const breadth = context.marketContext.breadth;
  const sectorLine = context.marketContext.sectors.length > 0
    ? context.marketContext.sectors
      .slice(0, 4)
      .map((sector) => `${escapeHtml(sector.name)} ${sector.changePercent >= 0 ? "+" : ""}${sector.changePercent.toFixed(2)}%`)
      .join(" · ")
    : "板块数据暂不可用";
  const newsLine = context.marketContext.newsHighlights?.length
    ? context.marketContext.newsHighlights
      .slice(0, 2)
      .map((item) => `${escapeHtml(item.source)}：${escapeHtml(item.title)}`)
      .join("<br />")
    : "暂无可用新闻摘要";
  const warningLine = context.marketContext.warnings.length > 0
    ? context.marketContext.warnings.slice(0, 2).map((warning) => escapeHtml(warning)).join("<br />")
    : "无额外数据告警";
  return [
    `<p><strong>盘面：</strong>${escapeHtml(context.marketContext.summary)}</p>`,
    breadth
      ? `<p>上涨 ${breadth.advancers} · 下跌 ${breadth.decliners} · 平盘 ${breadth.flat} · 平均涨跌 ${formatPercent(breadth.averageChangePercent, 2)} · 覆盖 ${breadth.total} 只</p>`
      : "<p>盘面宽度缺少完整快照，不补造涨跌数据。</p>",
    `<p><strong>板块：</strong>${sectorLine}</p>`,
    `<p><strong>新闻：</strong>${newsLine}</p>`,
    context.marketContext.globalImpact
      ? `<p><strong>外围影响：</strong>${escapeHtml(context.marketContext.globalImpact.summary)}</p>`
      : "",
    `<p><strong>告警：</strong>${warningLine}</p>`,
  ].join("");
}

export function formatPaperPlanMessage(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
  slot: PaperPlanBriefingSlot = PAPER_PLAN_BRIEFING_SLOTS[0],
  delivery: PaperPlanMessageDelivery = {
    messageKind: "scheduled-briefing",
    scheduledAt: PAPER_PLAN_BRIEFING_SLOTS[0].scheduledAt,
    sequence: PAPER_PLAN_BRIEFING_SLOTS[0].sequence,
    totalBriefings: SCHEDULED_BRIEFING_COUNT,
  },
): WxPusherMessage {
  const conclusion = conclusionFor(plan, context);
  const operations = context.executableOperations.slice(0, 5);
  const execution = context.executionSummary;
  const sizing = plan.capitalPlan?.sizingDiagnostics;
  const effectiveOrderCap =
    sizing?.effectiveOrderCap ?? plan.capitalPlan?.maxSingleOrderNotional ?? 0;
  const limitingConstraint = sizing
    ? SIZING_CONSTRAINT_LABELS[sizing.limitingConstraint]
    : "单笔风控上限";
  const strongestEvidence = uniqueText([
    operations[0]?.reason,
    plan.qualitySummary?.strategyCoverage?.summary,
    context.marketContext.summary,
  ]).find((value) => !isUnavailableText(value)) ?? "等待更多有效行情证据";
  const actionHtml = operations.length > 0
    ? `<ol>${operations.map((operation) => `<li>${formatOperation(operation, context.positions, context.account.equity)}</li>`).join("")}</ol>`
    : "<p>本轮没有满足条件的买卖动作；不为了凑成交放宽策略和风控。</p>";
  const executedHtml = execution.executedOrders.length > 0
    ? `<ol>${execution.executedOrders.slice(0, 5).map((order) => `<li>${formatExecuted(order)}</li>`).join("")}</ol>${execution.executedOrders.length > 5 ? `<p>另有 ${execution.executedOrders.length - 5} 笔成交，请在订单历史查看。</p>` : ""}`
    : "<p>今日暂无 Paper 成交。</p>";
  const unfilledHtml = execution.unfilledOrders.length > 0
    ? `<p>${execution.unfilledOrders.slice(0, 4).map((order) => formatUnfilled(order)).join("<br />")}</p>`
    : "";
  const strategyLabel = plan.executionStrategy?.label ||
    plan.topStrategy?.strategyName ||
    "未记录策略";
  const profileLabel = plan.strategyProfile?.label ?? "未记录档位";
  const sourceLabel = context.marketContext.sourceStatus === "live-read-only"
    ? "真实只读行情"
    : context.marketContext.sourceStatus === "degraded"
      ? "数据降级"
      : "模拟数据已禁用";
  const holdingCount = context.positions.filter((position) => position.quantity > 0).length;
  const summary = `KAIROS 简报 ${delivery.sequence ?? slot.sequence}/${delivery.totalBriefings ?? SCHEDULED_BRIEFING_COUNT}｜${conclusion.label}｜持仓 ${holdingCount} 只｜${plan.tradingDate}`;

  return {
    summary,
    content: [
      `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.65;color:#172b4d;">`,
      `<div style="padding:12px 14px;background:${conclusion.background};border-left:4px solid ${conclusion.color};">`,
      `<div style="font-size:13px;color:#667085;">${escapeHtml(plan.tradingDate)} · 第 ${delivery.sequence ?? slot.sequence}/${delivery.totalBriefings ?? SCHEDULED_BRIEFING_COUNT} 次定时简报 · 计划 ${escapeHtml(delivery.scheduledAt)} · 实际 ${escapeHtml(delivery.actualAt ?? delivery.scheduledAt)} · ${escapeHtml(slot.label)} · ${escapeHtml(sourceLabel)}</div>`,
      `<h2 style="margin:4px 0;font-size:21px;color:${conclusion.color};">今日结论：${escapeHtml(conclusion.label)}</h2>`,
      `<div>${escapeHtml(conclusion.detail)}</div>`,
      `</div>`,
      "<h3>当前持仓与盈亏</h3>",
      holdingsHtml(context),
      "<h3>账户与累计收益</h3>",
      accountHtml(plan, context),
      "<h3>打算交易什么</h3>",
      actionHtml,
      `<p><strong>策略与档位：</strong>${escapeHtml(strategyLabel)} · ${escapeHtml(profileLabel)}<br /><strong>最强证据：</strong>${escapeHtml(strongestEvidence)}<br /><strong>主要阻塞：</strong>${escapeHtml(primaryBlocker(plan))}<br /><strong>金额限制：</strong>实际单笔上限 ${formatMoney(effectiveOrderCap)} · ${escapeHtml(limitingConstraint)} · 保留现金 ${formatMoney(plan.capitalPlan?.cashReserveAmount ?? 0)}</p>`,
      "<h3>今日成交与拒单</h3>",
      executedHtml,
      `<p>成交 ${execution.filledOrders} 笔 · 拒单 ${execution.rejectedOrders} 笔 · 待处理 ${execution.pendingOrders} 笔 · 买入 ${formatMoney(execution.buyNotional)} · 卖出 ${formatMoney(execution.sellNotional)} · 手续费 ${formatMoney(execution.commission)}</p>`,
      ...(unfilledHtml ? [unfilledHtml] : []),
      "<h3>市场与风险</h3>",
      marketHtml(context),
      riskHtml(plan, context),
      "<h3>边界</h3>",
      "<p>仅 Paper 模拟研究；不连接真实券商、不保证成交、不构成投资建议。每个真实交易日发送 6 条定时简报，并最多发送 4 条成交或市场异动事件；周末和法定节假日不发送。</p>",
      `<p style="color:#667085;"><small>数据来源：${escapeHtml(plan.provider)}。</small></p>`,
      "</div>",
    ].join(""),
  };
}

function eventOrderLines(
  orders: OrderRecord[],
  context: PaperPlanNotificationContext,
): string {
  return `<ol>${orders.map((order) => {
    const direction = order.side === "buy" ? "买入" : "卖出";
    const statusLabel = order.status === "filled" ? "已成交" : "已拒单";
    const price = order.filledPrice ?? order.requestedPrice;
    const explanation = order.status === "filled"
      ? context.executionSummary.executedOrders.find((item) => item.orderId === order.id)
      : context.executionSummary.unfilledOrders.find((item) => item.orderId === order.id);
    const strategy = explanation?.strategy || order.strategy?.trim() ||
      "历史订单未记录策略";
    const reason = explanation?.reason || order.rejectionReason?.trim() ||
      "历史字段未记录，不推断原因";
    const reasonNote = explanation?.reasonSource === "historical-fallback" &&
      !order.rejectionReason?.trim()
      ? "（历史字段未记录，不推断原因）"
      : "";
    return `<li><strong>${statusLabel} · ${direction} ${escapeHtml(order.symbol)} ${escapeHtml(order.name ?? order.symbol)}</strong><br />${order.filledQuantity || order.quantity} 股 · 价格 ${price.toFixed(2)} · 金额 ${formatMoney(order.notional)} · 手续费 ${formatMoney(order.commission)}<br />策略：${escapeHtml(strategy)}<br />原因：${escapeHtml(reason)}${reasonNote}</li>`;
  }).join("")}</ol>`;
}

function formatOrderEventMessage(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
  orders: OrderRecord[],
  delivery: PaperPlanMessageDelivery,
): WxPusherMessage {
  const filled = orders.filter((order) => order.status === "filled").length;
  const rejected = orders.filter((order) => order.status === "rejected").length;
  const summary = `KAIROS Paper 回执｜成交 ${filled} · 拒单 ${rejected}｜${plan.tradingDate}`;
  return {
    summary,
    content: [
      `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.65;color:#172b4d;">`,
      `<div style="padding:12px 14px;background:#eff8ff;border-left:4px solid #175cd3;">`,
      `<div style="font-size:13px;color:#667085;">${escapeHtml(plan.tradingDate)} · ${escapeHtml(delivery.actualAt ?? delivery.scheduledAt)} · Paper 交易事件</div>`,
      `<h2 style="margin:4px 0;font-size:21px;color:#175cd3;">本次模拟成交/拒单回执</h2>`,
      `<div>以下状态来自本地持久化 Paper 订单，不是真实券商成交。</div>`,
      `</div>`,
      "<h3>订单回执</h3>",
      eventOrderLines(orders, context),
      "<h3>回执后账户</h3>",
      accountHtml(plan, context),
      "<h3>当前持仓与盈亏</h3>",
      holdingsHtml(context),
      "<h3>今日累计</h3>",
      `<p>成交 ${context.executionSummary.filledOrders} 笔 · 拒单 ${context.executionSummary.rejectedOrders} 笔 · 买入 ${formatMoney(context.executionSummary.buyNotional)} · 卖出 ${formatMoney(context.executionSummary.sellNotional)} · 手续费 ${formatMoney(context.executionSummary.commission)}</p>`,
      "<p>该回执不会触发新订单、修改策略或绕过任何 Paper 风控。</p>",
      "</div>",
    ].join(""),
  };
}

function formatMarketAnomalyMessage(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
  triggers: string[],
  previous: MarketObservation,
  current: MarketObservation,
  delivery: PaperPlanMessageDelivery,
): WxPusherMessage {
  return {
    summary: `KAIROS 市场异动｜平均涨跌 ${current.averageChangePercent >= 0 ? "+" : ""}${current.averageChangePercent.toFixed(2)}%｜${plan.tradingDate}`,
    content: [
      `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.65;color:#172b4d;">`,
      `<div style="padding:12px 14px;background:#fffaeb;border-left:4px solid #dc6803;">`,
      `<div style="font-size:13px;color:#667085;">${escapeHtml(plan.tradingDate)} · ${escapeHtml(delivery.actualAt ?? delivery.scheduledAt)} · 真实只读行情异动</div>`,
      `<h2 style="margin:4px 0;font-size:21px;color:#b54708;">市场突然出现较大变化</h2>`,
      `<div>${triggers.map((trigger) => escapeHtml(trigger)).join("<br />")}</div>`,
      `</div>`,
      "<h3>盘面前后变化</h3>",
      `<p>平均涨跌：${previous.averageChangePercent.toFixed(2)}% → ${current.averageChangePercent.toFixed(2)}%<br />上涨/下跌：${previous.advancers}/${previous.decliners} → ${current.advancers}/${current.decliners}<br />风险基调：${escapeHtml(previous.tone)} → ${escapeHtml(current.tone)}</p>`,
      "<h3>对 Paper 组合的影响</h3>",
      holdingsHtml(context),
      accountHtml(plan, context),
      "<p>异动提醒只用于解释和风险观察，不会据此自动追单、加仓或创建真实订单。</p>",
      `<p style="color:#667085;"><small>数据来源：${escapeHtml(plan.provider)}；仅 Paper 研究。</small></p>`,
      "</div>",
    ].join(""),
  };
}

interface MarketObservation {
  tradingDate: string;
  observedAtMs: number;
  averageChangePercent: number;
  advancers: number;
  decliners: number;
  tone: DailyMarketTone;
  holdingChanges: Map<string, number>;
}

export class PaperPlanNotifier {
  private lastMarketObservation: MarketObservation | null = null;
  private lastMarketAlertAtMs: number | null = null;

  constructor(private readonly options: PaperPlanNotifierOptions) {}

  async notify(
    plan: PaperTradingPlan,
    context: PaperPlanNotificationContext,
  ): Promise<PaperPlanNotificationResult> {
    const timing = this.validateTiming(plan);
    if (timing) return timing;

    const now = this.now();
    await this.observeMarket(plan, context);

    const slot = getPaperPlanBriefingSlot(now);
    if (!slot) {
      const minute = getChinaMinutes(now);
      if (minute < PAPER_PLAN_BRIEFING_SLOTS[0].minuteOfDay) {
        return {
          status: "scheduled-wait",
          scheduledAt: PAPER_PLAN_BRIEFING_SLOTS[0].scheduledAt,
        };
      }
      return { status: "outside-session" };
    }

    const signature = materialSignature(plan, context);
    const attempted = this.options.store.listAudit(10_000).some((event) => (
      PROVIDER_ATTEMPT_ACTIONS.has(event.action) &&
      event.data?.tradingDate === plan.tradingDate &&
      event.data?.messageKind === "scheduled-briefing" &&
      event.data?.scheduledAt === slot.scheduledAt
    ));
    if (attempted) return { status: "phase-used", signature };

    if (this.attemptedMessageCount(plan.tradingDate) >= this.effectiveDailyLimit()) {
      return { status: "daily-limit" };
    }

    const messageKind: PaperPlanMessageKind = "scheduled-briefing";
    const delivery: PaperPlanMessageDelivery = {
      messageKind,
      scheduledAt: slot.scheduledAt,
      actualAt: chinaTimeLabel(now),
      sequence: slot.sequence,
      totalBriefings: SCHEDULED_BRIEFING_COUNT,
    };
    const auditData = {
      tradingDate: plan.tradingDate,
      attemptedAt: now.toISOString(),
      scheduledAt: slot.scheduledAt,
      actualAt: delivery.actualAt,
      sequence: slot.sequence,
      totalBriefings: SCHEDULED_BRIEFING_COUNT,
      messageKind,
      signature,
      strategy: plan.executionStrategy?.key ?? plan.topStrategy?.strategyKey ?? "unavailable",
      sourceStatus: context.marketContext.sourceStatus,
      marketTone: context.marketContext.tone,
      operationCount: context.executableOperations.length,
      positionCount: context.positions.filter((position) => position.quantity > 0).length,
      riskEvents: dailyRiskEvents(plan, context),
      mode: "paper-research-only",
      liveTradingEnabled: false,
    };

    try {
      await this.options.sender!.send(formatPaperPlanMessage(plan, context, slot, delivery));
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-plan.sent",
        "WxPusher scheduled paper briefing accepted",
        auditData,
      );
      return { status: "sent", signature, messageKind };
    } catch {
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-plan.failed",
        "WxPusher scheduled paper briefing failed",
        { ...auditData, reason: "provider-request-failed" },
      );
      return { status: "failed", signature, messageKind };
    }
  }

  async notifyOrderEvents(
    plan: PaperTradingPlan,
    context: PaperPlanNotificationContext,
    orders: OrderRecord[],
  ): Promise<PaperPlanNotificationResult> {
    const timing = this.validateTiming(plan);
    if (timing) return timing;
    const attemptedOrderIds = new Set(
      this.options.store.listAudit(10_000)
        .filter((event) => (
          PROVIDER_ATTEMPT_ACTIONS.has(event.action) &&
          event.data?.tradingDate === plan.tradingDate &&
          event.data?.messageKind === "order-event" &&
          Array.isArray(event.data?.orderIds)
        ))
        .flatMap((event) => event.data?.orderIds as string[]),
    );
    const terminalEvents = orders.filter((order) => (
      order.status === "filled" || order.status === "rejected"
    ));
    if (terminalEvents.length === 0) return { status: "no-event" };
    const events = terminalEvents.filter((order) => !attemptedOrderIds.has(order.id));
    if (events.length === 0) {
      return {
        status: "duplicate",
        eventKey: `orders:${terminalEvents.map((order) => order.id).sort().join(",")}`,
      };
    }

    const eventKey = `orders:${events.map((order) => order.id).sort().join(",")}`;
    const duplicate = this.options.store.listAudit(10_000).some((event) => (
      PROVIDER_ATTEMPT_ACTIONS.has(event.action) &&
      event.data?.tradingDate === plan.tradingDate &&
      event.data?.eventKey === eventKey
    ));
    if (duplicate) return { status: "duplicate", eventKey };

    if (this.attemptedMessageCount(plan.tradingDate) >= this.effectiveDailyLimit()) {
      return { status: "daily-limit" };
    }
    if (
      this.attemptedEventCount(plan.tradingDate) >= PAPER_EVENT_MESSAGE_LIMIT ||
      !this.canSendEventWithoutStarvingBriefings(plan.tradingDate)
    ) {
      return { status: "event-limit" };
    }

    const now = this.now();
    const delivery: PaperPlanMessageDelivery = {
      messageKind: "order-event",
      scheduledAt: chinaTimeLabel(now),
      actualAt: chinaTimeLabel(now),
      eventKey,
    };
    const signature = createHash("sha256").update(eventKey).digest("hex");
    const auditData = {
      tradingDate: plan.tradingDate,
      attemptedAt: now.toISOString(),
      messageKind: "order-event",
      eventKey,
      signature,
      orderIds: events.map((order) => order.id),
      filledOrders: events.filter((order) => order.status === "filled").length,
      rejectedOrders: events.filter((order) => order.status === "rejected").length,
      mode: "paper-research-only",
      liveTradingEnabled: false,
    };

    try {
      await this.options.sender!.send(formatOrderEventMessage(plan, context, events, delivery));
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-event.sent",
        "WxPusher paper order event accepted",
        auditData,
      );
      return { status: "sent", signature, messageKind: "order-event" };
    } catch {
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-event.failed",
        "WxPusher paper order event failed",
        { ...auditData, reason: "provider-request-failed" },
      );
      return { status: "failed", signature, messageKind: "order-event" };
    }
  }

  async observeMarket(
    plan: PaperTradingPlan,
    context: PaperPlanNotificationContext,
  ): Promise<PaperPlanNotificationResult> {
    const timing = this.validateTiming(plan);
    if (timing) return timing;
    if (context.marketContext.sourceStatus !== "live-read-only") {
      return { status: "no-event" };
    }
    const breadth = context.marketContext.breadth;
    if (!breadth || !Number.isFinite(breadth.averageChangePercent)) {
      return { status: "no-event" };
    }

    const now = this.now();
    const current: MarketObservation = {
      tradingDate: plan.tradingDate,
      observedAtMs: now.getTime(),
      averageChangePercent: breadth.averageChangePercent,
      advancers: breadth.advancers,
      decliners: breadth.decliners,
      tone: context.marketContext.tone,
      holdingChanges: new Map(
        (breadth.holdingQuotes ?? []).map((quote) => [quote.symbol, quote.changePercent]),
      ),
    };
    const previous = this.lastMarketObservation?.tradingDate === plan.tradingDate
      ? this.lastMarketObservation
      : null;
    this.lastMarketObservation = current;
    if (!previous) return { status: "no-event" };

    const triggers: string[] = [];
    const averageDelta = current.averageChangePercent - previous.averageChangePercent;
    if (Math.abs(averageDelta) >= MARKET_ANOMALY_AVERAGE_DELTA) {
      triggers.push(`观察池平均涨跌在两次读取间变化 ${averageDelta >= 0 ? "+" : ""}${averageDelta.toFixed(2)} 个百分点。`);
    }
    if (
      previous.tone !== "risk-off" &&
      current.tone === "risk-off"
    ) {
      triggers.push("盘面风险基调从非风险偏高切换为 risk-off。");
    }
    for (const [symbol, changePercent] of current.holdingChanges) {
      const priorChange = previous.holdingChanges.get(symbol);
      if (priorChange === undefined) continue;
      const delta = changePercent - priorChange;
      if (Math.abs(delta) >= MARKET_ANOMALY_HOLDING_DELTA) {
        triggers.push(`持仓 ${symbol} 的涨跌幅在两次读取间变化 ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} 个百分点。`);
      }
    }
    if (triggers.length === 0) return { status: "no-event" };

    const cooldownMs = MARKET_ANOMALY_COOLDOWN_MINUTES * 60_000;
    const lastAuditAt = this.lastMarketAlertAtMs ?? this.lastMarketEventAuditMs(plan.tradingDate);
    if (lastAuditAt !== null && now.getTime() - lastAuditAt < cooldownMs) {
      return { status: "event-limit" };
    }

    if (this.attemptedMessageCount(plan.tradingDate) >= this.effectiveDailyLimit()) {
      return { status: "daily-limit" };
    }
    if (
      this.attemptedEventCount(plan.tradingDate) >= PAPER_EVENT_MESSAGE_LIMIT ||
      !this.canSendEventWithoutStarvingBriefings(plan.tradingDate)
    ) {
      return { status: "event-limit" };
    }

    const minute = getChinaMinutes(now);
    const eventKey = `market:${plan.tradingDate}:${Math.floor(minute / MARKET_ANOMALY_COOLDOWN_MINUTES)}`;
    const delivery: PaperPlanMessageDelivery = {
      messageKind: "market-anomaly",
      scheduledAt: chinaTimeLabel(now),
      actualAt: chinaTimeLabel(now),
      eventKey,
    };
    const signature = createHash("sha256").update(eventKey).digest("hex");
    const auditData = {
      tradingDate: plan.tradingDate,
      attemptedAt: now.toISOString(),
      messageKind: "market-anomaly",
      eventKey,
      signature,
      previous: {
        averageChangePercent: previous.averageChangePercent,
        advancers: previous.advancers,
        decliners: previous.decliners,
        tone: previous.tone,
      },
      current: {
        averageChangePercent: current.averageChangePercent,
        advancers: current.advancers,
        decliners: current.decliners,
        tone: current.tone,
      },
      triggers,
      mode: "paper-research-only",
      liveTradingEnabled: false,
    };

    this.lastMarketAlertAtMs = now.getTime();
    try {
      await this.options.sender!.send(formatMarketAnomalyMessage(
        plan,
        context,
        triggers,
        previous,
        current,
        delivery,
      ));
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-event.sent",
        "WxPusher market anomaly event accepted",
        auditData,
      );
      return { status: "sent", signature, messageKind: "market-anomaly" };
    } catch {
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-event.failed",
        "WxPusher market anomaly event failed",
        { ...auditData, reason: "provider-request-failed" },
      );
      return { status: "failed", signature, messageKind: "market-anomaly" };
    }
  }

  private validateTiming(plan: PaperTradingPlan): PaperPlanNotificationResult | null {
    if (!this.options.enabled || !this.options.sender) return { status: "disabled" };
    const now = this.now();
    const dayStatus = getAshareTradingDayStatus(now);
    if (!dayStatus.isTradingDay || getChinaDateKey(now) !== plan.tradingDate) {
      return { status: "not-actionable" };
    }
    if (
      getAshareMarketSession(now) !== "open" ||
      getChinaMinutes(now) >= ASHARE_MARKET_CLOSE_MINUTE
    ) {
      return { status: "outside-session" };
    }
    return null;
  }

  private effectiveDailyLimit(): number {
    return Math.max(0, Math.min(10, Math.floor(this.options.dailyMessageLimit)));
  }

  private attemptedMessageCount(tradingDate: string): number {
    return this.options.store.listAudit(10_000).filter((event) => (
      PROVIDER_ATTEMPT_ACTIONS.has(event.action) &&
      event.data?.tradingDate === tradingDate
    )).length;
  }

  private attemptedEventCount(tradingDate: string): number {
    return this.options.store.listAudit(10_000).filter((event) => (
      (event.action === "wxpusher.paper-event.sent" ||
        event.action === "wxpusher.paper-event.failed") &&
      event.data?.tradingDate === tradingDate
    )).length;
  }

  private attemptedScheduledBriefingCount(tradingDate: string): number {
    return this.options.store.listAudit(10_000).filter((event) => (
      (event.action === "wxpusher.paper-plan.sent" ||
        event.action === "wxpusher.paper-plan.failed") &&
      event.data?.tradingDate === tradingDate &&
      event.data?.messageKind === "scheduled-briefing"
    )).length;
  }

  /** Event messages may use spare capacity only; six scheduled slots stay reserved. */
  private canSendEventWithoutStarvingBriefings(tradingDate: string): boolean {
    const remainingBriefings = Math.max(
      0,
      SCHEDULED_BRIEFING_COUNT - this.attemptedScheduledBriefingCount(tradingDate),
    );
    return (
      this.attemptedMessageCount(tradingDate) + 1 + remainingBriefings <=
      this.effectiveDailyLimit()
    );
  }

  private lastMarketEventAuditMs(tradingDate: string): number | null {
    const times = this.options.store.listAudit(10_000)
      .filter((event) => (
        (event.action === "wxpusher.paper-event.sent" ||
          event.action === "wxpusher.paper-event.failed") &&
        event.data?.tradingDate === tradingDate &&
        event.data?.messageKind === "market-anomaly"
      ))
      .map((event) => Date.parse(event.timestamp))
      .filter(Number.isFinite);
    return times.length > 0 ? Math.max(...times) : null;
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }
}
