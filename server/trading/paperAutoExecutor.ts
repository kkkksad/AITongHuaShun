import {
  getPaperExecutionStrategyOption,
  type AccountSnapshot,
  type MarketSnapshot,
  type OrderRecord,
  type OrderRequest,
  type PaperExecutionStrategy,
  type PaperStrategyProfile,
  type PositionSnapshot,
} from "../../shared/trading";
import type { ServerConfig } from "../config";
import type { TradingSystem } from "../system";
import { executionCosts, hasSufficientCash } from "../broker/executionCosts";
import {
  buildExternalMarketNotificationImpact,
  summarizePaperOrders,
  type PaperPlanNotifier,
  type PaperPlanNotificationContext,
} from "../notifications/paperPlanNotifier";
import { buildCurrentPaperTradingPlan } from "../research/paperTradingPlanService";
import { assessMarketSnapshot } from "../research/dailyMarketReview";
import type { AdaptiveStrategyRouting } from "../research/adaptiveStrategyRouter";
import {
  buildResearchInputDiagnostics,
  type ResearchInputDiagnostics,
} from "../research/researchInputDiagnostics";
import {
  getAshareMarketSession,
  getChinaDateKey,
  type AshareMarketSession,
} from "./ashareTradingCalendar";
import type {
  PaperTradingOperation,
  PaperTradingPlan,
  PaperTradingPlanSizingConstraint,
} from "../research/paperTradingPlan";
import {
  getAshareTradingPhase,
  getPhaseCumulativeOrderLimit,
  getIntradayExecutionPolicy,
  type AShareTradingPhase,
  type IntradayExecutionPolicy,
} from "./intradayExecutionPolicy";
import { getPaperStrategyProfilePolicy } from "./paperStrategyProfile";
import { getOrderFillTime } from "./orderFillTime";
import { assertPaperExecutionRevision, assertPaperLedgerContext, capturePaperLedgerContext, PaperExecutionContextChangedError } from "./paperExecutionContext";
import { PaperExecutionTimer } from "./paperExecutionTiming";
import type { PaperExecutionTiming } from "../../shared/paperExecutionTiming";
import { derivePaperSkipBlockerStage, selectPaperSkipEvidence, type PaperSkipBlockerStage } from "./paperSkipEvidence";

export type PaperAutoExecutionTrigger = "timer" | "manual" | "startup";
export type PaperAutoExecutionActivityMode =
  | "observe"
  | "qualified-probe"
  | "validation-probe";
export type PaperAutoExecutionSession = AshareMarketSession;

export interface PaperAutoExecutionOrder {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  clientOrderId: string;
  status: OrderRecord["status"];
  orderId: string;
  rejectionReason?: string;
  strategy: string;
  strategyKey: string | null;
  reason: string;
  ruleChecks: string[];
  estimatedNotional: number;
}

export interface PaperAutoExecutionPlanSnapshot {
  operationCount: number;
  buyPlanCount: number;
  sellPlanCount: number;
  buyNotional: number;
  sellNotional: number;
}

function buildPlanSnapshot(
  plan: PaperTradingPlan,
): PaperAutoExecutionPlanSnapshot {
  const buyPlans = plan.operations.filter(
    (operation) => operation.action === "paper-buy-plan",
  );
  const sellPlans = plan.operations.filter(
    (operation) => operation.action === "paper-sell-plan",
  );
  return {
    operationCount: plan.operations.length,
    buyPlanCount: buyPlans.length,
    sellPlanCount: sellPlans.length,
    buyNotional: Number(
      buyPlans.reduce((sum, operation) => sum + operation.estimatedNotional, 0)
        .toFixed(2),
    ),
    sellNotional: Number(
      sellPlans.reduce((sum, operation) => sum + operation.estimatedNotional, 0)
        .toFixed(2),
    ),
  };
}

export interface PaperAutoExecutionSkip {
  symbol: string;
  action: PaperTradingOperation["action"];
  reason: string;
  strategy?: string;
  strategyKey?: string | null;
  quantity?: number;
  price?: number;
  estimatedNotional?: number;
  blockerStage?: PaperSkipBlockerStage;
}

export interface PaperAutoExecutionResearchContext {
  regime: string;
  observedRegime: string;
  routingStability: AdaptiveStrategyRouting["stability"]["status"];
  previousConfirmedRegime: string | null;
  previousConfirmedAt: string | null;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  allowNewPositions: boolean;
  candidatePoolSize: number;
  affordableCandidateCount: number;
  executionStrategy: PaperExecutionStrategy;
  executionStrategyLabel: string;
  executionStrategyMode: "auto" | "manual";
  selectedStrategyMatched: boolean;
  matchedCandidateCount: number;
  strategyCoverage: PaperTradingPlan["qualitySummary"]["strategyCoverage"];
  dominantBlocker: string | null;
  dominantBlockerReason: string | null;
  blockedReasons: PaperTradingPlan["qualitySummary"]["blockedReasons"];
  researchDiagnostics?: ResearchInputDiagnostics;
}

export interface PaperAutoExecutionRun {
  id: string;
  trigger: PaperAutoExecutionTrigger;
  startedAt: string;
  finishedAt: string;
  timing?: PaperExecutionTiming;
  tradingDate: string;
  session: PaperAutoExecutionSession;
  phase: AShareTradingPhase;
  phaseMaxInvestedRatio: number;
  planQuality: PaperTradingPlan["qualitySummary"]["planQuality"] | "not-run";
  activityMode?: PaperAutoExecutionActivityMode;
  planSnapshot?: PaperAutoExecutionPlanSnapshot;
  researchContext?: PaperAutoExecutionResearchContext;
  submittedOrders: PaperAutoExecutionOrder[];
  skippedOperations: PaperAutoExecutionSkip[];
  guardrails: string[];
}

export interface PaperActivityTargetStatus {
  status: "met" | "active" | "blocked" | "closed";
  targetOrders: number;
  filledOrders: number;
  remainingOrders: number;
  reason: string;
}

export interface PaperAutoExecutionStatus {
  enabled: boolean;
  running: boolean;
  mode: "paper-auto";
  execution: "local-paper-broker-only";
  liveTradingEnabled: false;
  intervalMs: number;
  tradeWindowOnly: boolean;
  maxOrdersPerRun: number;
  maxDailyOrders: number;
  targetDailyOrders: number;
  activityMode: PaperAutoExecutionActivityMode;
  qualifiedProbeActive: boolean;
  todaySubmittedOrders: number;
  todayFilledOrders: number;
  activityTarget: PaperActivityTargetStatus;
  phaseDailyOrderLimit: number;
  phaseRemainingOrders: number;
  currentSession: PaperAutoExecutionSession;
  currentPhase: AShareTradingPhase;
  phaseMaxInvestedRatio: number;
  startedAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  latestRun: PaperAutoExecutionRun | null;
  recentRuns: PaperAutoExecutionRun[];
  guardrails: string[];
}

