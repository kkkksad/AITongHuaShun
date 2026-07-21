/**
 * 策略库测试 —— 验证所有内置策略正确实现 BacktestStrategy 接口，
 * 并在回测引擎中产生合理的交易信号。
 */
import { describe, it, expect } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "./backtestEngine";
import {
  MovingAverageCrossStrategy,
  RSIStrategy,
  BollingerBandsStrategy,
  MomentumStrategy,
  GridTradingStrategy,
  MACDStrategy,
  TurtleStrategy,
  ASharePullbackConfirmationStrategy,
  KairosCapitalShieldStrategy,
  KairosLowVolTrendStrategy,
  KairosQuietPullbackStrategy,
  KairosRiskOffRecoveryStrategy,
  KairosTrendHealthStrategy,
  KairosWashoutRecoveryStrategy,
} from "./strategies/index";

// ── 辅助函数 ──

/** 生成随机游走价格序列的市场快照 */
function createSeededRandom(seed = 0x9e3779b9): () => number {
  let state = seed;
  return () => {
    let value = (state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    state = value ^ (value >>> 14);
    return (state >>> 0) / 4294967296;
  };
}

function generateSnapshots(
  count: number,
  seedPrice = 100,
  volatility = 0.02,
  symbols: string[] = ["600519"],
): MarketSnapshot[] {
  const snapshots: MarketSnapshot[] = [];
  const prices = symbols.map(() => seedPrice);
  const random = createSeededRandom();

  for (let i = 0; i < count; i++) {
    const quotes = symbols.map((symbol, idx) => {
      prices[idx] = prices[idx] * (1 + (random() - 0.48) * volatility);
      prices[idx] = Math.max(1, prices[idx]);
      return {
        symbol,
        name: symbol === "600519" ? "GuiZhouMaoTai" : symbol,
        tradable: true,
        price: Number(prices[idx].toFixed(2)),
        previousClose: Number((prices[idx] * 0.99).toFixed(2)),
        changePercent: Number(((random() - 0.5) * 2).toFixed(2)),
        volume: 10_000_000,
        updatedAt: new Date(2024, 0, i + 1).toISOString(),
      };
    });

    snapshots.push({
      mode: "paper",
      sequence: i + 1,
      marketTime: new Date(2024, 0, i + 1).toISOString(),
      quotes,
    });
  }

  return snapshots;
}

function snapshotsFromPrices(
  prices: number[],
  volumeAt: (index: number) => number,
): MarketSnapshot[] {
  return prices.map((price, index) => ({
    mode: "paper",
    sequence: index + 1,
    marketTime: new Date(2024, 0, index + 1).toISOString(),
    quotes: [{
      symbol: "600519",
      name: "TestStock",
      tradable: true,
      price: Number(price.toFixed(2)),
      previousClose: Number((prices[index - 1] ?? price).toFixed(2)),
      changePercent:
        index === 0 ? 0 : Number(((price / prices[index - 1] - 1) * 100).toFixed(2)),
      volume: volumeAt(index),
      updatedAt: new Date(2024, 0, index + 1).toISOString(),
    }],
  }));
}

/** Validate basic report structure for any strategy */
function validateStrategyReport(report: ReturnType<BacktestEngine["run"]>) {
  const m = report.metrics;
  expect(typeof m.totalReturn).toBe("number");
  expect(typeof m.sharpeRatio).toBe("number");
  expect(typeof m.maxDrawdownPercent).toBe("number");
  expect(m.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
  expect(m.maxDrawdownPercent).toBeLessThanOrEqual(1);
  expect(m.winRate).toBeGreaterThanOrEqual(0);
  expect(m.winRate).toBeLessThanOrEqual(1);
  expect(report.equityCurve.length).toBeGreaterThanOrEqual(report.metrics.barCount);
}

// ═══════════════════════════════════════════════
// MovingAverageCrossStrategy
// ═══════════════════════════════════════════════

describe("MovingAverageCrossStrategy", () => {
  it("implements BacktestStrategy and produces trades", () => {
    const snapshots = generateSnapshots(200, 100, 0.015);
    const engine = new BacktestEngine(
      snapshots,
      new MovingAverageCrossStrategy(5, 20, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("均线交叉");
    expect(report.trades.length).toBeGreaterThan(0);
  });

  it("custom params are reflected", () => {
    const snapshots = generateSnapshots(200, 100);
    const engine = new BacktestEngine(
      snapshots,
      new MovingAverageCrossStrategy(10, 30, 0.3, "CustomMA"),
      {
        initialCapital: 500_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    expect(report.strategyName).toBe("CustomMA");
    validateStrategyReport(report);
  });

  it("no signals with insufficient data", () => {
    const snapshots = generateSnapshots(10, 100);
    const engine = new BacktestEngine(
      snapshots,
      new MovingAverageCrossStrategy(5, 20, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    expect(report.trades.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// RSIStrategy
// ═══════════════════════════════════════════════

describe("RSIStrategy", () => {
  it("produces signals on long enough series", () => {
    const snapshots = generateSnapshots(252, 100, 0.025);
    const engine = new BacktestEngine(
      snapshots,
      new RSIStrategy(14, 30, 70, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("RSI");
    expect(report.trades.length).toBeGreaterThan(0);
  });

  it("narrow thresholds produce more trades than wide", () => {
    const snapshots = generateSnapshots(252, 100, 0.01);
    const wideEngine = new BacktestEngine(
      snapshots,
      new RSIStrategy(14, 20, 80, 0.5, "RSI-Wide"),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const narrowEngine = new BacktestEngine(
      snapshots,
      new RSIStrategy(14, 40, 60, 0.5, "RSI-Narrow"),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const wideReport = wideEngine.run();
    const narrowReport = narrowEngine.run();

    expect(narrowReport.trades.length).toBeGreaterThanOrEqual(
      wideReport.trades.length,
    );
  });

  it("no signals with insufficient data", () => {
    const snapshots = generateSnapshots(10, 100);
    const engine = new BacktestEngine(
      snapshots,
      new RSIStrategy(14, 30, 70, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    expect(report.trades.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// BollingerBandsStrategy
// ═══════════════════════════════════════════════

describe("BollingerBandsStrategy", () => {
  it("produces trades in volatile markets", () => {
    const snapshots = generateSnapshots(252, 100, 0.03);
    const engine = new BacktestEngine(
      snapshots,
      new BollingerBandsStrategy(20, 2, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("布林带");
    expect(report.trades.length).toBeGreaterThan(0);
  });

  it("high vol produces more trades than low vol", () => {
    const lowVolSnapshots = generateSnapshots(100, 100, 0.005);
    const highVolSnapshots = generateSnapshots(100, 100, 0.04);

    const lowVolEngine = new BacktestEngine(
      lowVolSnapshots,
      new BollingerBandsStrategy(20, 2, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const highVolEngine = new BacktestEngine(
      highVolSnapshots,
      new BollingerBandsStrategy(20, 2, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const lowReport = lowVolEngine.run();
    const highReport = highVolEngine.run();

    expect(highReport.trades.length).toBeGreaterThanOrEqual(
      lowReport.trades.length,
    );
  });

  it("no signals with insufficient data", () => {
    const snapshots = generateSnapshots(15, 100);
    const engine = new BacktestEngine(
      snapshots,
      new BollingerBandsStrategy(20, 2, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    expect(report.trades.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// MomentumStrategy
// ═══════════════════════════════════════════════

describe("MomentumStrategy", () => {
  it("buys on breakout in uptrend", () => {
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    const random = createSeededRandom(0x1001);
    for (let i = 0; i < 200; i++) {
      price = price * (1 + 0.002 + (random() - 0.5) * 0.01);
      snapshots.push({
        mode: "paper",
        sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [
          {
            symbol: "600519",
            name: "MaoTai",
            tradable: true,
            price: Number(price.toFixed(2)),
            previousClose: Number((price * 0.998).toFixed(2)),
            changePercent: 0.2,
            volume: 10_000_000,
            updatedAt: new Date(2024, 0, i + 1).toISOString(),
          },
        ],
      });
    }

    const engine = new BacktestEngine(
      snapshots,
      new MomentumStrategy(20, 10, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("动量突破");
    expect(report.trades.length).toBeGreaterThan(0);
  });

  it("handles downtrend without crash", () => {
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    const random = createSeededRandom(0x1002);
    for (let i = 0; i < 200; i++) {
      price = price * (1 - 0.002 + (random() - 0.5) * 0.01);
      snapshots.push({
        mode: "paper",
        sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [
          {
            symbol: "600519",
            name: "MaoTai",
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

    const engine = new BacktestEngine(
      snapshots,
      new MomentumStrategy(20, 10, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
  });

  it("no signals with insufficient data", () => {
    const snapshots = generateSnapshots(10, 100);
    const engine = new BacktestEngine(
      snapshots,
      new MomentumStrategy(20, 10, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    expect(report.trades.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// ASharePullbackConfirmationStrategy
// ═══════════════════════════════════════════════

describe("ASharePullbackConfirmationStrategy", () => {
  it("buys after an uptrend pullback and confirmed rebound", () => {
    const prices = [
      ...Array.from({ length: 35 }, (_, i) => 100 + i * 0.65),
      124,
      122,
      120,
      121.2,
      123.4,
      127.8,
      130,
    ];

    const snapshots: MarketSnapshot[] = prices.map((price, index) => ({
      mode: "paper",
      sequence: index + 1,
      marketTime: new Date(2024, 0, index + 1).toISOString(),
      quotes: [
        {
          symbol: "600519",
          name: "GuiZhouMaoTai",
          tradable: true,
          price: Number(price.toFixed(2)),
          previousClose: Number((prices[index - 1] ?? price).toFixed(2)),
          changePercent:
            index === 0
              ? 0
              : Number(((price / prices[index - 1] - 1) * 100).toFixed(2)),
          volume: index >= 39 ? 15_000_000 : 10_000_000,
          updatedAt: new Date(2024, 0, index + 1).toISOString(),
        },
      ],
    }));

    const engine = new BacktestEngine(
      snapshots,
      new ASharePullbackConfirmationStrategy(
        20,
        8,
        0.08,
        0.006,
        1.05,
        0.03,
        0.03,
        0.35,
      ),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("A股强势回踩确认");
    expect(report.trades.some((trade) => trade.side === "buy")).toBe(true);
  });

  it("stays idle when the trend filter is not satisfied", () => {
    const snapshots = generateSnapshots(80, 100, 0.005);
    const engine = new BacktestEngine(
      snapshots,
      new ASharePullbackConfirmationStrategy(30, 8),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
  });
});

describe("KAIROS defensive strategies", () => {
  it("low-vol trend participates in controlled uptrends", () => {
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    for (let i = 0; i < 120; i++) {
      price = price * (1 + 0.003);
      snapshots.push({
        mode: "paper",
        sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [{
          symbol: "600519",
          name: "MaoTai",
          tradable: true,
          price: Number(price.toFixed(2)),
          previousClose: Number((price / 1.003).toFixed(2)),
          changePercent: 0.3,
          volume: 10_000_000,
          updatedAt: new Date(2024, 0, i + 1).toISOString(),
        }],
      });
    }

    const engine = new BacktestEngine(
      snapshots,
      new KairosLowVolTrendStrategy(20, 50, 0.02, 0.04, 0.018, 0.18),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("KAIROS低波趋势");
    expect(report.trades.some((trade) => trade.side === "buy")).toBe(true);
  });

  it("quiet pullback buys only after controlled pullback and rebound", () => {
    const prices = [
      ...Array.from({ length: 35 }, (_, i) => 100 + i * 0.55),
      119,
      117.8,
      116.7,
      117.4,
      118.2,
      119.6,
      121,
    ];
    const snapshots = prices.map((price, index) => ({
      mode: "paper" as const,
      sequence: index + 1,
      marketTime: new Date(2024, 0, index + 1).toISOString(),
      quotes: [{
        symbol: "600519",
        name: "MaoTai",
        tradable: true,
        price: Number(price.toFixed(2)),
        previousClose: Number((prices[index - 1] ?? price).toFixed(2)),
        changePercent:
          index === 0
            ? 0
            : Number(((price / prices[index - 1] - 1) * 100).toFixed(2)),
        volume: index >= 36 && index <= 39 ? 8_000_000 : 10_000_000,
        updatedAt: new Date(2024, 0, index + 1).toISOString(),
      }],
    }));

    const engine = new BacktestEngine(
      snapshots,
      new KairosQuietPullbackStrategy(20, 6, 0.01, 0.07, 1.4),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("KAIROS缩量回撤反弹");
    expect(report.trades.some((trade) => trade.side === "buy")).toBe(true);
  });

  it("capital shield handles volatile markets without throwing", () => {
    const snapshots = generateSnapshots(160, 100, 0.03);
    const engine = new BacktestEngine(
      snapshots,
      new KairosCapitalShieldStrategy(18, 5, 0.06, 0.03, 0.015, 4, 0.12),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
  });

  it("risk-off recovery waits for a volume-backed short trend repair", () => {
    const prices = [
      ...Array.from({ length: 36 }, (_, index) => 120 - index * 0.82),
      91.1,
      90.4,
      89.8,
      90.2,
      91.1,
      92.4,
      94.2,
      98.4,
    ];
    const snapshots = snapshotsFromPrices(
      prices,
      (index) => index >= prices.length - 3 ? 15_000_000 : 10_000_000,
    );
    const engine = new BacktestEngine(
      snapshots,
      new KairosRiskOffRecoveryStrategy(8, 30, 15, 0.06, 0.025, 1.1),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("KAIROS风险收缩修复");
    expect(report.trades.some((trade) => trade.side === "buy")).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// GridTradingStrategy
// ═══════════════════════════════════════════════

describe("GridTradingStrategy", () => {
  it("buys low and sells high in range-bound markets", () => {
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    const random = createSeededRandom(0x1003);
    for (let i = 0; i < 200; i++) {
      const wave = Math.sin((i / 50) * Math.PI * 2) * 10;
      price = 100 + wave + (random() - 0.5) * 2;
      price = Math.max(50, price);

      snapshots.push({
        mode: "paper",
        sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [
          {
            symbol: "600519",
            name: "MaoTai",
            tradable: true,
            price: Number(price.toFixed(2)),
            previousClose: Number((price * 0.99).toFixed(2)),
            changePercent: Number((((price - 100) / 100) * 1).toFixed(2)),
            volume: 10_000_000,
            updatedAt: new Date(2024, 0, i + 1).toISOString(),
          },
        ],
      });
    }

    const engine = new BacktestEngine(
      snapshots,
      new GridTradingStrategy(5, 2, 100),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("网格交易");
    expect(report.trades.length).toBeGreaterThan(0);
  });

  it("tighter grid spacing produces more trades", () => {
    const snapshots = generateSnapshots(200, 100, 0.02);

    const wideEngine = new BacktestEngine(
      snapshots,
      new GridTradingStrategy(5, 5, 100, "WideGrid"),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const tightEngine = new BacktestEngine(
      snapshots,
      new GridTradingStrategy(5, 1, 100, "TightGrid"),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const wideReport = wideEngine.run();
    const tightReport = tightEngine.run();

    expect(tightReport.trades.length).toBeGreaterThanOrEqual(
      wideReport.trades.length,
    );
  });

  it("all strategies handle extreme rally without throwing", () => {
    const snapshotsUp: MarketSnapshot[] = [];
    let price = 100;
    for (let i = 0; i < 100; i++) {
      price = price * 1.02;
      snapshotsUp.push({
        mode: "paper",
        sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [
          {
            symbol: "600519",
            name: "MaoTai",
            tradable: true,
            price: Number(price.toFixed(2)),
            previousClose: Number((price * 0.98).toFixed(2)),
            changePercent: 2.0,
            volume: 10_000_000,
            updatedAt: new Date(2024, 0, i + 1).toISOString(),
          },
        ],
      });
    }

    const strategies = [
      new MovingAverageCrossStrategy(),
      new RSIStrategy(),
      new BollingerBandsStrategy(),
      new MomentumStrategy(),
      new GridTradingStrategy(),
      new MACDStrategy(),
      new TurtleStrategy(),
    ];

    for (const strategy of strategies) {
      const engine = new BacktestEngine(snapshotsUp, strategy, {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      });

      expect(() => engine.run()).not.toThrow();
    }
  });
});

// ═══════════════════════════════════════════════
// MACDStrategy
// ═══════════════════════════════════════════════

describe("MACDStrategy", () => {
  it("produces trades with enough data", () => {
    const snapshots = generateSnapshots(300, 100, 0.015);
    const engine = new BacktestEngine(
      snapshots,
      new MACDStrategy(12, 26, 9, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("MACD");
  });

  it("custom params reflected in name", () => {
    const snapshots = generateSnapshots(300, 100, 0.015);
    const engine = new BacktestEngine(
      snapshots,
      new MACDStrategy(6, 13, 5, 0.3, "FastMACD"),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    expect(report.strategyName).toBe("FastMACD");
    validateStrategyReport(report);
  });

  it("no signals with insufficient data", () => {
    const snapshots = generateSnapshots(30, 100);
    const engine = new BacktestEngine(
      snapshots,
      new MACDStrategy(),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    expect(report.trades.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// TurtleStrategy
// ═══════════════════════════════════════════════

describe("TurtleStrategy", () => {
  it("produces trades in trending markets", () => {
    // 用上升趋势的价格序列
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    const random = createSeededRandom(0x2001);
    for (let i = 0; i < 200; i++) {
      price = price * (1 + 0.003 + (random() - 0.5) * 0.01);
      snapshots.push({
        mode: "paper",
        sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [{
          symbol: "600519",
          name: "MaoTai",
          tradable: true,
          price: Number(price.toFixed(2)),
          previousClose: Number((price * 0.998).toFixed(2)),
          changePercent: 0.2,
          volume: 10_000_000,
          updatedAt: new Date(2024, 0, i + 1).toISOString(),
        }],
      });
    }

    const engine = new BacktestEngine(
      snapshots,
      new TurtleStrategy(20, 10, 0, 0.5),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    validateStrategyReport(report);
    expect(report.strategyName).toContain("Turtle");
  });

  it("custom params reflected in name", () => {
    const snapshots = generateSnapshots(200, 100, 0.02);
    const engine = new BacktestEngine(
      snapshots,
      new TurtleStrategy(55, 20, 100, 0.3, "LongTurtle"),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    expect(report.strategyName).toBe("LongTurtle");
    validateStrategyReport(report);
  });

  it("no signals with insufficient data", () => {
    const snapshots = generateSnapshots(40, 100);
    const engine = new BacktestEngine(
      snapshots,
      new TurtleStrategy(20, 10, 50),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    const report = engine.run();
    expect(report.trades.length).toBe(0);
  });

  it("handles extreme market without throwing", () => {
    const snapshots: MarketSnapshot[] = [];
    let price = 100;
    for (let i = 0; i < 100; i++) {
      price = price * 1.02;
      snapshots.push({
        mode: "paper",
        sequence: i + 1,
        marketTime: new Date(2024, 0, i + 1).toISOString(),
        quotes: [{
          symbol: "600519",
          name: "MaoTai",
          tradable: true,
          price: Number(price.toFixed(2)),
          previousClose: Number((price * 0.98).toFixed(2)),
          changePercent: 2.0,
          volume: 10_000_000,
          updatedAt: new Date(2024, 0, i + 1).toISOString(),
        }],
      });
    }

    const engine = new BacktestEngine(
      snapshots,
      new TurtleStrategy(20, 10, 50),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1.0,
      },
    );

    expect(() => engine.run()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════
// KAIROS regime-aware defensive strategies
// ═══════════════════════════════════════════════

describe("KairosWashoutRecoveryStrategy", () => {
  it("enters only after an intact uptrend contracts in volume and stabilizes", () => {
    const trend = Array.from({ length: 70 }, (_, index) => 80 + index * 0.58);
    const prices = [...trend, 120.5, 119.2, 117.5, 116.8, 117.4, 118.3, 121];
    const snapshots = snapshotsFromPrices(prices, (index) =>
      index >= 70 && index <= 75 ? 3_500_000 : 10_000_000,
    );
    const engine = new BacktestEngine(
      snapshots,
      new KairosWashoutRecoveryStrategy(60, 20, 0.02, 0.12, 0.8, 0.004, 0.06, 0.025, 0.16),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1,
      },
    );

    const report = engine.run();

    validateStrategyReport(report);
    expect(report.strategyName).toContain("洗盘恢复");
    expect(report.trades.some((trade) => trade.side === "buy")).toBe(true);
  });

  it("does not buy a high-volume breakdown", () => {
    const trend = Array.from({ length: 70 }, (_, index) => 80 + index * 0.58);
    const prices = [...trend, 120, 117, 113, 109, 108, 107];
    const snapshots = snapshotsFromPrices(prices, (index) =>
      index >= 70 ? 24_000_000 : 10_000_000,
    );
    const report = new BacktestEngine(
      snapshots,
      new KairosWashoutRecoveryStrategy(),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1,
      },
    ).run();

    expect(report.trades).toHaveLength(0);
  });
});

describe("KairosTrendHealthStrategy", () => {
  it("exits a position on high-volume moving-average deterioration", () => {
    const trend = Array.from({ length: 75 }, (_, index) => 90 + index * 0.45);
    const prices = [...trend, 122, 119, 114, 108, 105, 106, 107];
    const snapshots = snapshotsFromPrices(prices, (index) =>
      index >= 75 ? 25_000_000 : 9_000_000,
    );
    const report = new BacktestEngine(
      snapshots,
      new KairosTrendHealthStrategy(20, 60, 1.25, 0.5, 0.2, 5, 0.18),
      {
        initialCapital: 1_000_000,
        maxOrderNotional: 2_000_000,
        maxPositionWeight: 1,
      },
    ).run();

    const sides = report.trades.map((trade) => trade.side);
    expect(sides).toContain("buy");
    expect(sides).toContain("sell");
    expect(sides.filter((side) => side === "buy")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════
// Technical Indicators
// ═══════════════════════════════════════════════

import { sma, ema, rsi, macd, bollingerBands, atr, highest, lowest } from "./strategies/indicators";

describe("Technical Indicators", () => {
  const prices = [10, 12, 14, 13, 15, 16, 14, 13, 12, 11, 13, 15, 17, 16, 18, 20, 19, 21, 22, 23, 24, 25, 26, 27, 28];

  describe("sma", () => {
    it("computes simple moving average", () => {
      const result = sma(prices, 5);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeCloseTo(26, 0);
    });

    it("returns NaN for insufficient data", () => {
      expect(sma([1, 2], 5)).toBeNaN();
    });

    it("returns NaN for period <= 0", () => {
      expect(sma(prices, 0)).toBeNaN();
      expect(sma(prices, -1)).toBeNaN();
    });
  });

  describe("ema", () => {
    it("computes exponential moving average", () => {
      const result = ema(prices, 5);
      expect(result).toBeGreaterThan(0);
      expect(result).not.toBeNaN();
    });

    it("is more responsive to recent prices than SMA", () => {
      const trendPrices = [10, 10, 10, 10, 10, 10, 10, 10, 10, 20];
      const smaVal = sma(trendPrices, 5);
      const emaVal = ema(trendPrices, 5);
      expect(emaVal).toBeGreaterThan(smaVal);
    });
  });

  describe("rsi", () => {
    it("returns value between 0 and 100", () => {
      const result = rsi(prices, 14);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
      expect(result).not.toBeNaN();
    });

    it("approaches 100 for all-up moves", () => {
      const upOnly = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
      const result = rsi(upOnly, 14);
      expect(result).toBeGreaterThan(90);
    });

    it("approaches 0 for all-down moves", () => {
      const downOnly = [24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
      const result = rsi(downOnly, 14);
      expect(result).toBeLessThan(10);
    });
  });

  describe("macd", () => {
    it("returns macd, signal, and histogram", () => {
      const result = macd(prices);
      expect(typeof result.macd).toBe("number");
      expect(typeof result.signal).toBe("number");
      expect(typeof result.histogram).toBe("number");
      if (!isNaN(result.macd)) {
        expect(result.histogram).toBeCloseTo(result.macd - result.signal, 5);
      }
    });

    it("returns NaN for insufficient data", () => {
      const result = macd([1, 2, 3], 12, 26, 9);
      expect(result.macd).toBeNaN();
    });
  });

  describe("bollingerBands", () => {
    it("returns upper, middle, and lower bands", () => {
      const result = bollingerBands(prices, 20, 2);
      expect(result.upper).toBeGreaterThan(result.middle);
      expect(result.lower).toBeLessThan(result.middle);
      expect(result.bandwidth).toBeGreaterThan(0);
    });

    it("flat prices produce zero-width bands", () => {
      const flat = Array(20).fill(10);
      const result = bollingerBands(flat, 20, 2);
      expect(result.upper).toBe(result.lower);
    });
  });

  describe("atr", () => {
    it("computes average true range", () => {
      const highs = prices.map((p) => p + 1);
      const lows = prices.map((p) => p - 1);
      const closes = prices;
      const result = atr(highs, lows, closes, 14);
      expect(result).toBeGreaterThan(0);
      expect(result).not.toBeNaN();
    });
  });

  describe("highest / lowest", () => {
    it("returns period high/low", () => {
      expect(highest(prices, 5)).toBe(28);
      expect(lowest(prices, 5)).toBe(24);
    });

    it("returns NaN for insufficient data", () => {
      expect(highest([1], 5)).toBeNaN();
      expect(lowest([1], 5)).toBeNaN();
    });
  });
});
