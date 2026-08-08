import type { MarketSnapshot, TradingMode } from "../../shared/trading";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";
import { historyBridgeTimeoutMs } from "./historyRequestPolicy";
import type {
  HistoricalBar,
  HistoricalBarsResponse,
  HistoricalSeries,
} from "./marketRegimeResearch";

export type TurningBias =
  | "up"
  | "down"
  | "two-way"
  | "none"
  | "insufficient-data";

export interface TurningPointValidation {
  samples: number;
  breakProbability: number | null;
  upProbability: number | null;
  downProbability: number | null;
  noBreakProbability: number | null;
  medianUpTradingDay: number | null;
  medianDownTradingDay: number | null;
  medianUpReturn: number | null;
  medianDownReturn: number | null;
  lastOutcomeDate: string | null;
}

export interface TurningPointCandidate {
  rank: number;
  symbol: string;
  name: string;
  latestDate: string | null;
  barCount: number;
  source: string;
  adjustment: string;
  bias: TurningBias;
  readinessScore: number;
  compressionScore: number;
  triggerScore: number;
  features: {
    atr14Percent: number;
    annualizedVolatility20d: number;
    bollingerBandwidth20d: number;
    rangeWidth20d: number;
    rangePosition20d: number;
    return5d: number;
    return20d: number;
    volumeRatio5d: number;
    distanceFromMa20: number;
  };
  validation: TurningPointValidation;
  evidence: string[];
  riskFlags: string[];
}

export interface TurningPointReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: {
    historySource: string;
    fetchedAt: string | null;
    adjustment: "qfq";
    requestedDays: number;
    universeCount: number;
    analyzedCount: number;
  };
  horizon: 5;
  minimumBars: 126;
  minimumSamples: 20;
  methodology: {
    version: "1.0.0";
    eventDefinition: string;
    probabilityMeaning: string;
    rankingMeaning: string;
    walkForward: true;
  };
  candidates: TurningPointCandidate[];
  warnings: string[];
  guardrails: string[];
}

export interface TurningOutcome {
  direction: "up" | "down" | "no-break";
  tradingDay: number | null;
  return: number;
}