export interface PaperAutoExecutorOptions {
  system: TradingSystem;
  config: ServerConfig;
  enabled: boolean;
  intervalMs: number;
  tradeWindowOnly: boolean;
  maxOrdersPerRun: number;
  maxDailyOrders: number;
  targetDailyOrders: number;
  clock?: () => Date;
  monotonicClock?: () => number;
  onOrder?: (order: OrderRecord, request: OrderRequest) => void;
  planNotifier?: Pick<PaperPlanNotifier, "notify" | "notifyOrderEvents">;
}

export interface SequentialTaskTimerApi {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SequentialTaskSchedulerOptions {
  intervalMs: number;
  task: () => Promise<void>;
  timers?: SequentialTaskTimerApi;
  clock?: () => Date;
  onError?: (error: unknown) => void;
}

function defaultTimers(): SequentialTaskTimerApi {
  return {
    setTimeout(callback, delayMs) {
      const handle = setTimeout(callback, delayMs);
      handle.unref?.();
      return handle;
    },
    clearTimeout(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

export class SequentialTaskScheduler {
  private readonly timers: SequentialTaskTimerApi;
  private timer: unknown | null = null;
  private active = false;
  private nextRunAt: string | null = null;

  constructor(private readonly options: SequentialTaskSchedulerOptions) {
    this.timers = options.timers ?? defaultTimers();
  }

  start(initialTask: (() => Promise<void>) | null = null): void {
    if (this.active) return;
    this.active = true;
    void this.run(initialTask ?? this.options.task);
  }

  stop(): void {
    this.active = false;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.nextRunAt = null;
  }

  isStarted(): boolean {
    return this.active;
  }

  getNextRunAt(): string | null {
    return this.nextRunAt;
  }

  private async run(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      if (this.active) this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.nextRunAt = new Date(
      (this.options.clock?.() ?? new Date()).getTime() + this.options.intervalMs,
    ).toISOString();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.nextRunAt = null;
      if (!this.active) return;
      void this.run(this.options.task);
    }, this.options.intervalMs);
  }
}

interface PreparedPaperOperation {
  operation: PaperTradingOperation;
  request: OrderRequest;
}

const HISTORY_LIMIT = 30;
const AUDIT_HEARTBEAT_MS = 15 * 60_000;
export function getAshareSession(value = new Date()): PaperAutoExecutionSession {
  return getAshareMarketSession(value);
}
export function getChinaTradeDate(value = new Date()): string {
  return getChinaDateKey(value);
}

export function resolvePaperActivityTarget(input: {
  targetOrders: number;
  filledOrders: number;
  session: PaperAutoExecutionSession;
  latestRun: PaperAutoExecutionRun | null;
  tradingDate?: string;
}): PaperActivityTargetStatus {
  const targetOrders = Math.max(1, Math.floor(input.targetOrders));
  const filledOrders = Math.max(0, Math.floor(input.filledOrders));
  const remainingOrders = Math.max(0, targetOrders - filledOrders);
  if (remainingOrders === 0) {
    return {
      status: "met",
      targetOrders,
      filledOrders,
      remainingOrders,
      reason: "今日 Paper 成交活跃度目标已达到。",
    };
  }
  if (
    input.session === "after-hours" ||
    input.session === "weekend" ||
    input.session === "holiday" ||
    input.session === "calendar-unavailable"
  ) {
    return {
      status: "closed",
      targetOrders,
      filledOrders,
      remainingOrders,
      reason: "当前不在 A 股交易时段，今日未完成的目标不会触发补单。",
    };
  }
  const applicableRun = input.latestRun && (
    input.tradingDate === undefined ||
    input.latestRun.tradingDate === input.tradingDate
  )
    ? input.latestRun
    : null;
  const rejectedOrder = applicableRun
    ? applicableRun.submittedOrders.find((order) => order.status === "rejected")
    : undefined;
  if (
    input.session === "open" &&
    applicableRun &&
    (
      applicableRun.planQuality !== "actionable" ||
      applicableRun.researchContext?.sourceStatus === "degraded" ||
      rejectedOrder ||
      applicableRun.submittedOrders.length === 0
    )
  ) {
    const blockedReason = rejectedOrder?.rejectionReason ??
      applicableRun.skippedOperations.find((operation) => operation.action === "blocked")?.reason ??
      applicableRun.skippedOperations[0]?.reason;
    return {
      status: "blocked",
      targetOrders,
      filledOrders,
      remainingOrders,
      reason: blockedReason
        ? `当前计划被阻塞：${blockedReason}`
        : "当前计划或真实历史数据不足，不能为完成目标绕过风控。",
    };
  }
  return {
    status: "active",
    targetOrders,
    filledOrders,
    remainingOrders,
    reason: input.session === "open"
      ? "目标进行中，仅在候选通过全部数据、费用和风控检查后提交 Paper 订单。"
      : "等待下一个 A 股交易时段，不会提前或补偿性下单。",
  };
}

export function shouldRunScheduledPaperAutoExecution(
  value: Date,
  tradeWindowOnly: boolean,
): boolean {
  return !tradeWindowOnly || getAshareSession(value) === "open";
}

export function hasUsableTradingQuote(
  snapshot: { quotes: Array<{ tradable: boolean; price: number; updatedAt?: string }> },
  freshnessReason?: (quote: { updatedAt?: string }) => string | null,
): boolean {
  return snapshot.quotes.some(
    (quote) => quote.tradable && Number.isFinite(quote.price) && quote.price > 0 &&
      !freshnessReason?.(quote),
  );
}

export function paperAutoExecutionAuditSignature(
  run: PaperAutoExecutionRun,
): string {
  return JSON.stringify({
    tradingDate: run.tradingDate,
    session: run.session,
    phase: run.phase,
    planQuality: run.planQuality,
    planSnapshot: run.planSnapshot ?? null,
    researchContext: run.researchContext ?? null,
    submittedOrders: run.submittedOrders.map((order) => ({
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      status: order.status,
      rejectionReason: order.rejectionReason ?? null,
    })),
    skippedOperations: run.skippedOperations.map((operation) => ({
      symbol: operation.symbol,
      action: operation.action,
      reason: operation.reason,
      strategy: operation.strategy ?? null,
      strategyKey: operation.strategyKey ?? null,
      quantity: operation.quantity ?? null,
      price: operation.price ?? null,
      estimatedNotional: operation.estimatedNotional ?? null,
      ...(operation.blockerStage ? { blockerStage: operation.blockerStage } : {}),
    })),
  });
}

export function shouldPersistPaperAutoExecutionRun(input: {
  run: PaperAutoExecutionRun;
  previousSignature: string | null;
  previousPersistedAt: number | null;
  heartbeatMs?: number;
}): boolean {
  if (input.run.trigger !== "timer" || input.run.submittedOrders.length > 0) {
    return true;
  }
  const currentSignature = paperAutoExecutionAuditSignature(input.run);
  if (input.previousSignature !== currentSignature) return true;
  if (input.previousPersistedAt === null) return true;
  const finishedAt = Date.parse(input.run.finishedAt);
  if (!Number.isFinite(finishedAt)) return true;
  return finishedAt - input.previousPersistedAt >=
    (input.heartbeatMs ?? AUDIT_HEARTBEAT_MS);
}

export function isPaperOperationBlockedByPhaseBudget(
  operation: PaperTradingOperation,
  remainingPhaseOrders: number,
): boolean {
  return remainingPhaseOrders <= 0 && operation.strategy !== "回撤控制";
}

export function paperNonExecutableReason(operation: PaperTradingOperation): string {
  if (operation.action === "hold" || operation.action === "observe") {
    return `正常观望：${operation.reason}`;
  }
  if (operation.action === "blocked") return `计划阻塞：${operation.reason}`;
  return `non-executable paper action ${operation.action}: ${operation.reason}`;
}

export function shouldActivateQualifiedPaperProbe(input: {
  mode: PaperAutoExecutionActivityMode;
  phase: AShareTradingPhase;
  remainingTargetOrders: number;
}): boolean {
  if (input.remainingTargetOrders <= 0) return false;
  if (input.mode === "qualified-probe") {
    return input.phase === "afternoon-confirmation" ||
      input.phase === "closing-risk-review";
  }
  if (input.mode === "validation-probe") {
    return input.phase === "morning-confirmation" ||
      input.phase === "afternoon-confirmation" ||
      input.phase === "closing-risk-review";
  }
  return false;
}

function paperOperationStrategyKey(operation: PaperTradingOperation): string | null {
  if (operation.strategyKey) return operation.strategyKey;
  for (const ruleCheck of operation.ruleChecks) {
    const match = /^strategy-route: pass \(([^)]+)\)$/.exec(ruleCheck);
    if (match?.[1]) return match[1];
  }
  return null;
}

function paperAutoExecutionSkip(
  operation: PaperTradingOperation,
  reason: string,
): PaperAutoExecutionSkip {
  const blockerStage = derivePaperSkipBlockerStage(operation);
  return {
    symbol: operation.symbol,
    action: operation.action,
    reason,
    strategy: operation.strategy,
    strategyKey: paperOperationStrategyKey(operation),
    quantity: operation.quantity,
    price: operation.price,
    estimatedNotional: Math.max(0, operation.estimatedNotional),
    ...(blockerStage ? { blockerStage } : {}),
  };
}

type NotificationResearchSourceStatus =
  | "live-read-only"
  | "degraded"
  | "mock-disabled";

export function resolveNotificationSourceStatus(input: {
  marketRegime: NotificationResearchSourceStatus;
  auxiliaryResearch: NotificationResearchSourceStatus;
}): NotificationResearchSourceStatus {
  return input.marketRegime;
}

export function buildPaperExecutionResearchContext(input: {
  plan: PaperTradingPlan;
  adaptiveRouting: AdaptiveStrategyRouting;
  sourceStatus: NotificationResearchSourceStatus;
  researchDiagnostics?: ResearchInputDiagnostics;
}): PaperAutoExecutionResearchContext {
  const { plan, adaptiveRouting } = input;
  const dominantBlocker = plan.qualitySummary.strategyCoverage.dominantBlocker;
  const dominantBlockerOperation = plan.operations.find((operation) =>
    operation.action === "blocked" &&
    (
      dominantBlocker === null ||
      operation.ruleChecks.includes(dominantBlocker)
    )
  );
  return {
    regime: adaptiveRouting.regime,
    observedRegime: adaptiveRouting.stability.observedRegime,
    routingStability: adaptiveRouting.stability.status,
    previousConfirmedRegime:
      adaptiveRouting.stability.previousConfirmedRegime,
    previousConfirmedAt: adaptiveRouting.stability.previousConfirmedAt,
    sourceStatus: input.sourceStatus,
    allowNewPositions: adaptiveRouting.allowNewPositions,
    candidatePoolSize: plan.qualitySummary.candidatePoolSize,
    affordableCandidateCount: plan.qualitySummary.affordableCandidateCount,
    executionStrategy: plan.executionStrategy.key,
    executionStrategyLabel: plan.executionStrategy.label,
    executionStrategyMode: plan.executionStrategy.mode,
    selectedStrategyMatched: plan.executionStrategy.selectedStrategyMatched,
    matchedCandidateCount: plan.executionStrategy.matchedCandidateCount,
    strategyCoverage: plan.qualitySummary.strategyCoverage,
    dominantBlocker,
    dominantBlockerReason: dominantBlockerOperation?.reason ?? null,
    blockedReasons: plan.qualitySummary.blockedReasons,
    ...(input.researchDiagnostics ? { researchDiagnostics: input.researchDiagnostics } : {}),
  };
}

function buildUnavailablePaperPlan(input: {
  now: Date;
  provider: string;
  account: AccountSnapshot;
  initialCapital: number;
  lotSize: number;
  maxPositionWeight: number;
  maxSingleOrderNotional: number;
  minimumCommission: number;
  cashReserveRatio: number;
  strategyProfile: PaperStrategyProfile;
  executionStrategy: PaperExecutionStrategy;
}): PaperTradingPlan {
  const profile = getPaperStrategyProfilePolicy(input.strategyProfile);
  const executionOption = getPaperExecutionStrategyOption(input.executionStrategy);
  const cashReserveRatio = input.cashReserveRatio;
  const cashReserveAmount = Math.min(
    input.account.cash,
    Math.max(0, input.account.equity * cashReserveRatio),
  );
  const plannedCashBudget = Math.max(0, input.account.cash - cashReserveAmount);
  const strategyScaledOrderCap =
    input.maxSingleOrderNotional * profile.newPositionScale;
  const strategyScaledPositionCap =
    input.account.equity * input.maxPositionWeight * profile.newPositionScale;
  const effectiveOrderCap = Math.min(
    strategyScaledOrderCap,
    strategyScaledPositionCap,
    plannedCashBudget,
  );
  const limitingConstraint: PaperTradingPlanSizingConstraint = plannedCashBudget <= 0
    ? "planned-cash-budget"
    : profile.newPositionScale <= 0
      ? "strategy-profile-scale"
      : input.maxSingleOrderNotional <= 0
        ? "risk-order-cap"
        : plannedCashBudget <= strategyScaledOrderCap + 0.005 &&
            plannedCashBudget <= strategyScaledPositionCap + 0.005
          ? "planned-cash-budget"
          : strategyScaledPositionCap <= strategyScaledOrderCap + 0.005
            ? "position-weight-cap"
            : profile.newPositionScale < 1 - 0.000001
              ? "strategy-profile-scale"
              : "risk-order-cap";
  const constraintLabels: Record<PaperTradingPlanSizingConstraint, string> = {
    "risk-order-cap": "服务端单笔风控上限",
    "strategy-profile-scale": profile.newPositionScale <= 0
      ? "策略档位停止新增仓位"
      : "策略档位缩放",
    "position-weight-cap": "单票仓位权重",
    "planned-cash-budget": "可用于本轮买单的实际现金",
    none: "未识别金额约束",
  };
  const isManual = input.executionStrategy !== "auto";
  return {
    generatedAt: input.now.toISOString(),
    tradingDate: getChinaTradeDate(input.now),
    mode: "paper",
    provider: input.provider,
    account: {
      accountId: input.account.accountId,
      cash: input.account.cash,
      equity: input.account.equity,
      marketValue: input.account.marketValue,
    },
    capitalPlan: {
      initialCapital: input.initialCapital,
      maxPositionWeight: input.maxPositionWeight,
      maxSingleOrderNotional: Number(effectiveOrderCap.toFixed(2)),
      lotSize: input.lotSize,
      cashReserveRatio,
      cashReserveAmount: Number(cashReserveAmount.toFixed(2)),
      sizingDiagnostics: {
        profileNewPositionScale: profile.newPositionScale,
        riskOrderCapBeforeScale: input.maxSingleOrderNotional,
        riskOrderCapAfterScale: Number(strategyScaledOrderCap.toFixed(2)),
        positionWeightCapAfterScale: Number(strategyScaledPositionCap.toFixed(2)),
        cashReserveAmount: Number(cashReserveAmount.toFixed(2)),
        plannedCashBudget: Number(plannedCashBudget.toFixed(2)),
        effectiveOrderCap: Number(effectiveOrderCap.toFixed(2)),
        minimumFeeEfficientNotional: Number(
          (input.minimumCommission * 2 / 0.01).toFixed(2),
        ),
        plannedBuyOrderCount: 0,
        plannedBuyNotional: 0,
        averagePlannedBuyNotional: 0,
        largestPlannedBuyNotional: 0,
        limitingConstraint,
        limitingConstraintLabel: constraintLabels[limitingConstraint],
        summary: "当前没有可交易行情，无法形成金额计划；金额上限仅作账户风控展示。",
      },
    },
    strategyProfile: {
      key: profile.key,
      label: profile.label,
      summary: profile.summary,
      cashReserveFloor: profile.cashReserveFloor,
      minDefensiveScore: profile.minDefensiveScore,
      maxNewPositionsPerPlan: profile.maxNewPositionsPerPlan,
      allowNewPositions: profile.allowNewPositions,
      effectiveCashReserveRatio: cashReserveRatio,
      effectiveNewPositionScale: profile.newPositionScale,
    },
    executionStrategy: {
      key: input.executionStrategy,
      label: executionOption?.label ?? input.executionStrategy,
      mode: isManual ? "manual" : "auto",
      selectedStrategyMatched: false,
      matchedCandidateCount: 0,
    },
    rules: [
      "A 股一手 100 股。",
      "当前行情不可用，本轮不产生任何 Paper 买卖动作。",
      "所有动作仅为本地 Paper 模拟，不连接真实券商。",
    ],
    topStrategy: null,
    adaptiveRouting: null,
    qualitySummary: {
      candidatePoolSize: 0,
      affordableCandidateCount: 0,
      positionConflictCount: 0,
      actionCounts: {
        observe: 0,
        "paper-buy-plan": 0,
        "paper-sell-plan": 0,
        blocked: 0,
        hold: 0,
      },
      blockedReasons: {},
      plannedBuyNotional: 0,
      plannedBuyFees: 0,
      plannedCashRequired: 0,
      plannedSellNotional: 0,
      cashDeploymentPercent: 0,
      remainingCashAfterPlan: input.account.cash,
      strategyCoverage: {
        eligibleKeys: isManual ? [input.executionStrategy] : [],
        matchedKeys: [],
        matchedCandidateCount: 0,
        unmatchedCandidateCount: 0,
        dominantStrategyKey: null,
        dominantBlocker: "market-data-unavailable",
        summary: "当前没有可用行情，无法评估策略覆盖。",
      },
      planQuality: "watch-only",
      summary: "当前没有可用行情，保持 Paper 观望，不补造价格或成交。",
    },
    operations: [],
    guardrails: [
      "行情不可用时零下单",
      "不重置 Paper 账户",
      "不推断缺失行情或历史成交",
    ],
  };
}

function buildHoldingQuotes(
  positions: PositionSnapshot[],
  snapshot: MarketSnapshot,
): NonNullable<
  PaperPlanNotificationContext["marketContext"]["breadth"]
>["holdingQuotes"] {
  return positions.flatMap((position) => {
    const quote = snapshot.quotes.find((item) => item.symbol === position.symbol);
    if (!quote || !Number.isFinite(quote.changePercent)) return [];
    return [{
      symbol: position.symbol,
      name: position.name || quote.name,
      changePercent: quote.changePercent,
    }];
  });
}

export class PaperAutoExecutor {
  private startedAt: string | null = null;
  private lastRunAt: string | null = null;
  private running = false;
  private executionLifecycle = 0;
  private sequence = 0;
  private lastPersistedRunSignature: string | null = null;
  private lastPersistedRunAt: number | null = null;
  private readonly runs: PaperAutoExecutionRun[] = [];
  private readonly scheduler: SequentialTaskScheduler;

