import type { BacktestMetrics } from "../../shared/backtest";
import type { MarketQuote, MarketSnapshot } from "../../shared/trading";
import {
  builtInFactories,
  estimateGridSearchTrials,
  gridSearch,
} from "../optimizer";
import type { ObjectiveFunction, StrategyFactory } from "../optimizer/types";

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
  trialCount: number;
}

export interface StrategyLeaderboardReport {
  generatedAt: string;
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

const objective: { metric: ObjectiveFunction; weight: number }[] = [
  { metric: "totalReturn", weight: 2.5 },
  { metric: "sharpeRatio", weight: 1.2 },
  { metric: "calmarRatio", weight: 0.8 },
];

const costModel = {
  initialCapital: 1_000_000,
  commissionRate: 0.0003,
  minimumCommission: 5,
  slippageBps: 5,
  maxOrderNotional: 100_000,
  maxPositionWeight: 0.25,
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

function nextRandom(seed: number): [number, number] {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  const nextSeed = value ^ (value >>> 14);
  return [nextSeed, (nextSeed >>> 0) / 4294967296];
}

function quoteSeed(symbol: string): number {
  return [...symbol].reduce(
    (seed, char) => Math.imul(seed ^ char.charCodeAt(0), 16777619),
    2166136261,
  );
}

function createSyntheticHistory(snapshot: MarketSnapshot, bars: number): MarketSnapshot[] {
  const tradableQuotes = snapshot.quotes.filter((quote) => quote.tradable && quote.price > 0);
  if (tradableQuotes.length === 0) {
    throw new Error("当前行情快照没有可交易标的，无法生成研究样本");
  }

  const baseTime = new Date(snapshot.marketTime);
  const states = new Map<string, { price: number; seed: number; volume: number }>();

  for (const quote of tradableQuotes) {
    states.set(quote.symbol, {
      price: quote.previousClose > 0 ? quote.previousClose : quote.price,
      seed: quoteSeed(quote.symbol),
      volume: Math.max(quote.volume || 0, 1_000_000),
    });
  }

  const history: MarketSnapshot[] = [];
  for (let index = 0; index < bars; index++) {
    const quotes: MarketQuote[] = tradableQuotes.map((quote) => {
      const state = states.get(quote.symbol)!;
      const previousPrice = state.price;
      const [seedA, noiseA] = nextRandom(state.seed + index * 97);
      const [seedB, noiseB] = nextRandom(seedA + index * 131);
      const trendBias = quote.changePercent / 100 / Math.max(bars, 1);
      const symbolDrift = (Number(quote.symbol.slice(-2)) % 7 - 3) / 25_000;
      const shock = (noiseA - 0.5) * 0.018 + (noiseB - 0.5) * 0.006;
      const nextPrice = Math.max(0.01, state.price * (1 + trendBias + symbolDrift + shock));
      state.price = nextPrice;
      state.seed = seedB;
      state.volume += Math.round(10_000 + noiseA * 50_000);

      return {
        ...quote,
        price: Number(nextPrice.toFixed(2)),
        previousClose: Number(previousPrice.toFixed(2)),
        changePercent: Number(((nextPrice / Math.max(previousPrice, 0.01) - 1) * 100).toFixed(3)),
        volume: state.volume,
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

export async function buildStrategyLeaderboard(
  snapshot: MarketSnapshot,
  marketDataProvider: string,
  bars = 90,
): Promise<StrategyLeaderboardReport> {
  const history = createSyntheticHistory(snapshot, bars);
  const entries: Omit<StrategyLeaderboardEntry, "rank">[] = [];

  for (const [strategyKey, factory] of rankedFactories) {
    const estimatedTrials = estimateGridSearchTrials(factory.parameters);
    const report = await gridSearch(history, factory, {
      objectives: objective,
      backtest: costModel,
    });

    entries.push({
      strategyKey,
      strategyName: report.strategyName,
      score: Number(report.best.score.toFixed(6)),
      bestParams: report.best.params,
      metrics: {
        totalReturn: report.best.metrics.totalReturn,
        annualizedReturn: report.best.metrics.annualizedReturn,
        sharpeRatio: report.best.metrics.sharpeRatio,
        sortinoRatio: report.best.metrics.sortinoRatio,
        calmarRatio: report.best.metrics.calmarRatio,
        maxDrawdownPercent: report.best.metrics.maxDrawdownPercent,
        winRate: report.best.metrics.winRate,
        totalTrades: report.best.metrics.totalTrades,
      },
      trialCount: Math.min(estimatedTrials, report.totalTrials),
    });
  }

  entries.sort((a, b) => {
    if (b.metrics.totalReturn !== a.metrics.totalReturn) {
      return b.metrics.totalReturn - a.metrics.totalReturn;
    }
    return b.score - a.score;
  });

  const tradableSymbols = snapshot.quotes
    .filter((quote) => quote.tradable && quote.price > 0)
    .map((quote) => quote.symbol);

  return {
    generatedAt: new Date().toISOString(),
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
    objective,
    costModel,
    guardrails: [
      "排行榜只用于研究和模拟，不代表真实收益或投资建议。",
      "当前样本由最新快照生成确定性历史序列，尚未替代授权历史行情。",
      "真实订单执行保持关闭，任何券商接入必须经过独立审批和风控网关。",
    ],
    entries: entries.map((entry, index) => ({ rank: index + 1, ...entry })),
  };
}
