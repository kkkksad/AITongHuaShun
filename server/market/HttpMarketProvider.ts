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

export class HttpMarketProvider
  extends EventEmitter
  implements MarketDataProvider
{
  private readonly cfg: HttpMarketConfig & { timeout: number; headers: Record<string, string> };
  private readonly quotes = new Map<string, MarketQuote>();
  private sequence = 0;
  private timer?: NodeJS.Timeout;
  private running = false;
  /** 最近一次 fetch 成功的时间戳（毫秒），用于新鲜度评估 */
  private lastFetchSuccessMs = 0;

  constructor(config: HttpMarketConfig) {
    super();
    this.cfg = {
      ...config,
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
  }

  start(): void {
    if (this.timer) return;
    this.running = true;
    this.fetchAndEmit().catch((err) => {
      console.error("[HttpMarketProvider] initial fetch failed:", err);
    });
    this.timer = setInterval(() => {
      if (this.running) {
        this.fetchAndEmit().catch((err) => {
          console.error("[HttpMarketProvider] poll failed:", err);
        });
      }
    }, this.cfg.tickMs);
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
    const quotes = await this.fetchQuotes();
    if (quotes.length === 0) return;
    this.lastFetchSuccessMs = Date.now();
    const now = new Date().toISOString();
    for (const quote of quotes) {
      this.quotes.set(quote.symbol, { ...quote, updatedAt: quote.updatedAt || now });
    }
    this.sequence += 1;
    this.emitSnapshot();
  }

  private async fetchQuotes(): Promise<MarketQuote[]> {
    const symbols = this.cfg.symbols.join(",");
    const url = `${this.cfg.baseUrl}/api/market/quotes?symbols=${encodeURIComponent(symbols)}`;

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
        console.error(`[HttpMarketProvider] API error: ${response.status}`);
        return [];
      }
      const data = (await response.json()) as QuoteApiResponse;
      if (!data.quotes || !Array.isArray(data.quotes)) {
        console.error("[HttpMarketProvider] unexpected response format");
        return [];
      }
      return data.quotes.map((q) => ({
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
      }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.error("[HttpMarketProvider] request timeout");
      } else if (err instanceof Error) {
        console.error(`[HttpMarketProvider] request failed: ${err.message}`);
      }
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private emitSnapshot(): MarketSnapshot {
    const snapshot = this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }
}
