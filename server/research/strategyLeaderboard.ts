import type { BacktestMetrics } from "../../shared/backtest";
import type { DataQualityReport, MarketQuote, MarketSnapshot } from "../../shared/trading";
import {
  builtInFactories,
  estimateGridSearchTrials,
  gridSearch,
} from "../optimizer";
import type { ObjectiveFunction, StrategyFactory } from "../optimizer/types";
import { computeDataQuality } from "../market/dataQuality";

export interface StrategyLeaderboardEntry {
  rank: number;
  strategyKey: string;
  strategyName: string;
  score: number;
  bestParams: Record<string, number>;
  metrics: Pick<
    BacktestMetrics,
    | "totalReturn"
    | "annualizedReturn"
    | "sharpeRatio"
    | "sortinoRatio"
    | "calmarRatio"
    | "maxDrawdownPercent"
    | "winRate"
    | "totalTrades"
  >;
  qualityGate: "pass" | "caution" | "blocked";
  trialCount: number;
}

export interface StrategyLeaderboardReport {
  generatedAt: string;
  /** 随机种子，保证排行榜可复现 */
  seed: number;
  source: {
    provider: string;
    mode: MarketSnapshot["mode"];
    sampleType: "synthetic-from-current-snapshot";
    quoteCount: number;
    tradableSymbols: string[];
    bars: number;
    snapshotSequence: number;
    snapshotTime: string;
  };
  /** 数据质量评分，用于判断排行榜样本可靠性 */
  dataQuality: Pick<
    DataQualityReport,
    "timestamp" | "score" | "totalSymbols"
  > & { summary: string };
  objective: { metric: ObjectiveFunction; weight: number }[];
  costModel: {
    initialCapital: number;
    commissionRate: number;
    minimumCommission: number;
    slippageBps: number;
    maxOrderNotional: number;
    maxPositionWeight: number;
  };
  guardrails: string[];
  entries: StrategyLeaderboardEntry[];
}

const DEFAULT_SEED = 42;

const objective: { metric: ObjectiveFunction; weight: number }[] = [
  { metric: "winRate", weight: 2.6 },
  { metric: "sortinoRatio", weight: 1.4 },
  { metric: "sharpeRatio", weight: 1.2 },
  { metric: "calmarRatio", weight: 1.2 },
  { metric: "totalReturn", weight: 0.8 },
  { metric: "profitFactor", weight: 0.6 },
];

const costModel = {
  initialCapital: 1_000_000,
  commissionRate: 0.0003,
  minimumCommission: 5,
  slippageBps: 5,
  maxOrderNotional: 350_000,
  maxPositionWeight: 0.35,
};

function leaderboardFactory(
  source: StrategyFactory,
  parameters: StrategyFactory["parameters"],
): StrategyFactory {
  return {
    ...source,
    parameters,
  };
}

