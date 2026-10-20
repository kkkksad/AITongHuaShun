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
  marketContext: {
    sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
    tone: DailyMarketTone;
    summary: string;
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
  /** Kept for configuration compatibility; a trading day is still hard-capped at one message. */
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
  sequence: 1;
  scheduledAt: string;
  minuteOfDay: number;
  label: string;
  purpose: string;
}

export type PaperPlanMessageKind = "scheduled-briefing";

export interface PaperPlanMessageDelivery {
  messageKind: PaperPlanMessageKind;
  scheduledAt: string;
}

export type PaperPlanNotificationResult =
  | { status: "disabled" }
  | { status: "not-actionable" }
  | { status: "scheduled-wait"; scheduledAt: string }
  | { status: "window-closed" }
  | { status: "risk-suppressed"; events: string[] }
  | { status: "phase-used"; signature: string }
  | { status: "sent"; signature: string; messageKind: PaperPlanMessageKind }
  | { status: "failed"; signature: string; messageKind: PaperPlanMessageKind };

const BRIEFING_SLOT: PaperPlanBriefingSlot = {
  phase: "opening",
  sequence: 1,
  scheduledAt: "09:35",
  minuteOfDay: 9 * 60 + 35,
  label: "开盘执行简报",
  purpose: "避开开盘第一分钟噪音，给出当天唯一一次 Paper 执行摘要。",
};

const BRIEFING_WINDOW_END_MINUTE = 10 * 60 + 30;
const PROVIDER_ATTEMPT_ACTIONS = new Set([
  "wxpusher.paper-plan.sent",
  "wxpusher.paper-plan.failed",
]);
const RISK_AUDIT_ACTION = "wxpusher.paper-plan.urgent-suppressed";

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
  const minute = getChinaMinutes(value);
  if (minute < BRIEFING_SLOT.minuteOfDay || minute >= BRIEFING_WINDOW_END_MINUTE) {
    return null;
  }
  return BRIEFING_SLOT;
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

function formatMoney(value: number): string {
  return `${value.toFixed(2)} 元`;
}

