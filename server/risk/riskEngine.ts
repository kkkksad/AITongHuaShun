import type {
  AccountSnapshot,
  CircuitBreakerConfig,
  CircuitState,
  EnhancedRiskLimits,
  MarketQuote,
  OrderRequest,
  PositionSnapshot,
  RiskDecision,
  RiskLimits,
  RiskState,
  TradingMode,
} from "../../shared/trading";
import type { AlertType } from "../notifications/types";
import { hasSufficientCash } from "../broker/executionCosts";
import { copyPaperRiskState, isRiskTimestamp, validatePaperRiskState } from "./paperRiskCheckpoint";

/** 熔断器事件回调 — 用于集成告警通知 */
export type CircuitBreakerCallback = (event: {
  type: AlertType;
  level: "warn" | "critical";
  title: string;
  message: string;
  data: Record<string, unknown>;
}) => void;

const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  maxConsecutiveLosses: 5,
  maxDailyDrawdown: 0.08,
  cooldownMinutes: 15,
  recoveryMinutes: 5,
};

function toEnhanced(limits: RiskLimits | EnhancedRiskLimits): EnhancedRiskLimits {
  const enhanced = limits as EnhancedRiskLimits;
  return {
    maxOrderNotional: enhanced.maxOrderNotional,
    maxPositionWeight: enhanced.maxPositionWeight,
    maxDailyLoss: enhanced.maxDailyLoss,
    lotSize: enhanced.lotSize,
    realTradingEnabled: enhanced.realTradingEnabled,
    circuitBreaker: { ...(enhanced.circuitBreaker ?? DEFAULT_CIRCUIT_BREAKER) },
    dynamicPositionScaling: enhanced.dynamicPositionScaling ?? false,
    maxDrawdownReductionFactor: enhanced.maxDrawdownReductionFactor ?? 0.25,
  };
}

export class RiskEngine {
  private state: RiskState;
  private readonly limits: EnhancedRiskLimits;
  private readonly onCircuitBreaker?: CircuitBreakerCallback;

  constructor(
    limits: RiskLimits | EnhancedRiskLimits,
    onCircuitBreaker?: CircuitBreakerCallback,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.limits = toEnhanced(limits);
    this.state = this.initialState();
    this.onCircuitBreaker = onCircuitBreaker;
  }

  // ── 公开 API ──────────────────────────────────────────────

  getLimits(): EnhancedRiskLimits {
    return { ...this.limits, circuitBreaker: { ...this.limits.circuitBreaker } };
  }

  getState(): Readonly<RiskState> {
    return { ...this.state };
  }

  restoreState(state: Readonly<RiskState>): void {
    validatePaperRiskState(state);
    this.state = copyPaperRiskState(state);
  }

  setLedgerStatus(status: NonNullable<RiskState["ledgerStatus"]>): void {
    this.state.ledgerStatus = status;
  }

  /** Fold committed cycles at their actual event times, then observe current equity separately. */
  recordClosedCycleResult(profit: number | null, closedAt: string): void {
    if ((profit !== null && !Number.isFinite(profit)) || !isRiskTimestamp(closedAt) ||
        Date.parse(closedAt) > this.clock().getTime() + 5_000) {
      throw new Error("Invalid committed Paper risk cycle evidence.");
    }
    this.syncTradingDay(new Date(Date.parse(closedAt) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10));
    this.refreshCircuit(closedAt);
    if (profit === null) {
      this.state.unknownCycleCount = (this.state.unknownCycleCount ?? 0) + 1;
    } else {
      this.state.tradeCount++;
      this.state.lastTradeTime = closedAt;
      if (profit < 0) {
        this.state.lossCount++;
        this.state.consecutiveLosses++;
      } else {
        this.state.consecutiveLosses = 0;
      }
    }
    this.state.lastEvaluationTime = closedAt;
    this.evaluateCircuit(closedAt);
  }

  /** 设置日内初始权益（应在交易日开始时调用） */
  setInitialEquity(equity: number): void {
    if (Number.isFinite(equity) && equity > 0) {
      this.syncTradingDay();
      if (this.state.peakDailyEquity > 0) return;
      this.state.peakDailyEquity = equity;
    }
  }