const rankedFactories: [string, StrategyFactory][] = [
  [
    "kairosLowVolTrend",
    leaderboardFactory(builtInFactories.kairosLowVolTrend, [
      { name: "trendPeriod", type: "int", min: 20, max: 30, step: 10 },
      { name: "slowPeriod", type: "int", min: 50, max: 60, step: 10 },
      { name: "maxVolatility", type: "float", min: 0.018, max: 0.026, step: 0.008 },
      { name: "takeProfitPercent", type: "float", min: 0.03, max: 0.045, step: 0.015 },
      { name: "stopLossPercent", type: "float", min: 0.014, max: 0.022, step: 0.008 },
      { name: "targetWeight", type: "float", min: 0.12, max: 0.2, step: 0.08 },
    ]),
  ],
  [
    "kairosQuietPullback",
    leaderboardFactory(builtInFactories.kairosQuietPullback, [
      { name: "trendPeriod", type: "int", min: 20, max: 30, step: 10 },
      { name: "pullbackPeriod", type: "int", min: 6, max: 9, step: 3 },
      { name: "minPullbackPercent", type: "float", min: 0.01, max: 0.018, step: 0.008 },
      { name: "maxPullbackPercent", type: "float", min: 0.05, max: 0.07, step: 0.02 },
      { name: "maxVolumeMultiplier", type: "float", min: 1.2, max: 1.4, step: 0.2 },
      { name: "takeProfitPercent", type: "float", min: 0.028, max: 0.04, step: 0.012 },
      { name: "stopLossPercent", type: "float", min: 0.014, max: 0.02, step: 0.006 },
      { name: "targetWeight", type: "float", min: 0.12, max: 0.18, step: 0.06 },
    ]),
  ],
  [
    "kairosCapitalShield",
    leaderboardFactory(builtInFactories.kairosCapitalShield, [
      { name: "entryPeriod", type: "int", min: 18, max: 24, step: 6 },
      { name: "exitPeriod", type: "int", min: 5, max: 8, step: 3 },
      { name: "maxRecentDrawdown", type: "float", min: 0.045, max: 0.06, step: 0.015 },
      { name: "takeProfitPercent", type: "float", min: 0.025, max: 0.035, step: 0.01 },
      { name: "stopLossPercent", type: "float", min: 0.012, max: 0.018, step: 0.006 },
      { name: "cooldownBars", type: "int", min: 4, max: 6, step: 2 },
      { name: "targetWeight", type: "float", min: 0.1, max: 0.16, step: 0.06 },
    ]),
  ],
  [
    "aSharePullback",
    leaderboardFactory(builtInFactories.aSharePullback, [
      { name: "trendPeriod", type: "int", min: 20, max: 30, step: 10 },
      { name: "pullbackPeriod", type: "int", min: 5, max: 8, step: 3 },
      { name: "maxPullbackPercent", type: "float", min: 0.05, max: 0.09, step: 0.04 },
      { name: "minReboundPercent", type: "float", min: 0.004, max: 0.008, step: 0.004 },
      { name: "volumeMultiplier", type: "float", min: 1.0, max: 1.15, step: 0.15 },
      { name: "takeProfitPercent", type: "float", min: 0.03, max: 0.05, step: 0.02 },
      { name: "stopLossPercent", type: "float", min: 0.02, max: 0.035, step: 0.015 },
      { name: "targetWeight", type: "float", min: 0.2, max: 0.35, step: 0.15 },
    ]),
  ],
  [
    "movingAverageCross",
    leaderboardFactory(builtInFactories.movingAverageCross, [
      { name: "fastPeriod", type: "int", min: 5, max: 15, step: 5 },
      { name: "slowPeriod", type: "int", min: 20, max: 50, step: 15 },
      { name: "targetWeight", type: "float", min: 0.2, max: 0.8, step: 0.3 },
    ]),
  ],
  [
    "momentum",
    leaderboardFactory(builtInFactories.momentum, [
      { name: "entryPeriod", type: "int", min: 15, max: 45, step: 15 },
      { name: "exitPeriod", type: "int", min: 5, max: 20, step: 5 },
      { name: "targetWeight", type: "float", min: 0.2, max: 0.8, step: 0.3 },
    ]),
  ],
  [
    "macd",
    leaderboardFactory(builtInFactories.macd, [
      { name: "fastPeriod", type: "int", min: 8, max: 16, step: 4 },
      { name: "slowPeriod", type: "int", min: 24, max: 36, step: 6 },
      { name: "signalPeriod", type: "int", min: 7, max: 13, step: 3 },
      { name: "targetWeight", type: "float", min: 0.2, max: 0.8, step: 0.3 },
    ]),
  ],
  [
    "turtle",
    leaderboardFactory(builtInFactories.turtle, [
      { name: "entryPeriod", type: "int", min: 20, max: 50, step: 15 },
      { name: "exitPeriod", type: "int", min: 10, max: 20, step: 5 },
      { name: "trendFilterPeriod", type: "int", min: 0, max: 50, step: 25 },
      { name: "targetWeight", type: "float", min: 0.2, max: 0.8, step: 0.3 },
    ]),
  ],
  [
    "rsi",
    leaderboardFactory(builtInFactories.rsi, [
      { name: "period", type: "int", min: 8, max: 20, step: 6 },
      { name: "oversoldThreshold", type: "int", min: 25, max: 35, step: 5 },
      { name: "overboughtThreshold", type: "int", min: 65, max: 75, step: 5 },
      { name: "targetWeight", type: "float", min: 0.2, max: 0.8, step: 0.3 },
    ]),
  ],
  [
    "bollingerBands",
    leaderboardFactory(builtInFactories.bollingerBands, [
      { name: "period", type: "int", min: 15, max: 35, step: 10 },
      { name: "stdMultiplier", type: "float", min: 1.5, max: 2.5, step: 0.5 },
      { name: "targetWeight", type: "float", min: 0.2, max: 0.8, step: 0.3 },
    ]),
  ],
];

/**
 * 确定性伪随机数生成器（基于 xorshift 种子）
 * 使用 murmur3 混合种子确保历史序列可复现
 */
function nextRandom(seed: number): [number, number] {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  const nextSeed = value ^ (value >>> 14);
  return [nextSeed, (nextSeed >>> 0) / 4294967296];
}

function quoteSeed(symbol: string, baseSeed: number): number {
  let seed = baseSeed;
  for (const char of symbol) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  }
  return seed;
}

