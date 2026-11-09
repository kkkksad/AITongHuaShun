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
  HistoricalBarsResponse,
  HistoricalSeries,
} from "./marketRegimeResearch";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";
import { historyBridgeTimeoutMs } from "./historyRequestPolicy";
import { validateStrategyHistory } from "./strategyHistoryEvidence";

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
  evaluatedSymbol: string;
  evaluatedName: string;
  windows: number;
  profitableWindows: number;
  totalTrades: number;
  medianReturn: number;
  worstReturn: number;
  averageMaxDrawdown: number;
  worstMaxDrawdown: number;
  averageWinRate: number;
  closedMatches: number;
  winningMatches: number;
  closedMatchWinRate: number | null;
  averageSharpeRatio: number;
  averageProfitFactor: number | null;
  evidenceScore: number;
  fragilityFlags: string[];
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
    testedSymbols: number;
    symbolWindowTests: number;
    alignedTradingDays: number;
    windowCount: 3;
  };
  methodology: {
    parametersOptimizedOnReportData: false;
    nonOverlappingWindows: true;
    minimumAlignedTradingDays: 300;
    stabilityMeaning: string;
    evidenceScoreMeaning: string;
  };
  entries: StrategyRobustnessEntry[];
  warnings: string[];
  guardrails: string[];
}

