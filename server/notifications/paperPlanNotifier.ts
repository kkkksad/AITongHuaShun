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

function formatOperations(operations: PaperTradingOperation[]): string {
  return compactList(
    operations.map((operation) => {
      const action = operation.action === "paper-buy-plan" ? "买入" : "卖出";
      return `${action} ${operation.symbol} ${operation.name} ${operation.quantity}股`;
    }),
    "无，继续观察",
    4,
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

function formatMessage(
  plan: PaperTradingPlan,
  context: PaperPlanNotificationContext,
): WxPusherMessage {
  const routing = plan.adaptiveRouting;
  const playbook = routing?.strategyPlaybook;
  const investedRatio = context.account.equity > 0
    ? context.account.marketValue / context.account.equity
    : 0;
  const sectors = context.marketContext.sectors
    .slice(0, 3)
    .map((sector) => `${sector.name}${formatSignedPercent(sector.changePercent)}`);
  const risks = [
    ...(routing?.riskFlags ?? []),
    ...context.marketContext.warnings,
  ].slice(0, 5);
  const targets = targetPositions(
    context.positions,
    context.executableOperations,
  );
  const sourceLabel = context.marketContext.sourceStatus === "live-read-only"
    ? "真实只读"
    : context.marketContext.sourceStatus === "degraded"
      ? "数据降级"
      : "模拟/不可用";

  return {
    summary: `KAIROS paper ${context.policy.phaseLabel} ${plan.tradingDate}`,
    content: [
      `KAIROS 本地paper简报｜${context.policy.phaseLabel}`,
      `日期：${plan.tradingDate}｜数据：${sourceLabel}`,
      `当前持仓：${formatCurrentPositions(context.positions)}`,
      `本轮paper动作：${formatOperations(context.executableOperations)}`,
      `计划后持仓：${compactList(targets.map(formatPosition), "空仓")}`,
      `账户：现金${context.account.cash.toFixed(2)}｜仓位${(investedRatio * 100).toFixed(1)}%｜阶段上限${(context.policy.maxInvestedRatio * 100).toFixed(1)}%`,
      `状态：${REGIME_LABELS[routing?.regime ?? "unclear"] ?? routing?.regime ?? "状态不清"}｜策略：${plan.topStrategy?.strategyName ?? "资金观察"}`,
      `适用：${playbook?.useWhen ?? "等待数据确认"}`,
      `回避：${playbook?.avoidWhen ?? "数据不足时不新增仓位"}`,
      `板块：${sectors.length > 0 ? sectors.join("｜") : "暂不可用"}`,
      `风险：${risks.length > 0 ? risks.join("；") : "未发现新增风险标记"}`,
      "仅用于本地模拟研究，不是真实持仓、真实订单或投资建议。",
    ].join("\n"),
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
  return (
    (plan.adaptiveRouting?.regime === "risk-off" && previousRegime !== "risk-off") ||
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
      signature,
      operationCount: context.executableOperations.length,
      symbols: context.executableOperations.map((operation) => operation.symbol),
      mode: "paper-research-only",
      liveTradingEnabled: false,
    };

    try {
      await this.options.sender.send(formatMessage(plan, context));
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
