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
    // 简单随机游走
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

/** 买入持有策略：第一根 bar 全仓买入，之后不动 */
class BuyAndHoldStrategy implements BacktestStrategy {
  readonly name = "买入持有";
  private entered = false;

  onBar(context: StrategyContext): StrategySignal[] {
    if (!this.entered && context.barIndex === 0) {
      this.entered = true;
      return [
        {
          symbol: "600519",
          side: "buy",
          type: "market",
          targetWeight: 0.95, // 95%仓位
        },
      ];
    }
    return [];
  }
}

/** 均线交叉策略：5日均线上穿20日均线买入，下穿卖出 */
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

    // 金叉买入
    if (!this.inPosition && prevMa5 <= prevMa20 && ma5 > ma20) {
      this.inPosition = true;
      return [
        {
          symbol: "600519",
          side: "buy",
          type: "market",
          targetWeight: 0.5,
        },
      ];
    }

    // 死叉卖出
    if (this.inPosition && prevMa5 >= prevMa20 && ma5 < ma20) {
      this.inPosition = false;
      return [
        {
          symbol: "600519",
          side: "sell",
          type: "market",
          targetWeight: 1.0, // 全部卖出
        },
      ];
    }

    return [];
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

/** 空策略：永远不交易 */
class NoOpStrategy implements BacktestStrategy {
  readonly name = "空策略";
  onBar(_context: StrategyContext): StrategySignal[] {
    return [];
  }
}

// ═══════════════════════════════════════════════
// 测试
// ═══════════════════════════════════════════════

