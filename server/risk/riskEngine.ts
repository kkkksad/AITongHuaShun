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
    circuitBreaker: enhanced.circuitBreaker ?? { ...DEFAULT_CIRCUIT_BREAKER },
    dynamicPositionScaling: enhanced.dynamicPositionScaling ?? false,
    maxDrawdownReductionFactor: enhanced.maxDrawdownReductionFactor ?? 0.25,
  };
}

export class RiskEngine {
  private state: RiskState;
  private readonly limits: EnhancedRiskLimits;

  constructor(limits: RiskLimits | EnhancedRiskLimits) {
    this.limits = toEnhanced(limits);
    this.state = this.initialState();
  }

  // ── 公开 API ──────────────────────────────────────────────

  getLimits(): EnhancedRiskLimits {
    return { ...this.limits };
  }

  getState(): Readonly<RiskState> {
    return { ...this.state };
  }

  /** 设置日内初始权益（应在交易日开始时调用） */
  setInitialEquity(equity: number): void {
    if (equity > 0) {
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
  }

  /** 记录一次交易结果（盈利/亏损），用于更新熔断器状态 */
  recordTradeResult(profit: number, accountEquity: number): void {
    const now = new Date().toISOString();
    this.state.tradeCount++;
    this.state.lastTradeTime = now;
    this.state.lastEvaluationTime = now;

    // 更新日内峰值权益
    if (accountEquity > this.state.peakDailyEquity) {
      this.state.peakDailyEquity = accountEquity;
    }

    // 计算日内回撤（基于峰值权益）
    this.state.dailyDrawdown =
      this.state.peakDailyEquity > 0
        ? Math.max(0, 1 - accountEquity / this.state.peakDailyEquity)
        : 0;

    if (profit < 0) {
      this.state.lossCount++;
      this.state.consecutiveLosses++;
    } else {
      this.state.consecutiveLosses = 0;
    }

    this.evaluateCircuit(now);
  }

  /** 评估订单风险 */
  evaluate(input: {
    request: OrderRequest;
    quote?: MarketQuote;
    account: AccountSnapshot;
    position?: PositionSnapshot;
    reservedSellQuantity?: number;
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
    if (account.dailyPnlPercent <= -this.limits.maxDailyLoss) {
      return this.reject("DAILY_LOSS_LIMIT", "账户已触发每日亏损停止线");
    }

    // ── 买入检查 ──
    if (request.side === "buy") {
      if (notional > account.cash) {
        return this.reject("INSUFFICIENT_CASH", "可用资金不足");
      }

      const effectiveMaxWeight = this.getEffectiveMaxPositionWeight();
      const currentValue = position?.marketValue ?? 0;
      const postTradeWeight =
        account.equity === 0
          ? 1
          : (currentValue + notional) / account.equity;

      if (postTradeWeight > effectiveMaxWeight) {
        return this.reject(
          "POSITION_WEIGHT_LIMIT",
          `成交后仓位权重 ${(postTradeWeight * 100).toFixed(1)}% 将超过单标的上限`,
        );
      }
    }

    // ── 卖出检查 ──
    if (request.side === "sell") {
      const availableQuantity = Math.max(
        0,
        (position?.quantity ?? 0) - reservedSellQuantity,
      );
      if (request.quantity > availableQuantity) {
        return this.reject("INSUFFICIENT_POSITION", "可卖持仓不足");
      }
    }

    // 熔断器警告仍允许交易
    if (circuitCheck.code === "RISK_WARNING") {
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
    const { circuitState } = this.state;

    if (circuitState === "tripped") {
      const trippedAt = this.state.trippedAt
        ? new Date(this.state.trippedAt)
        : new Date(0);
      const elapsedMinutes =
        (Date.now() - trippedAt.getTime()) / (1000 * 60);

      if (elapsedMinutes < this.limits.circuitBreaker.cooldownMinutes) {
        const remaining = Math.ceil(
          this.limits.circuitBreaker.cooldownMinutes - elapsedMinutes,
        );
        return this.reject(
          "CIRCUIT_BREAKER_TRIPPED",
          `熔断器已触发，剩余冷却时间约 ${remaining} 分钟`,
        );
      }

      // 冷却期满但仍在观察期：允许交易但保持 warning
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

      // 完全恢复
      this.state.circuitState = "normal";
      this.state.trippedAt = null;
      this.state.warningAt = null;
      this.state.consecutiveLosses = 0;
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

    // 检查是否触发熔断
    if (
      this.state.consecutiveLosses >= circuitBreaker.maxConsecutiveLosses ||
      this.state.dailyDrawdown >= circuitBreaker.maxDailyDrawdown
    ) {
      this.state.circuitState = "tripped";
      this.state.trippedAt = now;
      return;
    }

    // 检查是否触发预警（连续亏损接近阈值 60%）
    if (
      this.state.consecutiveLosses >=
      Math.floor(circuitBreaker.maxConsecutiveLosses * 0.6)
    ) {
      this.state.circuitState = "warning";
      this.state.warningAt = now;
      return;
    }

    // 检查回撤预警（接近阈值 60%）
    if (
      this.state.dailyDrawdown >=
      circuitBreaker.maxDailyDrawdown * 0.6
    ) {
      this.state.circuitState = "warning";
      this.state.warningAt = now;
      return;
    }
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

  private reject(code: string, message: string): RiskDecision {
    return { allowed: false, code, message };
  }
}
