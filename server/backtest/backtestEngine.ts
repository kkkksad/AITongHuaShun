import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
  RiskLimits,
} from "../../shared/trading";
import type {
  BacktestConfig,
  BacktestMetrics,
  BacktestReport,
  BacktestStrategy,
  EquityPoint,
  StrategyContext,
  StrategySignal,
  TradeRecord,
} from "../../shared/backtest";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { PaperBroker } from "../broker/paperBroker";
import { RiskEngine } from "../risk/riskEngine";
import { HistoricalDataProvider } from "./HistoricalDataProvider";

/**
 * 回测引擎 —— 按历史K线逐根回放，执行策略信号，计算绩效指标。
 *
 * 使用方式：
 * ```typescript
 * const engine = new BacktestEngine(snapshots, myStrategy, {
 *   initialCapital: 1_000_000,
 *   commissionRate: 0.0003,
 *   minimumCommission: 5,
 *   slippageBps: 5,
 *   maxOrderNotional: 100_000,
 *   maxPositionWeight: 0.25,
 *   maxDailyLoss: 0.05,
 * });
 * const report = engine.run();
 * console.log(report.metrics);
 * ```
 *
 * 架构说明：
 * - HistoricalDataProvider 实现 MarketDataProvider，封装历史快照数组
 * - InMemoryTradingStore 实现 TradingStore，不预设种子持仓（从纯现金开始）
 * - PaperBroker 复用已有的下单/成交逻辑（市价单、限价单、滑点、佣金）
 * - 策略通过 onBar() 回调返回信号，引擎解释信号生成 OrderRequest
 */
export class BacktestEngine {
  private readonly config: BacktestConfig;
  private readonly provider: HistoricalDataProvider;
  private store!: InMemoryTradingStore;
  private broker!: PaperBroker;
  private risk!: RiskEngine;
  private readonly equityCurve: EquityPoint[] = [];
  private readonly trades: TradeRecord[] = [];
  private readonly allOrders: OrderRecord[] = [];
  private readonly limits: RiskLimits;

  constructor(
    snapshots: MarketSnapshot[],
    private readonly strategy: BacktestStrategy,
    config: Partial<BacktestConfig> = {},
  ) {
    if (snapshots.length < 2) {
      throw new Error("回测至少需要 2 根 bar 数据");
    }

    this.config = {
      initialCapital: config.initialCapital ?? 1_000_000,
      commissionRate: config.commissionRate ?? 0.0003,
      minimumCommission: config.minimumCommission ?? 5,
      slippageBps: config.slippageBps ?? 5,
      maxOrderNotional: config.maxOrderNotional ?? 100_000,
      maxPositionWeight: config.maxPositionWeight ?? 0.25,
      maxDailyLoss: config.maxDailyLoss ?? 0.05,
    };

    this.limits = {
      maxOrderNotional: this.config.maxOrderNotional,
      maxPositionWeight: this.config.maxPositionWeight,
      maxDailyLoss: this.config.maxDailyLoss,
      lotSize: 100,
      realTradingEnabled: false,
    };

    this.provider = new HistoricalDataProvider(snapshots);
    this.resetRuntime();
  }

  private resetRuntime(): void {
    this.store = new InMemoryTradingStore(
      this.config.initialCapital,
      false,
      () => new Date(this.provider.getSnapshot().marketTime),
    );
    this.risk = new RiskEngine(this.limits);
    this.broker = new PaperBroker(this.provider, this.store, this.risk, {
      mode: "paper",
      commissionRate: this.config.commissionRate,
      minimumCommission: this.config.minimumCommission,
      slippageBps: this.config.slippageBps,
      limits: this.limits,
    });
  }

