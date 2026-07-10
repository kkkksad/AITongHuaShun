import { describe, it, expect } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import type {
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../shared/backtest";
import { BacktestEngine } from "./backtestEngine";
import { HistoricalDataProvider } from "./HistoricalDataProvider";

// ── 辅助：生成历史快照 ──

function createSeededRandom(seed = 0x243f6a88): () => number {
  let state = seed;
  return () => {
    let value = (state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    state = value ^ (value >>> 14);
    return (state >>> 0) / 4294967296;
  };
}

function generateSnapshots(count: number, seedPrice = 100): MarketSnapshot[] {
  const snapshots: MarketSnapshot[] = [];
  let price = seedPrice;
  const random = createSeededRandom();

  for (let i = 0; i < count; i++) {
    price = price * (1 + (random() - 0.48) * 0.02);
    price = Math.max(1, price);

    snapshots.push({
      mode: "paper",
      sequence: i + 1,
      marketTime: new Date(2024, 0, i + 1).toISOString(),
      quotes: [
        {
          symbol: "600519",
          name: "贵州茅台",
          tradable: true,
          price: Number(price.toFixed(2)),
          previousClose: Number((price * 0.99).toFixed(2)),
          changePercent: 1.0,
          volume: 10_000_000,
          updatedAt: new Date(2024, 0, i + 1).toISOString(),
        },
        {
          symbol: "000001",
          name: "上证指数",
          tradable: false,
          price: 3500 + i * 0.5,
          previousClose: 3499 + i * 0.5,
          changePercent: 0.03,
          volume: 100_000_000,
          updatedAt: new Date(2024, 0, i + 1).toISOString(),
        },
      ],
    });
  }

  return snapshots;
}

// ── 测试策略 ──

class BuyAndHoldStrategy implements BacktestStrategy {
  readonly name = "买入持有";
  private entered = false;

  onBar(context: StrategyContext): StrategySignal[] {
    if (!this.entered && context.barIndex === 0) {
      this.entered = true;
      return [{ symbol: "600519", side: "buy", type: "market", targetWeight: 0.95 }];
    }
    return [];
  }

  reset(): void {
    this.entered = false;
  }
}

class MACrossStrategy implements BacktestStrategy {
  readonly name = "均线交叉";
  private prices: number[] = [];
  private inPosition = false;

  onBar(context: StrategyContext): StrategySignal[] {
    const quote = context.snapshot.quotes.find((q) => q.symbol === "600519");
    if (!quote) return [];
    this.prices.push(quote.price);
    if (this.prices.length < 20) return [];

    const ma5 = this.sma(5);
    const ma20 = this.sma(20);
    const prevMa5 = this.smaPrev(5);
    const prevMa20 = this.smaPrev(20);

    if (!this.inPosition && prevMa5 <= prevMa20 && ma5 > ma20) {
      this.inPosition = true;
      return [{ symbol: "600519", side: "buy", type: "market", targetWeight: 0.5 }];
    }
    if (this.inPosition && prevMa5 >= prevMa20 && ma5 < ma20) {
      this.inPosition = false;
      return [{ symbol: "600519", side: "sell", type: "market", targetWeight: 1.0 }];
    }
    return [];
  }

  reset(): void {
    this.prices.length = 0;
    this.inPosition = false;
  }

  private sma(period: number): number {
    const slice = this.prices.slice(-period);
    return slice.reduce((s, p) => s + p, 0) / period;
  }
  private smaPrev(period: number): number {
    const slice = this.prices.slice(-period - 1, -1);
    return slice.reduce((s, p) => s + p, 0) / period;
  }
}

class NoOpStrategy implements BacktestStrategy {
  readonly name = "空策略";
  onBar(_context: StrategyContext): StrategySignal[] { return []; }
}

// ═══════════════════════════════════════════════

describe("HistoricalDataProvider", () => {
  it("正确初始化并返回首根 bar", () => {
    const snapshots = generateSnapshots(10, 100);
    const provider = new HistoricalDataProvider(snapshots);
    expect(provider.length).toBe(10);
    expect(provider.index).toBe(0);
    expect(provider.isComplete).toBe(false);
    expect(provider.getSnapshot().sequence).toBe(1);
  });

  it("tick 推进到下一根 bar", () => {
    const snapshots = generateSnapshots(5);
    const provider = new HistoricalDataProvider(snapshots);
    expect(provider.index).toBe(0);
    provider.tick();
    expect(provider.index).toBe(1);
    expect(provider.getSnapshot().sequence).toBe(2);
  });

  it("getQuote 返回当前 bar 的报价", () => {
    const snapshots = generateSnapshots(5, 150);
    const provider = new HistoricalDataProvider(snapshots);
    const quote = provider.getQuote("600519");
    expect(quote).toBeDefined();
    expect(quote!.symbol).toBe("600519");
    expect(quote!.price).toBeGreaterThan(0);
  });

  it("getQuote 对不存在的标的返回 undefined", () => {
    const snapshots = generateSnapshots(5);
    const provider = new HistoricalDataProvider(snapshots);
    expect(provider.getQuote("999999")).toBeUndefined();
  });

  it("isComplete 在最后 bar 后为 true", () => {
    const snapshots = generateSnapshots(3);
    const provider = new HistoricalDataProvider(snapshots);
    expect(provider.isComplete).toBe(false);
    provider.tick();
    expect(provider.isComplete).toBe(false);
    provider.tick();
    expect(provider.isComplete).toBe(true);
  });

  it("seek 跳转到指定 bar", () => {
    const snapshots = generateSnapshots(10);
    const provider = new HistoricalDataProvider(snapshots);
    provider.seek(5);
    expect(provider.index).toBe(5);
    expect(provider.getSnapshot().sequence).toBe(6);
  });

  it("seek 越界抛出异常", () => {
    const snapshots = generateSnapshots(5);
    const provider = new HistoricalDataProvider(snapshots);
    expect(() => provider.seek(-1)).toThrow();
    expect(() => provider.seek(10)).toThrow();
  });

  it("reset 回到第一根 bar", () => {
    const snapshots = generateSnapshots(5);
    const provider = new HistoricalDataProvider(snapshots);
    provider.tick(); provider.tick();
    expect(provider.index).toBe(2);
    provider.reset();
    expect(provider.index).toBe(0);
  });

  it("空数组构造抛出异常", () => {
    expect(() => new HistoricalDataProvider([])).toThrow();
  });
});

describe("BacktestEngine", () => {
  it("买入持有策略：最终权益应反映价格上涨", () => {
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    for (let i = 0; i < 50; i++) {
      price = price * 1.001;
      snapshots.push({
        mode: "paper", sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [{
          symbol: "600519", name: "贵州茅台", tradable: true,
          price: Number(price.toFixed(2)),
          previousClose: Number((price * 0.999).toFixed(2)),
          changePercent: 0.1, volume: 10_000_000,
          updatedAt: new Date(2024, 0, i + 1).toISOString(),
        }],
      });
    }
    const engine = new BacktestEngine(snapshots, new BuyAndHoldStrategy(), {
      initialCapital: 1_000_000, commissionRate: 0.0003, minimumCommission: 5,
      slippageBps: 0, maxOrderNotional: 2_000_000, maxPositionWeight: 1.0,
    });
    const report = engine.run();
    expect(report.strategyName).toBe("买入持有");
    expect(report.metrics.totalTrades).toBeGreaterThan(0);
    expect(report.metrics.initialCapital).toBe(1_000_000);
    expect(report.metrics.finalEquity).toBeGreaterThan(1_000_000);
    expect(report.equityCurve.length).toBe(51);
    expect(report.equityCurve[0].equity).toBe(1_000_000);
    expect(report.equityCurve[0].cumulativeReturn).toBe(0);
    expect(report.metrics.sharpeRatio).not.toBeNaN();
    expect(report.metrics.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    expect(report.metrics.winRate).toBeGreaterThanOrEqual(0);
  });

  it("空策略：权益不变（扣除佣金后略有变动）", () => {
    const snapshots = generateSnapshots(30, 100);
    const engine = new BacktestEngine(snapshots, new NoOpStrategy(), {
      initialCapital: 1_000_000, slippageBps: 0,
    });
    const report = engine.run();
    expect(report.metrics.totalTrades).toBe(0);
    expect(report.metrics.finalEquity).toBe(1_000_000);
    expect(report.metrics.totalReturn).toBe(0);
  });

  it("均线交叉策略：合理运行并产生交易", () => {
    const snapshots = generateSnapshots(200, 100);
    const engine = new BacktestEngine(snapshots, new MACrossStrategy(), {
      maxOrderNotional: 2_000_000, maxPositionWeight: 1.0,
      initialCapital: 1_000_000, commissionRate: 0.0003, minimumCommission: 5, slippageBps: 5,
    });
    const report = engine.run();
    expect(report.strategyName).toBe("均线交叉");
    expect(report.equityCurve.length).toBe(201);
    expect(report.trades.length).toBeGreaterThan(0);
    const m = report.metrics;
    expect(m.totalTrades).toBeGreaterThan(0);
    expect(m.winRate).toBeGreaterThanOrEqual(0);
    expect(m.winRate).toBeLessThanOrEqual(1);
    expect(m.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    expect(typeof m.sharpeRatio).toBe("number");
    expect(typeof m.sortinoRatio).toBe("number");
    expect(typeof m.calmarRatio).toBe("number");
    expect(typeof m.profitFactor).toBe("number");
    expect(m.totalCommission).toBeGreaterThan(0);
    expect(report.config.initialCapital).toBe(1_000_000);
  });

  it("少于2根 bar 抛出异常", () => {
    const snapshots = generateSnapshots(1);
    expect(() => new BacktestEngine(snapshots, new NoOpStrategy())).toThrow("至少需要 2 根 bar 数据");
  });

  it("回测报告包含完整的绩效指标", () => {
    const snapshots = generateSnapshots(60, 100);
    const engine = new BacktestEngine(snapshots, new BuyAndHoldStrategy(), { initialCapital: 500_000 });
    const report = engine.run();
    const m = report.metrics;
    const numericKeys: (keyof typeof m)[] = [
      "initialCapital", "finalEquity", "totalReturn", "totalReturnPercent",
      "annualizedReturn", "annualizedVolatility", "sharpeRatio", "sortinoRatio",
      "maxDrawdown", "maxDrawdownPercent", "calmarRatio", "totalTrades",
      "winningTrades", "losingTrades", "winRate", "avgWin", "avgLoss",
      "profitFactor", "totalCommission", "totalSlippage", "barCount",
    ];
    for (const key of numericKeys) {
      expect(typeof m[key], `${key} should be a number`).toBe("number");
      expect(m[key], `${key} should not be NaN`).not.toBeNaN();
    }
  });

  it("权益曲线随 bar 推进记录每个点", () => {
    const snapshots = generateSnapshots(10, 100);
    const engine = new BacktestEngine(snapshots, new NoOpStrategy(), { initialCapital: 100_000 });
    const report = engine.run();
    expect(report.equityCurve.length).toBe(11);
    for (const point of report.equityCurve) {
      expect(point.equity).toBeGreaterThan(0);
      expect(point.cash).toBeGreaterThanOrEqual(0);
      expect(typeof point.time).toBe("string");
      expect(typeof point.index).toBe("number");
    }
  });

  it("onStart / onEnd 回调被正确调用", () => {
    let startCalled = false, endCalled = false, startEquity = 0, endBarIndex = -1;
    const strategy: BacktestStrategy = {
      name: "回调测试",
      onBar: () => [],
      onStart(ctx) { startCalled = true; startEquity = ctx.equity; },
      onEnd(ctx) { endCalled = true; endBarIndex = ctx.barIndex; },
    };
    const snapshots = generateSnapshots(20, 100);
    const engine = new BacktestEngine(snapshots, strategy, { initialCapital: 200_000 });
    engine.run();
    expect(startCalled).toBe(true);
    expect(endCalled).toBe(true);
    expect(startEquity).toBe(200_000);
    expect(endBarIndex).toBe(19);
  });

  it("限价单在回测中正确挂单和成交", () => {
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    for (let i = 0; i < 30; i++) {
      price = price * (1 - 0.005);
      snapshots.push({
        mode: "paper", sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [{
          symbol: "600519", name: "贵州茅台", tradable: true,
          price: Number(price.toFixed(2)),
          previousClose: Number((price * 1.002).toFixed(2)),
          changePercent: -0.2, volume: 10_000_000,
          updatedAt: new Date(2024, 0, i + 1).toISOString(),
        }],
      });
    }
    let limitPlaced = false;
    const strategy: BacktestStrategy = {
      name: "限价单测试",
      onBar(ctx) {
        if (!limitPlaced && ctx.barIndex === 5) {
          limitPlaced = true;
          const quote = ctx.snapshot.quotes[0];
          return [{
            symbol: "600519", side: "buy", type: "limit",
            quantity: 100,
            limitPrice: Number((quote.price * 0.9).toFixed(2)),
          }];
        }
        return [];
      },
    };
    const engine = new BacktestEngine(snapshots, strategy, {
      initialCapital: 1_000_000, slippageBps: 0,
    });
    const report = engine.run();
    const limitOrders = report.orders.filter((o) => o.type === "limit");
    expect(limitOrders.length).toBeGreaterThan(0);
    const filledLimit = limitOrders.filter((o) => o.status === "filled");
    expect(filledLimit.length).toBeGreaterThan(0);
  });

  // ── 新增边界case ──

  it("handles strategy that throws from onBar gracefully", () => {
    const snapshots = generateSnapshots(30, 100);
    const strategy: BacktestStrategy = {
      name: "崩溃策略",
      onBar(ctx) {
        if (ctx.barIndex === 10) throw new Error("策略执行异常");
        return [];
      },
    };
    const engine = new BacktestEngine(snapshots, strategy, { initialCapital: 1_000_000 });
    expect(() => engine.run()).not.toThrow();
    const report = engine.run();
    expect(report.strategyName).toBe("崩溃策略");
    expect(report.equityCurve.length).toBe(31);
  });

  it("handles multiple symbols in backtest", () => {
    const snapshots: MarketSnapshot[] = [];
    let price1 = 100, price2 = 50;
    for (let i = 0; i < 50; i++) {
      price1 *= 1.002; price2 *= 0.999;
      snapshots.push({
        mode: "paper", sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [
          { symbol: "600519", name: "贵州茅台", tradable: true, price: Number(price1.toFixed(2)),
            previousClose: Number((price1 * 0.999).toFixed(2)), changePercent: 0.1, volume: 10_000_000,
            updatedAt: new Date(2024, 0, i + 1).toISOString() },
          { symbol: "300750", name: "宁德时代", tradable: true, price: Number(price2.toFixed(2)),
            previousClose: Number((price2 * 1.001).toFixed(2)), changePercent: -0.1, volume: 5_000_000,
            updatedAt: new Date(2024, 0, i + 1).toISOString() },
        ],
      });
    }
    const strategy: BacktestStrategy = {
      name: "多标的策略",
      onBar(ctx) {
        if (ctx.barIndex === 0) {
          return [
            { symbol: "600519", side: "buy", type: "market", targetWeight: 0.4 },
            { symbol: "300750", side: "buy", type: "market", targetWeight: 0.3 },
          ];
        }
        return [];
      },
    };
    const engine = new BacktestEngine(snapshots, strategy, {
      initialCapital: 1_000_000, maxOrderNotional: 2_000_000, maxPositionWeight: 1.0, slippageBps: 0,
    });
    const report = engine.run();
    expect(report.trades.length).toBeGreaterThanOrEqual(2);
    const symbols = new Set(report.trades.map((t) => t.symbol));
    expect(symbols.has("600519")).toBe(true);
    expect(symbols.has("300750")).toBe(true);
  });

  it("handles very small initial capital", () => {
    const snapshots = generateSnapshots(20, 10);
    const engine = new BacktestEngine(snapshots, new BuyAndHoldStrategy(), {
      initialCapital: 1000, maxOrderNotional: 2000, maxPositionWeight: 1.0,
      slippageBps: 0, commissionRate: 0, minimumCommission: 0,
    });
    const report = engine.run();
    expect(report.metrics.initialCapital).toBe(1000);
    expect(report.metrics.finalEquity).toBeGreaterThan(0);
    expect(typeof report.metrics.sharpeRatio).toBe("number");
  });

  it("handles zero slippage and zero commission", () => {
    let price = 100;
    const risingSnapshots: MarketSnapshot[] = [];
    for (let i = 0; i < 20; i++) {
      price *= 1.01;
      risingSnapshots.push({
        mode: "paper", sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [{ symbol: "600519", name: "MaoTai", tradable: true,
          price: Number(price.toFixed(2)), previousClose: Number((price * 0.99).toFixed(2)),
          changePercent: 1.0, volume: 10_000_000,
          updatedAt: new Date(2024, 0, i + 1).toISOString() }],
      });
    }
    const engine = new BacktestEngine(risingSnapshots, new BuyAndHoldStrategy(), {
      initialCapital: 1_000_000, commissionRate: 0, minimumCommission: 0,
      slippageBps: 0, maxOrderNotional: 2_000_000, maxPositionWeight: 1.0,
    });
    const report = engine.run();
    expect(report.metrics.totalCommission).toBe(0);
    expect(report.metrics.totalSlippage).toBe(0);
  });

  it("rerun produces consistent results (idempotent)", () => {
    const snapshots = generateSnapshots(50, 100);
    const engine = new BacktestEngine(snapshots, new MACrossStrategy(), {
      initialCapital: 1_000_000, maxOrderNotional: 2_000_000, maxPositionWeight: 1.0,
    });
    const report1 = engine.run();
    const report2 = engine.run();
    expect(report1.metrics.finalEquity).toBe(report2.metrics.finalEquity);
    expect(report1.metrics.totalTrades).toBe(report2.metrics.totalTrades);
    expect(report1.equityCurve.length).toBe(report2.equityCurve.length);
  });
});
