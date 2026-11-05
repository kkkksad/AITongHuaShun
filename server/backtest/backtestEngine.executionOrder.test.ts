import { describe, expect, it } from "vitest";
import type {
  BacktestConfig,
  BacktestStrategy,
  StrategyContext,
  StrategySignal,
} from "../../shared/backtest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "./backtestEngine";

const symbol = "600001";

function createEngine(
  prices: number[],
  onBar: BacktestStrategy["onBar"],
  config: Partial<BacktestConfig> = {},
): BacktestEngine {
  const snapshots: MarketSnapshot[] = prices.map((price, index) => {
    const marketTime = new Date(Date.UTC(2026, 10, index + 2, 7)).toISOString();
    return {
      mode: "paper",
      sequence: index + 1,
      marketTime,
      quotes: [{
        symbol,
        name: "回归样本",
        tradable: true,
        price,
        previousClose: prices[Math.max(0, index - 1)],
        changePercent: 0,
        volume: 1_000_000,
        updatedAt: marketTime,
      }],
    };
  });
  return new BacktestEngine(snapshots, { name: "成交顺序回归", onBar }, {
    initialCapital: 10_000,
    maxOrderNotional: 10_000,
    maxPositionWeight: 1,
    maxDailyLoss: 1,
    commissionRate: 0,
    minimumCommission: 0,
    slippageBps: 0,
    ...config,
  });
}

function market(side: "buy" | "sell", quantity = 100): StrategySignal {
  return { symbol, side, type: "market", quantity };
}

function limit(side: "buy" | "sell", limitPrice: number): StrategySignal {
  return { symbol, side, type: "limit", quantity: 100, limitPrice };
}

describe("BacktestEngine 已成交状态与成交顺序", () => {
  it("挂单买入后先更新 context，空仓策略不会重复买入，并保留初始权益与 T+1", () => {
    const contexts: StrategyContext[] = [];
    const engine = createEngine([10, 8, 8], (context) => {
      contexts.push(context);
      if (context.barIndex === 0) return [limit("buy", 9)];
      if (context.barIndex === 1 && context.positions.length === 0) return [market("buy")];
      return [];
    }, { minimumCommission: 5 });

    const report = engine.run();

    expect(report.trades).toHaveLength(1);
    expect(contexts[1].account.cash).toBe(9_195);
    expect(contexts[1].cash).toBe(9_195);
    expect(contexts[1].account.equity).toBe(9_995);
    expect(contexts[1].equity).toBe(9_995);
    expect(contexts[1].positions).toMatchObject([{ quantity: 100, availableQuantity: 0, t1LockedQuantity: 100 }]);
    expect(contexts[2].positions).toMatchObject([{ quantity: 100, availableQuantity: 100, t1LockedQuantity: 0 }]);
    expect(report.finalPositions).toMatchObject([{ quantity: 100 }]);
    expect(report.metrics.totalCommission).toBe(5);
    expect(report.equityCurve).toHaveLength(4);
    expect(report.equityCurve[0]).toMatchObject({ equity: 10_000, cash: 10_000, marketValue: 0, cumulativeReturn: 0 });
  });

  it("挂单卖出后 context 已空仓并包含卖出费用，策略不会发出多余卖单", () => {
    const contexts: StrategyContext[] = [];
    const engine = createEngine([10, 10, 12], (context) => {
      contexts.push(context);
      if (context.barIndex === 0) return [market("buy")];
      if (context.barIndex === 1) return [limit("sell", 11)];
      return context.positions.length > 0 ? [market("sell")] : [];
    }, { minimumCommission: 5 });

    const report = engine.run();

    expect(report.orders).toHaveLength(2);
    expect(contexts[2].positions).toEqual([]);
    expect(contexts[2].cash).toBe(10_190);
    expect(contexts[2].equity).toBe(10_190);
    expect(report.trades.map((trade) => [trade.side, trade.type, trade.barIndex])).toEqual([
      ["buy", "market", 0], ["sell", "limit", 2],
    ]);
    expect(report.metrics.totalCommission).toBe(10);
  });

  it("先记录旧挂单成交再记录同 bar 市价成交，FIFO 费用后盈亏匹配实际先后", () => {
    const engine = createEngine([10, 9, 9.08], ({ barIndex }) => {
      if (barIndex === 0) return [limit("buy", 9)];
      return [market(barIndex === 1 ? "buy" : "sell")];
    }, { commissionRate: 0.001, slippageBps: 50 });

    const report = engine.run();

    expect(report.trades.map((trade) => [trade.type, trade.price, trade.barIndex])).toEqual([
      ["limit", 9, 1], ["market", 9.04, 1], ["market", 9.03, 2],
    ]);
    expect(report.metrics.winningTrades).toBe(1);
    expect(report.metrics.losingTrades).toBe(0);
    expect(report.metrics.winRate).toBe(1);
    expect(report.metrics.avgWin).toBeCloseTo(1.2);
    expect(report.metrics.totalCommission).toBeCloseTo(2.7);
  });

  it("多个挂单保留 Broker 的实际遍历顺序，不按创建顺序反转或重复收集", () => {
    const engine = createEngine([10, 9, 9], ({ barIndex }) =>
      barIndex === 0 ? [limit("buy", 9), limit("buy", 9.02)] : [],
    { slippageBps: 50 });

    const report = engine.run();

    expect(report.trades.map((trade) => trade.price)).toEqual([9.02, 9]);
    expect(report.trades.map((trade) => trade.orderId.slice(-4))).toEqual(["0002", "0001"]);
    expect(report.trades.map((trade) => trade.barIndex)).toEqual([1, 1]);
    expect(report.finalPositions).toMatchObject([{ quantity: 200 }]);
  });

  it("同 bar 的批信号继续共用撮合后的 context，不在每个信号之间重新定仓", () => {
    const engine = createEngine([10, 10], ({ barIndex }) => barIndex === 0 ? [
      market("buy"),
      { symbol, side: "buy", type: "market", targetWeight: 0.5 },
    ] : [], { minimumCommission: 100 });

    const report = engine.run();

    expect(report.trades.map((trade) => trade.quantity)).toEqual([100, 500]);
    expect(report.finalPositions).toMatchObject([{ quantity: 600 }]);
    expect(report.metrics.totalCommission).toBe(200);
  });
});