  constructor(private readonly options: PaperAutoExecutorOptions) {
    this.scheduler = new SequentialTaskScheduler({
      intervalMs: options.intervalMs,
      clock: options.clock,
      task: async () => {
        if (!shouldRunScheduledPaperAutoExecution(
          this.now(),
          this.options.tradeWindowOnly,
        )) return;
        await this.runOnce("timer");
      },
    });
  }

  start(): void {
    if (
      (!this.options.enabled && !this.options.planNotifier) ||
      this.scheduler.isStarted()
    ) return;
    this.startedAt = this.now().toISOString();
    this.scheduler.start(async () => {
      await this.runOnce("startup");
    });
  }

  stop(): void {
    this.executionLifecycle++;
    this.scheduler.stop();
  }

  getStatus(): PaperAutoExecutionStatus {
    const latestRun = this.runs[0] ?? null;
    const now = this.now();
    const currentPolicy = getIntradayExecutionPolicy(now, null);
    const tradingDate = getChinaTradeDate(now);
    const currentSession = getAshareSession(now);
    const todaySubmittedOrders = this.countSubmittedOrders(tradingDate);
    const todayFilledOrders = this.countFilledOrders(tradingDate, now);
    const phaseDailyOrderLimit = getPhaseCumulativeOrderLimit(
      this.options.maxDailyOrders,
      currentPolicy.phase,
    );
    const qualifiedProbeActive = shouldActivateQualifiedPaperProbe({
      mode: this.options.config.PAPER_AUTO_EXECUTION_ACTIVITY_MODE,
      phase: currentPolicy.phase,
      remainingTargetOrders: Math.max(
        0,
        this.options.targetDailyOrders - todayFilledOrders,
      ),
    });
    return {
      enabled: this.options.enabled,
      running: this.running,
      mode: "paper-auto",
      execution: "local-paper-broker-only",
      liveTradingEnabled: false,
      intervalMs: this.options.intervalMs,
      tradeWindowOnly: this.options.tradeWindowOnly,
      maxOrdersPerRun: this.options.maxOrdersPerRun,
      maxDailyOrders: this.options.maxDailyOrders,
      targetDailyOrders: this.options.targetDailyOrders,
      activityMode: this.options.config.PAPER_AUTO_EXECUTION_ACTIVITY_MODE,
      qualifiedProbeActive,
      todaySubmittedOrders,
      todayFilledOrders,
      activityTarget: resolvePaperActivityTarget({
        targetOrders: this.options.targetDailyOrders,
        filledOrders: todayFilledOrders,
        session: currentSession,
        latestRun,
        tradingDate,
      }),
      phaseDailyOrderLimit,
      phaseRemainingOrders: Math.max(0, phaseDailyOrderLimit - todaySubmittedOrders),
      currentSession,
      currentPhase: getAshareTradingPhase(now),
      phaseMaxInvestedRatio:
        latestRun?.phaseMaxInvestedRatio ?? currentPolicy.maxInvestedRatio,
      startedAt: this.startedAt,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.scheduler.getNextRunAt(),
      latestRun,
      recentRuns: [...this.runs],
      guardrails: this.guardrails(),
    };
  }

