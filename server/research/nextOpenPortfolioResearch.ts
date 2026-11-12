import type { BacktestStrategy, StrategyContext, StrategySignal } from "../../shared/backtest";
import type { MarketSnapshot } from "../../shared/trading";
import { BacktestEngine } from "../backtest/backtestEngine";
import type { ExecutionCostOptions } from "../broker/executionCosts";
import { getChinaDateKey } from "../trading/ashareTradingCalendar";

export const SHARED_CAPITAL_RESEARCH_LIMITS = {
  initialCapital: 20_000, maxOrderNotional: 5_000, maxPositionWeight: 0.25, maxDailyLoss: 0.05,
} as const;

function executionSnapshots(daily: MarketSnapshot[], asOf: Date): MarketSnapshot[] {
  if (daily.length < 2 || daily.length > 500) throw Error("研究需要2至500个已完成共同日");
  const cutoff = asOf.getTime();
  if (!Number.isFinite(cutoff)) throw Error("研究缺少有效asOf");
  let lastClose = -Infinity;
  return daily.flatMap((snapshot, index) => {
    const close = Date.parse(snapshot.marketTime);
    if (!Number.isFinite(close)) throw Error("研究日线时间无效");
    const date = getChinaDateKey(new Date(close));
    if (snapshot.mode !== "paper" || close > cutoff || close !== Date.parse(`${date}T15:00:00+08:00`) || close <= lastClose ||
      new Set(snapshot.quotes.map(quote => quote.symbol)).size !== snapshot.quotes.length) {
      throw Error("研究仅接受严格递增、逐股唯一的Paper收盘日线");
    }
    lastClose = close;
    const openTime = `${date}T09:30:00+08:00`;
    const open: MarketSnapshot = { mode: "paper", sequence: index * 2 + 1, marketTime: openTime,
      quotes: snapshot.quotes.map(quote => {
        const price = quote.open;
        if (price === undefined || !Number.isFinite(price) || price <= 0 || !Number.isFinite(quote.price) || quote.price <= 0 ||
          Date.parse(quote.updatedAt) !== close) {
          throw Error("研究缺少真实开盘/收盘价，不允许以收盘价填充开盘");
        }
        // The full-day tradability flag censors execution evidence only; children never see this open.
        return { ...quote, price, open: price, high: price, low: price, volume: 0, amount: undefined,
          turnover: undefined, amplitude: 0, updatedAt: openTime,
          changePercent: quote.previousClose > 0 ? (price / quote.previousClose - 1) * 100 : 0 };
      }) };
    return [open, { ...snapshot, sequence: index * 2 + 2, quotes: snapshot.quotes.map(quote => ({ ...quote })) }];
  });
}

function ownContext(context: StrategyContext, symbol: string): StrategyContext {
  return { ...context, barIndex: Math.floor(context.barIndex / 2), totalBars: context.totalBars / 2,
    snapshot: { ...context.snapshot, quotes: context.snapshot.quotes.filter(quote => quote.symbol === symbol).map(quote => ({ ...quote })) },
    account: { ...context.account, ...(context.account.tradingDayPerformance === undefined ? {} : {
      tradingDayPerformance: { ...context.account.tradingDayPerformance },
    }) }, positions: context.positions.filter(position => position.symbol === symbol).map(position => ({ ...position })) };
}