export interface BuildTurningPointReportInput {
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

interface TurningFeatures {
  atr14Percent: number;
  annualizedVolatility20d: number;
  bollingerBandwidth20d: number;
  rangeWidth20d: number;
  rangePosition20d: number;
  return5d: number;
  return20d: number;
  volumeRatio5d: number;
  distanceFromMa20: number;
  compressionScore: number;
  triggerScore: number;
}

const FEATURE_LOOKBACK = 120;
const HORIZON = 5;
const MINIMUM_SAMPLES = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function trailingValues(
  bars: HistoricalBar[],
  endIndex: number,
  period: number,
  field: "close" | "volume",
): number[] {
  const start = endIndex - period + 1;
  if (start < 0) return [];
  return bars.slice(start, endIndex + 1).map((bar) => bar[field]);
}

function trailingAverage(
  bars: HistoricalBar[],
  endIndex: number,
  period: number,
  field: "close" | "volume",
): number {
  const values = trailingValues(bars, endIndex, period, field);
  return values.length === period ? average(values) : Number.NaN;
}

function periodReturn(bars: HistoricalBar[], endIndex: number, period: number): number {
  const start = endIndex - period;
  if (start < 0 || bars[start].close <= 0) return 0;
  return bars[endIndex].close / bars[start].close - 1;
}

function trueRange(bars: HistoricalBar[], index: number): number {
  const previousClose = bars[Math.max(0, index - 1)].close;
  return Math.max(
    bars[index].high - bars[index].low,
    Math.abs(bars[index].high - previousClose),
    Math.abs(bars[index].low - previousClose),
  );
}

function atr(bars: HistoricalBar[], endIndex: number, period = 14): number {
  const start = endIndex - period + 1;
  if (start < 1) return Number.NaN;
  return average(
    Array.from({ length: period }, (_, offset) => trueRange(bars, start + offset)),
  );
}

function dailyReturns(bars: HistoricalBar[], endIndex: number, period: number): number[] {
  const start = endIndex - period + 1;
  if (start < 1) return [];
  return Array.from({ length: period }, (_, offset) => {
    const index = start + offset;
    return bars[index].close / bars[index - 1].close - 1;
  });
}

function percentileRank(values: number[], current: number): number {
  if (values.length === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (const value of values) {
    if (value < current - 1e-12) below += 1;
    else if (Math.abs(value - current) <= 1e-12) equal += 1;
  }
  return (below + equal * 0.5) / values.length;
}

function rawCompressionMetrics(
  bars: HistoricalBar[],
  endIndex: number,
): {
  atrPercent: number;
  bandwidth: number;
  rangeWidth: number;
} | null {
  const closes = trailingValues(bars, endIndex, 20, "close");
  if (closes.length < 20 || bars[endIndex].close <= 0) return null;
  const ma20 = average(closes);
  const atr14 = atr(bars, endIndex);
  const recent = bars.slice(endIndex - 19, endIndex + 1);
  const high20 = Math.max(...recent.map((bar) => bar.high));
  const low20 = Math.min(...recent.map((bar) => bar.low));
  return {
    atrPercent: Number.isFinite(atr14) ? atr14 / bars[endIndex].close : 0,
    bandwidth: ma20 > 0 ? (standardDeviation(closes) * 4) / ma20 : 0,
    rangeWidth: (high20 - low20) / bars[endIndex].close,
  };
}

function computeFeatures(bars: HistoricalBar[], endIndex: number): TurningFeatures | null {
  if (endIndex < FEATURE_LOOKBACK) return null;
  const close = bars[endIndex].close;
  const raw = rawCompressionMetrics(bars, endIndex);
  if (!raw || close <= 0) return null;

  const historicalMetrics = Array.from({ length: 60 }, (_, offset) =>
    rawCompressionMetrics(bars, endIndex - 59 + offset),
  ).filter((item): item is NonNullable<typeof item> => item !== null);
  const atrRank = percentileRank(
    historicalMetrics.map((item) => item.atrPercent),
    raw.atrPercent,
  );
  const bandwidthRank = percentileRank(
    historicalMetrics.map((item) => item.bandwidth),
    raw.bandwidth,
  );
  const rangeRank = percentileRank(
    historicalMetrics.map((item) => item.rangeWidth),
    raw.rangeWidth,
  );

  const ma5 = trailingAverage(bars, endIndex, 5, "close");
  const ma20 = trailingAverage(bars, endIndex, 20, "close");
  const atr14 = atr(bars, endIndex);
  const convergenceDenominator = Math.max(atr14 * 2, close * 0.002);
  const convergence = 1 - clamp(Math.abs(ma5 - ma20) / convergenceDenominator, 0, 1);
  const compressionScore = clamp(
    (1 - bandwidthRank) * 35 +
      (1 - atrRank) * 30 +
      (1 - rangeRank) * 20 +
      convergence * 15,
    0,
    100,
  );

  const recent = bars.slice(endIndex - 19, endIndex + 1);
  const high20 = Math.max(...recent.map((bar) => bar.high));
  const low20 = Math.min(...recent.map((bar) => bar.low));
  const rangePosition20d = high20 > low20 ? (close - low20) / (high20 - low20) : 0.5;
  const return5d = periodReturn(bars, endIndex, 5);
  const return20d = periodReturn(bars, endIndex, 20);
  const recentVolume = trailingAverage(bars, endIndex, 5, "volume");
  const baselineVolume = trailingAverage(bars, endIndex, 20, "volume");
  const volumeRatio5d = baselineVolume > 0 ? recentVolume / baselineVolume : 1;
  const edgeReadiness = clamp(Math.abs(rangePosition20d - 0.5) * 2, 0, 1);
  const volumeReadiness = clamp((volumeRatio5d - 0.75) / 0.75, 0, 1);
  const momentumReadiness = clamp(Math.abs(return5d) / 0.04, 0, 1);
  const triggerScore = clamp(
    compressionScore * 0.45 +
      edgeReadiness * 25 +
      volumeReadiness * 20 +
      momentumReadiness * 10,
    0,
    100,
  );

  return {
    atr14Percent: raw.atrPercent,
    annualizedVolatility20d: standardDeviation(dailyReturns(bars, endIndex, 20)) * Math.sqrt(252),
    bollingerBandwidth20d: raw.bandwidth,
    rangeWidth20d: raw.rangeWidth,
    rangePosition20d,
    return5d,
    return20d,
    volumeRatio5d,
    distanceFromMa20: ma20 > 0 ? close / ma20 - 1 : 0,
    compressionScore,
    triggerScore,
  };
}

export function classifyTurningOutcome(
  bars: HistoricalBar[],
  decisionIndex: number,
  horizon = HORIZON,
): TurningOutcome {
  const recent = bars.slice(Math.max(0, decisionIndex - 19), decisionIndex + 1);
  const decisionClose = bars[decisionIndex]?.close ?? 0;
  if (recent.length < 20 || decisionClose <= 0) {
    return { direction: "no-break", tradingDay: null, return: 0 };
  }
  const high20 = Math.max(...recent.map((bar) => bar.high));
  const low20 = Math.min(...recent.map((bar) => bar.low));
  const atr14 = atr(bars, decisionIndex);
  const margin = Math.max(decisionClose * 0.0025, Number.isFinite(atr14) ? atr14 * 0.25 : 0);
  const lastIndex = Math.min(bars.length - 1, decisionIndex + horizon);

  for (let index = decisionIndex + 1; index <= lastIndex; index += 1) {
    const forwardReturn = bars[index].close / decisionClose - 1;
    if (bars[index].close > high20 + margin) {
      return { direction: "up", tradingDay: index - decisionIndex, return: forwardReturn };
    }
    if (bars[index].close < low20 - margin) {
      return { direction: "down", tradingDay: index - decisionIndex, return: forwardReturn };
    }
  }
  const finalClose = bars[lastIndex]?.close ?? decisionClose;
  return {
    direction: "no-break",
    tradingDay: null,
    return: finalClose / decisionClose - 1,
  };
}

function emptyValidation(samples = 0): TurningPointValidation {
  return {
    samples,
    breakProbability: null,
    upProbability: null,
    downProbability: null,
    noBreakProbability: null,
    medianUpTradingDay: null,
    medianDownTradingDay: null,
    medianUpReturn: null,
    medianDownReturn: null,
    lastOutcomeDate: null,
  };
}

function roundedFeatures(features: TurningFeatures): TurningPointCandidate["features"] {
  return {
    atr14Percent: round(features.atr14Percent),
    annualizedVolatility20d: round(features.annualizedVolatility20d),
    bollingerBandwidth20d: round(features.bollingerBandwidth20d),
    rangeWidth20d: round(features.rangeWidth20d),
    rangePosition20d: round(features.rangePosition20d),
    return5d: round(features.return5d),
    return20d: round(features.return20d),
    volumeRatio5d: round(features.volumeRatio5d),
    distanceFromMa20: round(features.distanceFromMa20),
  };
}

export function deriveTurningBias(
  upProbability: number,
  downProbability: number,
  noBreakProbability: number,
): Exclude<TurningBias, "insufficient-data"> {
  const breakProbability = upProbability + downProbability;
  if (breakProbability < 0.5 || noBreakProbability > breakProbability) return "none";
  if (upProbability >= downProbability + 0.12) return "up";
  if (downProbability >= upProbability + 0.12) return "down";
  return "two-way";
}

export function analyzeTurningPointSeries(
  series: HistoricalSeries,
  displayName = series.name || series.symbol,
): TurningPointCandidate {
  const bars = [...series.bars]
    .filter((bar) => bar.date && bar.close > 0 && bar.high > 0 && bar.low > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const latestDate = bars.at(-1)?.date ?? null;
  const current = computeFeatures(bars, bars.length - 1);
  const base = {
    rank: 0,
    symbol: series.symbol,
    name: displayName,
    latestDate,
    barCount: bars.length,
    source: series.source,
    adjustment: series.adjustment,
  };
  if (!current || bars.length < FEATURE_LOOKBACK + HORIZON + 1) {
    return {
      ...base,
      bias: "insufficient-data",
      readinessScore: 0,
      compressionScore: 0,
      triggerScore: 0,
      features: {
        atr14Percent: 0,
        annualizedVolatility20d: 0,
        bollingerBandwidth20d: 0,
        rangeWidth20d: 0,
        rangePosition20d: 0.5,
        return5d: 0,
        return20d: 0,
        volumeRatio5d: 0,
        distanceFromMa20: 0,
      },
      validation: emptyValidation(),
      evidence: [],
      riskFlags: [`至少需要 ${FEATURE_LOOKBACK + HORIZON + 1} 根有效日线。`],
    };
  }

  const outcomes: TurningOutcome[] = [];
  let lastOutcomeDate: string | null = null;
  for (let index = FEATURE_LOOKBACK; index + HORIZON < bars.length; index += 1) {
    const features = computeFeatures(bars, index);
    if (!features) continue;
    const compressionNear = Math.abs(features.compressionScore - current.compressionScore) <= 18;
    const positionNear = Math.abs(features.rangePosition20d - current.rangePosition20d) <= 0.3;
    if (!compressionNear || !positionNear) continue;
    outcomes.push(classifyTurningOutcome(bars, index, HORIZON));
    lastOutcomeDate = bars[index + HORIZON].date;
  }

  const evidence: string[] = [];
  const riskFlags: string[] = [];
  if (current.compressionScore >= 70) evidence.push("ATR、带宽和 20 日区间处于历史偏紧状态。");
  else if (current.compressionScore >= 55) evidence.push("波动处于收敛观察区，但尚未达到极端压缩。");
  else riskFlags.push("当前波动压缩程度一般，变盘准备度主要来自边界或量能因素。");
  if (current.rangePosition20d >= 0.75) evidence.push("收盘靠近 20 日区间上沿，向上确认条件更近。");
  else if (current.rangePosition20d <= 0.25) evidence.push("收盘靠近 20 日区间下沿，向下风险需要优先观察。");
  else evidence.push("价格位于 20 日区间中部，方向尚未确认。");
  if (current.volumeRatio5d >= 1.15) evidence.push("近 5 日量能相对 20 日基线已有抬升。");
  else riskFlags.push("量能尚未明显放大，价格离开区间后仍需成交确认。");

  if (outcomes.length < MINIMUM_SAMPLES) {
    riskFlags.unshift(`相似压缩样本只有 ${outcomes.length} 个，少于 ${MINIMUM_SAMPLES} 个，不输出经验概率。`);
    return {
      ...base,
      bias: "insufficient-data",
      readinessScore: round(Math.min(49, current.triggerScore * 0.5), 1),
      compressionScore: round(current.compressionScore, 1),
      triggerScore: round(current.triggerScore, 1),
      features: roundedFeatures(current),
      validation: emptyValidation(outcomes.length),
      evidence,
      riskFlags,
    };
  }

  const up = outcomes.filter((outcome) => outcome.direction === "up");
  const down = outcomes.filter((outcome) => outcome.direction === "down");
  const noBreak = outcomes.filter((outcome) => outcome.direction === "no-break");
  const upProbability = up.length / outcomes.length;
  const downProbability = down.length / outcomes.length;
  const noBreakProbability = noBreak.length / outcomes.length;
  const breakProbability = upProbability + downProbability;
  const bias = deriveTurningBias(upProbability, downProbability, noBreakProbability);
  const sampleConfidence = Math.min(1, outcomes.length / 60);
  const readinessScore = clamp(
    (breakProbability * 60 + current.compressionScore * 0.25 + current.triggerScore * 0.15) *
      (0.75 + sampleConfidence * 0.25),
    0,
    100,
  );
  if (bias === "two-way") riskFlags.push("历史样本上下突破接近，当前只适合等待方向确认。 ");
  if (bias === "none") riskFlags.push("相似历史状态多数未在 5 日内离开区间，不应为变盘而强行交易。 ");

  return {
    ...base,
    bias,
    readinessScore: round(readinessScore, 1),
    compressionScore: round(current.compressionScore, 1),
    triggerScore: round(current.triggerScore, 1),
    features: roundedFeatures(current),
    validation: {
      samples: outcomes.length,
      breakProbability: round(breakProbability),
      upProbability: round(upProbability),
      downProbability: round(downProbability),
      noBreakProbability: round(noBreakProbability),
      medianUpTradingDay: up.length > 0
        ? Math.round(median(up.map((outcome) => outcome.tradingDay ?? 0))!)
        : null,
      medianDownTradingDay: down.length > 0
        ? Math.round(median(down.map((outcome) => outcome.tradingDay ?? 0))!)
        : null,
      medianUpReturn: up.length > 0 ? round(median(up.map((outcome) => outcome.return))!) : null,
      medianDownReturn: down.length > 0 ? round(median(down.map((outcome) => outcome.return))!) : null,
      lastOutcomeDate,
    },
    evidence,
    riskFlags,
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function baseReport(input: BuildTurningPointReportInput): TurningPointReport {
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.marketDataProvider,
    sourceStatus: "degraded",
    source: {
      historySource: "unavailable",
      fetchedAt: null,
      adjustment: "qfq",
      requestedDays: input.days,
      universeCount: 0,
      analyzedCount: 0,
    },
    horizon: HORIZON,
    minimumBars: 126,
    minimumSamples: MINIMUM_SAMPLES,
    methodology: {
      version: "1.0.0",
      eventDefinition:
        "以决策时点冻结的 20 日高低区间为边界，叠加 0.25 ATR 与 0.25% 价格下限；随后 5 个交易日首次收盘越界定义为向上或向下变盘。",
      probabilityMeaning:
        "经验概率只统计过去压缩分数与区间位置相近的样本；至少 20 个样本才展示，不是校准后的未来保证。",
      rankingMeaning:
        "准备度综合经验变盘频率、波动压缩、区间位置、量能和样本置信度，仅用于排序。",
      walkForward: true,
    },
    candidates: [],
    warnings: [],
    guardrails: [
      "结果只扫描当前受控 A 股观察池，不代表全市场覆盖。",
      "变盘可以向上、向下或继续横盘；任何方向都必须等待收盘越界和量能确认。",
      "该接口只读，不直接生成本地 paper 或真实订单。",
    ],
  };
}

export async function buildTurningPointReport(
  input: BuildTurningPointReportInput,
): Promise<TurningPointReport> {
  const days = Math.min(500, Math.max(180, Math.round(input.days)));
  const limit = Math.min(12, Math.max(1, Math.round(input.limit)));
  const normalizedInput = { ...input, days, limit };
  const base = baseReport(normalizedInput);
  if (input.marketDataProvider !== "akshare") {
    return {
      ...base,
      sourceStatus: "mock-disabled",
      warnings: ["当前未启用 AkShare，真实变盘扫描不可用且不会返回静态候选。"],
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
  if (universe.length === 0) {
    return {
      ...base,
      warnings: ["当前行情快照没有可查询的 A 股标的。"],
    };
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
    const names = new Map(universe.map((quote) => [quote.symbol, quote.name]));
    const candidates = history.series
      .map((series) => analyzeTurningPointSeries(series, names.get(series.symbol)))
      .sort((left, right) =>
        right.readinessScore - left.readinessScore ||
        right.validation.samples - left.validation.samples,
      )
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    const warnings = [history.warning].filter((warning): warning is string => Boolean(warning));
    if (history.series.length < universe.length) {
      warnings.push(`请求 ${universe.length} 只标的，仅取得 ${history.series.length} 只有效历史。`);
    }
    return {
      ...base,
      sourceStatus: warnings.length === 0 && candidates.length > 0
        ? "live-read-only"
        : "degraded",
      source: {
        historySource: history.source,
        fetchedAt: history.fetchedAt || null,
        adjustment: "qfq",
        requestedDays: days,
        universeCount: universe.length,
        analyzedCount: candidates.length,
      },
      candidates,
      warnings,
    };
  } catch (error) {
    return {
      ...base,
      source: { ...base.source, universeCount: universe.length },
      warnings: [
        `A 股历史日线暂不可用: ${bridgeErrorMessage(error)}`,
      ],
    };
  }
}