  /** 获取当前有效的（可能被动态缩减的）仓位权重上限 */
  getEffectiveMaxPositionWeight(): number {
    if (!this.limits.dynamicPositionScaling) {
      return this.limits.maxPositionWeight;
    }
    return this.calculateDynamicWeight();
  }

  /** Check projected buy exposure without evaluating or changing circuit state. */
  evaluatePositionWeight(input: {
    currentValue: number;
    addedValue: number;
    equity: number;
    reservedBuyNotional?: number;
  }): RiskDecision {
    const projectedValue = input.currentValue + input.addedValue + (input.reservedBuyNotional ?? 0);
    const postTradeWeight = input.equity === 0 ? 1 : projectedValue / input.equity;
    const effectiveMaxWeight = this.getEffectiveMaxPositionWeight();
    const exceedsLimit = input.equity === 0
      ? postTradeWeight > effectiveMaxWeight
      : !hasSufficientCash(input.equity * effectiveMaxWeight, projectedValue);
    if (exceedsLimit) {
      return this.reject(
        "POSITION_WEIGHT_LIMIT",
        `成交后仓位权重 ${(postTradeWeight * 100).toFixed(1)}% 将超过单标的上限`,
      );
    }
    return { allowed: true, code: "APPROVED", message: "风险检查通过" };
  }

  /** 获取当前有效的单笔订单金额上限 */
  getEffectiveMaxOrderNotional(): number {
    if (!this.limits.dynamicPositionScaling) {
      // Dynamic scaling disabled: use full limit
      return this.limits.maxOrderNotional;
    }

    const weightScale =
      this.calculateDynamicWeight() / this.limits.maxPositionWeight;
    return Math.max(
      this.limits.maxOrderNotional * this.limits.maxDrawdownReductionFactor,
      this.limits.maxOrderNotional * weightScale,
    );
  }

  /** 重置熔断器状态（手动恢复） */
  resetCircuit(): void {
    this.state = this.initialState();
    this.state.baselineResetDate = this.state.tradingDate;
  }

  /** 记录一次交易结果（盈利/亏损），用于更新熔断器状态 */
  recordTradeResult(profit: number, accountEquity: number): void {
    if (!Number.isFinite(profit) || !Number.isFinite(accountEquity) || accountEquity < 0) {
      throw new Error("Risk trade evidence must contain finite profit and nonnegative equity.");
    }
    this.syncTradingDay();

    const now = this.clock().toISOString();
    this.refreshCircuit(now);
    this.state.tradeCount++;
    this.state.lastTradeTime = now;
    this.state.lastEvaluationTime = now;

    this.updateEquity(accountEquity);

    if (profit < 0) {
      this.state.lossCount++;
      this.state.consecutiveLosses++;
    } else {
      this.state.consecutiveLosses = 0;
    }

    this.evaluateCircuit(now);
  }

  /** Mark-to-market observations never increment the complete-trade counters. */
  observeEquity(equity: number, evidencedOpeningEquity?: number): void {
    if (!Number.isFinite(equity) || equity < 0) return;
    this.syncTradingDay();
    const now = this.clock().toISOString();
    this.refreshCircuit(now);
    if (this.state.peakDailyEquity === 0 && this.state.baselineResetDate !== this.state.tradingDate &&
        evidencedOpeningEquity !== undefined &&
        Number.isFinite(evidencedOpeningEquity) && evidencedOpeningEquity > 0) {
      this.state.peakDailyEquity = evidencedOpeningEquity;
    }
    this.updateEquity(equity);
    this.state.lastEvaluationTime = now;
    this.evaluateCircuit(now);
  }