  /** 执行回测并返回报告 */
  run(): BacktestReport {
    this.provider.reset();
    this.resetRuntime();
    this.strategy.reset?.();
    this.equityCurve.length = 0;
    this.trades.length = 0;
    this.allOrders.length = 0;

    const firstSnapshot = this.provider.getSnapshot();

    // 记录初始权益点
    const initialAccount = this.store.getAccount(
      "paper",
      firstSnapshot,
      this.limits,
    );
    this.equityCurve.push({
      index: 0,
      time: firstSnapshot.marketTime,
      equity: initialAccount.equity,
      cash: initialAccount.cash,
      marketValue: initialAccount.marketValue,
      cumulativeReturn: 0,
    });

    // 回调策略 onStart
    if (this.strategy.onStart) {
      this.strategy.onStart({
        snapshot: firstSnapshot,
        account: initialAccount,
        positions: this.store.getPositions(firstSnapshot),
        equity: initialAccount.equity,
        cash: initialAccount.cash,
      });
    }

    const totalBars = this.provider.length;

    // 逐根回放
    for (let i = 0; i < totalBars; i++) {
      if (i > 0) {
        this.provider.tick();
      }

      const snapshot = this.provider.getSnapshot();
      const account = this.store.getAccount("paper", snapshot, this.limits);
      const positions = this.store.getPositions(snapshot);

      // 先处理挂单的限价单成交检查
      this.broker.markToMarket(snapshot);

      // 调用策略
      const context: StrategyContext = {
        snapshot,
        account,
        positions,
        equity: account.equity,
        cash: account.cash,
        barIndex: i,
        totalBars,
      };

      let signals: StrategySignal[];
      try {
        signals = this.strategy.onBar(context);
      } catch (err) {
        console.error(
          `[BacktestEngine] 策略 ${this.strategy.name} onBar 异常 (bar ${i}):`,
          err,
        );
        signals = [];
      }

      // 处理信号
      for (const signal of signals) {
        this.processSignal(signal, account, positions, i, snapshot.marketTime);
      }

      // 再次获取账户快照以反映所有成交
      const updatedAccount = this.store.getAccount(
        "paper",
        snapshot,
        this.limits,
      );

      // 收集本bar产生的已成交订单
      const newFilledOrders = this.store
        .listOrders()
        .filter(
          (o) =>
            o.status === "filled" &&
            !this.allOrders.some((ao) => ao.id === o.id),
        );
      for (const order of newFilledOrders) {
        this.allOrders.push(order);
        const quote = this.provider.getQuote(order.symbol);
        this.trades.push({
          orderId: order.id,
          symbol: order.symbol,
          name: quote?.name ?? order.symbol,
          side: order.side,
          type: order.type,
          quantity: order.quantity,
          price: order.filledPrice ?? 0,
          notional: order.notional,
          commission: order.commission,
          time: snapshot.marketTime,
          barIndex: i,
        });
      }

      // 记录权益曲线
      this.equityCurve.push({
        index: i,
        time: snapshot.marketTime,
        equity: updatedAccount.equity,
        cash: updatedAccount.cash,
        marketValue: updatedAccount.marketValue,
        cumulativeReturn:
          (updatedAccount.equity - this.config.initialCapital) /
          this.config.initialCapital,
      });
    }

    // 回调策略 onEnd
    const finalSnapshot = this.provider.getSnapshot();
    const finalAccount = this.store.getAccount(
      "paper",
      finalSnapshot,
      this.limits,
    );
    const finalPositions = this.store.getPositions(finalSnapshot);

    if (this.strategy.onEnd) {
      this.strategy.onEnd({
        snapshot: finalSnapshot,
        account: finalAccount,
        positions: finalPositions,
        equity: finalAccount.equity,
        cash: finalAccount.cash,
        barIndex: totalBars - 1,
        totalBars,
      });
    }

    const metrics = this.computeMetrics(finalAccount);

    return {
      strategyName: this.strategy.name,
      metrics,
      equityCurve: this.equityCurve,
      orders: this.store.listOrders(10_000),
      trades: this.trades,
      finalAccount,
      finalPositions,
      config: this.config,
    };
  }

  // ── 信号处理 ──

  private processSignal(
    signal: StrategySignal,
    account: AccountSnapshot,
    positions: PositionSnapshot[],
    barIndex: number,
    time: string,
  ): void {
    const quote = this.provider.getQuote(signal.symbol);
    if (!quote || !quote.tradable) {
      return;
    }

    // 计算下单数量
    let quantity = signal.quantity ?? 0;

    if (signal.targetWeight !== undefined && quantity === 0) {
      // 根据目标仓位计算数量
      const targetValue = account.equity * signal.targetWeight;
      quantity = Math.floor(targetValue / quote.price / this.limits.lotSize) * this.limits.lotSize;

      // 调整：根据 side 修正
      if (signal.side === "sell") {
        const pos = positions.find((p) => p.symbol === signal.symbol);
        const maxSell = pos?.quantity ?? 0;
        const lotAligned = Math.floor(maxSell / this.limits.lotSize) * this.limits.lotSize;
        quantity = Math.min(quantity, lotAligned);
      }
    }

    if (quantity <= 0) {
      return;
    }

    // 对齐整手数
    quantity = Math.floor(quantity / this.limits.lotSize) * this.limits.lotSize;
    if (quantity <= 0) {
      return;
    }

    const orderRequest: OrderRequest = {
      symbol: signal.symbol,
      side: signal.side,
      type: signal.type,
      quantity,
      ...(signal.type === "limit" ? { limitPrice: signal.limitPrice } : {}),
    };

    try {
      const order = this.broker.submitOrder(orderRequest);
      if (order.status === "filled") {
        this.allOrders.push(order);
        this.trades.push({
          orderId: order.id,
          symbol: order.symbol,
          name: quote.name,
          side: order.side,
          type: order.type,
          quantity: order.quantity,
          price: order.filledPrice ?? 0,
          notional: order.notional,
          commission: order.commission,
          time,
          barIndex,
        });
      }
    } catch (err) {
      console.error(
        `[BacktestEngine] 下单失败 bar=${barIndex} symbol=${signal.symbol}:`,
        err,
      );
    }
  }

  // ── 绩效计算 ──

