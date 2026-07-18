/**
 * HTTP 行情数据提供者 —— 通过 HTTP API 获取实时行情，实现 MarketDataProvider 契约。
 */
import { EventEmitter } from "node:events";
import type { MarketQuote, MarketSnapshot, TradingMode } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";

export interface HttpMarketConfig {
  baseUrl: string;
  tickMs: number;
  mode: TradingMode;
  symbols: string[];
  indexSymbols?: string[];
  apiKey?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

interface QuoteApiResponse {
  quotes: Array<{
    symbol: string;
    name: string;
    tradable: boolean;
    price: number;
    previousClose: number;
    changePercent: number;
    volume: number;
    updatedAt: string;
    open?: number | null;
    high?: number | null;
    low?: number | null;
    amount?: number | null;
    turnover?: number | null;
    amplitude?: number | null;
  }>;
}

interface QuoteFetchResult {
  attempted: boolean;
  error: string | null;
  quotes: MarketQuote[];
  success: boolean;
}

interface QuoteBatchResult {
  errors: string[];
  quotes: MarketQuote[];
  success: boolean;
}

const MAX_POLL_BACKOFF_MS = 60_000;

function connectionFailureMessage(endpoint: string, error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return `${endpoint}请求超时`;
  }
  return `${endpoint}无法连接行情桥`;
}

export class HttpMarketProvider
  extends EventEmitter
  implements MarketDataProvider
{
  private readonly cfg: HttpMarketConfig & {
    indexSymbols: string[];
    timeout: number;
    headers: Record<string, string>;
  };
  private readonly quotes = new Map<string, MarketQuote>();
  private sequence = 0;
  private timer?: NodeJS.Timeout;
  private running = false;
  private consecutiveFailures = 0;
  /** 最近一次 fetch 成功的时间戳（毫秒），用于新鲜度评估 */
  private lastFetchSuccessMs = 0;

  constructor(config: HttpMarketConfig) {
    super();
    this.cfg = {
      ...config,
      indexSymbols: config.indexSymbols ?? [],
      timeout: config.timeout ?? 10_000,
      headers: config.headers ?? {},
    };

    for (const symbol of config.symbols) {
      this.quotes.set(symbol, {
        symbol,
        name: symbol,
        tradable: true,
        price: 0,
        previousClose: 0,
        changePercent: 0,
        volume: 0,
        updatedAt: new Date().toISOString(),
      });
    }

    for (const symbol of this.cfg.indexSymbols) {
      this.quotes.set(symbol, {
        symbol,
        name: symbol,
        tradable: false,
        price: 0,
        previousClose: 0,
        changePercent: 0,
        volume: 0,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.runPollingCycle();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  tick(): MarketSnapshot {
    return this.emitSnapshot();
  }

  getQuote(symbol: string): MarketQuote | undefined {
    const quote = this.quotes.get(symbol);
    return quote ? { ...quote } : undefined;
  }

  getSnapshot(): MarketSnapshot {
    return {
      mode: this.cfg.mode,
      sequence: this.sequence,
      marketTime: new Date().toISOString(),
      quotes: [...this.quotes.values()].map((q) => ({ ...q })),
    };
  }

  /** 返回最近一次成功获取数据的本地时间戳（毫秒），用于质量评分 */
  getLastFetchSuccessMs(): number {
    return this.lastFetchSuccessMs;
  }

  private async fetchAndEmit(): Promise<void> {
    const result = await this.fetchQuotes();
    if (result.success) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures += 1;
    }
    if (result.errors.length > 0) {
      const retryMs = this.nextPollDelayMs();
      console.warn(
        `[HttpMarketProvider] 行情轮询降级: ${result.errors.join("；")}；` +
        `保留最近成功快照，${Math.round(retryMs / 1000)} 秒后重试`,
      );
    }
    if (!this.running || result.quotes.length === 0) return;
    this.lastFetchSuccessMs = Date.now();
    const now = new Date().toISOString();
    for (const quote of result.quotes) {
      this.quotes.set(quote.symbol, { ...quote, updatedAt: quote.updatedAt || now });
    }
    this.sequence += 1;
    this.emitSnapshot();
  }

  private async fetchQuotes(): Promise<QuoteBatchResult> {
    const [stockResult, indexResult] = await Promise.all([
      this.fetchQuoteEndpoint("/api/market/quotes", "个股行情", this.cfg.symbols),
      this.fetchQuoteEndpoint("/api/market/indices", "指数行情", this.cfg.indexSymbols),
    ]);
    const results = [stockResult, indexResult];
    const attempted = results.filter((result) => result.attempted);
    return {
      errors: attempted.flatMap((result) => result.error ? [result.error] : []),
      quotes: results.flatMap((result) => result.quotes),
      success: attempted.length === 0 || attempted.some((result) => result.success),
    };
  }

  private async fetchQuoteEndpoint(
    endpoint: string,
    label: string,
    symbols: string[],
  ): Promise<QuoteFetchResult> {
    if (symbols.length === 0) {
      return { attempted: false, error: null, quotes: [], success: true };
    }

    const symbolQuery = symbols.join(",");
    const url = `${this.cfg.baseUrl}${endpoint}?symbols=${encodeURIComponent(symbolQuery)}`;

    const headers: Record<string, string> = {
      "Accept": "application/json",
      ...this.cfg.headers,
    };

    if (this.cfg.apiKey) {
      headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.cfg.timeout);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        return {
          attempted: true,
          error: `${label}返回 HTTP ${response.status}`,
          quotes: [],
          success: false,
        };
      }
      const data = (await response.json()) as QuoteApiResponse;
      if (!data.quotes || !Array.isArray(data.quotes)) {
        return {
          attempted: true,
          error: `${label}响应格式错误`,
          quotes: [],
          success: false,
        };
      }
      return {
        attempted: true,
        error: null,
        quotes: data.quotes.map((q) => ({
          symbol: q.symbol,
          name: q.name ?? q.symbol,
          tradable: q.tradable ?? true,
          price: Number(q.price),
          previousClose: Number(q.previousClose),
          changePercent: Number(q.changePercent),
          volume: Number(q.volume),
          updatedAt: q.updatedAt ?? new Date().toISOString(),
          open: q.open != null ? Number(q.open) : undefined,
          high: q.high != null ? Number(q.high) : undefined,
          low: q.low != null ? Number(q.low) : undefined,
          amount: q.amount != null ? Number(q.amount) : undefined,
          turnover: q.turnover != null ? Number(q.turnover) : undefined,
          amplitude: q.amplitude != null ? Number(q.amplitude) : undefined,
        })),
        success: true,
      };
    } catch (err: unknown) {
      return {
        attempted: true,
        error: connectionFailureMessage(label, err),
        quotes: [],
        success: false,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async runPollingCycle(): Promise<void> {
    if (!this.running) return;
    try {
      await this.fetchAndEmit();
    } catch {
      this.consecutiveFailures += 1;
      console.warn("[HttpMarketProvider] 行情轮询异常；保留最近成功快照");
    }
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runPollingCycle();
    }, this.nextPollDelayMs());
    this.timer.unref();
  }

  private nextPollDelayMs(): number {
    if (this.consecutiveFailures === 0) return this.cfg.tickMs;
    const exponent = Math.min(this.consecutiveFailures, 10);
    return Math.min(MAX_POLL_BACKOFF_MS, this.cfg.tickMs * 2 ** exponent);
  }

  private emitSnapshot(): MarketSnapshot {
    const snapshot = this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }
}
