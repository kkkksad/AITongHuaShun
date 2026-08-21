import type { OrderRecord, OrderRequest } from "../../shared/trading";
import type { ServerConfig } from "../config";
import type { TradingSystem } from "../system";
import {
  buildExternalMarketNotificationImpact,
  summarizePaperOrders,
  type PaperPlanNotifier,
} from "../notifications/paperPlanNotifier";
import { buildCurrentPaperTradingPlan } from "../research/paperTradingPlanService";
import { assessMarketSnapshot } from "../research/dailyMarketReview";
import type { AdaptiveStrategyRouting } from "../research/adaptiveStrategyRouter";
import type {
  PaperTradingOperation,
  PaperTradingPlan,
} from "../research/paperTradingPlan";
import {
  getAshareTradingPhase,
  getPhaseCumulativeOrderLimit,
  getIntradayExecutionPolicy,
  type AShareTradingPhase,
  type IntradayExecutionPolicy,
} from "./intradayExecutionPolicy";

export type PaperAutoExecutionTrigger = "timer" | "manual" | "startup";
export type PaperAutoExecutionActivityMode =
  | "observe"
  | "qualified-probe"
  | "validation-probe";
export type PaperAutoExecutionSession =
  | "open"
  | "pre-market"
  | "lunch-break"
  | "after-hours"
  | "weekend";

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

export interface PaperAutoExecutionSkip {
  symbol: string;
  action: PaperTradingOperation["action"];
  reason: string;
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
}