describe("HistoricalDataProvider", () => {
  it("正确初始化并返回首根 bar", () => {
    const snapshots = generateSnapshots(10, 100);
    const provider = new HistoricalDataProvider(snapshots);

    expect(provider.length).toBe(10);
    expect(provider.index).toBe(0);
    expect(provider.isComplete).toBe(false);

    const snapshot = provider.getSnapshot();
    expect(snapshot.sequence).toBe(1);
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
    provider.tick(); // index 1
    expect(provider.isComplete).toBe(false);
    provider.tick(); // index 2 (last)
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

    provider.tick();
    provider.tick();
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
    // 生成持续上涨的数据
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    for (let i = 0; i < 50; i++) {
      price = price * 1.001; // 每天涨 0.1%
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
            previousClose: Number((price * 0.999).toFixed(2)),
            changePercent: 0.1,
            volume: 10_000_000,
            updatedAt: new Date(2024, 0, i + 1).toISOString(),
          },
        ],
      });
    }

    const engine = new BacktestEngine(snapshots, new BuyAndHoldStrategy(), {
      initialCapital: 1_000_000,
      commissionRate: 0.0003,
      minimumCommission: 5,
      slippageBps: 0, maxOrderNotional: 2_000_000, maxPositionWeight: 1.0, // 无滑点简化测试
    });

    const report = engine.run();

    // 基本断言
    expect(report.strategyName).toBe("买入持有");
    expect(report.metrics.totalTrades).toBeGreaterThan(0);
    expect(report.metrics.initialCapital).toBe(1_000_000);
    expect(report.metrics.finalEquity).toBeGreaterThan(1_000_000); // 上涨中应该盈利

    // 权益曲线
    expect(report.equityCurve.length).toBe(51); // 初始 + 50 bar
    expect(report.equityCurve[0].equity).toBe(1_000_000);
    expect(report.equityCurve[0].cumulativeReturn).toBe(0);

    // 指标应为数值
    expect(report.metrics.sharpeRatio).not.toBeNaN();
    expect(report.metrics.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    expect(report.metrics.winRate).toBeGreaterThanOrEqual(0);
  });

  it("空策略：权益不变（扣除佣金后略有变动）", () => {
    const snapshots = generateSnapshots(30, 100);
    const engine = new BacktestEngine(snapshots, new NoOpStrategy(), {
      initialCapital: 1_000_000,
      slippageBps: 0,
    });

    const report = engine.run();

    expect(report.metrics.totalTrades).toBe(0);
    // 无交易时权益应等于初始资金
    expect(report.metrics.finalEquity).toBe(1_000_000);
    expect(report.metrics.totalReturn).toBe(0);
  });

  it("均线交叉策略：合理运行并产生交易", () => {
    const snapshots = generateSnapshots(200, 100);
    const engine = new BacktestEngine(snapshots, new MACrossStrategy(), { maxOrderNotional: 2_000_000, maxPositionWeight: 1.0,
      initialCapital: 1_000_000,
      commissionRate: 0.0003,
      minimumCommission: 5,
      slippageBps: 5,
    });

    const report = engine.run();

    // 基本结构验证
    expect(report.strategyName).toBe("均线交叉");
    expect(report.equityCurve.length).toBe(201);

    // 应该有一些交易（在200根bar中均线交叉应该会产生交易）
    expect(report.trades.length).toBeGreaterThan(0);

    // 指标完整性
    const m = report.metrics;
    expect(m.totalTrades).toBeGreaterThan(0);
    expect(m.winRate).toBeGreaterThanOrEqual(0);
    expect(m.winRate).toBeLessThanOrEqual(1);
    expect(m.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    expect(typeof m.sharpeRatio).toBe("number");
    expect(typeof m.sortinoRatio).toBe("number");
    expect(typeof m.calmarRatio).toBe("number");
    expect(typeof m.profitFactor).toBe("number");

    // 佣金 > 0（有交易）
    expect(m.totalCommission).toBeGreaterThan(0);

    // 配置回传
    expect(report.config.initialCapital).toBe(1_000_000);
  });

  it("少于2根 bar 抛出异常", () => {
    const snapshots = generateSnapshots(1);
    expect(
      () => new BacktestEngine(snapshots, new NoOpStrategy()),
    ).toThrow("至少需要 2 根 bar 数据");
  });

  it("回测报告包含完整的绩效指标", () => {
    const snapshots = generateSnapshots(60, 100);
    const engine = new BacktestEngine(snapshots, new BuyAndHoldStrategy(), {
      initialCapital: 500_000,
    });

    const report = engine.run();
    const m = report.metrics;

    // 所有指标应该存在且为数值
    const numericKeys: (keyof typeof m)[] = [
      "initialCapital",
      "finalEquity",
      "totalReturn",
      "totalReturnPercent",
      "annualizedReturn",
      "annualizedVolatility",
      "sharpeRatio",
      "sortinoRatio",
      "maxDrawdown",
      "maxDrawdownPercent",
      "calmarRatio",
      "totalTrades",
      "winningTrades",
      "losingTrades",
      "winRate",
      "avgWin",
      "avgLoss",
      "profitFactor",
      "totalCommission",
      "totalSlippage",
      "barCount",
    ];

    for (const key of numericKeys) {
      expect(
        typeof m[key],
        `${key} should be a number`,
      ).toBe("number");
      expect(m[key], `${key} should not be NaN`).not.toBeNaN();
    }
  });

  it("权益曲线随 bar 推进记录每个点", () => {
    const snapshots = generateSnapshots(10, 100);
    const engine = new BacktestEngine(snapshots, new NoOpStrategy(), {
      initialCapital: 100_000,
    });

    const report = engine.run();

    expect(report.equityCurve.length).toBe(11); // 初始点 + 10 bar
    for (const point of report.equityCurve) {
      expect(point.equity).toBeGreaterThan(0);
      expect(point.cash).toBeGreaterThanOrEqual(0);
      expect(typeof point.time).toBe("string");
      expect(typeof point.index).toBe("number");
    }
  });

  it("onStart / onEnd 回调被正确调用", () => {
    let startCalled = false;
    let endCalled = false;
    let startEquity = 0;
    let endBarIndex = -1;

    const strategy: BacktestStrategy = {
      name: "回调测试",
      onBar: () => [],
      onStart(ctx) {
        startCalled = true;
        startEquity = ctx.equity;
      },
      onEnd(ctx) {
        endCalled = true;
        endBarIndex = ctx.barIndex;
      },
    };

    const snapshots = generateSnapshots(20, 100);
    const engine = new BacktestEngine(snapshots, strategy, {
      initialCapital: 200_000,
    });

    engine.run();

    expect(startCalled).toBe(true);
    expect(endCalled).toBe(true);
    expect(startEquity).toBe(200_000);
    expect(endBarIndex).toBe(19); // 最后一根 bar 索引
  });

  it("限价单在回测中正确挂单和成交", () => {
    // 创建一个下降趋势的数据，限价买单应该能成交
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    for (let i = 0; i < 30; i++) {
      price = price * (1 - 0.005); // 每天跌 0.2%
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
            previousClose: Number((price * 1.002).toFixed(2)),
            changePercent: -0.2,
            volume: 10_000_000,
            updatedAt: new Date(2024, 0, i + 1).toISOString(),
          },
        ],
      });
    }

    // 策略：在 bar 5 挂一个限价买单（价格比当前低很多，等下跌后成交）
    let limitPlaced = false;
    const strategy: BacktestStrategy = {
      name: "限价单测试",
      onBar(ctx) {
        if (!limitPlaced && ctx.barIndex === 5) {
          limitPlaced = true;
          const quote = ctx.snapshot.quotes[0];
          return [
            {
              symbol: "600519",
              side: "buy",
              type: "limit",
              quantity: 100,
              limitPrice: Number((quote.price * 0.9).toFixed(2)), // 比当前价低10%
            },
          ];
        }
        return [];
      },
    };

    const engine = new BacktestEngine(snapshots, strategy, {
      initialCapital: 1_000_000,
      slippageBps: 0,
    });

    const report = engine.run();

    // 限价单应该最终成交（价格持续下跌）
    const limitOrders = report.orders.filter((o) => o.type === "limit");
    expect(limitOrders.length).toBeGreaterThan(0);

    // 检查是否有成交的限价单
    const filledLimit = limitOrders.filter((o) => o.status === "filled");
    expect(filledLimit.length).toBeGreaterThan(0);
  });
});
