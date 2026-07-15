import type { OrderRecord, OrderRequest } from "../../shared/trading";
import type { ServerConfig } from "../config";
import type { TradingSystem } from "../system";
import type { PaperPlanNotifier } from "../notifications/paperPlanNotifier";
import { buildCurrentPaperTradingPlan } from "../research/paperTradingPlanService";
import type {
  PaperTradingOperation,
  PaperTradingPlan,
} from "../research/paperTradingPlan";

export type PaperAutoExecutionTrigger = "timer" | "manual" | "startup";
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
  reason: string;
  ruleChecks: string[];
  estimatedNotional: number;
}

export interface PaperAutoExecutionSkip {
  symbol: string;
  action: PaperTradingOperation["action"];
  reason: string;
}

export interface PaperAutoExecutionRun {
  id: string;
  trigger: PaperAutoExecutionTrigger;
  startedAt: string;
  finishedAt: string;
  tradingDate: string;
  session: PaperAutoExecutionSession;
  planQuality: PaperTradingPlan["qualitySummary"]["planQuality"] | "not-run";
  submittedOrders: PaperAutoExecutionOrder[];
  skippedOperations: PaperAutoExecutionSkip[];
  guardrails: string[];
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
  todaySubmittedOrders: number;
  currentSession: PaperAutoExecutionSession;
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
  clock?: () => Date;
  onOrder?: (order: OrderRecord, request: OrderRequest) => void;
  planNotifier?: Pick<PaperPlanNotifier, "notify">;
}

const HISTORY_LIMIT = 30;
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

export class PaperAutoExecutor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt: string | null = null;
  private lastRunAt: string | null = null;
  private nextRunAt: string | null = null;
  private running = false;
  private sequence = 0;
  private readonly runs: PaperAutoExecutionRun[] = [];

  constructor(private readonly options: PaperAutoExecutorOptions) {}

  start(): void {
    if (!this.options.enabled || this.timer) return;
    this.startedAt = this.now().toISOString();
    this.scheduleNext();
    this.timer = setInterval(() => {
      void this.runOnce("timer");
    }, this.options.intervalMs);
    this.timer.unref?.();
    void this.runOnce("startup");
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.nextRunAt = null;
  }

  getStatus(): PaperAutoExecutionStatus {
    const latestRun = this.runs[0] ?? null;
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
      todaySubmittedOrders: this.countSubmittedOrders(getChinaTradeDate(this.now())),
      currentSession: getAshareSession(this.now()),
      startedAt: this.startedAt,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      latestRun,
      recentRuns: [...this.runs],
      guardrails: this.guardrails(),
    };
  }

  async runOnce(trigger: PaperAutoExecutionTrigger = "manual"): Promise<PaperAutoExecutionRun> {
    const started = this.now();
    const session = getAshareSession(started);
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
        return this.finalizeRun(trigger, started, tradingDate, session, "not-run", submittedOrders, skippedOperations);
      }

      if (this.options.config.REAL_TRADING_ENABLED || this.options.config.MARKET_MODE !== "paper") {
        skippedOperations.push({
          symbol: "SYSTEM",
          action: "blocked",
          reason: "auto execution requires MARKET_MODE=paper and REAL_TRADING_ENABLED=false",
        });
        return this.finalizeRun(trigger, started, tradingDate, session, "not-run", submittedOrders, skippedOperations);
      }

      if (this.options.tradeWindowOnly && session !== "open") {
        skippedOperations.push({
          symbol: "SYSTEM",
          action: "observe",
          reason: `outside A-share trading session: ${session}`,
        });
        return this.finalizeRun(trigger, started, tradingDate, session, "not-run", submittedOrders, skippedOperations);
      }

      const { plan } = await buildCurrentPaperTradingPlan({
        system: this.options.system,
        config: this.options.config,
      });
      await this.options.planNotifier?.notify(plan);

      const todaySubmitted = this.countSubmittedOrders(tradingDate);
      let remainingDailyOrders = Math.max(0, this.options.maxDailyOrders - todaySubmitted);
      let remainingRunOrders = this.options.maxOrdersPerRun;

      for (const operation of plan.operations) {
        const side = this.toOrderSide(operation.action);
        if (!side) {
          skippedOperations.push({
            symbol: operation.symbol,
            action: operation.action,
            reason: "operation is not an executable paper auto action",
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
          const account = this.options.system.broker.getAccount();
          const cashReserve = account.equity *
            this.options.config.PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO;
          const spendableCash = Math.max(0, account.cash - cashReserve);

          if (requiredCash > spendableCash + 0.001) {
            skippedOperations.push({
              symbol: operation.symbol,
              action: operation.action,
              reason: `累计订单后可用资金不足，需 ${requiredCash.toFixed(2)} 元，可用于新买单 ${spendableCash.toFixed(2)} 元；未创建订单`,
            });
            continue;
          }
        }

        const request: OrderRequest = {
          symbol: operation.symbol,
          side,
          type: "market",
          quantity: operation.quantity,
          clientOrderId: this.clientOrderId(plan.tradingDate, operation),
        };
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
            reason: operation.reason,
            ruleChecks: operation.ruleChecks,
            estimatedNotional: operation.estimatedNotional,
            status: order.status,
            rejectionReason: order.rejectionReason,
          },
        );

        remainingRunOrders -= 1;
        remainingDailyOrders -= 1;
      }

      return this.finalizeRun(
        trigger,
        started,
        tradingDate,
        session,
        plan.qualitySummary.planQuality,
        submittedOrders,
        skippedOperations,
      );
    } finally {
      this.running = false;
      this.scheduleNext();
    }
  }

  private finalizeRun(
    trigger: PaperAutoExecutionTrigger,
    started: Date,
    tradingDate: string,
    session: PaperAutoExecutionSession,
    planQuality: PaperAutoExecutionRun["planQuality"],
    submittedOrders: PaperAutoExecutionOrder[],
    skippedOperations: PaperAutoExecutionSkip[],
  ): PaperAutoExecutionRun {
    return this.recordRun({
      id: this.nextRunId(tradingDate),
      trigger,
      startedAt: started.toISOString(),
      finishedAt: this.now().toISOString(),
      tradingDate,
      session,
      planQuality,
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
    this.options.system.store.appendAudit(
      "system",
      "paper-auto-execution.run",
      "paper auto execution run recorded",
      {
        id: run.id,
        trigger: run.trigger,
        tradingDate: run.tradingDate,
        session: run.session,
        planQuality: run.planQuality,
        submittedOrders: run.submittedOrders.length,
        skippedOperations: run.skippedOperations.length,
        submittedOrderStatuses: run.submittedOrders.map((order) => ({
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          status: order.status,
          rejectionReason: order.rejectionReason,
          strategy: order.strategy,
          reason: order.reason,
        })),
        skippedReasons: run.skippedOperations.slice(0, 8).map((operation) => ({
          symbol: operation.symbol,
          action: operation.action,
          reason: operation.reason,
        })),
      },
    );
    return run;
  }

  private scheduleNext(): void {
    if (!this.options.enabled) {
      this.nextRunAt = null;
      return;
    }
    this.nextRunAt = new Date(this.now().getTime() + this.options.intervalMs).toISOString();
  }

  private countSubmittedOrders(tradingDate: string): number {
    const prefix = `kairos-auto-paper:${tradingDate}:`;
    return this.options.system.store
      .listOrders(10_000)
      .filter((order) => order.clientOrderId?.startsWith(prefix))
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
      "No TongHuaShun, Zhongxin, SuperMind, browser cookie, password, SMS code or live broker token is used.",
    ];
  }
}