describe("BacktestEngine 报告隔离", () => {
  it("修改首份报告的配置不会改写其他报告或后续运行的经济结果", () => {
    const engine = createEngine([10, 8], ({ barIndex }) => barIndex === 0 ? [market("buy")] : [],
      { minimumCommission: 5 });
    const first = engine.run();
    const baseline = JSON.parse(JSON.stringify(first));
    const second = engine.run();

    Object.assign(first.config, {
      initialCapital: 20_000,
      commissionRate: 0.1,
      minimumCommission: 100,
      slippageBps: 100,
      maxOrderNotional: 500,
      maxPositionWeight: 0.01,
      maxDailyLoss: 0.001,
    });
    const third = engine.run();

    expect(third).toEqual(baseline);
    expect(second).toEqual(baseline);
    expect(first.config).not.toBe(second.config);
    expect(first.config).not.toBe(third.config);
    expect(second.config).not.toBe(third.config);
  });

  it("重复 run 产生不同成交时保留已返回报告的曲线、成交与指标一致性", () => {
    let shouldBuy = true;
    const engine = createEngine([10, 8], ({ barIndex }) =>
      shouldBuy && barIndex === 0 ? [market("buy")] : [],
    { minimumCommission: 5 });
    const first = engine.run();
    const saved = JSON.stringify(first);

    shouldBuy = false;
    const second = engine.run();

    expect(JSON.stringify(first)).toBe(saved);
    expect(first.trades).toHaveLength(1);
    expect(first.equityCurve.at(-1)?.equity).toBe(first.finalAccount.equity);
    expect(second.trades).toHaveLength(0);
    expect(second.finalAccount.equity).toBe(10_000);
  });

  it("报告数组及每个元素互不共享，修改已返回对象不会改写其他报告", () => {
    const engine = createEngine([10, 8], ({ barIndex }) => barIndex === 0 ? [market("buy")] : []);
    const first = engine.run();
    const second = engine.run();
    const saved = JSON.stringify(second);

    expect(first.trades).not.toBe(second.trades);
    expect(first.equityCurve).not.toBe(second.equityCurve);
    for (let i = 0; i < first.trades.length; i++) {
      expect(first.trades[i]).not.toBe(second.trades[i]);
    }
    for (let i = 0; i < first.equityCurve.length; i++) {
      expect(first.equityCurve[i]).not.toBe(second.equityCurve[i]);
    }

    first.trades[0].price = -1;
    first.equityCurve[0].equity = -1;
    first.trades.push({ ...first.trades[0] });
    first.equityCurve.push({ ...first.equityCurve[0] });

    expect(JSON.stringify(second)).toBe(saved);
    const third = engine.run();
    expect(third.trades).toEqual(second.trades);
    expect(third.equityCurve).toEqual(second.equityCurve);
  });
});
