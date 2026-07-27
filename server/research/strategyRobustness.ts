import type { BacktestMetrics } from "../../shared/backtest";
import type {
  MarketQuote,
  MarketSnapshot,
  TradingMode,
} from "../../shared/trading";
import { BacktestEngine } from "../backtest/backtestEngine";
import { builtInFactories } from "../optimizer";
import type { StrategyFactory } from "../optimizer/types";
import type {
  HistoricalBar,
  HistoricalBarsResponse,
  HistoricalSeries,
} from "./marketRegimeResearch";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";
import { historyBridgeTimeoutMs } from "./historyRequestPolicy";

export type StrategyFamily =
  | "trend"
  | "pullback"
  | "breakout"
  | "mean-reversion"
  | "defensive";

export interface StrategyRobustnessProfile {
  strategyKey: string;
  strategyFamily: StrategyFamily;
  factory: StrategyFactory;
  fixedParams: Record<string, number>;
}

export interface StrategyRobustnessEntry {
  rank: number;
  strategyKey: string;
  strategyName: string;
  strategyFamily: StrategyFamily;
  fixedParams: Record<string, number>;
  windows: number;
  profitableWindows: number;
  totalTrades: number;
  medianReturn: number;
  worstReturn: number;
  averageMaxDrawdown: number;
  worstMaxDrawdown: number;
  averageWinRate: number;
  stabilityGate: "pass" | "caution" | "blocked";
}

export interface StrategyRobustnessReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: {
    sampleType: "real-qfq-fixed-parameter-multi-window";
    historySource: string;
    fetchedAt: string | null;
    adjustment: "qfq";
    requestedDays: number;
    requestedSymbols: number;
    historySymbols: number;
    alignedTradingDays: number;
    windowCount: 3;
  };
  methodology: {
    parametersOptimizedOnReportData: false;
    nonOverlappingWindows: true;
    minimumAlignedTradingDays: 300;
    stabilityMeaning: string;
  };
  entries: StrategyRobustnessEntry[];
  warnings: string[];
  guardrails: string[];
}

