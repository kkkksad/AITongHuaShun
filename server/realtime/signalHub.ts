import type {
  SignalSubscription,
  TradingSignal,
} from "../../shared/trading";

// ── 信号生成器接口 ────────────────────────────────────────

export interface SignalGenerator {
  /** 策略ID */
  readonly strategyId: string;
  /** 策略名称 */
  readonly strategyName: string;
  /** 评估并生成交易信号 */
  evaluate(): TradingSignal[];
  /** 手动推送信号 */
  push(signal: TradingSignal): void;
}

// ── SignalHub ─────────────────────────────────────────────

export type SignalListener = (signal: TradingSignal) => void;

export class SignalHub {
  private readonly listeners = new Set<SignalListener>();
  private readonly generators = new Map<string, SignalGenerator>();
  private readonly activeSignals = new Map<string, TradingSignal>();
  private evaluateTimer: ReturnType<typeof setInterval> | null = null;

  /** 注册信号生成器（策略） */
  registerGenerator(generator: SignalGenerator): void {
    if (this.generators.has(generator.strategyId)) {
      throw new Error(
        `SignalGenerator "${generator.strategyId}" already registered`,
      );
    }
    this.generators.set(generator.strategyId, generator);
  }

  /** 移除信号生成器 */
  unregisterGenerator(strategyId: string): boolean {
    return this.generators.delete(strategyId);
  }

  /** 获取已注册的策略ID列表 */
  get strategyIds(): string[] {
    return [...this.generators.keys()];
  }

  /** 订阅信号 */
  subscribe(listener: SignalListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 推送信号到所有监听者 */
  broadcast(signal: TradingSignal): void {
    // 更新活跃信号缓存
    this.activeSignals.set(signal.id, signal);

    // 通知所有监听者
    for (const listener of this.listeners) {
      try {
        listener(signal);
      } catch {
        // 单个监听者失败不影响其他
      }
    }
  }

  /** 推送信号并应用订阅过滤 */
  broadcastFiltered(signal: TradingSignal, filter: SignalSubscription): boolean {
    // 策略过滤
    if (
      filter.strategyIds &&
      filter.strategyIds.length > 0 &&
      !filter.strategyIds.includes(signal.strategyId)
    ) {
      return false;
    }

    // 标的过滤
    if (
      filter.symbols &&
      filter.symbols.length > 0 &&
      !filter.symbols.includes(signal.symbol)
    ) {
      return false;
    }

    // 强度过滤
    if (
      filter.minStrength !== undefined &&
      signal.strength < filter.minStrength
    ) {
      return false;
    }

    // 置信度过滤
    if (
      filter.minConfidence !== undefined &&
      signal.confidence < filter.minConfidence
    ) {
      return false;
    }

    this.broadcast(signal);
    return true;
  }

  /** 评估所有策略并推送信号 */
  evaluateAll(): TradingSignal[] {
    const allSignals: TradingSignal[] = [];

    for (const generator of this.generators.values()) {
      try {
        const signals = generator.evaluate();
        for (const signal of signals) {
          this.broadcast(signal);
          allSignals.push(signal);
        }
      } catch {
        // 单个策略评估失败不影响其他
      }
    }

    return allSignals;
  }

  /** 启动定时评估 */
  startAutoEvaluate(intervalMs: number): void {
    if (this.evaluateTimer) return;
    this.evaluateTimer = setInterval(() => {
      this.evaluateAll();
    }, intervalMs);
  }

  /** 停止定时评估 */
  stopAutoEvaluate(): void {
    if (this.evaluateTimer) {
      clearInterval(this.evaluateTimer);
      this.evaluateTimer = null;
    }
  }

  /** 获取所有活跃信号 */
  getActiveSignals(): TradingSignal[] {
    // 清理过期信号
    const now = Date.now();
    for (const [id, signal] of this.activeSignals) {
      if (signal.status === "active" && signal.ttlSeconds > 0) {
        const expiresAt =
          new Date(signal.timestamp).getTime() + signal.ttlSeconds * 1000;
        if (now > expiresAt) {
          signal.status = "expired";
          this.activeSignals.set(id, signal);
        }
      }
    }

    return [...this.activeSignals.values()].filter(
      (s) => s.status === "active",
    );
  }

  /** 将一个信号标记为已执行 */
  markExecuted(signalId: string): boolean {
    const signal = this.activeSignals.get(signalId);
    if (signal && signal.status === "active") {
      signal.status = "executed";
      this.activeSignals.set(signalId, signal);
      return true;
    }
    return false;
  }

  /** 取消一个信号 */
  cancelSignal(signalId: string): boolean {
    const signal = this.activeSignals.get(signalId);
    if (signal && signal.status === "active") {
      signal.status = "cancelled";
      // 广播取消事件
      this.broadcast({ ...signal, status: "cancelled" });
      this.activeSignals.set(signalId, signal);
      return true;
    }
    return false;
  }

  /** 获取监听者数量 */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** 获取生成器数量 */
  get generatorCount(): number {
    return this.generators.size;
  }

  /** 清理所有资源 */
  dispose(): void {
    this.stopAutoEvaluate();
    this.listeners.clear();
    this.generators.clear();
    this.activeSignals.clear();
  }
}

// ── 辅助：创建交易信号 ────────────────────────────────────

let signalCounter = 0;

export function createSignal(params: {
  strategyId: string;
  strategyName: string;
  symbol: string;
  direction: "buy" | "sell" | "hold";
  strength: number;
  positionSize: number;
  price: number;
  reason: string;
  ttlSeconds?: number;
  confidence?: number;
  indicators?: Record<string, number>;
}): TradingSignal {
  signalCounter += 1;
  return {
    id: `sig_${Date.now()}_${signalCounter}`,
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    symbol: params.symbol,
    direction: params.direction,
    strength: Math.max(0, Math.min(1, params.strength)),
    positionSize: params.positionSize,
    price: params.price,
    reason: params.reason,
    timestamp: new Date().toISOString(),
    ttlSeconds: params.ttlSeconds ?? 300,
    confidence: params.confidence ?? params.strength,
    indicators: params.indicators,
    status: "active",
  };
}
