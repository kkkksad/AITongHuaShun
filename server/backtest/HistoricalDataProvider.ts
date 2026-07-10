import { EventEmitter } from "node:events";
import type { MarketQuote, MarketSnapshot } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";

/**
 * 历史行情重放提供者 —— 实现 MarketDataProvider 契约，
 * 用于回测引擎按顺序重放历史行情快照。
 *
 * 设计要点：
 * - 持有 MarketSnapshot[] 条形数据
 * - currentIndex 控制当前回放位置
 * - getSnapshot/getQuote 返回当前 bar 的数据
 * - tick() 推进到下一根 bar
 * - 兼容 PaperBroker 的依赖注入
 */
export class HistoricalDataProvider
  extends EventEmitter
  implements MarketDataProvider
{
  private readonly snapshots: MarketSnapshot[];
  private currentIndex = 0;
  private timer?: NodeJS.Timeout;

  constructor(snapshots: MarketSnapshot[]) {
    super();
    if (snapshots.length === 0) {
      throw new Error("HistoricalDataProvider requires at least one snapshot.");
    }
    this.snapshots = snapshots;
  }

  /** 重设到第一根 bar */
  reset(): void {
    this.currentIndex = 0;
  }

  /** 当前 bar 索引 */
  get index(): number {
    return this.currentIndex;
  }

  /** bar 总数 */
  get length(): number {
    return this.snapshots.length;
  }

  /** 是否已经回放完所有 bar */
  get isComplete(): boolean {
    return this.currentIndex >= this.snapshots.length - 1;
  }

  // ── MarketDataProvider 实现 ──

  start(): void {
    // 历史重放不需要定时器；回测引擎通过 tick() 手动推进
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getQuote(symbol: string): MarketQuote | undefined {
    const quote = this.currentSnapshot.quotes.find((q) => q.symbol === symbol);
    return quote ? { ...quote } : undefined;
  }

  getSnapshot(): MarketSnapshot {
    return { ...this.currentSnapshot };
  }

  tick(): MarketSnapshot {
    if (this.isComplete) {
      return this.emitSnapshot();
    }

    this.currentIndex += 1;
    return this.emitSnapshot();
  }

  /** 设置当前 bar 索引（用于随机访问） */
  seek(index: number): MarketSnapshot {
    if (index < 0 || index >= this.snapshots.length) {
      throw new Error(
        `Index ${index} out of range [0, ${this.snapshots.length - 1}]`
      );
    }
    this.currentIndex = index;
    return this.emitSnapshot();
  }

  private get currentSnapshot(): MarketSnapshot {
    return this.snapshots[this.currentIndex];
  }

  private emitSnapshot(): MarketSnapshot {
    const snapshot = this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }
}