  async runOnce(trigger: PaperAutoExecutionTrigger = "manual"): Promise<PaperAutoExecutionRun> {
    const timing = new PaperExecutionTimer(this.options.monotonicClock);
    const started = this.now();
    const session = getAshareSession(started);
    const initialPolicy = getIntradayExecutionPolicy(started, null);
    const tradingDate = getChinaTradeDate(started);
    const skippedOperations: PaperAutoExecutionSkip[] = [];
    const submittedOrders: PaperAutoExecutionOrder[] = [];

    if (this.running) {
      return this.recordRun({
        id: this.nextRunId(tradingDate),
        trigger,
        startedAt: started.toISOString(),
        finishedAt: this.now().toISOString(),
        timing: timing.snapshot(),
        tradingDate,
        session,
        phase: initialPolicy.phase,
        phaseMaxInvestedRatio: initialPolicy.maxInvestedRatio,
        planQuality: "not-run",
        submittedOrders,
        skippedOperations: [
          {
            symbol: "SYSTEM",
            action: "observe",
            reason: "previous auto paper execution is still running",
          },
        ],
        guardrails: this.guardrails(),
      });
    }

    this.running = true;
    const executionRevision = this.options.system.store.getExecutionRevision();
    const executionLifecycle = this.executionLifecycle;
    const assertExecutionContext = () => {
      assertPaperExecutionRevision(this.options.system.store, executionRevision);
      if (this.executionLifecycle !== executionLifecycle) throw new PaperExecutionContextChangedError();
    };
    try {
      if (!this.options.enabled && !this.options.planNotifier) {
        skippedOperations.push({
          symbol: "SYSTEM",
          action: "observe",
          reason: "paper auto execution and notifications are both disabled",
        });
        return this.finalizeRun(timing, trigger, started, tradingDate, session, initialPolicy, "not-run", submittedOrders, skippedOperations);
      }

      if (this.options.config.REAL_TRADING_ENABLED || this.options.config.MARKET_MODE !== "paper") {
        skippedOperations.push({
          symbol: "SYSTEM",
          action: "blocked",
          reason: "auto execution requires MARKET_MODE=paper and REAL_TRADING_ENABLED=false",
        });
        return this.finalizeRun(timing, trigger, started, tradingDate, session, initialPolicy, "not-run", submittedOrders, skippedOperations);
      }

      if (this.options.tradeWindowOnly && session !== "open") {
        skippedOperations.push({
          symbol: "SYSTEM",
          action: "observe",
          reason: `outside A-share trading session: ${session}`,
        });
        return this.finalizeRun(timing, trigger, started, tradingDate, session, initialPolicy, "not-run", submittedOrders, skippedOperations);
      }

      const initialSnapshot = this.options.system.market.getSnapshot();
      if (!hasUsableTradingQuote(initialSnapshot, (quote) =>
        this.options.system.broker.getQuoteFreshnessReason(quote))) {
        const sourceTimeReason = initialSnapshot.quotes
          .filter((quote) => quote.tradable && Number.isFinite(quote.price) && quote.price > 0)
          .map((quote) => this.options.system.broker.getQuoteFreshnessReason(quote))
          .find(Boolean);
        skippedOperations.push({
          symbol: "CASH",
          action: "observe",
          reason: "当前没有可交易行情，保持 Paper 观望并等待行情源恢复。" +
            (sourceTimeReason ? ` ${sourceTimeReason}` : ""),
        });
        const account = this.options.system.broker.getAccount();
        const plan = buildUnavailablePaperPlan({
          now: started,
          provider: this.options.config.MARKET_DATA_PROVIDER,
          account,
          initialCapital:
            account.startingEquity ?? this.options.config.TRADING_STARTING_CASH,
          lotSize: 100,
          maxPositionWeight: this.options.system.risk.getEffectiveMaxPositionWeight(),
          maxSingleOrderNotional: this.options.system.risk.getEffectiveMaxOrderNotional(),
          minimumCommission: this.options.config.MIN_COMMISSION,
          cashReserveRatio:
            this.options.config.PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO,
          strategyProfile: this.options.system.store.getStrategyProfile(),
          executionStrategy: this.options.system.store.getExecutionStrategy(),
        });
        const positions = this.options.system.broker.getPositions();
        const snapshot = this.options.system.market.getSnapshot();
        const executionSummary = summarizePaperOrders(
          this.options.system.broker.getOrders(10_000),
          plan.tradingDate,
          this.options.system.store.listAudit(10_000),
          this.now(),
        );
        if (this.options.planNotifier) await timing.measure("notificationMs", () => this.options.planNotifier!.notify(plan, {
          account,
          positions,
          executableOperations: [],
          executionSummary,
          policy: initialPolicy,
          executionEnabled: this.options.enabled,
          marketContext: {
            sourceStatus: "degraded",
            tone: "insufficient-data",
            summary: "当前没有可交易行情；保持 Paper 观望，不补造价格或成交。",
            breadth: {
              ...assessMarketSnapshot(snapshot).breadth,
              holdingQuotes: buildHoldingQuotes(positions, snapshot),
            },
            sectors: [],
            warnings: ["当前没有可交易行情，定时简报仍保留诚实降级状态。"],
            newsHighlights: [],
          },
        }));
        return this.finalizeRun(
          timing,
          trigger,
          started,
          tradingDate,
          session,
          initialPolicy,
          "watch-only",
          submittedOrders,
          skippedOperations,
          {
            regime: "unavailable",
            observedRegime: "unavailable",
            routingStability: "degraded-defensive-hold",
            previousConfirmedRegime: null,
            previousConfirmedAt: null,
            sourceStatus: "degraded",
            allowNewPositions: false,
            candidatePoolSize: 0,
            affordableCandidateCount: 0,
            executionStrategy: plan.executionStrategy.key,
            executionStrategyLabel: plan.executionStrategy.label,
            executionStrategyMode: plan.executionStrategy.mode,
            selectedStrategyMatched: false,
            matchedCandidateCount: 0,
            strategyCoverage: plan.qualitySummary.strategyCoverage,
            dominantBlocker: "market-data-unavailable",
            dominantBlockerReason: "当前没有可交易行情",
            blockedReasons: {},
          },
          buildPlanSnapshot(plan),
        );
      }

      const {
        plan,
        marketRegimeResearch,
        realResearchDataFeed,
        externalMarketImpact,
        adaptiveRouting,
      } = await timing.measure("researchMs", () => buildCurrentPaperTradingPlan({
        system: this.options.system,
        config: this.options.config,
        now: started,
        activityTargetActive: shouldActivateQualifiedPaperProbe({
          mode: this.options.config.PAPER_AUTO_EXECUTION_ACTIVITY_MODE,
          phase: initialPolicy.phase,
          remainingTargetOrders: Math.max(
            0,
            this.options.targetDailyOrders - this.countFilledOrders(tradingDate, started),
          ),
        }),
        activityMode: this.options.config.PAPER_AUTO_EXECUTION_ACTIVITY_MODE,
      }));
      assertExecutionContext();
      // Research can finish with a cached or unchanged snapshot from another
      // date. Stop before plan-date quotas, idempotency keys or notifications.
      if (plan.tradingDate !== tradingDate) {
        skippedOperations.push({
          symbol: "SYSTEM",
          action: "observe",
          reason: `计划交易日期与本轮交易日期不一致（计划 ${plan.tradingDate}，本轮 ${tradingDate}），保持 Paper 观望并等待本交易日行情。`,
        });
        return this.finalizeRun(
          timing,
          trigger,
          started,
          tradingDate,
          session,
          initialPolicy,
          "watch-only",
          submittedOrders,
          skippedOperations,
        );
      }
      const executionTimeBlocker = (
        checkedAt: Date,
        stage: string,
      ): PaperAutoExecutionSkip | null => {
        const actualTradingDate = getChinaTradeDate(checkedAt);
        if (actualTradingDate !== tradingDate || actualTradingDate !== plan.tradingDate) {
          return {
            symbol: "SYSTEM",
            action: "observe",
            reason: `${stage}交易日期已变化（当前 ${actualTradingDate}，本轮 ${tradingDate}，计划 ${plan.tradingDate}），停止本轮剩余 Paper 订单并等待新一轮计划。`,
          };
        }
        const actualSession = getAshareSession(checkedAt);
        if (this.options.tradeWindowOnly && actualSession !== "open") {
          return {
            symbol: "SYSTEM",
            action: "observe",
            reason: `${stage}已不在 A 股交易时段（${actualSession}），停止本轮剩余 Paper 订单。`,
          };
        }
        return null;
      };
      const researchFinishedAt = this.now();
      const researchTimeBlocker = executionTimeBlocker(researchFinishedAt, "研究完成时");
      if (researchTimeBlocker) {
        skippedOperations.push(researchTimeBlocker);
        return this.finalizeRun(
          timing,
          trigger,
          started,
          tradingDate,
          session,
          initialPolicy,
          "watch-only",
          submittedOrders,
          skippedOperations,
        );
      }
      const policy = getIntradayExecutionPolicy(researchFinishedAt, plan.adaptiveRouting);
      const snapshot = this.options.system.market.getSnapshot();
      const marketAssessment = assessMarketSnapshot(snapshot);
      const preparedOperations = timing.measureSync("executionMs", () => this.preflightOperations(
        plan,
        policy,
        skippedOperations,
      ));
      const sourceStatus = resolveNotificationSourceStatus({
        marketRegime: marketRegimeResearch.sourceStatus,
        auxiliaryResearch: realResearchDataFeed.sourceStatus,
      });
      const account = this.options.system.broker.getAccount();
      const positions = this.options.system.broker.getPositions();
      const notificationContext: PaperPlanNotificationContext = {
        account,
        positions,
        executableOperations: preparedOperations.map(({ operation }) => operation),
        executionSummary: summarizePaperOrders(
          this.options.system.broker.getOrders(10_000),
          plan.tradingDate,
          this.options.system.store.listAudit(10_000),
          this.now(),
        ),
        policy,
        executionEnabled: this.options.enabled,
        marketContext: {
          sourceStatus,
          tone: marketAssessment.tone,
          summary: marketAssessment.summary,
          breadth: {
            ...marketAssessment.breadth,
            holdingQuotes: buildHoldingQuotes(positions, snapshot),
          },
          sectors: marketRegimeResearch.sectorOutlooks.slice(0, 24).map((sector) => ({
            name: sector.name,
            direction: sector.direction,
            score: sector.score,
            changePercent: sector.current.changePercent,
          })),
          warnings: [...new Set([
            ...marketRegimeResearch.warnings,
            realResearchDataFeed.news.warning,
            realResearchDataFeed.globalMarkets.warning,
          ].filter((warning): warning is string => Boolean(warning)))],
          newsHighlights: realResearchDataFeed.news.items.slice(0, 2).map((item) => ({
            source: item.source,
            title: item.title,
          })),
          globalImpact: buildExternalMarketNotificationImpact({
            bias: externalMarketImpact.aShareImpact.bias,
            evidenceGrade: externalMarketImpact.aShareImpact.evidenceGrade,
            samples: externalMarketImpact.validation.samples,
            groups: externalMarketImpact.groups.map((group) => ({
              key: group.key,
              tone: group.tone,
            })),
            rationale: externalMarketImpact.aShareImpact.rationale,
          }),
        },
      };
      const notificationLedgerContext = this.options.planNotifier
        ? capturePaperLedgerContext(this.options.system.store) : null;
      if (this.options.planNotifier) await timing.measure("notificationMs", () => this.options.planNotifier!.notify(plan, notificationContext));
      assertExecutionContext();
      if (notificationLedgerContext) assertPaperLedgerContext(this.options.system.store, notificationLedgerContext);

      let executionTimeStopped = false;
      if (this.options.enabled) timing.measureSync("executionMs", () => {
        for (const { operation, request } of preparedOperations) {
          assertExecutionContext();
          // Notifications may wait on the network, and onOrder may change state
          // between synchronous submissions. Check the real clock for every order.
          const submissionTimeBlocker = executionTimeBlocker(this.now(), "逐笔提交前");
          if (submissionTimeBlocker) {
            skippedOperations.push(submissionTimeBlocker);
            executionTimeStopped = true;
            break;
          }
          const currentQuoteReason = this.tradingQuoteReason(operation.symbol);
          if (currentQuoteReason) {
            skippedOperations.push(paperAutoExecutionSkip(operation, currentQuoteReason));
            continue;
          }
          const side = request.side;
          const order = this.options.system.broker.submitOrder(request, {
            strategy: operation.strategy,
            strategyKey: paperOperationStrategyKey(operation) ?? undefined,
          });
          this.options.onOrder?.(order, request);
          submittedOrders.push({
            symbol: order.symbol,
            side: order.side,
            quantity: order.quantity,
            clientOrderId: request.clientOrderId ?? "",
            status: order.status,
            orderId: order.id,
            rejectionReason: order.rejectionReason,
            strategy: operation.strategy,
            strategyKey: paperOperationStrategyKey(operation),
            reason: operation.reason,
            ruleChecks: [...operation.ruleChecks],
            estimatedNotional: operation.estimatedNotional,
          });
          this.options.system.store.appendAudit(
            "system",
            "paper-auto-execution.decision",
            "paper auto execution decision recorded",
            {
              tradingDate: plan.tradingDate,
              orderId: order.id,
              clientOrderId: request.clientOrderId,
              symbol: operation.symbol,
              side,
              quantity: operation.quantity,
              strategy: operation.strategy,
              strategyKey: paperOperationStrategyKey(operation),
              reason: operation.reason,
              ruleChecks: operation.ruleChecks,
              estimatedNotional: operation.estimatedNotional,
              status: order.status,
              rejectionReason: order.rejectionReason,
            },
          );
        }
      });

      if (this.options.enabled && submittedOrders.length > 0) {
        const currentOrderIds = new Set(submittedOrders.map((order) => order.orderId));
        const persistedOrders = this.options.system.broker.getOrders(10_000)
          .filter((order) => (
            currentOrderIds.has(order.id) &&
            (order.status === "filled" || order.status === "rejected")
          ));
        if (persistedOrders.length > 0) {
          const refreshedAccount = this.options.system.broker.getAccount();
          const refreshedPositions = this.options.system.broker.getPositions();
          if (this.options.planNotifier) await timing.measure("notificationMs", () => this.options.planNotifier!.notifyOrderEvents(
            plan,
            {
              ...notificationContext,
              account: refreshedAccount,
              positions: refreshedPositions,
              executionSummary: summarizePaperOrders(
                this.options.system.broker.getOrders(10_000),
                plan.tradingDate,
                this.options.system.store.listAudit(10_000),
                this.now(),
              ),
              marketContext: {
                ...notificationContext.marketContext,
                breadth: notificationContext.marketContext.breadth
                  ? {
                      ...notificationContext.marketContext.breadth,
                      holdingQuotes: buildHoldingQuotes(
                        refreshedPositions,
                        this.options.system.market.getSnapshot(),
                      ),
                    }
                  : undefined,
              },
            },
            persistedOrders,
          ));
        }
      }

      return this.finalizeRun(
        timing,
        trigger,
        started,
        tradingDate,
        session,
        policy,
        executionTimeStopped ? "watch-only" : plan.qualitySummary.planQuality,
        submittedOrders,
        skippedOperations,
        buildPaperExecutionResearchContext({
          plan,
          adaptiveRouting,
          sourceStatus,
          researchDiagnostics: buildResearchInputDiagnostics(marketRegimeResearch),
        }),
        buildPlanSnapshot(plan),
      );
    } catch (error) {
      const contextChanged = error instanceof PaperExecutionContextChangedError;
      const detail = error instanceof Error ? error.message : String(error);
      skippedOperations.push({
        symbol: "SYSTEM",
        action: "observe",
        reason: contextChanged ? detail : `paper auto execution input is temporarily unavailable: ${detail.slice(0, 240)}`,
      });
      return this.finalizeRun(
        timing,
        trigger,
        started,
        tradingDate,
        session,
        initialPolicy,
        contextChanged ? "watch-only" : "not-run",
        submittedOrders,
        skippedOperations,
      );
    } finally {
      this.running = false;
    }
  }

