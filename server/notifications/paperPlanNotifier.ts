import { createHash } from "node:crypto";
import type {
  AccountSnapshot,
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
}

export interface PaperPlanBriefingSlot {
  phase: Exclude<AShareTradingPhase, "closed">;
  sequence: 1 | 2 | 3 | 4;
  scheduledAt: string;
  minuteOfDay: number;
  label: string;
  purpose: string;
  nextLabel: string;
}

export type PaperPlanMessageKind = "scheduled-briefing" | "urgent-update";

export type PaperPlanUrgentEvent =
  | "risk-off"
  | "data-degraded"
  | "paper-order-rejected"
  | "trading-paused";

export interface PaperPlanMessageDelivery {
  attemptNumber: number;
  dailyMessageLimit: number;
  messageKind: PaperPlanMessageKind;
  urgentEvents: PaperPlanUrgentEvent[];
}

export type PaperPlanNotificationResult =
  | { status: "disabled" }
  | { status: "not-actionable" }
  | { status: "scheduled-wait"; scheduledAt: string }
  | { status: "daily-limit" }
  | { status: "phase-used"; signature: string }
  | {
      status: "sent";
      signature: string;
      messageKind: PaperPlanMessageKind;
    }
  | {
      status: "failed";
      signature: string;
      messageKind: PaperPlanMessageKind;
    };

const REGIME_LABELS: Record<string, string> = {
  "trend-up-low-volatility": "低波上行",
  "trend-up-high-volatility": "高波上行",
  "range-low-volatility": "低波震荡",
  "range-high-volatility": "高波震荡",
  "risk-off": "风险收缩",
  unclear: "状态不清",
};

const PROVIDER_ATTEMPT_ACTIONS = new Set([
  "wxpusher.paper-plan.sent",
  "wxpusher.paper-plan.failed",
]);

const BRIEFING_SLOTS: readonly PaperPlanBriefingSlot[] = [
  {
    phase: "opening",
    sequence: 1,
    scheduledAt: "09:35",
    minuteOfDay: 9 * 60 + 35,
    label: "开盘定调",
    purpose: "避开开盘第一分钟噪音，确认今天是否允许新增 paper 风险。",
    nextLabel: "10:30 上午确认",
  },
  {
    phase: "morning-confirmation",
    sequence: 2,
    scheduledAt: "10:30",
    minuteOfDay: 10 * 60 + 30,
    label: "上午确认",
    purpose: "过滤开盘脉冲，复核策略、候选和计划动作是否仍然成立。",
    nextLabel: "13:30 午后风控",
  },
  {
    phase: "afternoon-confirmation",
    sequence: 3,
    scheduledAt: "13:30",
    minuteOfDay: 13 * 60 + 30,
    label: "午后风控",
    purpose: "检查午后盘面、现金、仓位和当日模拟执行是否需要收缩。",
    nextLabel: "14:50 尾盘复核",
  },
  {
    phase: "closing-risk-review",
    sequence: 4,
    scheduledAt: "14:50",
    minuteOfDay: 14 * 60 + 50,
    label: "尾盘复核",
    purpose: "汇总今日模拟结果，收拢尾盘风险并列出下一交易日观察条件。",
    nextLabel: "下一交易日 09:35 开盘定调",
  },
] as const;

const BRIEFING_SLOT_BY_PHASE = new Map(
  BRIEFING_SLOTS.map((slot) => [slot.phase, slot]),
);

const URGENT_EVENT_LABELS: Record<PaperPlanUrgentEvent, string> = {
  "risk-off": "市场转为不宜操作",
  "data-degraded": "真实数据源降级",
  "paper-order-rejected": "本地模拟订单出现拒单",
  "trading-paused": "本地模拟交易已暂停",
};

