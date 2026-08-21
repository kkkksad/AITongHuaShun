import { EventEmitter } from "node:events";
import type { MarketQuote, MarketSnapshot, TradingMode } from "../../shared/trading";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";

const initialQuotes = [
  {
    symbol: "000001",
    name: "上证指数",
    tradable: false,
    price: 3521.84,
    previousClose: 3498.06,
  },
  {
    symbol: "399001",
    name: "深证成指",
    tradable: false,
    price: 10794.32,
    previousClose: 10674.77,
  },
  {
    symbol: "399006",
    name: "创业板指",
    tradable: false,
    price: 2238.61,
    previousClose: 2206.4,
  },
  {
    symbol: "000300",
    name: "沪深 300",
    tradable: false,
    price: 4146.28,
    previousClose: 4115.82,
  },
  {
    symbol: "600519",
    name: "贵州茅台",
    tradable: true,
    price: 1492.6,
    previousClose: 1486.8,
  },
  {
    symbol: "300750",
    name: "宁德时代",
    tradable: true,
    price: 253.4,
    previousClose: 249.7,
  },
  {
    symbol: "688981",
    name: "中芯国际",
    tradable: true,
    price: 93.2,
    previousClose: 90.65,
  },
  {
    symbol: "601318",
    name: "中国平安",
    tradable: true,
    price: 52.1,
    previousClose: 51.72,
  },
] as const;

export class MockMarket extends EventEmitter implements MarketDataProvider {
  private readonly mode: TradingMode;
  private readonly tickMs: number;
  private readonly now: () => Date;
  private readonly quotes = new Map<string, MarketQuote>();
  private sequence = 0;
  private randomState = 0x9e3779b9;
  private timer?: NodeJS.Timeout;

  constructor(mode: TradingMode, tickMs: number, now: () => Date = () => new Date()) {
    super();
    this.mode = mode;
    this.tickMs = tickMs;
    this.now = now;

    const timestamp = this.now().toISOString();
    for (const quote of initialQuotes) {
      this.quotes.set(quote.symbol, {
        ...quote,
        changePercent: ((quote.price - quote.previousClose) / quote.previousClose) * 100,
        volume: 10_000_000 + this.sequence * 100_000,
        updatedAt: timestamp,
      });
      this.sequence += 1;
    }
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.emitSnapshot();
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  getQuote(symbol: string): MarketQuote | undefined {
    const quote = this.quotes.get(symbol);
    return quote ? { ...quote } : undefined;
  }

  getSnapshot(): MarketSnapshot {
    return {
      mode: this.mode,
      sequence: this.sequence,
      marketTime: this.now().toISOString(),
      quotes: [...this.quotes.values()].map((quote) => ({ ...quote })),
    };
  }

  tick(): MarketSnapshot {
    const timestamp = this.now().toISOString();

    for (const [symbol, quote] of this.quotes) {
      const volatility = symbol.startsWith("3") || symbol.startsWith("6") ? 0.0015 : 0.00055;
      const drift = symbol === "688981" ? 0.00018 : 0.00004;
      const change = (this.nextRandom() - 0.48) * volatility + drift;
      const nextPrice = Math.max(0.01, quote.price * (1 + change));

      this.quotes.set(symbol, {
        ...quote,
        price: Number(nextPrice.toFixed(2)),
        changePercent: Number(
          (((nextPrice - quote.previousClose) / quote.previousClose) * 100).toFixed(3),
        ),
        volume: quote.volume + Math.round(20_000 + this.nextRandom() * 80_000),
        updatedAt: timestamp,
      });
    }

    this.sequence += 1;
    return this.emitSnapshot();
  }

  private emitSnapshot(): MarketSnapshot {
    const snapshot = this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  private nextRandom(): number {
    let value = (this.randomState += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    this.randomState = value ^ (value >>> 14);
    return (this.randomState >>> 0) / 4294967296;
  }
}