/** Input comes from validated aligned history. This is not the online plan/executor or a live feed. */
export function runNextOpenPortfolioResearch(
  daily: MarketSnapshot[], strategies: ReadonlyMap<string, BacktestStrategy>, costs: ExecutionCostOptions, asOf: Date,
) {
  if (!strategies.size || strategies.size > 12 || new Set(strategies.values()).size !== strategies.size) {
    throw Error("研究需要1至12个互相独立的逐股策略实例");
  }
  if ([costs.commissionRate, costs.minimumCommission, costs.slippageBps].some(value => !Number.isFinite(value) || value < 0)) {
    throw Error("研究成本必须为有限非负值");
  }
  const snapshots = executionSnapshots(daily, asOf);
  const symbols = new Set(daily.flatMap(snapshot => snapshot.quotes.map(quote => quote.symbol)));
  if ([...strategies.keys()].some(symbol => !symbols.has(symbol))) throw Error("策略绑定标的不在研究行情中");
  let pending: StrategySignal[] = [], started = new Set<string>();
  let generatedSignals = 0, unexecutableNextOpenSignals = 0, missingCloseObservations = 0;
  let maximumObservedPositions = 0, maximumObservedGrossWeight = 0, minimumObservedCash = 20_000;
  const failures: string[] = [];
  const adapter: BacktestStrategy = {
    name: "20000 shared-capital completed-close to next-open research",
    reset() {
      pending = []; started = new Set(); failures.length = 0;
      generatedSignals = unexecutableNextOpenSignals = missingCloseObservations = 0;
      maximumObservedPositions = maximumObservedGrossWeight = 0; minimumObservedCash = 20_000;
      for (const strategy of strategies.values()) strategy.reset?.();
    },
    onBar(context) {
      minimumObservedCash = Math.min(minimumObservedCash, context.account.cash);
      maximumObservedPositions = Math.max(maximumObservedPositions, context.positions.length);
      maximumObservedGrossWeight = Math.max(maximumObservedGrossWeight,
        context.account.equity > 0 ? context.account.marketValue / context.account.equity : 0);
      if (context.barIndex % 2 === 0) {
        const signals = pending; pending = [];
        return signals.filter(signal => {
          const quote = context.snapshot.quotes.find(item => item.symbol === signal.symbol);
          if (quote?.tradable) return true;
          unexecutableNextOpenSignals++;
          return false;
        });
      }
      for (const [symbol, strategy] of strategies) {
        if (!context.snapshot.quotes.some(quote => quote.symbol === symbol)) { missingCloseObservations++; continue; }
        try {
          if (!started.has(symbol)) {
            strategy.onStart?.(ownContext(context, symbol));
            started.add(symbol);
          }
          const signals = strategy.onBar(ownContext(context, symbol));
          if (!Array.isArray(signals) || signals.some(signal => !signal || signal.symbol !== symbol || signal.type !== "market")) {
            throw Error("逐股研究仅允许本股市价意图");
          }
          pending.push(...signals.map(signal => ({ ...signal })));
          generatedSignals += signals.length;
        } catch {
          failures.push(`${symbol}:${Math.floor(context.barIndex / 2)}`);
        }
      }
      return [];
    },
    onEnd(context) {
      for (const [symbol, strategy] of strategies) {
        if (!started.has(symbol)) continue;
        try { strategy.onEnd?.(ownContext(context, symbol)); }
        catch { failures.push(`${symbol}:end`); }
      }
    },
  };
  const report = new BacktestEngine(snapshots, adapter, { ...SHARED_CAPITAL_RESEARCH_LIMITS, ...costs }).run();
  if (failures.length) throw Error(`研究策略出现${failures.length}次异常或越界意图，不能将其当无信号：${failures.slice(0, 5).join(",")}`);
  return { methodology: { evaluationUnit: "one-shared-account-per-strategy-window-cost-order",
    asOf: asOf.toISOString(), decision: "completed-close-only", execution: "next-observed-open-market-order-no-retry",
    childOrder: [...strategies.keys()], observationsPerTradingDay: 2,
    excludedMetrics: ["annualizedReturn", "annualizedVolatility", "sharpeRatio", "sortinoRatio", "calmarRatio"],
    scope: "fixed-strategy-research-not-online-adaptive-routing-or-full-production-risk-tracking" },
    diagnostics: { generatedSignals, unexecutableNextOpenSignals, missingCloseObservations,
      tailSignals: pending.length, maximumObservedPositions, maximumObservedGrossWeight, minimumObservedCash }, report };
}