function dailyRiskEvents(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
): string[] {
  const events: string[] = [];
  if (context.marketContext.sourceStatus !== "live-read-only") {
    events.push("market-data-not-live");
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
  if (plan.qualitySummary?.planQuality === "blocked") {
    return {
      label: "风控暂停",
      detail: "本轮没有新增风险，优先保留现金并等待阻塞条件解除。",
      color: "#b42318",
      background: "#fff1f0",
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

function formatOperation(operation: PaperTradingOperation): string {
  const direction = operation.action === "paper-buy-plan" ? "买入" : "卖出";
  const strategy = operation.strategy || operation.strategyKey || "策略未记录";
  return [
    `<strong>${direction} ${escapeHtml(operation.symbol)} ${escapeHtml(operation.name)}</strong>`,
    `${operation.quantity} 股 · ${formatMoney(operation.estimatedNotional)} · ${escapeHtml(strategy)}`,
    `依据：${escapeHtml(operation.reason)}`,
  ].join("<br />");
}

function formatExecuted(order: PaperPlanExecutedOrder): string {
  const direction = order.side === "buy" ? "买入" : "卖出";
  return `${direction} ${escapeHtml(order.symbol)} ${escapeHtml(order.name)} ${order.quantity} 股 · ${formatMoney(order.notional)} · ${escapeHtml(order.strategy)}`;
}

function formatUnfilled(order: PaperPlanUnfilledOrder): string {
  const direction = order.side === "buy" ? "买入" : "卖出";
  return `${direction} ${escapeHtml(order.symbol)} ${escapeHtml(order.name)} · ${escapeHtml(order.reason)}`;
}

export function formatPaperPlanMessage(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
  _slot: PaperPlanBriefingSlot = BRIEFING_SLOT,
  delivery: PaperPlanMessageDelivery = {
    messageKind: "scheduled-briefing",
    scheduledAt: BRIEFING_SLOT.scheduledAt,
  },
): WxPusherMessage {
  const conclusion = conclusionFor(plan, context);
  const operations = context.executableOperations.slice(0, 3);
  const execution = context.executionSummary;
  const investedRatio = context.account.equity > 0
    ? context.account.marketValue / context.account.equity
    : 0;
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
    ? `<ol>${operations.map((operation) => `<li>${formatOperation(operation)}</li>`).join("")}</ol>`
    : "<p>今日没有满足条件的买卖动作。</p>";
  const executedHtml = execution.executedOrders.length > 0
    ? `<ol>${execution.executedOrders.slice(0, 2).map((order) => `<li>${formatExecuted(order)}</li>`).join("")}</ol>${execution.executedOrders.length > 2 ? `<p>另有 ${execution.executedOrders.length - 2} 笔成交，请在订单历史查看。</p>` : ""}`
    : "<p>今日暂无成交。</p>";
  const unfilledHtml = execution.unfilledOrders.length > 0
    ? `<p>${execution.unfilledOrders.slice(0, 2).map((order) => formatUnfilled(order)).join("<br />")}</p>`
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
  const summary = `KAIROS 今日${conclusion.label}｜${operations.length > 0 ? `${operations.length} 项 Paper 动作` : "暂无动作"}｜${plan.tradingDate}`;

  return {
    summary,
    content: [
      `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.65;color:#172b4d;">`,
      `<div style="padding:12px 14px;background:${conclusion.background};border-left:4px solid ${conclusion.color};">`,
      `<div style="font-size:13px;color:#667085;">${escapeHtml(plan.tradingDate)} · ${escapeHtml(delivery.scheduledAt)} 唯一简报 · ${escapeHtml(sourceLabel)}</div>`,
      `<h2 style="margin:4px 0;font-size:21px;color:${conclusion.color};">今日结论：${escapeHtml(conclusion.label)}</h2>`,
      `<div>${escapeHtml(conclusion.detail)}</div>`,
      `</div>`,
      "<h3>今日动作</h3>",
      actionHtml,
      "<h3>原因</h3>",
      `<p><strong>最强证据：</strong>${escapeHtml(strongestEvidence)}<br /><strong>首个阻塞：</strong>${escapeHtml(primaryBlocker(plan))}</p>`,
      "<h3>资金与限制</h3>",
      `<p>权益 ${formatMoney(context.account.equity)} · 现金 ${formatMoney(context.account.cash)} · 仓位 ${(investedRatio * 100).toFixed(1)}%<br />实际单笔上限 ${formatMoney(effectiveOrderCap)} · 主要限制：${escapeHtml(limitingConstraint)}<br />计划 ${sizing?.plannedBuyOrderCount ?? operations.filter((operation) => operation.action === "paper-buy-plan").length} 笔买入 · 平均 ${formatMoney(sizing?.averagePlannedBuyNotional ?? 0)} · 最大 ${formatMoney(sizing?.largestPlannedBuyNotional ?? 0)} · 保留现金 ${formatMoney(plan.capitalPlan?.cashReserveAmount ?? 0)}<br />执行档位：${escapeHtml(profileLabel)} · 策略：${escapeHtml(strategyLabel)}</p>`,
      "<h3>最近成交</h3>",
      executedHtml,
      `<p>成交 ${execution.filledOrders} 笔 · 拒单 ${execution.rejectedOrders} 笔 · 待处理 ${execution.pendingOrders} 笔 · 手续费 ${formatMoney(execution.commission)}</p>`,
      ...(unfilledHtml ? [unfilledHtml] : []),
      "<h3>今日边界</h3>",
      `<p>仅 Paper 研究；不连接真实券商、不保证成交。每个真实交易日只发送这一条，法定节假日与周末不发送。</p>`,
      `<p style="color:#667085;"><small>非投资建议。数据来源：${escapeHtml(plan.provider)}。</small></p>`,
      "</div>",
    ].join(""),
  };
}

export class PaperPlanNotifier {
  constructor(private readonly options: PaperPlanNotifierOptions) {}

  async notify(
    plan: PaperTradingPlan,
    context: PaperPlanNotificationContext,
  ): Promise<PaperPlanNotificationResult> {
    if (!this.options.enabled || !this.options.sender) {
      return { status: "disabled" };
    }

    const now = this.now();
    const dayStatus = getAshareTradingDayStatus(now);
    if (!dayStatus.isTradingDay || getChinaDateKey(now) !== plan.tradingDate) {
      return { status: "not-actionable" };
    }

    const minute = getChinaMinutes(now);
    if (minute < BRIEFING_SLOT.minuteOfDay) {
      return { status: "scheduled-wait", scheduledAt: BRIEFING_SLOT.scheduledAt };
    }
    if (minute >= BRIEFING_WINDOW_END_MINUTE) {
      return { status: "window-closed" };
    }

    const attempts = this.options.store.listAudit(10_000).filter((event) => (
      PROVIDER_ATTEMPT_ACTIONS.has(event.action) &&
      event.data?.tradingDate === plan.tradingDate
    ));
    const signature = materialSignature(plan, context);
    if (attempts.length > 0) {
      return { status: "phase-used", signature };
    }

    const riskEvents = dailyRiskEvents(plan, context);
    if (riskEvents.length > 0) {
      const alreadyAudited = this.options.store.listAudit(10_000).some((event) => (
        event.action === RISK_AUDIT_ACTION &&
        event.data?.tradingDate === plan.tradingDate
      ));
      if (!alreadyAudited) {
        this.options.store.appendAudit(
          "system",
          RISK_AUDIT_ACTION,
          "Paper briefing suppressed by risk or data anomaly",
          {
            tradingDate: plan.tradingDate,
            attemptedAt: now.toISOString(),
            events: riskEvents,
            signature,
            mode: "paper-research-only",
            liveTradingEnabled: false,
          },
        );
      }
      return { status: "risk-suppressed", events: riskEvents };
    }

    const messageKind: PaperPlanMessageKind = "scheduled-briefing";
    const auditData = {
      tradingDate: plan.tradingDate,
      attemptedAt: now.toISOString(),
      scheduledAt: BRIEFING_SLOT.scheduledAt,
      messageKind,
      signature,
      strategy: plan.executionStrategy?.key ?? plan.topStrategy?.strategyKey ?? "unavailable",
      sourceStatus: context.marketContext.sourceStatus,
      marketTone: context.marketContext.tone,
      operationCount: context.executableOperations.length,
      symbols: context.executableOperations.map((operation) => operation.symbol),
      onePerTradingDay: true,
      mode: "paper-research-only",
      liveTradingEnabled: false,
    };

    try {
      await this.options.sender.send(formatPaperPlanMessage(plan, context, BRIEFING_SLOT, {
        messageKind,
        scheduledAt: BRIEFING_SLOT.scheduledAt,
      }));
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-plan.sent",
        "WxPusher daily paper briefing accepted",
        auditData,
      );
      return { status: "sent", signature, messageKind };
    } catch {
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-plan.failed",
        "WxPusher daily paper briefing failed",
        { ...auditData, reason: "provider-request-failed" },
      );
      return { status: "failed", signature, messageKind };
    }
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }
}