  /** 评估订单风险 */
  evaluate(input: {
    request: OrderRequest;
    quote?: MarketQuote;
    account: AccountSnapshot;
    position?: PositionSnapshot;
    reservedSellQuantity?: number;
    reservedBuyNotional?: number;
    requiredCash?: number;
    mode: TradingMode;
  }): RiskDecision {
    const {
      request,
      quote,
      account,
      position,
      reservedSellQuantity = 0,
      mode,
    } = input;

    this.syncTradingDay();

    if (this.state.ledgerStatus && this.state.ledgerStatus !== "ready") {
      return this.reject("RISK_LEDGER_UNAVAILABLE", this.state.ledgerStatus === "history-gap"
        ? "完整成交风险记录存在缺口，请复核后手动重置风控" : "风险检查点暂不可用，停止新增执行");
    }

    // ── 熔断器检查（最高优先级） ──
    const circuitCheck = this.checkCircuitBreaker();
    if (!circuitCheck.allowed) {
      return circuitCheck;
    }

    // ── 实盘开关 ──
    if (mode === "live" && !this.limits.realTradingEnabled) {
      return this.reject("LIVE_TRADING_DISABLED", "真实交易开关未启用");
    }

    // ── 交易暂停 ──
    if (account.paused) {
      return this.reject("TRADING_PAUSED", "交易已暂停");
    }

    // ── 行情检查 ──
    if (!quote) {
      return this.reject("UNKNOWN_SYMBOL", "没有可用的行情报价");
    }

    if (!Number.isFinite(quote.price) || quote.price <= 0) {
      return this.reject("INVALID_MARKET_PRICE", "行情尚未就绪，暂不创建订单");
    }

    if (!quote.tradable) {
      return this.reject(
        "NON_TRADABLE_SYMBOL",
        "当前标的仅用于行情展示，不能下单",
      );
    }

    // ── 数量校验 ──
    if (!Number.isInteger(request.quantity) || request.quantity <= 0) {
      return this.reject("INVALID_QUANTITY", "订单数量必须是正整数");
    }

    if (request.quantity % this.limits.lotSize !== 0) {
      return this.reject(
        "INVALID_LOT_SIZE",
        `订单数量必须是 ${this.limits.lotSize} 的整数倍`,
      );
    }

    const orderPrice =
      request.type === "limit"
        ? (request.limitPrice ?? quote.price)
        : quote.price;
    const notional = orderPrice * request.quantity;

    // ── 单笔订单限额检查（买/卖都适用） ──
    const effectiveMaxNotional = this.getEffectiveMaxOrderNotional();
    if (notional > effectiveMaxNotional) {
      return this.reject(
        "ORDER_NOTIONAL_LIMIT",
        `订单金额 ${notional.toFixed(0)} 超过单笔限额 ${effectiveMaxNotional.toFixed(0)}`,
      );
    }

    // ── 每日亏损检查 ──
    const dayPerformance = account.tradingDayPerformance;
    if (dayPerformance && dayPerformance.pnlPercent === null && request.side === "buy") {
      return this.reject("DAILY_BASELINE_UNAVAILABLE", "当日权益基线数据不足，暂不新增仓位");
    }
    // Legacy external snapshots remain compatible; both built-in stores supply the daily ledger.
    const dailyLoss = dayPerformance ? dayPerformance.pnlPercent : account.dailyPnlPercent;
    if (dailyLoss !== null && dailyLoss <= -this.limits.maxDailyLoss) {
      return this.reject("DAILY_LOSS_LIMIT", "账户已触发每日亏损停止线");
    }

    // ── 买入检查 ──
    if (request.side === "buy") {
      if (!hasSufficientCash(account.cash, Math.max(notional, input.requiredCash ?? notional))) {
        return this.reject("INSUFFICIENT_CASH", "可用资金不足");
      }

      const positionDecision = this.evaluatePositionWeight({
        currentValue: position?.marketValue ?? 0,
        addedValue: notional,
        equity: account.equity,
        reservedBuyNotional: input.reservedBuyNotional,
      });
      if (!positionDecision.allowed) return positionDecision;
    }

    // ── 卖出检查 ──
    if (request.side === "sell") {
      const heldQuantity = position?.quantity ?? 0;
      const t1LockedQuantity = position?.t1LockedQuantity ?? 0;
      const sellableBeforeReservations = position?.availableQuantity ?? heldQuantity;
      const availableQuantity = Math.max(
        0,
        sellableBeforeReservations - reservedSellQuantity,
      );
      if (request.quantity > availableQuantity) {
        const message =
          t1LockedQuantity > 0 && heldQuantity >= request.quantity
            ? "可卖持仓不足（A股 T+1：当日买入不可卖）"
            : "可卖持仓不足";
        return this.reject("INSUFFICIENT_POSITION", message);
      }
    }

    // 熔断器警告仍允许交易
    if (circuitCheck.code === "RISK_WARNING" || circuitCheck.code === "CIRCUIT_RECOVERING") {
      return circuitCheck;
    }

    return {
      allowed: true,
      code: "APPROVED",
      message: "风险检查通过",
    };
  }