export interface BuildStrategyRobustnessInput {
  now?: Date;
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
    strategyKey: "kairosQualityLowVolTrend",
    strategyFamily: "trend",
    factory: builtInFactories.kairosQualityLowVolTrend,
    fixedParams: {
      fastPeriod: 20,
      slowPeriod: 60,
      qualityPeriod: 20,
      maxDailyVolatility: 0.022,
      minTrendEfficiency: 0.38,
      maxRecentDrawdown: 0.055,
      takeProfitPercent: 0.07,
      stopLossPercent: 0.03,
      targetWeight: 0.18,
    },
  },
  {
    strategyKey: "kairosVolatilityContractionBreakout",
    strategyFamily: "breakout",
    factory: builtInFactories.kairosVolatilityContractionBreakout,
    fixedParams: {
      contractionPeriod: 20,
      baselinePeriod: 40,
      maxContractionRatio: 0.62,
      breakoutPeriod: 20,
      minVolumeRatio: 1.4,
      trendPeriod: 50,
      maxEntryChangePercent: 4.8,
      takeProfitPercent: 0.08,
      stopLossPercent: 0.035,
      targetWeight: 0.16,
    },
  },
  {
    strategyKey: "kairosVolumePriceBreakout",
    strategyFamily: "breakout",
    factory: builtInFactories.kairosVolumePriceBreakout,
    fixedParams: {
      breakoutPeriod: 20,
      fastPeriod: 20,
      slowPeriod: 60,
      minVolumeRatio: 1.5,
      minIntradayPosition: 0.58,
      maxEntryChangePercent: 4.5,
      takeProfitPercent: 0.075,
      stopLossPercent: 0.03,
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

export function buildAlignedHistoricalSnapshots(
  seriesList: HistoricalSeries[],
  mode: TradingMode,
  asOf = new Date(),
): MarketSnapshot[] {
  const normalized = validateStrategyHistory(seriesList, { asOf }).series
    .map((series) => ({ series, bars: series.bars }))
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
      const volume = Math.round(bar.volume);
      return {
        symbol: series.symbol,
        name: series.name || series.symbol,
        tradable: volume > 0,
        price: bar.close,
        previousClose,
        changePercent: previousClose > 0 ? (bar.close / previousClose - 1) * 100 : 0,
        volume,
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

export interface StrategyEvidenceInput {
  windows: number;
  profitableWindows: number;
  totalTrades: number;
  worstReturn: number;
  worstMaxDrawdown: number;
}

export function assessStrategyEvidence(metrics: StrategyEvidenceInput): {
  evidenceScore: number;
  fragilityFlags: string[];
} {
  const windows = Math.max(0, metrics.windows);
  const totalTrades = Math.max(0, metrics.totalTrades);
  const fragilityFlags: string[] = [];

  if (windows < WINDOW_COUNT) fragilityFlags.push("有效窗口不足 3 个");
  if (totalTrades < 6) fragilityFlags.push("交易样本少于 6 笔");
  if (metrics.worstReturn < -0.05) fragilityFlags.push("最差窗口收益低于 -5%");
  if (metrics.worstMaxDrawdown > 0.15) fragilityFlags.push("最差回撤超过 15%");

  const coverage = clamp(windows / WINDOW_COUNT, 0, 1);
  const activity = clamp(totalTrades / 12, 0, 1);
  const consistency = windows > 0
    ? clamp(metrics.profitableWindows / windows, 0, 1)
    : 0;
  const tailReturn = clamp((metrics.worstReturn + 0.08) / 0.12, 0, 1);
  const drawdownControl = 1 - clamp(metrics.worstMaxDrawdown / 0.25, 0, 1);
  let evidenceScore = round((
    coverage * 0.15 +
    activity * 0.25 +
    consistency * 0.25 +
    tailReturn * 0.15 +
    drawdownControl * 0.2
  ) * 100, 0);

  if (windows < WINDOW_COUNT) evidenceScore = Math.min(evidenceScore, 45);
  if (totalTrades < 3) evidenceScore = Math.min(evidenceScore, 35);

  return { evidenceScore, fragilityFlags };
}

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
  if (windows.length === 0) return [];
  const entries: Array<Omit<StrategyRobustnessEntry, "rank">> = [];
  const symbols = [...new Set(snapshots.flatMap(s => s.quotes.map(q => q.symbol)))].sort().slice(0, 12);

  const names = new Map(snapshots.flatMap(s => s.quotes.map(q => [q.symbol, q.name] as const)));
  for (const { profile, symbol } of profiles.flatMap(profile => symbols.map(symbol => ({ profile, symbol })))) {
    const reports: BacktestMetrics[] = [];
    for (const window of windows) {
      // Independent strategies cannot accidentally bind the first of many
      // quotes, or borrow a different stock while this one is suspended.
      const singleSymbolWindow = window.map(snapshot => ({
        ...snapshot, quotes: snapshot.quotes.filter(q => q.symbol === symbol),
      }));
      const strategy = await profile.factory.create(profile.fixedParams);
      const report = new BacktestEngine(singleSymbolWindow, strategy, {
        initialCapital: 1_000_000,
        commissionRate: 0.0003,
        minimumCommission: 5,
        slippageBps: 5,
        maxOrderNotional: 200_000,
        maxPositionWeight: 0.2,
      }).run();
      reports.push(report.metrics);
      // Research must let health checks and unrelated API requests run.
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    const returns = reports.map((metrics) => metrics.totalReturn);
    const drawdowns = reports.map((metrics) => metrics.maxDrawdownPercent);
    const sharpeRatios = reports
      .map((metrics) => metrics.sharpeRatio)
      .filter(Number.isFinite);
    const profitFactors = reports
      .map((metrics) => metrics.profitFactor)
      .filter(Number.isFinite);
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
    const evidence = assessStrategyEvidence(aggregate);
    const winningMatches = reports.reduce((sum, metrics) => sum + metrics.winningTrades, 0);
    const closedMatches = reports.reduce((sum, metrics) => sum + metrics.winningTrades + metrics.losingTrades, 0);
    entries.push({
      strategyKey: profile.strategyKey,
      strategyName: profile.factory.name,
      strategyFamily: profile.strategyFamily,
      fixedParams: { ...profile.fixedParams },
      evaluatedSymbol: symbol,
      evaluatedName: names.get(symbol) || symbol,
      ...aggregate,
      closedMatches,
      winningMatches,
      closedMatchWinRate: closedMatches > 0 ? round(winningMatches / closedMatches) : null,
      averageSharpeRatio: round(average(sharpeRatios)),
      averageProfitFactor: profitFactors.length > 0
        ? round(average(profitFactors))
        : null,
      ...evidence,
      stabilityGate: stabilityGate(aggregate),
    });
  }

  const gateRank = { pass: 0, caution: 1, blocked: 2 } as const;
  return entries
    .sort((left, right) =>
      left.evaluatedSymbol.localeCompare(right.evaluatedSymbol) ||
      gateRank[left.stabilityGate] - gateRank[right.stabilityGate] ||
      right.evidenceScore - left.evidenceScore ||
      right.profitableWindows - left.profitableWindows ||
      right.medianReturn - left.medianReturn ||
      left.worstMaxDrawdown - right.worstMaxDrawdown,
    )
    .map((entry, index, sorted) => ({
      rank: index - sorted.findIndex(candidate => candidate.evaluatedSymbol === entry.evaluatedSymbol) + 1,
      ...entry,
    }));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function baseReport(input: BuildStrategyRobustnessInput): StrategyRobustnessReport {
  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
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
      testedSymbols: 0,
      symbolWindowTests: 0,
      alignedTradingDays: 0,
      windowCount: WINDOW_COUNT,
    },
    methodology: {
      parametersOptimizedOnReportData: false,
      nonOverlappingWindows: true,
      minimumAlignedTradingDays: MINIMUM_ALIGNED_DAYS,
      stabilityMeaning:
        "每只股票以独立账户和策略在三个不重叠真实历史窗口回测、单股排名；至少两窗盈利、六笔成交、中位收益为正且最差回撤不超过15%才通过。闭合片段胜率按费用后已闭合总数计算，未平仓盈亏只进入权益收益，不进入胜率分母。",
      evidenceScoreMeaning:
        "证据分综合窗口完整性、交易样本、一致性和尾部风险，仅衡量当前验证充分度，不是盈利概率。",
    },
    entries: [],
    warnings: [],
    guardrails: [
      "该报告使用真实前复权日线，与合成参数排行榜分开，不代表未来收益。",
      "当前股票池来自今日流动性观察池，仍存在 point-in-time 股票池和生存者偏差。",
      "固定参数没有在本报告数据上重新优化；下一阶段仍需 purged walk-forward 和成本压力测试。",
      "结果只用于研究和 shadow 评估，不直接生成本地 paper 或真实订单。",
      "只使用报告与行情快照较早时点已完成的日线；无效、重复、请求外或复权不符证据明确排除，零成交量日线只估值。",
      "逐股测试使用各自100万元研究账户，不是多股组合或当前生产资金的实现收益；不把闭合片段胜率称为整体成功率。",
    ],
  };
}

export async function buildStrategyRobustnessReport(
  input: BuildStrategyRobustnessInput,
): Promise<StrategyRobustnessReport> {
  const limit = Math.min(12, Math.max(2, Math.round(input.limit)));
  const days = Math.min(500, Math.max(360, Math.round(input.days)));
  const now = input.now ?? new Date();
  const normalized = { ...input, now, limit, days };
  const base = baseReport(normalized);
  if (input.marketDataProvider !== "akshare") {
    return {
      ...base,
      sourceStatus: "mock-disabled",
      warnings: ["当前未启用 AkShare，真实策略稳健性验证不可用且不会使用合成历史替代。"],
    };
  }
  const snapshotTime = Date.parse(input.snapshot.marketTime);
  const cutoff = Math.min(now.getTime(), snapshotTime);
  if (!Number.isFinite(cutoff)) {
    return { ...base, warnings: ["历史证据校验缺少有效行情快照时间，不运行稳健性排名。"] };
  }
  if (snapshotTime > now.getTime() + 5_000) {
    return { ...base, warnings: ["历史证据校验：行情快照时间明显晚于报告时点，不使用未来股票池。"] };
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
      cacheTtlMs: 10 * 60_000,
      fetchImpl: input.fetchImpl ?? fetch,
    });
    if (history.provider !== "akshare") {
      return { ...base, source: { ...base.source, requestedSymbols: universe.length },
        warnings: ["历史证据校验：返回供应方不是AkShare，不运行真实历史稳健性排名。"] };
    }
    const names = new Map(universe.map((quote) => [quote.symbol, quote.name]));
    const checkedHistory = validateStrategyHistory(history.series, {
      asOf: new Date(cutoff), requestedSymbols: new Set(universe.map((quote) => quote.symbol)), maxBars: days,
    });
    const validSeries = checkedHistory.series
      .filter((series) => series.bars.length >= MINIMUM_ALIGNED_DAYS)
      .map((series) => ({ ...series, name: names.get(series.symbol) ?? series.name }));
    const snapshots = buildAlignedHistoricalSnapshots(validSeries, input.mode, new Date(cutoff));
    const warnings = [history.warning, ...checkedHistory.warnings]
      .filter((warning): warning is string => Boolean(warning));
    const historySource = [...new Set(validSeries.map((series) => series.source))].sort().join(" + ") || "unavailable";
    if (validSeries.length < universe.length) {
      warnings.push(`请求 ${universe.length} 只股票，仅 ${validSeries.length} 只达到 300 根有效日线。`);
    }
    if (snapshots.length < MINIMUM_ALIGNED_DAYS) {
      warnings.push(`共同交易日只有 ${snapshots.length} 天，少于 ${MINIMUM_ALIGNED_DAYS} 天，不运行稳健性排名。`);
      return {
        ...base,
        source: {
          ...base.source,
          historySource,
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
        historySource,
        fetchedAt: history.fetchedAt || null,
        adjustment: "qfq",
        requestedDays: days,
        requestedSymbols: universe.length,
        historySymbols: validSeries.length,
        testedSymbols: new Set(entries.map(entry => entry.evaluatedSymbol)).size,
        symbolWindowTests: entries.reduce((sum, entry) => sum + entry.windows, 0),
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