export interface BuildStrategyRobustnessInput {
  bridgeUrl: string;
  bridgeToken?: string;
  marketDataProvider: string;
  mode: TradingMode;
  snapshot: MarketSnapshot;
  limit: number;
  days: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

const WINDOW_COUNT = 3;
const MINIMUM_ALIGNED_DAYS = 300;

export const STRATEGY_ROBUSTNESS_PROFILES: StrategyRobustnessProfile[] = [
  {
    strategyKey: "kairosLowVolTrend",
    strategyFamily: "trend",
    factory: builtInFactories.kairosLowVolTrend,
    fixedParams: {
      trendPeriod: 20,
      slowPeriod: 60,
      maxVolatility: 0.026,
      takeProfitPercent: 0.04,
      stopLossPercent: 0.02,
      targetWeight: 0.16,
    },
  },
  {
    strategyKey: "kairosTrendHealth",
    strategyFamily: "trend",
    factory: builtInFactories.kairosTrendHealth,
    fixedParams: {
      fastPeriod: 20,
      slowPeriod: 60,
      breakdownVolumeRatio: 1.35,
      takeProfitPercent: 0.06,
      stopLossPercent: 0.03,
      cooldownBars: 6,
      targetWeight: 0.16,
    },
  },
  {
    strategyKey: "kairosQuietPullback",
    strategyFamily: "pullback",
    factory: builtInFactories.kairosQuietPullback,
    fixedParams: {
      trendPeriod: 20,
      pullbackPeriod: 6,
      minPullbackPercent: 0.01,
      maxPullbackPercent: 0.06,
      maxVolumeMultiplier: 1.3,
      takeProfitPercent: 0.035,
      stopLossPercent: 0.018,
      targetWeight: 0.15,
    },
  },
  {
    strategyKey: "kairosWashoutRecovery",
    strategyFamily: "pullback",
    factory: builtInFactories.kairosWashoutRecovery,
    fixedParams: {
      trendPeriod: 60,
      pullbackPeriod: 20,
      minPullbackPercent: 0.025,
      maxPullbackPercent: 0.1,
      maxVolumeRatio: 0.8,
      minReboundPercent: 0.005,
      takeProfitPercent: 0.055,
      stopLossPercent: 0.025,
      targetWeight: 0.16,
    },
  },
  {
    strategyKey: "momentum",
    strategyFamily: "breakout",
    factory: builtInFactories.momentum,
    fixedParams: { entryPeriod: 30, exitPeriod: 10, targetWeight: 0.2 },
  },
  {
    strategyKey: "turtle",
    strategyFamily: "breakout",
    factory: builtInFactories.turtle,
    fixedParams: {
      entryPeriod: 20,
      exitPeriod: 10,
      trendFilterPeriod: 50,
      targetWeight: 0.2,
    },
  },
  {
    strategyKey: "rsi",
    strategyFamily: "mean-reversion",
    factory: builtInFactories.rsi,
    fixedParams: {
      period: 14,
      oversoldThreshold: 30,
      overboughtThreshold: 70,
      targetWeight: 0.18,
    },
  },
  {
    strategyKey: "bollingerBands",
    strategyFamily: "mean-reversion",
    factory: builtInFactories.bollingerBands,
    fixedParams: { period: 20, stdMultiplier: 2, targetWeight: 0.18 },
  },
  {
    strategyKey: "kairosCapitalShield",
    strategyFamily: "defensive",
    factory: builtInFactories.kairosCapitalShield,
    fixedParams: {
      entryPeriod: 24,
      exitPeriod: 8,
      maxRecentDrawdown: 0.045,
      takeProfitPercent: 0.03,
      stopLossPercent: 0.015,
      cooldownBars: 6,
      targetWeight: 0.12,
    },
  },
  {
    strategyKey: "movingAverageCross",
    strategyFamily: "trend",
    factory: builtInFactories.movingAverageCross,
    fixedParams: { fastPeriod: 10, slowPeriod: 30, targetWeight: 0.2 },
  },
  {
    strategyKey: "macd",
    strategyFamily: "trend",
    factory: builtInFactories.macd,
    fixedParams: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      targetWeight: 0.18,
    },
  },
  {
    strategyKey: "aSharePullback",
    strategyFamily: "pullback",
    factory: builtInFactories.aSharePullback,
    fixedParams: {
      trendPeriod: 30,
      pullbackPeriod: 8,
      maxPullbackPercent: 0.07,
      minReboundPercent: 0.008,
      volumeMultiplier: 1.15,
      takeProfitPercent: 0.05,
      stopLossPercent: 0.03,
      targetWeight: 0.2,
    },
  },
  {
    strategyKey: "gridTrading",
    strategyFamily: "mean-reversion",
    factory: builtInFactories.gridTrading,
    fixedParams: { gridCount: 6, gridSpacingPercent: 2, lotsPerGrid: 100 },
  },
  {
    strategyKey: "dca",
    strategyFamily: "defensive",
    factory: builtInFactories.dca,
    fixedParams: { intervalBars: 10, investAmount: 10_000, takeProfitPercent: 15 },
  },
];

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function sortedValidBars(series: HistoricalSeries): HistoricalBar[] {
  return [...series.bars]
    .filter((bar) => bar.date && bar.close > 0 && bar.high > 0 && bar.low > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function buildAlignedHistoricalSnapshots(
  seriesList: HistoricalSeries[],
  mode: TradingMode,
): MarketSnapshot[] {
  const normalized = seriesList
    .map((series) => ({ series, bars: sortedValidBars(series) }))
    .filter((item) => item.bars.length > 0);
  if (normalized.length === 0) return [];

  let commonDates = new Set(normalized[0].bars.map((bar) => bar.date));
  for (const item of normalized.slice(1)) {
    const dates = new Set(item.bars.map((bar) => bar.date));
    commonDates = new Set([...commonDates].filter((date) => dates.has(date)));
  }
  const dates = [...commonDates].sort((left, right) => left.localeCompare(right));
  const barsBySeries = normalized.map(({ series, bars }) => {
    const indexByDate = new Map(bars.map((bar, index) => [bar.date, index]));
    return { series, bars, indexByDate };
  });

  return dates.map((date, sequence) => {
    const quotes: MarketQuote[] = barsBySeries.map(({ series, bars, indexByDate }) => {
      const index = indexByDate.get(date)!;
      const bar = bars[index];
      const previousClose = bars[Math.max(0, index - 1)].close;
      return {
        symbol: series.symbol,
        name: series.name || series.symbol,
        tradable: true,
        price: bar.close,
        previousClose,
        changePercent: previousClose > 0 ? (bar.close / previousClose - 1) * 100 : 0,
        volume: Math.max(0, Math.round(bar.volume)),
        amount: bar.amount ?? undefined,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        updatedAt: `${date}T15:00:00+08:00`,
      };
    });
    return {
      mode,
      sequence: sequence + 1,
      marketTime: `${date}T15:00:00+08:00`,
      quotes,
    };
  });
}

export function splitChronologicalWindows(
  snapshots: MarketSnapshot[],
  count = WINDOW_COUNT,
): MarketSnapshot[][] {
  if (count <= 0 || snapshots.length < count * 2) return [];
  const baseSize = Math.floor(snapshots.length / count);
  return Array.from({ length: count }, (_, index) => {
    const start = index * baseSize;
    const end = index === count - 1 ? snapshots.length : start + baseSize;
    return snapshots.slice(start, end);
  });
}

type StrategyRobustnessAggregate = Pick<
  StrategyRobustnessEntry,
  | "windows"
  | "profitableWindows"
  | "totalTrades"
  | "medianReturn"
  | "worstReturn"
  | "averageMaxDrawdown"
  | "worstMaxDrawdown"
  | "averageWinRate"
>;

function stabilityGate(
  metrics: StrategyRobustnessAggregate,
): StrategyRobustnessEntry["stabilityGate"] {
  if (
    metrics.windows >= 3 &&
    metrics.profitableWindows >= 2 &&
    metrics.totalTrades >= 6 &&
    metrics.medianReturn > 0 &&
    metrics.worstMaxDrawdown <= 0.15
  ) {
    return "pass";
  }
  if (
    metrics.profitableWindows >= 1 &&
    metrics.totalTrades >= 3 &&
    metrics.worstMaxDrawdown <= 0.22
  ) {
    return "caution";
  }
  return "blocked";
}

export async function evaluateFixedStrategyProfiles(
  snapshots: MarketSnapshot[],
  profiles: StrategyRobustnessProfile[] = STRATEGY_ROBUSTNESS_PROFILES,
): Promise<StrategyRobustnessEntry[]> {
  const windows = splitChronologicalWindows(snapshots, WINDOW_COUNT);
  const entries: Array<Omit<StrategyRobustnessEntry, "rank">> = [];

  for (const profile of profiles) {
    const reports: BacktestMetrics[] = [];
    for (const window of windows) {
      const strategy = await profile.factory.create(profile.fixedParams);
      const report = new BacktestEngine(window, strategy, {
        initialCapital: 1_000_000,
        commissionRate: 0.0003,
        minimumCommission: 5,
        slippageBps: 5,
        maxOrderNotional: 200_000,
        maxPositionWeight: 0.2,
      }).run();
      reports.push(report.metrics);
    }

    const returns = reports.map((metrics) => metrics.totalReturn);
    const drawdowns = reports.map((metrics) => metrics.maxDrawdownPercent);
    const aggregate = {
      windows: reports.length,
      profitableWindows: returns.filter((value) => value > 0).length,
      totalTrades: reports.reduce((sum, metrics) => sum + metrics.totalTrades, 0),
      medianReturn: round(median(returns)),
      worstReturn: round(Math.min(...returns)),
      averageMaxDrawdown: round(average(drawdowns)),
      worstMaxDrawdown: round(Math.max(...drawdowns, 0)),
      averageWinRate: round(average(reports.map((metrics) => metrics.winRate))),
    };
    entries.push({
      strategyKey: profile.strategyKey,
      strategyName: profile.factory.name,
      strategyFamily: profile.strategyFamily,
      fixedParams: { ...profile.fixedParams },
      ...aggregate,
      stabilityGate: stabilityGate(aggregate),
    });
  }

  const gateRank = { pass: 0, caution: 1, blocked: 2 } as const;
  return entries
    .sort((left, right) =>
      gateRank[left.stabilityGate] - gateRank[right.stabilityGate] ||
      right.profitableWindows - left.profitableWindows ||
      right.medianReturn - left.medianReturn ||
      left.worstMaxDrawdown - right.worstMaxDrawdown,
    )
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function baseReport(input: BuildStrategyRobustnessInput): StrategyRobustnessReport {
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.marketDataProvider,
    sourceStatus: "degraded",
    source: {
      sampleType: "real-qfq-fixed-parameter-multi-window",
      historySource: "unavailable",
      fetchedAt: null,
      adjustment: "qfq",
      requestedDays: input.days,
      requestedSymbols: 0,
      historySymbols: 0,
      alignedTradingDays: 0,
      windowCount: WINDOW_COUNT,
    },
    methodology: {
      parametersOptimizedOnReportData: false,
      nonOverlappingWindows: true,
      minimumAlignedTradingDays: MINIMUM_ALIGNED_DAYS,
      stabilityMeaning:
        "固定参数在三个不重叠真实历史窗口分别回测；至少两窗盈利、六笔交易、中位收益为正且最差回撤不超过 15% 才通过。",
    },
    entries: [],
    warnings: [],
    guardrails: [
      "该报告使用真实前复权日线，与合成参数排行榜分开，不代表未来收益。",
      "当前股票池来自今日流动性观察池，仍存在 point-in-time 股票池和生存者偏差。",
      "固定参数没有在本报告数据上重新优化；下一阶段仍需 purged walk-forward 和成本压力测试。",
      "结果只用于研究和 shadow 评估，不直接生成本地 paper 或真实订单。",
    ],
  };
}

export async function buildStrategyRobustnessReport(
  input: BuildStrategyRobustnessInput,
): Promise<StrategyRobustnessReport> {
  const limit = Math.min(12, Math.max(2, Math.round(input.limit)));
  const days = Math.min(500, Math.max(360, Math.round(input.days)));
  const normalized = { ...input, limit, days };
  const base = baseReport(normalized);
  if (input.marketDataProvider !== "akshare") {
    return {
      ...base,
      sourceStatus: "mock-disabled",
      warnings: ["当前未启用 AkShare，真实策略稳健性验证不可用且不会使用合成历史替代。"],
    };
  }

  const universe = [...input.snapshot.quotes]
    .filter((quote) => quote.tradable && /^\d{6}$/.test(quote.symbol) && quote.price > 0)
    .sort((left, right) =>
      (right.amount ?? right.price * right.volume) -
      (left.amount ?? left.price * left.volume),
    )
    .filter((quote, index, quotes) =>
      quotes.findIndex((candidate) => candidate.symbol === quote.symbol) === index,
    )
    .slice(0, limit);
  if (universe.length < 2) {
    return { ...base, warnings: ["当前真实行情快照不足 2 只可验证股票。"] };
  }

  const historyUrl = new URL(
    `${trimTrailingSlash(input.bridgeUrl)}/api/market/stock-history`,
  );
  historyUrl.searchParams.set("symbols", universe.map((quote) => quote.symbol).join(","));
  historyUrl.searchParams.set("days", String(days));

  try {
    const history = await fetchBridgeJson<HistoricalBarsResponse>({
      url: historyUrl.toString(),
      token: input.bridgeToken,
      timeoutMs: historyBridgeTimeoutMs(input.timeoutMs),
      fetchImpl: input.fetchImpl ?? fetch,
    });
    const names = new Map(universe.map((quote) => [quote.symbol, quote.name]));
    const validSeries = history.series
      .filter((series) => series.bars.length >= MINIMUM_ALIGNED_DAYS)
      .map((series) => ({ ...series, name: names.get(series.symbol) ?? series.name }));
    const snapshots = buildAlignedHistoricalSnapshots(validSeries, input.mode);
    const warnings = [history.warning].filter((warning): warning is string => Boolean(warning));
    if (validSeries.length < universe.length) {
      warnings.push(`请求 ${universe.length} 只股票，仅 ${validSeries.length} 只达到 300 根有效日线。`);
    }
    if (snapshots.length < MINIMUM_ALIGNED_DAYS) {
      warnings.push(`共同交易日只有 ${snapshots.length} 天，少于 ${MINIMUM_ALIGNED_DAYS} 天，不运行稳健性排名。`);
      return {
        ...base,
        source: {
          ...base.source,
          historySource: history.source,
          fetchedAt: history.fetchedAt || null,
          requestedSymbols: universe.length,
          historySymbols: validSeries.length,
          alignedTradingDays: snapshots.length,
        },
        warnings,
      };
    }

    const entries = await evaluateFixedStrategyProfiles(snapshots);
    return {
      ...base,
      sourceStatus: warnings.length === 0 ? "live-read-only" : "degraded",
      source: {
        sampleType: "real-qfq-fixed-parameter-multi-window",
        historySource: history.source,
        fetchedAt: history.fetchedAt || null,
        adjustment: "qfq",
        requestedDays: days,
        requestedSymbols: universe.length,
        historySymbols: validSeries.length,
        alignedTradingDays: snapshots.length,
        windowCount: WINDOW_COUNT,
      },
      entries,
      warnings,
    };
  } catch (error) {
    return {
      ...base,
      source: { ...base.source, requestedSymbols: universe.length },
      warnings: [
        `真实策略历史样本暂不可用: ${bridgeErrorMessage(error)}`,
      ],
    };
  }
}