  // ── 内部方法 ──────────────────────────────────────────────

  private initialState(): RiskState {
    return {
      tradingDate: this.tradingDate(),
      unknownCycleCount: 0,
      ledgerStatus: "ready",
      baselineResetDate: null,
      circuitState: "normal",
      consecutiveLosses: 0,
      dailyDrawdown: 0,
      peakDailyEquity: 0,
      trippedAt: null,
      warningAt: null,
      tradeCount: 0,
      lossCount: 0,
      lastTradeTime: null,
      lastEvaluationTime: null,
    };
  }

  private checkCircuitBreaker(): RiskDecision {
    this.refreshCircuit(this.clock().toISOString());
    const { circuitState } = this.state;

    if (circuitState === "tripped") {
      const trippedAt = this.state.trippedAt
        ? new Date(this.state.trippedAt)
        : new Date(0);
      const elapsedMinutes =
        (this.clock().getTime() - trippedAt.getTime()) / (1000 * 60);

      if (elapsedMinutes < this.limits.circuitBreaker.cooldownMinutes) {
        const remaining = Math.ceil(
          this.limits.circuitBreaker.cooldownMinutes - elapsedMinutes,
        );
        return this.reject(
          "CIRCUIT_BREAKER_TRIPPED",
          `熔断器已触发，剩余冷却时间约 ${remaining} 分钟`,
        );
      }

      // 冷却期满但仍在观察期：允许交易，保留原触发时间。
      if (
        elapsedMinutes <
        this.limits.circuitBreaker.cooldownMinutes +
          this.limits.circuitBreaker.recoveryMinutes
      ) {
        return {
          allowed: true,
          code: "CIRCUIT_RECOVERING",
          message: "熔断器恢复观察中，请谨慎交易",
        };
      }
    }

    if (circuitState === "warning") {
      return {
        allowed: true,
        code: "RISK_WARNING",
        message: `风控预警：连续亏损 ${this.state.consecutiveLosses} 次，日内回撤 ${(this.state.dailyDrawdown * 100).toFixed(2)}%`,
      };
    }

    return { allowed: true, code: "APPROVED", message: "风险检查通过" };
  }

  private evaluateCircuit(now: string): void {
    const { circuitBreaker } = this.limits;
    const previousState = this.state.circuitState;
    // Keep the original trip time through cooldown/recovery. New observations
    // and a profitable fill must not extend or prematurely clear that latch.
    if (previousState === "tripped") return;

    // 检查是否触发熔断
    if (
      this.state.consecutiveLosses >= circuitBreaker.maxConsecutiveLosses ||
      this.state.dailyDrawdown >= circuitBreaker.maxDailyDrawdown
    ) {
      this.state.circuitState = "tripped";
      this.state.trippedAt = now;

      // 🔔 熔断触发 → 发送 critical 告警
      this.notifyCircuitBreaker(
        "risk_circuit_breaker",
        "critical",
        "熔断器触发",
        `连续亏损 ${this.state.consecutiveLosses} 次，日内回撤 ${(this.state.dailyDrawdown * 100).toFixed(2)}%，熔断器已触发`,
        {
          consecutiveLosses: this.state.consecutiveLosses,
          dailyDrawdown: this.state.dailyDrawdown,
          maxConsecutiveLosses: circuitBreaker.maxConsecutiveLosses,
          maxDailyDrawdown: circuitBreaker.maxDailyDrawdown,
          cooldownMinutes: circuitBreaker.cooldownMinutes,
          trippedAt: now,
        },
      );
      return;
    }

    // 检查是否触发预警（连续亏损接近阈值 60%）
    if (
      this.state.consecutiveLosses >=
      Math.max(1, Math.floor(circuitBreaker.maxConsecutiveLosses * 0.6))
    ) {
      const wasAlreadyWarning = previousState === "warning";
      this.state.circuitState = "warning";
      if (!wasAlreadyWarning) this.state.warningAt = now;

      // 🔔 首次进入预警 → 发送 warn 告警
      if (!wasAlreadyWarning) {
        this.notifyCircuitBreaker(
          "risk_drawdown_warning",
          "warn",
          "风控预警",
          `连续亏损 ${this.state.consecutiveLosses} 次（阈值 ${circuitBreaker.maxConsecutiveLosses}），已触发风控预警`,
          {
            consecutiveLosses: this.state.consecutiveLosses,
            threshold: circuitBreaker.maxConsecutiveLosses,
          },
        );
      }
      return;
    }

    // 检查回撤预警（接近阈值 60%）
    if (
      this.state.dailyDrawdown >=
      circuitBreaker.maxDailyDrawdown * 0.6
    ) {
      const wasAlreadyWarning = previousState === "warning";
      this.state.circuitState = "warning";
      if (!wasAlreadyWarning) this.state.warningAt = now;

      // 🔔 首次进入预警 → 发送 warn 告警
      if (!wasAlreadyWarning) {
        this.notifyCircuitBreaker(
          "risk_drawdown_warning",
          "warn",
          "回撤预警",
          `日内回撤 ${(this.state.dailyDrawdown * 100).toFixed(2)}%（阈值 ${(circuitBreaker.maxDailyDrawdown * 100).toFixed(2)}%），已触发回撤预警`,
          {
            dailyDrawdown: this.state.dailyDrawdown,
            threshold: circuitBreaker.maxDailyDrawdown,
          },
        );
      }
      return;
    }

    if (previousState === "warning") {
      this.state.circuitState = "normal";
      this.state.warningAt = null;
    }
  }