  private preflightOperations(
    plan: PaperTradingPlan,
    policy: IntradayExecutionPolicy,
    skippedOperations: PaperAutoExecutionSkip[],
  ): PreparedPaperOperation[] {
    const prepared: PreparedPaperOperation[] = [];
    const todaySubmitted = this.countSubmittedOrders(plan.tradingDate);
    let remainingDailyOrders = Math.max(0, this.options.maxDailyOrders - todaySubmitted);
    let remainingRunOrders = this.options.maxOrdersPerRun;
    let remainingPhaseOrders = Math.max(
      0,
      getPhaseCumulativeOrderLimit(this.options.maxDailyOrders, policy.phase) -
        todaySubmitted,
    );
    const account = this.options.system.broker.getAccount();
    let projectedCash = account.cash;
    let projectedMarketValue = account.marketValue;
    // Server configuration is authoritative; an old plan must not reinstate a
    // cash floor that the operator has explicitly disabled.
    const reserveRatio = this.options.config.PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO;
    const cashReserve = account.equity * reserveRatio;

    for (const operation of plan.operations) {
      const side = this.toOrderSide(operation.action);
      if (!side) {
        skippedOperations.push(paperAutoExecutionSkip(
          operation,
          paperNonExecutableReason(operation),
        ));
        continue;
      }
      if (operation.quantity <= 0 || !/^\d{6}$/.test(operation.symbol)) {
        skippedOperations.push(paperAutoExecutionSkip(
          operation,
          "operation quantity or symbol is not executable",
        ));
        continue;
      }
      if (remainingDailyOrders <= 0) {
        skippedOperations.push(paperAutoExecutionSkip(
          operation,
          "daily auto paper order cap reached",
        ));
        continue;
      }
      if (remainingRunOrders <= 0) {
        skippedOperations.push(paperAutoExecutionSkip(
          operation,
          "per-run auto paper order cap reached",
        ));
        continue;
      }
      if (isPaperOperationBlockedByPhaseBudget(operation, remainingPhaseOrders)) {
        skippedOperations.push(paperAutoExecutionSkip(
          operation,
          `${policy.phaseLabel}阶段自动订单额度已用完，保留额度给后续确认阶段`,
        ));
        continue;
      }

      const request: OrderRequest = {
        symbol: operation.symbol,
        side,
        type: "market",
        quantity: operation.quantity,
        clientOrderId: this.clientOrderId(plan.tradingDate, operation),
      };
      if (this.options.system.store.findByClientOrderId(request.clientOrderId)) {
        skippedOperations.push(paperAutoExecutionSkip(
          operation,
          "operation was already submitted for this trading date",
        ));
        continue;
      }

      const quote = this.options.system.market.getQuote(operation.symbol);
      const quoteReason = this.tradingQuoteReason(operation.symbol, quote);
      if (!quote || quoteReason) {
        skippedOperations.push(paperAutoExecutionSkip(
          operation,
          quoteReason ?? "最新行情尚未就绪，未创建本地 paper 订单",
        ));
        continue;
      }

      if (side === "buy") {
        const { notional, cashDebit: requiredCash } = executionCosts(request, quote.price, {
          commissionRate: this.options.config.COMMISSION_RATE,
          minimumCommission: this.options.config.MIN_COMMISSION,
          slippageBps: this.options.config.SLIPPAGE_BPS,
        });
        const spendableCash = Math.max(0, projectedCash - cashReserve);
        if (!hasSufficientCash(spendableCash, requiredCash)) {
          skippedOperations.push(paperAutoExecutionSkip(
            operation,
            `累计订单后可用资金不足，需 ${requiredCash.toFixed(2)} 元，可用于新买单 ${spendableCash.toFixed(2)} 元；未创建订单`,
          ));
          continue;
        }
        const projectedInvestedRatio = account.equity > 0
          ? (projectedMarketValue + notional) / account.equity
          : 1;
        if (projectedInvestedRatio > policy.maxInvestedRatio + 0.0001) {
          skippedOperations.push(paperAutoExecutionSkip(
            operation,
            `${policy.phaseLabel}仓位节奏限制：计划后仓位 ${(projectedInvestedRatio * 100).toFixed(1)}% 超过阶段上限 ${(policy.maxInvestedRatio * 100).toFixed(1)}%`,
          ));
          continue;
        }
        projectedCash -= requiredCash;
        projectedMarketValue += notional;
      }

      prepared.push({ operation, request });
      remainingRunOrders -= 1;
      remainingDailyOrders -= 1;
      remainingPhaseOrders = Math.max(0, remainingPhaseOrders - 1);
    }

    return prepared;
  }