  private computeMetrics(finalAccount: AccountSnapshot): BacktestMetrics {
    const initial = this.config.initialCapital;
    const final = finalAccount.equity;
    const returns = this.equityCurve.map((p) => p.cumulativeReturn);
    const barCount = this.equityCurve.length;

    // 总收益
    const totalReturn = (final - initial) / initial;
    const totalReturnPercent = totalReturn * 100;

    // 年化收益率（假设252个交易日/年）
    const years = barCount / 252 || 1 / 252;
    const annualizedReturn =
      Math.pow(final / initial, 1 / years) - 1;

    // 日收益率序列
    const dailyReturns: number[] = [];
    for (let i = 1; i < returns.length; i++) {
      // 使用连续复利近似
      const dailyRet = (returns[i] - returns[i - 1]) / (1 + returns[i - 1]);
      dailyReturns.push(dailyRet);
    }

    // 年化波动率
    const avgRet =
      dailyReturns.reduce((s, r) => s + r, 0) / (dailyReturns.length || 1);
    const variance =
      dailyReturns.reduce((s, r) => s + (r - avgRet) ** 2, 0) /
      (dailyReturns.length || 1);
    const dailyVol = Math.sqrt(variance);
    const annualizedVolatility = dailyVol * Math.sqrt(252);

    // 夏普比率
    const sharpeRatio =
      annualizedVolatility === 0
        ? 0
        : (annualizedReturn - 0) / annualizedVolatility; // 无风险利率假设为0

    // 索提诺比率（只考虑下行波动）
    const downReturns = dailyReturns.filter((r) => r < 0);
    const downVariance =
      downReturns.length > 0
        ? downReturns.reduce((s, r) => s + r ** 2, 0) / dailyReturns.length
        : 0;
    const downVol = Math.sqrt(downVariance) * Math.sqrt(252);
    const sortinoRatio = downVol === 0 ? 0 : (annualizedReturn - 0) / downVol;

    // 最大回撤
    let peak = this.equityCurve[0].equity;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const drawdown = (peak - point.equity) / peak;
      if (drawdown > maxDrawdownPercent) {
        maxDrawdownPercent = drawdown;
        maxDrawdown = peak - point.equity;
      }
    }

    // 卡尔玛比率
    const calmarRatio =
      maxDrawdownPercent === 0
        ? annualizedReturn * 100
        : annualizedReturn / maxDrawdownPercent;

    // 交易统计
    const totalCommission = this.trades.reduce((s, t) => s + t.commission, 0);
    const totalSlippage = 0; // 已包含在成交价中

    // 盈亏分析：按成交对分组（买+卖 = 一笔完整交易）
    const tradePnls = this.computeTradePnls();
    const winningTrades = tradePnls.filter((p) => p > 0);
    const losingTrades = tradePnls.filter((p) => p <= 0);

    const totalTrades = this.trades.length;
    const winCount = winningTrades.length;
    const lossCount = losingTrades.length;
    const winRate = totalTrades > 0 ? winCount / totalTrades : 0;
    const avgWin =
      winCount > 0 ? winningTrades.reduce((s, p) => s + p, 0) / winCount : 0;
    const avgLoss =
      lossCount > 0
        ? Math.abs(losingTrades.reduce((s, p) => s + p, 0)) / lossCount
        : 0;
    const grossProfit = winningTrades.reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(losingTrades.reduce((s, p) => s + p, 0));
    const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;

    return {
      initialCapital: initial,
      finalEquity: final,
      totalReturn,
      totalReturnPercent,
      annualizedReturn,
      annualizedVolatility,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      maxDrawdownPercent,
      calmarRatio,
      totalTrades,
      winningTrades: winCount,
      losingTrades: lossCount,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      totalCommission,
      totalSlippage,
      barCount,
      startTime: this.equityCurve[0]?.time ?? "",
      endTime: this.equityCurve[this.equityCurve.length - 1]?.time ?? "",
    };
  }

  /**
   * 简单盈亏分组：按 symbol 分组，买卖配对计算 PnL
   * 买方成交增加持仓，卖方成交减少持仓，用先进先出法。
   */
  private computeTradePnls(): number[] {
    const pnls: number[] = [];
    const lots: Map<
      string,
      { quantity: number; cost: number }[]
    > = new Map();

    for (const trade of this.trades) {
      if (!lots.has(trade.symbol)) {
        lots.set(trade.symbol, []);
      }
      const symbolLots = lots.get(trade.symbol)!;

      if (trade.side === "buy") {
        symbolLots.push({ quantity: trade.quantity, cost: trade.notional + trade.commission });
      } else {
        let remaining = trade.quantity;
        const sellProceeds = trade.notional - trade.commission;

        while (remaining > 0 && symbolLots.length > 0) {
          const lot = symbolLots[0];
          const matchedQty = Math.min(remaining, lot.quantity);
          const costBasis = (lot.cost / lot.quantity) * matchedQty;
          const revenue = (sellProceeds / trade.quantity) * matchedQty;
          pnls.push(revenue - costBasis);

          remaining -= matchedQty;
          lot.quantity -= matchedQty;
          lot.cost -= costBasis;

          if (lot.quantity <= 0) {
            symbolLots.shift();
          }
        }

        // 卖空情况：记录负PnL（不应在回测中出现）
        if (remaining > 0) {
          pnls.push(0);
        }
      }
    }

    return pnls;
  }
}
