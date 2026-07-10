/**
 * 东方财富行情数据提供者。
 *
 * 实现 MarketDataProvider 契约，从东方财富公开 API 获取 A 股实时行情。
 * 支持定时轮询模式，可配置刷新间隔。
 *
 * 安全约束：
 * - 默认仅获取行情，不执行任何交易操作
 * - 仅支持 "paper" 模式（模拟），"live" 模式需额外配置
 */

import { EventEmitter } from "node:events";
import type {
  MarketQuote,
  MarketSnapshot,
  TradingMode,
} from "../../../shared/trading";
import type { MarketDataProvider } from "../../contracts/MarketDataProvider";
import { EastMoneyApi } from "./eastMoneyApi";

/** 默认监控的股票列表 */
const DEFAULT_SYMBOLS = [
  "600519", // 贵州茅台
  "000858", // 五粮液
  "300750", // 宁德时代
  "601318", // 中国平安
  "000001", // 平安银行
  "600036", // 招商银行
  "002594", // 比亚迪
  "688981", // 中芯国际
];

/** 默认指数列表（不可交易） */
const DEFAULT_INDICES = [
  "000001", // 上证指数
  "399001", // 深证成指
  "399006", // 创业板指
];

export interface EastMoneyMarketConfig {
  /** 监控的股票代码列表 */
  symbols?: string[];
  /** 监控的指数代码列表 */
  indices?: string[];
  /** 轮询间隔（毫秒），默认 3000 */
  pollIntervalMs?: number;
  /** API 请求超时（毫秒），默认 10000 */
  timeoutMs?: number;
  /** 交易模式 */
  mode?: TradingMode;
}

export class EastMoneyMarketProvider
  extends EventEmitter
  implements MarketDataProvider
{
  private readonly api: EastMoneyApi;
  private readonly symbols: string[];
  private readonly indices: string[];
  private readonly pollIntervalMs: number;
  private readonly mode: TradingMode;
  private readonly quoteCache = new Map<string, MarketQuote>();
  private sequence = 0;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(config: EastMoneyMarketConfig = {}) {
    super();
    this.symbols = config.symbols ?? DEFAULT_SYMBOLS;
    this.indices = config.indices ?? DEFAULT_INDICES;
    this.pollIntervalMs = Math.max(1000, config.pollIntervalMs ?? 3000);
    this.mode = config.mode ?? "paper";
    this.api = new EastMoneyApi({ timeoutMs: config.timeoutMs ?? 10000 });

    // 初始化缓存为占位数据
    const now = new Date().toISOString();
    for (const symbol of [...this.symbols, ...this.indices]) {
      this.quoteCache.set(symbol, {
        symbol,
        name: symbol,
        tradable: this.symbols.includes(symbol),
        price: 0,
        previousClose: 0,
        changePercent: 0,
        volume: 0,
        updatedAt: now,
      });
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // 立即拉取一次
    this.poll().catch((err) => {
      console.error("[EastMoneyMarket] 初始拉取失败:", err);
    });

    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[EastMoneyMarket] 轮询失败:", err);
      });
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  tick(): MarketSnapshot {
    // 同步 tick：仅返回当前缓存快照，不发起网络请求
    this.sequence++;
    return this.buildSnapshot();
  }

  getQuote(symbol: string): MarketQuote | undefined {
    const quote = this.quoteCache.get(symbol);
    return quote ? { ...quote } : undefined;
  }

  getSnapshot(): MarketSnapshot {
    return this.buildSnapshot();
  }

  // ── 私有方法 ──

  private async poll(): Promise<void> {
    if (!this.running) return;

    const allCodes = [...this.symbols, ...this.indices];
    try {
      const quotes = await this.api.getQuotes(allCodes);
      const now = new Date().toISOString();

      for (const code of allCodes) {
        const normalized = quotes.get(code);
        if (normalized) {
          const cached = this.quoteCache.get(code);
          this.quoteCache.set(code, {
            symbol: normalized.symbol,
            name: normalized.name,
            tradable: this.symbols.includes(code),
            price: normalized.price,
            previousClose:
              normalized.previousClose || cached?.previousClose || 0,
            changePercent: normalized.changePercent,
            volume: normalized.volume,
            updatedAt: now,
          });
        }
      }

      this.sequence++;
      this.emit("snapshot", this.buildSnapshot());
    } catch (err) {
      // 网络请求失败时保持缓存数据不变，仅记录日志
      if (this.running) {
        console.warn("[EastMoneyMarket] API 请求失败，使用缓存数据:", err);
      }
    }
  }

  private buildSnapshot(): MarketSnapshot {
    return {
      mode: this.mode,
      sequence: this.sequence,
      marketTime: new Date().toISOString(),
      quotes: [...this.quoteCache.values()].map((q) => ({ ...q })),
    };
  }
}