  private tradingQuoteReason(
    symbol: string,
    quote = this.options.system.market.getQuote(symbol),
  ): string | null {
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0 || quote.tradable === false) {
      return "最新行情尚未就绪或不可交易，未创建本地 paper 订单";
    }
    return this.options.system.broker.getQuoteFreshnessReason(quote);
  }

  private finalizeRun(
    timing: PaperExecutionTimer,
    trigger: PaperAutoExecutionTrigger,
    started: Date,
    tradingDate: string,
    session: PaperAutoExecutionSession,
    policy: IntradayExecutionPolicy,
    planQuality: PaperAutoExecutionRun["planQuality"],
    submittedOrders: PaperAutoExecutionOrder[],
    skippedOperations: PaperAutoExecutionSkip[],
    researchContext?: PaperAutoExecutionResearchContext,
    planSnapshot?: PaperAutoExecutionPlanSnapshot,
  ): PaperAutoExecutionRun {
    return this.recordRun({
      id: this.nextRunId(tradingDate),
      trigger,
      startedAt: started.toISOString(),
      finishedAt: this.now().toISOString(),
      timing: timing.snapshot(),
      tradingDate,
      session,
      phase: policy.phase,
      phaseMaxInvestedRatio: policy.maxInvestedRatio,
      planQuality,
      activityMode: this.options.config.PAPER_AUTO_EXECUTION_ACTIVITY_MODE,
      planSnapshot,
      researchContext,
      submittedOrders,
      skippedOperations,
      guardrails: this.guardrails(),
    });
  }