export interface PaperAutoExecutionRun {
  id: string;
  trigger: PaperAutoExecutionTrigger;
  startedAt: string;
  finishedAt: string;
  tradingDate: string;
  session: PaperAutoExecutionSession;
  phase: AShareTradingPhase;
  phaseMaxInvestedRatio: number;
  planQuality: PaperTradingPlan["qualitySummary"]["planQuality"] | "not-run";
  activityMode?: PaperAutoExecutionActivityMode;
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
  onOrder?: (order: OrderRecord, request: OrderRequest) => void;
  planNotifier?: Pick<PaperPlanNotifier, "notify">;
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
const CHINA_TZ_OFFSET_MINUTES = 8 * 60;

function getChinaParts(value: Date) {
  const shifted = new Date(value.getTime() + CHINA_TZ_OFFSET_MINUTES * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    day: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export function getAshareSession(value = new Date()): PaperAutoExecutionSession {
  const { day, minutes } = getChinaParts(value);
  if (day === 0 || day === 6) return "weekend";
  if (minutes < 9 * 60 + 30) return "pre-market";
  if (minutes <= 11 * 60 + 30) return "open";
  if (minutes < 13 * 60) return "lunch-break";
  if (minutes <= 15 * 60) return "open";
  return "after-hours";
}

export function getChinaTradeDate(value = new Date()): string {
  return getChinaParts(value).date;
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
  if (input.session === "after-hours" || input.session === "weekend") {
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

export function paperAutoExecutionAuditSignature(
  run: PaperAutoExecutionRun,
): string {
  return JSON.stringify({
    tradingDate: run.tradingDate,
    session: run.session,
    phase: run.phase,
    planQuality: run.planQuality,
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

export class PaperAutoExecutor {
  private startedAt: string | null = null;
  private lastRunAt: string | null = null;
  private running = false;
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
    if (!this.options.enabled || this.scheduler.isStarted()) return;
    this.startedAt = this.now().toISOString();
    this.scheduler.start(async () => {
      await this.runOnce("startup");
    });
  }

  stop(): void {
    this.scheduler.stop();
  }

  getStatus(): PaperAutoExecutionStatus {
    const latestRun = this.runs[0] ?? null;
    const now = this.now();
    const currentPolicy = getIntradayExecutionPolicy(now, null);
    const tradingDate = getChinaTradeDate(now);
    const currentSession = getAshareSession(now);
    const todaySubmittedOrders = this.countSubmittedOrders(tradingDate);
    const todayFilledOrders = this.countFilledOrders(tradingDate);
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
    try {
      if (!this.options.enabled && trigger !== "manual") {
        skippedOperations.push({
          symbol: "SYSTEM",
          action: "observe",
          reason: "auto paper execution is disabled",
        });
        return this.finalizeRun(trigger, started, tradingDate, session, initialPolicy, "not-run", submittedOrders, skippedOperations);
      }

      if (this.options.config.REAL_TRADING_ENABLED || this.options.config.MARKET_MODE !== "paper") {
        skippedOperations.push({
          symbol: "SYSTEM",
          action: "blocked",
          reason: "auto execution requires MARKET_MODE=paper and REAL_TRADING_ENABLED=false",
        });
        return this.finalizeRun(trigger, started, tradingDate, session, initialPolicy, "not-run", submittedOrders, skippedOperations);
      }

      if (this.options.tradeWindowOnly && session !== "open") {
        skippedOperations.push({
          symbol: "SYSTEM",
          action: "observe",
          reason: `outside A-share trading session: ${session}`,
        });
        return this.finalizeRun(trigger, started, tradingDate, session, initialPolicy, "not-run", submittedOrders, skippedOperations);
      }

      const {
        plan,
        marketRegimeResearch,
        realResearchDataFeed,
        externalMarketImpact,
        adaptiveRouting,
      } = await buildCurrentPaperTradingPlan({
        system: this.options.system,
        config: this.options.config,
        now: started,
        activityTargetActive: shouldActivateQualifiedPaperProbe({
          mode: this.options.config.PAPER_AUTO_EXECUTION_ACTIVITY_MODE,
          phase: initialPolicy.phase,
          remainingTargetOrders: Math.max(
            0,
            this.options.targetDailyOrders - this.countFilledOrders(tradingDate),
          ),
        }),
        activityMode: this.options.config.PAPER_AUTO_EXECUTION_ACTIVITY_MODE,
      });
      const policy = getIntradayExecutionPolicy(started, plan.adaptiveRouting);
      const marketAssessment = assessMarketSnapshot(
        this.options.system.market.getSnapshot(),
      );
      const preparedOperations = this.preflightOperations(
        plan,
        policy,
        skippedOperations,
      );
      await this.options.planNotifier?.notify(plan, {
        account: this.options.system.broker.getAccount(),
        positions: this.options.system.broker.getPositions(),
        executableOperations: preparedOperations.map(({ operation }) => operation),
        executionSummary: summarizePaperOrders(
          this.options.system.broker.getOrders(10_000),
          plan.tradingDate,
          this.options.system.store.listAudit(10_000),
        ),
        policy,
        marketContext: {
          sourceStatus: resolveNotificationSourceStatus({
            marketRegime: marketRegimeResearch.sourceStatus,
            auxiliaryResearch: realResearchDataFeed.sourceStatus,
          }),
          tone: marketAssessment.tone,
          summary: marketAssessment.summary,
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
      });

      for (const { operation, request } of preparedOperations) {
        const side = request.side;
        const order = this.options.system.broker.submitOrder(request);
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

      return this.finalizeRun(
        trigger,
        started,
        tradingDate,
        session,
        policy,
        plan.qualitySummary.planQuality,
        submittedOrders,
        skippedOperations,
        {
          regime: adaptiveRouting.regime,
          observedRegime: adaptiveRouting.stability.observedRegime,
          routingStability: adaptiveRouting.stability.status,
          previousConfirmedRegime:
            adaptiveRouting.stability.previousConfirmedRegime,
          previousConfirmedAt: adaptiveRouting.stability.previousConfirmedAt,
          sourceStatus: marketRegimeResearch.sourceStatus,
          allowNewPositions: adaptiveRouting.allowNewPositions,
          candidatePoolSize: plan.qualitySummary.candidatePoolSize,
          affordableCandidateCount: plan.qualitySummary.affordableCandidateCount,
        },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      skippedOperations.push({
        symbol: "SYSTEM",
        action: "observe",
        reason: `paper auto execution input is temporarily unavailable: ${detail.slice(0, 240)}`,
      });
      return this.finalizeRun(
        trigger,
        started,
        tradingDate,
        session,
        initialPolicy,
        "not-run",
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
    const reserveRatio = Math.max(
      this.options.config.PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO,
      plan.capitalPlan.cashReserveRatio,
    );
    const cashReserve = account.equity * reserveRatio;

    for (const operation of plan.operations) {
      const side = this.toOrderSide(operation.action);
      if (!side) {
        skippedOperations.push({
          symbol: operation.symbol,
          action: operation.action,
          reason: paperNonExecutableReason(operation),
        });
        continue;
      }
      if (operation.quantity <= 0 || !/^\d{6}$/.test(operation.symbol)) {
        skippedOperations.push({
          symbol: operation.symbol,
          action: operation.action,
          reason: "operation quantity or symbol is not executable",
        });
        continue;
      }
      if (remainingDailyOrders <= 0) {
        skippedOperations.push({
          symbol: operation.symbol,
          action: operation.action,
          reason: "daily auto paper order cap reached",
        });
        continue;
      }
      if (remainingRunOrders <= 0) {
        skippedOperations.push({
          symbol: operation.symbol,
          action: operation.action,
          reason: "per-run auto paper order cap reached",
        });
        continue;
      }
      if (isPaperOperationBlockedByPhaseBudget(operation, remainingPhaseOrders)) {
        skippedOperations.push({
          symbol: operation.symbol,
          action: operation.action,
          reason: `${policy.phaseLabel}阶段自动订单额度已用完，保留额度给后续确认阶段`,
        });
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
        skippedOperations.push({
          symbol: operation.symbol,
          action: operation.action,
          reason: "operation was already submitted for this trading date",
        });
        continue;
      }

      if (side === "buy") {
        const quote = this.options.system.market.getQuote(operation.symbol);
        if (!quote) {
          skippedOperations.push({
            symbol: operation.symbol,
            action: operation.action,
            reason: "最新行情不可用，未创建本地 paper 买单",
          });
          continue;
        }
        const fillPrice = Number((
          quote.price * (1 + this.options.config.SLIPPAGE_BPS / 10_000)
        ).toFixed(2));
        const notional = fillPrice * operation.quantity;
        const commission = Math.max(
          this.options.config.MIN_COMMISSION,
          notional * this.options.config.COMMISSION_RATE,
        );
        const requiredCash = notional + commission;
        const spendableCash = Math.max(0, projectedCash - cashReserve);
        if (requiredCash > spendableCash + 0.001) {
          skippedOperations.push({
            symbol: operation.symbol,
            action: operation.action,
            reason: `累计订单后可用资金不足，需 ${requiredCash.toFixed(2)} 元，可用于新买单 ${spendableCash.toFixed(2)} 元；未创建订单`,
          });
          continue;
        }
        const projectedInvestedRatio = account.equity > 0
          ? (projectedMarketValue + notional) / account.equity
          : 1;
        if (projectedInvestedRatio > policy.maxInvestedRatio + 0.0001) {
          skippedOperations.push({
            symbol: operation.symbol,
            action: operation.action,
            reason: `${policy.phaseLabel}仓位节奏限制：计划后仓位 ${(projectedInvestedRatio * 100).toFixed(1)}% 超过阶段上限 ${(policy.maxInvestedRatio * 100).toFixed(1)}%`,
          });
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

  private finalizeRun(
    trigger: PaperAutoExecutionTrigger,
    started: Date,
    tradingDate: string,
    session: PaperAutoExecutionSession,
    policy: IntradayExecutionPolicy,
    planQuality: PaperAutoExecutionRun["planQuality"],
    submittedOrders: PaperAutoExecutionOrder[],
    skippedOperations: PaperAutoExecutionSkip[],
    researchContext?: PaperAutoExecutionResearchContext,
  ): PaperAutoExecutionRun {
    return this.recordRun({
      id: this.nextRunId(tradingDate),
      trigger,
      startedAt: started.toISOString(),
      finishedAt: this.now().toISOString(),
      tradingDate,
      session,
      phase: policy.phase,
      phaseMaxInvestedRatio: policy.maxInvestedRatio,
      planQuality,
      activityMode: this.options.config.PAPER_AUTO_EXECUTION_ACTIVITY_MODE,
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
    this.options.system.store.appendAudit(
      "system",
      "paper-auto-execution.run",
      "paper auto execution run recorded",
      {
        id: run.id,
        trigger: run.trigger,
        tradingDate: run.tradingDate,
        session: run.session,
        phase: run.phase,
        phaseMaxInvestedRatio: run.phaseMaxInvestedRatio,
        planQuality: run.planQuality,
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
        })),
        skippedReasons: run.skippedOperations.slice(0, 8).map((operation) => ({
          symbol: operation.symbol,
          action: operation.action,
          reason: operation.reason,
        })),
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

  private countFilledOrders(tradingDate: string): number {
    const prefix = `kairos-auto-paper:${tradingDate}:`;
    return this.options.system.store
      .listOrders(10_000)
      .filter((order) =>
        order.clientOrderId?.startsWith(prefix) && order.status === "filled",
      )
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
      "New paper buys are paced by opening, morning, afternoon and closing invested-ratio caps.",
      "The daily target may activate a qualified afternoon probe but never overrides plan eligibility or risk checks.",
      "Qualified probes can activate only in the afternoon and still require live history, fees, cash, position, and broker risk checks.",
      "No TongHuaShun, Zhongxin, SuperMind, browser cookie, password, SMS code or live broker token is used.",
    ];
  }
}
