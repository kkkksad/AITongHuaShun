import type { MarketQuote, MarketSnapshot } from "../../shared/trading";

/**
 * 行情数据提供者契约 —— 所有行情源（模拟、AkShare、Tushare、券商行情网关）
 * 都必须实现此接口。
 *
 * 设计原则：
 * - 纯接口，不含实现细节，便于注入和替换。
 * - 返回的是不可变快照，调用方不持有内部引用。
 * - 事件语义通过 EventEmitter 约定：'snapshot' 事件携带 MarketSnapshot。
 */
export interface MarketDataProvider {
  /** 启动行情推送，启动后应定期发出 'snapshot' 事件。 */
  start(): void;

  /** 停止行情推送，释放定时器和连接。 */
  stop(): void;

  /** 手动推进一次行情 tick（用于测试和确定性回放）。返回新的快照。 */
  tick(): MarketSnapshot;

  /** 获取单个标的的最新行情快照；未找到返回 undefined。 */
  getQuote(symbol: string): MarketQuote | undefined;

  /** 获取全量行情快照。 */
  getSnapshot(): MarketSnapshot;

  /** 订阅 'snapshot' 事件。 */
  on(event: "snapshot", listener: (snapshot: MarketSnapshot) => void): this;

  /** 取消订阅 'snapshot' 事件。 */
  off(event: "snapshot", listener: (snapshot: MarketSnapshot) => void): this;
}