function chinaMinutes(value: Date): number {
  const shifted = new Date(value.getTime() + 8 * 60 * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function getPaperPlanBriefingSlot(
  value: Date,
  phase: AShareTradingPhase,
): PaperPlanBriefingSlot | null {
  if (phase === "closed") return null;
  const slot = BRIEFING_SLOT_BY_PHASE.get(phase);
  if (!slot || chinaMinutes(value) < slot.minuteOfDay) return null;
  return slot;
}

function slotForPhase(phase: AShareTradingPhase): PaperPlanBriefingSlot | null {
  return phase === "closed" ? null : BRIEFING_SLOT_BY_PHASE.get(phase) ?? null;
}

function chinaDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

export function summarizePaperOrders(
  orders: OrderRecord[],
  tradingDate: string,
): PaperPlanExecutionSummary {
  const today = orders.filter((order) => chinaDate(order.createdAt) === tradingDate);
  const filled = today.filter((order) => order.status === "filled");
  const roundMoney = (value: number) => Number(value.toFixed(2));
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
  };
}

function detectUrgentEvents(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
): PaperPlanUrgentEvent[] {
  const events: PaperPlanUrgentEvent[] = [];
  if (
    context.marketContext.tone === "risk-off" ||
    (plan.adaptiveRouting?.regime === "risk-off" &&
      plan.adaptiveRouting.allowNewPositions === false)
  ) {
    events.push("risk-off");
  }
  if (context.marketContext.sourceStatus === "degraded") {
    events.push("data-degraded");
  }
  if (context.executionSummary.rejectedOrders > 0) {
    events.push("paper-order-rejected");
  }
  if (context.account.paused) {
    events.push("trading-paused");
  }
  return events;
}

function auditUrgentEvents(data: Record<string, unknown> | undefined): string[] {
  return Array.isArray(data?.urgentEvents)
    ? data.urgentEvents.filter((value): value is string => typeof value === "string")
    : [];
}

function materialSignature(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
): string {
  const currentPositions = context.positions
    .filter((position) => position.quantity > 0)
    .map((position) => ({
      symbol: position.symbol,
      quantity: position.quantity,
    }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  const operations = context.executableOperations
    .map((operation) => ({
      symbol: operation.symbol,
      action: operation.action,
      quantity: operation.quantity,
    }))
    .sort((left, right) => (
      left.symbol.localeCompare(right.symbol) ||
      left.action.localeCompare(right.action)
    ));
  const routing = plan.adaptiveRouting;

  return createHash("sha256")
    .update(JSON.stringify({
      tradingDate: plan.tradingDate,
      regime: routing?.regime ?? "unavailable",
      strategy: plan.topStrategy?.strategyKey ?? "cash-observation",
      primaryStrategies: routing?.strategyPlaybook.primaryStrategyKeys ?? [],
      sourceStatus: context.marketContext.sourceStatus,
      marketTone: context.marketContext.tone,
      currentPositions,
      operations,
    }))
    .digest("hex");
}

function formatPosition(position: {
  symbol: string;
  name: string;
  quantity: number;
}): string {
  return `${position.symbol} ${position.name} ${position.quantity}股`;
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
  return [...new Set(values
    .map((value) => value?.trim() ?? "")
    .filter(Boolean))];
}

function isUnavailableText(value: string): boolean {
  return /暂不可用|不可用|未取得|unavailable|数据降级|源失败|请求失败|超时|为空/i.test(value);
}

function compactList(values: string[], empty: string, limit = 8): string {
  if (values.length === 0) return empty;
  const visible = values.slice(0, limit);
  const remaining = values.length - visible.length;
  return `${visible.join("；")}${remaining > 0 ? `；另${remaining}项` : ""}`;
}

function formatCurrentPositions(positions: PositionSnapshot[]): string {
  return compactList(
    positions
      .filter((position) => position.quantity > 0)
      .map(formatPosition),
    "空仓",
  );
}

function targetPositions(
  positions: PositionSnapshot[],
  operations: PaperTradingOperation[],
): Array<{ symbol: string; name: string; quantity: number }> {
  const targets = new Map(
    positions
      .filter((position) => position.quantity > 0)
      .map((position) => [position.symbol, {
        symbol: position.symbol,
        name: position.name,
        quantity: position.quantity,
      }]),
  );

  for (const operation of operations) {
    const current = targets.get(operation.symbol) ?? {
      symbol: operation.symbol,
      name: operation.name,
      quantity: 0,
    };
    const delta = operation.action === "paper-buy-plan"
      ? operation.quantity
      : -operation.quantity;
    const quantity = Math.max(0, current.quantity + delta);
    if (quantity === 0) {
      targets.delete(operation.symbol);
    } else {
      targets.set(operation.symbol, { ...current, quantity });
    }
  }

  return [...targets.values()].sort((left, right) => (
    left.symbol.localeCompare(right.symbol)
  ));
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatAction(operation: PaperTradingOperation): string {
  const action = operation.action === "paper-buy-plan" ? "买入" : "卖出";
  return [
    `<strong>${action} ${escapeHtml(operation.symbol)} ${escapeHtml(operation.name)} ${operation.quantity}股</strong>`,
    `参考价 ${operation.price.toFixed(2)} 元`,
    `预计金额 ${operation.estimatedNotional.toFixed(2)} 元`,
    `原因：${escapeHtml(operation.reason)}`,
  ].join("<br />");
}

function formatHtmlPositions(
  positions: Array<{ symbol: string; name: string; quantity: number }>,
  empty = "空仓",
): string {
  return escapeHtml(compactList(positions.map(formatPosition), empty, 6));
}

export function formatPaperPlanMessage(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
  briefingSlot = slotForPhase(context.policy.phase),
  delivery: PaperPlanMessageDelivery = {
    attemptNumber: 1,
    dailyMessageLimit: 10,
    messageKind: "scheduled-briefing",
    urgentEvents: [],
  },
): WxPusherMessage {
  if (!briefingSlot) {
    throw new Error("Paper plan briefing requires an active notification slot");
  }
  const routing = plan.adaptiveRouting;
  const playbook = routing?.strategyPlaybook;
  const investedRatio = context.account.equity > 0
    ? context.account.marketValue / context.account.equity
    : 0;
  const sectors = context.marketContext.sectors
    .filter((sector) => (
      sector.name.trim().length > 0 &&
      !isUnavailableText(sector.name) &&
      Number.isFinite(sector.changePercent)
    ))
    .slice(0, 3)
    .map((sector) => `${sector.name}${formatSignedPercent(sector.changePercent)}`);
  const routingRisks = uniqueText(routing?.riskFlags ?? []);
  const strategyRisks = routingRisks.filter((risk) => !isUnavailableText(risk)).slice(0, 4);
  const dataWarnings = uniqueText([
    ...context.marketContext.warnings,
    ...routingRisks.filter(isUnavailableText),
  ]).slice(0, 5);
  const targets = targetPositions(
    context.positions,
    context.executableOperations,
  );
  const sourceLabel = context.marketContext.sourceStatus === "live-read-only"
    ? "真实只读"
    : context.marketContext.sourceStatus === "degraded"
      ? "数据降级"
      : "模拟/不可用";
  const avoidNewRisk =
    context.marketContext.tone === "risk-off" ||
    (routing?.regime === "risk-off" && routing.allowNewPositions === false);
  const headline = avoidNewRisk
    ? "市场不宜操作"
    : context.executableOperations.length > 0
      ? `本时段有 ${context.executableOperations.length} 项模拟动作`
      : "暂无动作，继续等待";
  const conclusion = avoidNewRisk
    ? "市场不宜操作，暂停新增 paper 仓位，优先保留现金并执行既定风控。"
    : context.executableOperations.length > 0
      ? `本阶段有 ${context.executableOperations.length} 项通过资金、仓位和策略约束的 paper 计划，仍需以实际撮合结果为准。`
      : "本阶段无可执行 paper 动作，不为交易次数强行下单，继续等待策略与风险条件同时满足。";
  const marketSummary = isUnavailableText(context.marketContext.summary)
    ? "盘面摘要未通过有效性校验，不作为本轮新增风险依据。"
    : context.marketContext.summary;
  const dataQuality = uniqueText([
    context.marketContext.sourceStatus === "degraded"
      ? "数据处于降级状态，本轮不依据缺失项增加风险暴露"
      : context.marketContext.sourceStatus === "mock-disabled"
        ? "真实只读研究源未启用，本轮不依据模拟输入增加风险暴露"
        : null,
    ...dataWarnings,
    isUnavailableText(context.marketContext.summary) ? "盘面摘要无有效内容" : null,
  ]);
  const actionHtml = context.executableOperations.length > 0
    ? `<ol>${context.executableOperations.slice(0, 4).map((operation) => `<li>${formatAction(operation)}</li>`).join("")}</ol>`
    : `<p><strong>本阶段无可执行 paper 动作。</strong><br />${escapeHtml(conclusion)}</p>`;
  const strategyName = plan.topStrategy?.strategyName ?? "资金观察";
  const regimeName = REGIME_LABELS[routing?.regime ?? "unclear"] ?? routing?.regime ?? "状态不清";
  const validSectorText = sectors.length > 0
    ? sectors.map(escapeHtml).join("；")
    : "没有通过有效性校验的板块证据";
  const newsHighlights = (context.marketContext.newsHighlights ?? [])
    .filter((item) => (
      item.source.trim().length > 0 &&
      item.title.trim().length > 0 &&
      !isUnavailableText(item.title)
    ))
    .slice(0, 2)
    .map((item) => `${item.source}：${item.title}`);
  const globalSummary = context.marketContext.globalImpact?.summary;
  const globalDrivers = (context.marketContext.globalImpact?.drivers ?? [])
    .filter((driver) => driver.trim().length > 0 && !isUnavailableText(driver))
    .slice(0, 3);
  const globalText = globalSummary && !isUnavailableText(globalSummary)
    ? globalSummary
    : "外围信号未形成有效结论";
  const macroHtml = [
    `外围：${escapeHtml(globalText)}${globalDrivers.length > 0 ? `（${globalDrivers.map(escapeHtml).join("；")}）` : ""}`,
    `新闻：${newsHighlights.length > 0 ? newsHighlights.map(escapeHtml).join("；") : "暂无通过有效性校验的重要标题"}`,
  ].join("<br />");
  const execution = context.executionSummary;
  const statusColor = avoidNewRisk ? "#b42318" : "#067647";
  const statusBackground = avoidNewRisk ? "#fff1f0" : "#ecfdf3";
  const dailyPnlSign = context.account.dailyPnl > 0 ? "+" : "";
  const dailyPnl = `${dailyPnlSign}${context.account.dailyPnl.toFixed(2)} 元 (${dailyPnlSign}${(context.account.dailyPnlPercent * 100).toFixed(2)}%)`;
  const executionText = [
    `成交 ${execution.filledOrders} 笔`,
    `拒单 ${execution.rejectedOrders} 笔`,
    `待处理 ${execution.pendingOrders} 笔`,
    execution.cancelledOrders > 0 ? `撤单 ${execution.cancelledOrders} 笔` : null,
  ].filter(Boolean).join(" · ");
  const stageReview = briefingSlot.sequence === 4
    ? `<h3>尾盘结果</h3><p>当日 Paper 盈亏 ${escapeHtml(dailyPnl)}<br />${escapeHtml(executionText)}<br />买入 ${execution.buyNotional.toFixed(2)} 元 · 卖出 ${execution.sellNotional.toFixed(2)} 元 · 手续费 ${execution.commission.toFixed(2)} 元</p>`
    : `<h3>策略与盘面</h3><p>状态：${escapeHtml(regimeName)} · 策略：${escapeHtml(strategyName)}<br />适用：${escapeHtml(playbook?.useWhen ?? "等待真实数据确认")}<br />回避：${escapeHtml(playbook?.avoidWhen ?? "数据不足时不新增仓位")}<br />有效板块：${validSectorText}<br />${macroHtml}</p>`;
  const deliveryLabel = delivery.messageKind === "scheduled-briefing"
    ? `固定简报 ${briefingSlot.sequence}/4`
    : "重要事件快报";
  const urgentText = delivery.urgentEvents.length > 0
    ? delivery.urgentEvents.map((event) => URGENT_EVENT_LABELS[event]).join("；")
    : null;
  const timingLabel = delivery.messageKind === "scheduled-briefing"
    ? `${escapeHtml(briefingSlot.label)} ${briefingSlot.scheduledAt}`
    : `关联阶段 ${escapeHtml(briefingSlot.label)}`;

  return {
    summary: `KAIROS ${delivery.attemptNumber}/${delivery.dailyMessageLimit} ${deliveryLabel} | ${headline} | ${plan.tradingDate}`,
    content: [
      `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.65;color:#172b4d;">`,
      `<div style="padding:12px 14px;background:#f6f8fa;border-left:4px solid ${statusColor};">`,
      `<div style="font-size:13px;color:#667085;">今日第 ${delivery.attemptNumber}/${delivery.dailyMessageLimit} 条 · ${deliveryLabel} · ${timingLabel}</div>`,
      `<h2 style="margin:4px 0 2px;font-size:21px;">KAIROS 本地 Paper 简报</h2>`,
      `<div style="font-size:13px;color:#667085;">${escapeHtml(plan.tradingDate)} · ${sourceLabel} · ${escapeHtml(urgentText ?? briefingSlot.purpose)}</div>`,
      `</div>`,
      "<h3>一眼结论</h3>",
      `<div style="padding:10px 12px;background:${statusBackground};border-radius:6px;"><strong style="color:${statusColor};">${escapeHtml(headline)}</strong><br />${escapeHtml(conclusion)}<br />盘面：${escapeHtml(marketSummary)}</div>`,
      "<h3>关键数字</h3>",
      `<p>权益 ${context.account.equity.toFixed(2)} 元 · 现金 ${context.account.cash.toFixed(2)} 元<br />当前仓位 ${(investedRatio * 100).toFixed(1)}% / 阶段上限 ${(context.policy.maxInvestedRatio * 100).toFixed(1)}% · 当日 Paper 盈亏 ${escapeHtml(dailyPnl)}</p>`,
      "<h3>本时段动作</h3>",
      actionHtml,
      "<h3>当前与计划后持仓</h3>",
      `<p>当前：${escapeHtml(formatCurrentPositions(context.positions))}<br />计划后：${formatHtmlPositions(targets)}</p>`,
      stageReview,
      briefingSlot.sequence === 4
        ? `<h3>策略与盘面</h3><p>状态：${escapeHtml(regimeName)} · 策略：${escapeHtml(strategyName)}<br />有效板块：${validSectorText}<br />${macroHtml}<br />明日复核：${escapeHtml(compactList(playbook?.recheckTriggers ?? [], "等待下一交易日真实数据", 3))}</p>`
        : `<h3>今日模拟执行</h3><p>${escapeHtml(executionText)}<br />买入 ${execution.buyNotional.toFixed(2)} 元 · 卖出 ${execution.sellNotional.toFixed(2)} 元 · 手续费 ${execution.commission.toFixed(2)} 元</p>`,
      "<h3>风险与数据</h3>",
      `<p>策略风险：${strategyRisks.length > 0 ? compactList(strategyRisks, "", 3).split("；").map(escapeHtml).join("；") : "未记录新增策略风险"}<br />数据质量：${dataQuality.length > 0 ? compactList(dataQuality, "", 3).split("；").map(escapeHtml).join("；") : "真实只读来源未记录新增缺失项"}</p>`,
      "<h3>下一次提醒</h3>",
      `<p><strong>下一条：${escapeHtml(briefingSlot.nextLabel)}</strong><br />固定简报不重复；仅新的重要事件可能使用预留额度。</p>`,
      "<hr />",
      "<p><small>仅用于本地模拟研究，不是真实持仓、真实订单或投资建议。</small></p>",
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
    if (context.policy.phase === "closed") {
      return { status: "not-actionable" };
    }

    const now = this.now();
    const configuredSlot = slotForPhase(context.policy.phase);
    if (!configuredSlot) {
      return { status: "not-actionable" };
    }
    const briefingSlot = getPaperPlanBriefingSlot(now, context.policy.phase);

    const signature = materialSignature(plan, context);
    const attempts = this.options.store.listAudit(10_000).filter((event) => (
      PROVIDER_ATTEMPT_ACTIONS.has(event.action) &&
      event.data?.tradingDate === plan.tradingDate
    ));
    const phaseAttempts = attempts.filter((event) => (
      event.data?.phase === context.policy.phase
    ));
    const alertedUrgentEvents = new Set(
      attempts.flatMap((event) => auditUrgentEvents(event.data)),
    );
    const urgentEvents = detectUrgentEvents(plan, context).filter(
      (event) => !alertedUrgentEvents.has(event),
    );

    let messageKind: PaperPlanMessageKind;
    if (urgentEvents.length > 0) {
      messageKind = "urgent-update";
    } else {
      if (!briefingSlot) {
        return {
          status: "scheduled-wait",
          scheduledAt: configuredSlot.scheduledAt,
        };
      }
      if (phaseAttempts.length > 0) {
        return { status: "phase-used", signature };
      }
      messageKind = "scheduled-briefing";
    }

    const dailyMessageLimit = Math.min(this.options.dailyMessageLimit, 10);
    if (attempts.length >= dailyMessageLimit) {
      return { status: "daily-limit" };
    }

    const attemptNumber = attempts.length + 1;
    const auditData = {
      tradingDate: plan.tradingDate,
      attemptedAt: now.toISOString(),
      phase: context.policy.phase,
      attemptNumber,
      messageKind,
      slotSequence: configuredSlot.sequence,
      scheduledAt: configuredSlot.scheduledAt,
      slotLabel: configuredSlot.label,
      urgentEvents,
      regime: plan.adaptiveRouting?.regime ?? "unavailable",
      strategy: plan.topStrategy?.strategyKey ?? "cash-observation",
      sourceStatus: context.marketContext.sourceStatus,
      marketTone: context.marketContext.tone,
      signature,
      operationCount: context.executableOperations.length,
      symbols: context.executableOperations.map((operation) => operation.symbol),
      mode: "paper-research-only",
      liveTradingEnabled: false,
    };

    try {
      await this.options.sender.send(formatPaperPlanMessage(
        plan,
        context,
        briefingSlot ?? configuredSlot,
        {
          attemptNumber,
          dailyMessageLimit,
          messageKind,
          urgentEvents,
        },
      ));
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-plan.sent",
        "WxPusher paper briefing accepted",
        auditData,
      );
      return { status: "sent", signature, messageKind };
    } catch {
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-plan.failed",
        "WxPusher paper briefing failed",
        { ...auditData, reason: "provider-request-failed" },
      );
      return { status: "failed", signature, messageKind };
    }
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }
}
