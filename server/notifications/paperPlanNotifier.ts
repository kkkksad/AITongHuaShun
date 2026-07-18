import { createHash } from "node:crypto";
import type {
  AccountSnapshot,
  PositionSnapshot,
} from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";
import type {
  PaperTradingOperation,
  PaperTradingPlan,
} from "../research/paperTradingPlan";
import type { DailyMarketTone } from "../research/dailyMarketReview";
import type {
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
  policy: IntradayExecutionPolicy;
  marketContext: {
    sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
    tone: DailyMarketTone;
    summary: string;
    sectors: PaperPlanNotificationSector[];
    warnings: string[];
  };
}

export interface PaperPlanNotifierOptions {
  enabled: boolean;
  sender?: PaperPlanMessageSender;
  store: TradingStore;
  dailyMessageLimit: number;
  materialCooldownMs: number;
  clock?: () => Date;
}

export type PaperPlanMessageKind = "phase-briefing" | "material-update";

export type PaperPlanNotificationResult =
  | { status: "disabled" }
  | { status: "not-actionable" }
  | { status: "daily-limit" }
  | { status: "duplicate"; signature: string }
  | { status: "cooldown"; signature: string }
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
): WxPusherMessage {
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
  const headline = avoidNewRisk ? "市场不宜操作" : context.policy.phaseLabel;
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

  return {
    summary: `KAIROS paper ${headline} ${plan.tradingDate}`,
    content: [
      `<h2>KAIROS 本地 paper 简报</h2>`,
      `<p><strong>${escapeHtml(headline)}</strong> · ${escapeHtml(context.policy.phaseLabel)}<br />${escapeHtml(plan.tradingDate)} · ${sourceLabel}</p>`,
      "<hr />",
      "<h3>今日结论</h3>",
      `<p><strong>${escapeHtml(conclusion)}</strong><br />盘面：${escapeHtml(marketSummary)}</p>`,
      `<p>状态：${escapeHtml(regimeName)} · 策略：${escapeHtml(strategyName)}</p>`,
      "<h3>精确动作</h3>",
      actionHtml,
      "<h3>动作依据</h3>",
      `<p>适用：${escapeHtml(playbook?.useWhen ?? "等待真实数据确认")}<br />回避：${escapeHtml(playbook?.avoidWhen ?? "数据不足时不新增仓位")}<br />有效板块：${validSectorText}</p>`,
      "<h3>账户与持仓</h3>",
      `<p>现金 ${context.account.cash.toFixed(2)} 元 · 当前仓位 ${(investedRatio * 100).toFixed(1)}% · 阶段上限 ${(context.policy.maxInvestedRatio * 100).toFixed(1)}%<br />当前：${escapeHtml(formatCurrentPositions(context.positions))}<br />计划后：${formatHtmlPositions(targets)}</p>`,
      "<h3>风险与数据质量</h3>",
      `<p>策略风险：${strategyRisks.length > 0 ? strategyRisks.map(escapeHtml).join("；") : "未记录新增策略风险"}<br />数据质量：${dataQuality.length > 0 ? dataQuality.map(escapeHtml).join("；") : "真实只读来源未记录新增缺失项"}</p>`,
      "<hr />",
      "<p><small>仅用于本地模拟研究，不是真实持仓、真实订单或投资建议。</small></p>",
    ].join(""),
  };
}

function auditString(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === "string" ? value : null;
}

function isUrgentTransition(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
  previousData: Record<string, unknown> | undefined,
): boolean {
  const previousRegime = auditString(previousData, "regime");
  const previousSourceStatus = auditString(previousData, "sourceStatus");
  const previousMarketTone = auditString(previousData, "marketTone");
  return (
    (plan.adaptiveRouting?.regime === "risk-off" && previousRegime !== "risk-off") ||
    (context.marketContext.tone === "risk-off" && previousMarketTone !== "risk-off") ||
    (context.marketContext.sourceStatus === "degraded" && previousSourceStatus !== "degraded")
  );
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

    const signature = materialSignature(plan, context);
    const attempts = this.options.store.listAudit(10_000).filter((event) => (
      PROVIDER_ATTEMPT_ACTIONS.has(event.action) &&
      event.data?.tradingDate === plan.tradingDate
    ));
    const phaseAttempts = attempts.filter((event) => (
      event.data?.phase === context.policy.phase
    ));
    const duplicate = phaseAttempts.some((event) => (
      event.action === "wxpusher.paper-plan.sent" &&
      event.data?.signature === signature
    ));
    if (duplicate) {
      return { status: "duplicate", signature };
    }
    if (attempts.length >= this.options.dailyMessageLimit) {
      return { status: "daily-limit" };
    }

    const latestPhaseAttempt = phaseAttempts[0];
    const latestAttemptedAt = auditString(latestPhaseAttempt?.data, "attemptedAt");
    const elapsedMs = latestAttemptedAt
      ? this.now().getTime() - new Date(latestAttemptedAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (
      latestPhaseAttempt &&
      elapsedMs < this.options.materialCooldownMs &&
      !isUrgentTransition(plan, context, latestPhaseAttempt.data)
    ) {
      return { status: "cooldown", signature };
    }

    const messageKind: PaperPlanMessageKind = phaseAttempts.length === 0
      ? "phase-briefing"
      : "material-update";
    const attemptNumber = attempts.length + 1;
    const auditData = {
      tradingDate: plan.tradingDate,
      attemptedAt: this.now().toISOString(),
      phase: context.policy.phase,
      attemptNumber,
      messageKind,
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
      await this.options.sender.send(formatPaperPlanMessage(plan, context));
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