function createSyntheticHistory(
  snapshot: MarketSnapshot,
  bars: number,
  seed: number,
): MarketSnapshot[] {
  const tradableQuotes = snapshot.quotes.filter((quote) => quote.tradable && quote.price > 0);
  if (tradableQuotes.length === 0) {
    throw new Error("当前行情快照没有可交易标的，无法生成研究样本");
  }

  const baseTime = new Date(snapshot.marketTime);
  const states = new Map<string, { price: number; seed: number; baseVolume: number }>();

  for (const quote of tradableQuotes) {
    states.set(quote.symbol, {
      price: quote.previousClose > 0 ? quote.previousClose : quote.price,
      seed: quoteSeed(quote.symbol, seed),
      baseVolume: Math.max(quote.volume || 0, 1_000_000),
    });
  }

  const history: MarketSnapshot[] = [];
  for (let index = 0; index < bars; index++) {
    const quotes: MarketQuote[] = tradableQuotes.map((quote) => {
      const state = states.get(quote.symbol)!;
      const previousPrice = state.price;
      const [seedA, noiseA] = nextRandom(state.seed + index * 97);
      const [seedB, noiseB] = nextRandom(seedA + index * 131);
      const phase = (index + Number(quote.symbol.slice(-1))) % 24;
      const trendBias = Math.max(
        -0.002,
        Math.min(0.002, quote.changePercent / 100 / Math.max(bars / 4, 1)),
      );
      const symbolDrift = (Number(quote.symbol.slice(-2)) % 7 - 3) / 25_000;
      const regimeDrift =
        phase < 10
          ? 0.0045
          : phase < 14
            ? -0.009
            : phase < 18
              ? 0.012
              : phase < 21
                ? -0.002
                : 0.003;
      const shock = (noiseA - 0.5) * 0.004 + (noiseB - 0.5) * 0.002;
      const nextReturn = Math.max(
        -0.06,
        Math.min(0.06, trendBias + symbolDrift + regimeDrift + shock),
      );
      const nextPrice = Math.max(0.01, state.price * (1 + nextReturn));
      const volumePulse =
        phase >= 14 && phase < 18
          ? 1.6 + noiseA * 0.35
          : phase >= 10 && phase < 14
            ? 0.85 + noiseA * 0.12
            : 1 + noiseA * 0.15;
      state.price = nextPrice;
      state.seed = seedB;

      return {
        ...quote,
        price: Number(nextPrice.toFixed(2)),
        previousClose: Number(previousPrice.toFixed(2)),
        changePercent: Number(((nextPrice / Math.max(previousPrice, 0.01) - 1) * 100).toFixed(3)),
        volume: Math.round(state.baseVolume * volumePulse),
        updatedAt: new Date(baseTime.getTime() - (bars - index - 1) * 86_400_000).toISOString(),
      };
    });

    history.push({
      mode: snapshot.mode,
      sequence: snapshot.sequence + index + 1,
      marketTime: new Date(baseTime.getTime() - (bars - index - 1) * 86_400_000).toISOString(),
      quotes,
    });
  }

  return history;
}

/**
 * 生成数据质量摘要文本
 */
function buildQualitySummary(report: DataQualityReport): string {
  const { score } = report;
  if (score.overall >= 90) return "优秀：数据质量高，排行榜结果可靠";
  if (score.overall >= 70) return "良好：数据质量中等，少数标的可能存在停牌或异常";
  if (score.overall >= 50) return "一般：数据质量偏低，存在较多停牌/复权问题，排行榜仅供参考";
  return "较差：数据质量严重不足，排行榜结果不可靠，请检查行情源";
}

function buildQualityGate(metrics: StrategyLeaderboardEntry["metrics"]): StrategyLeaderboardEntry["qualityGate"] {
  if (metrics.totalTrades < 2 || metrics.totalReturn <= 0 || metrics.maxDrawdownPercent > 0.22) {
    return "blocked";
  }
  if (
    metrics.totalTrades < 4 ||
    metrics.maxDrawdownPercent > 0.12 ||
    metrics.sharpeRatio < 0 ||
    metrics.sortinoRatio < 0
  ) {
    return "caution";
  }
  return "pass";
}