  private recordRun(run: PaperAutoExecutionRun): PaperAutoExecutionRun {
    this.lastRunAt = run.finishedAt;
    this.runs.unshift(run);
    if (this.runs.length > HISTORY_LIMIT) {
      this.runs.splice(HISTORY_LIMIT);
    }
    const signature = paperAutoExecutionAuditSignature(run);
    const shouldPersist = shouldPersistPaperAutoExecutionRun({
      run,
      previousSignature: this.lastPersistedRunSignature,
      previousPersistedAt: this.lastPersistedRunAt,
    });
    if (!shouldPersist) return run;
    const skippedEvidence = selectPaperSkipEvidence(run.skippedOperations);
    this.options.system.store.appendAudit(
      "system",
      "paper-auto-execution.run",
      "paper auto execution run recorded",
      {
        id: run.id,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        timing: run.timing ?? null,
        trigger: run.trigger,
        tradingDate: run.tradingDate,
        session: run.session,
        phase: run.phase,
        phaseMaxInvestedRatio: run.phaseMaxInvestedRatio,
        planQuality: run.planQuality,
        planSnapshot: run.planSnapshot ?? null,
        activityMode: run.activityMode ?? null,
        regime: run.researchContext?.regime,
        observedRegime: run.researchContext?.observedRegime,
        routingStability: run.researchContext?.routingStability,
        previousConfirmedRegime:
          run.researchContext?.previousConfirmedRegime,
        previousConfirmedAt: run.researchContext?.previousConfirmedAt,
        sourceStatus: run.researchContext?.sourceStatus,
        allowNewPositions: run.researchContext?.allowNewPositions,
        candidatePoolSize: run.researchContext?.candidatePoolSize,
        affordableCandidateCount: run.researchContext?.affordableCandidateCount,
        executionStrategy: run.researchContext?.executionStrategy ?? null,
        executionStrategyLabel:
          run.researchContext?.executionStrategyLabel ?? null,
        executionStrategyMode:
          run.researchContext?.executionStrategyMode ?? null,
        selectedStrategyMatched:
          run.researchContext?.selectedStrategyMatched ?? null,
        matchedCandidateCount:
          run.researchContext?.matchedCandidateCount ?? null,
        strategyCoverage: run.researchContext?.strategyCoverage ?? null,
        dominantBlocker: run.researchContext?.dominantBlocker ?? null,
        dominantBlockerReason:
          run.researchContext?.dominantBlockerReason ?? null,
        blockedReasons: run.researchContext?.blockedReasons ?? null,
        researchDiagnostics: run.researchContext?.researchDiagnostics ?? null,
        submittedOrders: run.submittedOrders.length,
        skippedOperations: run.skippedOperations.length,
        submittedOrderStatuses: run.submittedOrders.map((order) => ({
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          status: order.status,
          rejectionReason: order.rejectionReason,
          strategy: order.strategy,
          strategyKey: order.strategyKey,
          reason: order.reason,
          estimatedNotional: order.estimatedNotional,
        })),
        skippedReasons: skippedEvidence.reasons,
        skippedReasonCount: skippedEvidence.total,
        skippedReasonsOmitted: skippedEvidence.omitted,
        skippedReasonSelection: "execution-and-gate-first-distinct-reasons-v2",
      },
    );
    this.lastPersistedRunSignature = signature;
    this.lastPersistedRunAt = Date.parse(run.finishedAt);
    return run;
  }