  private tradingDate(): string {
    return new Date(this.clock().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private syncTradingDay(tradingDate = this.tradingDate()): void {
    if (this.state.tradingDate === tradingDate) return;
    this.state.tradingDate = tradingDate;
    this.state.baselineResetDate = null;
    this.state.peakDailyEquity = 0;
    this.state.dailyDrawdown = 0;
    // A multi-day losing streak remains meaningful for T+1 positions.
    if (this.state.circuitState === "warning" && this.state.consecutiveLosses <
        Math.max(1, Math.floor(this.limits.circuitBreaker.maxConsecutiveLosses * 0.6))) {
      this.state.circuitState = "normal";
      this.state.warningAt = null;
    }
  }

  private updateEquity(equity: number): void {
    this.state.peakDailyEquity = Math.max(this.state.peakDailyEquity, equity);
    this.state.dailyDrawdown = this.state.peakDailyEquity > 0
      ? Math.max(0, 1 - equity / this.state.peakDailyEquity) : 0;
  }

  private refreshCircuit(now: string): void {
    if (this.state.circuitState !== "tripped" || this.state.trippedAt === null) return;
    const elapsed = (Date.parse(now) - Date.parse(this.state.trippedAt)) / 60_000;
    if (elapsed < this.limits.circuitBreaker.cooldownMinutes + this.limits.circuitBreaker.recoveryMinutes) return;
    this.state.circuitState = "normal";
    this.state.trippedAt = null;
    this.state.warningAt = null;
    this.state.consecutiveLosses = 0;
  }

  /** 根据日内回撤动态计算当前仓位权重上限 */
  private calculateDynamicWeight(): number {
    const { maxPositionWeight, maxDrawdownReductionFactor } = this.limits;
    const maxDailyDrawdown = this.limits.circuitBreaker.maxDailyDrawdown;

    if (this.state.dailyDrawdown <= 0 || Number.isNaN(this.state.dailyDrawdown)) {
      return maxPositionWeight;
    }

    // 线性缩减：回撤从 0 到 maxDailyDrawdown，权重缩减到 maxPositionWeight * maxDrawdownReductionFactor
    const drawdownRatio = Math.min(
      1,
      this.state.dailyDrawdown / maxDailyDrawdown,
    );
    const reductionFactor =
      1 - (1 - maxDrawdownReductionFactor) * drawdownRatio;

    return Math.max(
      maxPositionWeight * maxDrawdownReductionFactor,
      maxPositionWeight * reductionFactor,
    );
  }

  /** 调用熔断器回调（如已注册） */
  private notifyCircuitBreaker(
    type: AlertType,
    level: "warn" | "critical",
    title: string,
    message: string,
    data: Record<string, unknown>,
  ): void {
    if (this.onCircuitBreaker) {
      try {
        this.onCircuitBreaker({ type, level, title, message, data });
      } catch (err) {
        // 回调异常不应影响风控主流程
        console.error("[RiskEngine] 熔断器回调异常:", err);
      }
    }
  }

  private reject(code: string, message: string): RiskDecision {
    return { allowed: false, code, message };
  }
}