function compareLeaderboardEntries(
  a: Omit<StrategyLeaderboardEntry, "rank">,
  b: Omit<StrategyLeaderboardEntry, "rank">,
): number {
  const gateRank = { pass: 0, caution: 1, blocked: 2 } as const;
  if (gateRank[a.qualityGate] !== gateRank[b.qualityGate]) {
    return gateRank[a.qualityGate] - gateRank[b.qualityGate];
  }
  if (Math.abs(a.metrics.maxDrawdownPercent - b.metrics.maxDrawdownPercent) > 0.005) {
    return a.metrics.maxDrawdownPercent - b.metrics.maxDrawdownPercent;
  }
  if (b.metrics.winRate !== a.metrics.winRate) {
    return b.metrics.winRate - a.metrics.winRate;
  }
  if (b.metrics.totalTrades !== a.metrics.totalTrades) {
    return b.metrics.totalTrades - a.metrics.totalTrades;
  }
  if (b.metrics.totalReturn !== a.metrics.totalReturn) {
    return b.metrics.totalReturn - a.metrics.totalReturn;
  }
  if (a.metrics.maxDrawdownPercent !== b.metrics.maxDrawdownPercent) {
    return a.metrics.maxDrawdownPercent - b.metrics.maxDrawdownPercent;
  }
  return b.score - a.score;
}

/**
 * 构建策略研究排行榜
 *
 * @param snapshot 当前市场快照
 * @param marketDataProvider 行情数据提供者标识
 * @param bars 生成的合成历史K线数量（默认90根日K）
 * @param seed 随机种子（默认42），相同种子+相同快照 → 可复现结果
 * @param requestedSymbols 请求的标的列表，用于数据质量检测
 */
export async function buildStrategyLeaderboard(
  snapshot: MarketSnapshot,
  marketDataProvider: string,
  bars = 90,
  seed = DEFAULT_SEED,
  requestedSymbols: string[] = [],
): Promise<StrategyLeaderboardReport> {
  // 1. 先做数据质量评估
  const qualityReport = computeDataQuality(
    snapshot,
    marketDataProvider,
    requestedSymbols,
    null,
  );

  // 2. 生成确定性合成历史
  const history = createSyntheticHistory(snapshot, bars, seed);
  const entries: Omit<StrategyLeaderboardEntry, "rank">[] = [];

  // 3. 运行各策略的参数搜索
  for (const [strategyKey, factory] of rankedFactories) {
    const estimatedTrials = estimateGridSearchTrials(factory.parameters);
    const report = await gridSearch(history, factory, {
      objectives: objective,
      backtest: costModel,
    });

    const metrics = {
      totalReturn: report.best.metrics.totalReturn,
      annualizedReturn: report.best.metrics.annualizedReturn,
      sharpeRatio: report.best.metrics.sharpeRatio,
      sortinoRatio: report.best.metrics.sortinoRatio,
      calmarRatio: report.best.metrics.calmarRatio,
      maxDrawdownPercent: report.best.metrics.maxDrawdownPercent,
      winRate: report.best.metrics.winRate,
      totalTrades: report.best.metrics.totalTrades,
    };

    entries.push({
      strategyKey,
      strategyName: report.strategyName,
      score: Number(report.best.score.toFixed(6)),
      bestParams: report.best.params,
      metrics,
      qualityGate: buildQualityGate(metrics),
      trialCount: Math.min(estimatedTrials, report.totalTrials),
    });
  }

  // 4. 按成功率/胜率排序，并用交易次数、收益和回撤约束过滤“虚高胜率”
  entries.sort(compareLeaderboardEntries);

  const tradableSymbols = snapshot.quotes
    .filter((quote) => quote.tradable && quote.price > 0)
    .map((quote) => quote.symbol);

  return {
    generatedAt: new Date().toISOString(),
    seed,
    source: {
      provider: marketDataProvider,
      mode: snapshot.mode,
      sampleType: "synthetic-from-current-snapshot",
      quoteCount: snapshot.quotes.length,
      tradableSymbols,
      bars,
      snapshotSequence: snapshot.sequence,
      snapshotTime: snapshot.marketTime,
    },
    dataQuality: {
      timestamp: qualityReport.timestamp,
      score: qualityReport.score,
      totalSymbols: qualityReport.totalSymbols,
      summary: buildQualitySummary(qualityReport),
    },
    objective,
    costModel,
    guardrails: [
      "排行榜只用于研究和模拟，不代表真实收益或投资建议。",
      "当前样本由最新快照生成确定性历史序列，尚未替代授权历史行情。",
      "排序优先考虑胜率/成功率，并用交易次数、正收益和最大回撤约束过滤不稳健结果。",
      "新增 A 股强势回踩确认战法：只研究上升趋势回踩后的放量反包候选，并用止盈止损控制单笔风险。",
      "真实订单执行保持关闭，任何券商接入必须经过独立审批和风控网关。",
      `数据质量评级：${buildQualitySummary(qualityReport)}`,
    ],
    entries: entries.map((entry, index) => ({ rank: index + 1, ...entry })),
  };
}