  private countSubmittedOrders(tradingDate: string): number {
    const prefix = `kairos-auto-paper:${tradingDate}:`;
    return this.options.system.store
      .listOrders(10_000)
      .filter((order) => order.clientOrderId?.startsWith(prefix))
      .length;
  }

  private countFilledOrders(tradingDate: string, asOf: Date): number {
    return this.options.system.store
      .listOrders(10_000)
      .filter((order) => {
        const time = getOrderFillTime(order);
        return order.clientOrderId?.startsWith("kairos-auto-paper:") === true &&
          time !== null && Date.parse(time) <= asOf.getTime() &&
          getChinaDateKey(new Date(time)) === tradingDate;
      })
      .length;
  }

  private nextRunId(tradingDate: string): string {
    this.sequence += 1;
    return `paper-auto-${tradingDate}-${String(this.sequence).padStart(4, "0")}`;
  }

  private clientOrderId(
    tradingDate: string,
    operation: PaperTradingOperation,
  ): string {
    return [
      "kairos-auto-paper",
      tradingDate,
      operation.symbol,
      operation.action,
      operation.quantity,
    ].join(":");
  }

  private toOrderSide(
    action: PaperTradingOperation["action"],
  ): "buy" | "sell" | null {
    if (action === "paper-buy-plan") return "buy";
    if (action === "paper-sell-plan") return "sell";
    return null;
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private guardrails(): string[] {
    return [
      "Auto execution submits orders only to the local PaperBroker.",
      "REAL_TRADING_ENABLED must remain false and MARKET_MODE must be paper.",
      "A-share lot-size, T+1, cash, position and circuit-breaker checks still run before every order.",
      "A plan must match this run's trading date before quotas, notifications or orders are processed.",
      "Automatic order counts are paced across opening, morning, afternoon and closing phases without fixed portfolio cash floors.",
      "The daily target may activate a qualified afternoon probe but never overrides plan eligibility or risk checks.",
      "Qualified probes can activate only in the afternoon and still require live history, fees, cash, position, and broker risk checks.",
      "No TongHuaShun, Zhongxin, SuperMind, browser cookie, password, SMS code or live broker token is used.",
    ];
  }
}
