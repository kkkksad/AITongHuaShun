import type { TradingMode } from "../../shared/trading";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";
import { historyBridgeTimeoutMs } from "./historyRequestPolicy";
import type {
  HistoricalBar,
  HistoricalBarsResponse,
  HistoricalSeries,
} from "./marketRegimeResearch";

export type StockTrendHorizon = 3 | 5 | 10;
export type StockTrendDirection =
  | "bullish"
  | "slightly-bullish"
  | "sideways"
  | "slightly-bearish"
  | "bearish"
  | "insufficient-data";

export type StockTrendResolution =
  | "resolved"
  | "ambiguous"
  | "not-found"
  | "mock-disabled"
  | "degraded";

export interface StockSearchMatch {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  updatedAt: string;
}

interface StockSearchResponse {
  provider: string;
  source: string;
  fetchedAt: string;
  items: StockSearchMatch[];
  warning: string | null;
}

export interface StockTrendFactors {
  return5d: number;
  return20d: number;
  return60d: number;
  distanceFromMa20: number;
  distanceFromMa60: number;
  ma20Slope5d: number;
  ma60Slope5d: number;
  rsi14: number;
  annualizedVolatility20d: number;
  atr14Percent: number;
  volumeRatio5d: number;
  drawdownFrom20DayHigh: number;
}

export interface StockTrendValidation {
  samples: number;
  directionalHitRate: number | null;
  empiricalUpProbability: number | null;
  empiricalDownProbability: number | null;
  empiricalFlatProbability: number | null;
  averageForwardReturn: number | null;
  bestForwardReturn: number | null;
  worstForwardReturn: number | null;
  medianPeakTradingDay: number | null;
  medianTroughTradingDay: number | null;
  medianPeakReturn: number | null;
  medianTroughReturn: number | null;
  lastSignalDate: string | null;
  lastOutcomeDate: string | null;
}

export interface StockTrendOutlook {
  horizon: StockTrendHorizon;
  direction: StockTrendDirection;
  score: number;
  signalStrength: number;
  volatilityReferencePercent: number;
  validation: StockTrendValidation;
}

export interface StockTrendChartPoint {
  date: string;
  close: number;
  ma20: number | null;
  ma60: number | null;
}

export interface StockTrendForecastReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  query: string;
  resolution: StockTrendResolution;
  selected: StockSearchMatch | null;
  matches: StockSearchMatch[];
  source: {
    searchSource: string;
    historySource: string;
    fetchedAt: string | null;
    adjustment: "qfq";
    requestedDays: number;
    barCount: number;
  };
  latest: {
    date: string;
    close: number;
    changePercent: number;
  } | null;
  factors: StockTrendFactors | null;
  supportResistance: {
    support20: number;
    resistance20: number;
  } | null;
  horizons: StockTrendOutlook[];
  chart: StockTrendChartPoint[];
  evidence: string[];
  risks: string[];
  warnings: string[];
  methodology: {
    version: "1.0.0";
    horizons: [3, 5, 10];
    minimumBars: number;
    walkForward: true;
    scoreMeaning: string;
    validationMeaning: string;
  };
  guardrails: string[];
}

export interface AnalyzeStockTrendBarsInput {
  query: string;
  mode: TradingMode;
  provider: string;
  selected: StockSearchMatch;
  series: HistoricalSeries;
  fetchedAt: string;
  requestedDays: number;
  warnings?: string[];
}

export interface BuildStockTrendForecastInput {
  query: string;
  days: number;
  bridgeUrl: string;
  bridgeToken?: string;
  marketDataProvider: string;
  mode: TradingMode;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

const HORIZONS: [3, 5, 10] = [3, 5, 10];
const MINIMUM_BARS = 80;
const FEATURE_LOOKBACK = 65;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

function trailingAverage(
  bars: HistoricalBar[],
  endIndex: number,
  period: number,
  field: "close" | "volume",
): number {
  const start = endIndex - period + 1;
  if (start < 0) return Number.NaN;
  return average(bars.slice(start, endIndex + 1).map((bar) => bar[field]));
}

function periodReturn(bars: HistoricalBar[], endIndex: number, period: number): number {
  const startIndex = endIndex - period;
  if (startIndex < 0 || bars[startIndex].close <= 0) return 0;
  return bars[endIndex].close / bars[startIndex].close - 1;
}

function dailyReturns(bars: HistoricalBar[], endIndex: number, period: number): number[] {
  const start = Math.max(1, endIndex - period + 1);
  const values: number[] = [];
  for (let index = start; index <= endIndex; index += 1) {
    if (bars[index - 1].close > 0) {
      values.push(bars[index].close / bars[index - 1].close - 1);
    }
  }
  return values;
}

function computeRsi14(bars: HistoricalBar[], endIndex: number): number {
  let gains = 0;
  let losses = 0;
  for (let index = endIndex - 13; index <= endIndex; index += 1) {
    const change = bars[index].close - bars[index - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  if (gains === 0 && losses === 0) return 50;
  if (losses === 0) return 100;
  if (gains === 0) return 0;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function computeAtr14Percent(bars: HistoricalBar[], endIndex: number): number {
  const ranges: number[] = [];
  for (let index = endIndex - 13; index <= endIndex; index += 1) {
    const previousClose = bars[index - 1].close;
    ranges.push(Math.max(
      bars[index].high - bars[index].low,
      Math.abs(bars[index].high - previousClose),
      Math.abs(bars[index].low - previousClose),
    ));
  }
  return bars[endIndex].close > 0 ? average(ranges) / bars[endIndex].close : 0;
}

function computeFeatures(
  bars: HistoricalBar[],
  endIndex: number,
): StockTrendFactors | null {
  if (endIndex < FEATURE_LOOKBACK) return null;
  const close = bars[endIndex].close;
  const ma20 = trailingAverage(bars, endIndex, 20, "close");
  const ma60 = trailingAverage(bars, endIndex, 60, "close");
  const previousMa20 = trailingAverage(bars, endIndex - 5, 20, "close");
  const previousMa60 = trailingAverage(bars, endIndex - 5, 60, "close");
  const recentVolume = trailingAverage(bars, endIndex, 5, "volume");
  const baselineVolume = trailingAverage(bars, endIndex - 5, 20, "volume");
  const high20 = Math.max(...bars.slice(endIndex - 19, endIndex + 1).map((bar) => bar.high));

  return {
    return5d: periodReturn(bars, endIndex, 5),
    return20d: periodReturn(bars, endIndex, 20),
    return60d: periodReturn(bars, endIndex, 60),
    distanceFromMa20: ma20 > 0 ? close / ma20 - 1 : 0,
    distanceFromMa60: ma60 > 0 ? close / ma60 - 1 : 0,
    ma20Slope5d: previousMa20 > 0 ? ma20 / previousMa20 - 1 : 0,
    ma60Slope5d: previousMa60 > 0 ? ma60 / previousMa60 - 1 : 0,
    rsi14: computeRsi14(bars, endIndex),
    annualizedVolatility20d: standardDeviation(dailyReturns(bars, endIndex, 20)) * Math.sqrt(252),
    atr14Percent: computeAtr14Percent(bars, endIndex),
    volumeRatio5d: baselineVolume > 0 ? recentVolume / baselineVolume : 1,
    drawdownFrom20DayHigh: high20 > 0 ? close / high20 - 1 : 0,
  };
}

function scoreTrend(features: StockTrendFactors, horizon: StockTrendHorizon): number {
  const weights = horizon === 3
    ? { short: 1.8, medium: 0.6, long: 0.15 }
    : horizon === 5
      ? { short: 1.1, medium: 0.9, long: 0.22 }
      : { short: 0.6, medium: 0.8, long: 0.35 };
  const momentum =
    clamp(features.return5d * 100, -8, 8) * weights.short +
    clamp(features.return20d * 100, -20, 20) * weights.medium +
    clamp(features.return60d * 100, -35, 35) * weights.long;
  const structure =
    clamp(features.distanceFromMa20 * 100, -10, 10) * 1.3 +
    clamp(features.distanceFromMa60 * 100, -15, 15) * 0.55 +
    clamp(features.ma20Slope5d * 100, -6, 6) * 1.8 +
    clamp(features.ma60Slope5d * 100, -6, 6);
  const volumeConfirmation = Math.sign(features.return5d) *
    clamp((features.volumeRatio5d - 1) * 4, -4, 4);
  const rsiAdjustment = features.rsi14 >= 75
    ? -8
    : features.rsi14 >= 68
      ? -4
      : features.rsi14 <= 25
        ? 8
        : features.rsi14 <= 32
          ? 4
          : 0;
  const raw = 50 + momentum + structure + volumeConfirmation + rsiAdjustment;
  const volatilityAttenuation = clamp(
    1 - Math.max(0, features.annualizedVolatility20d - 0.4) * 0.7,
    0.65,
    1,
  );
  return clamp(50 + (raw - 50) * volatilityAttenuation, 0, 100);
}

function directionFromScore(score: number): StockTrendDirection {
  if (score >= 65) return "bullish";
  if (score >= 56) return "slightly-bullish";
  if (score <= 35) return "bearish";
  if (score <= 44) return "slightly-bearish";
  return "sideways";
}

function directionHit(
  direction: StockTrendDirection,
  forwardReturn: number,
  volatilityBand: number,
): boolean {
  if (direction === "bullish" || direction === "slightly-bullish") return forwardReturn > 0;
  if (direction === "bearish" || direction === "slightly-bearish") return forwardReturn <= 0;
  if (direction === "sideways") return Math.abs(forwardReturn) <= Math.max(0.015, volatilityBand);
  return false;
}

function validateDirection(
  bars: HistoricalBar[],
  horizon: StockTrendHorizon,
  targetDirection: StockTrendDirection,
): StockTrendValidation {
  const outcomes: number[] = [];
  const peakTradingDays: number[] = [];
  const troughTradingDays: number[] = [];
  const peakReturns: number[] = [];
  const troughReturns: number[] = [];
  let hits = 0;
  let upOutcomes = 0;
  let downOutcomes = 0;
  let flatOutcomes = 0;
  let lastSignalDate: string | null = null;
  let lastOutcomeDate: string | null = null;

  for (let index = FEATURE_LOOKBACK; index + horizon < bars.length; index += 1) {
    const features = computeFeatures(bars, index);
    if (!features) continue;
    const direction = directionFromScore(scoreTrend(features, horizon));
    if (direction !== targetDirection) continue;
    const forwardReturn = bars[index + horizon].close / bars[index].close - 1;
    const volatilityBand = features.annualizedVolatility20d /
      Math.sqrt(252) * Math.sqrt(horizon);
    const noiseThreshold = clamp(features.atr14Percent * 0.25, 0.003, 0.015);
    if (forwardReturn > noiseThreshold) upOutcomes += 1;
    else if (forwardReturn < -noiseThreshold) downOutcomes += 1;
    else flatOutcomes += 1;

    const futureCloses = bars
      .slice(index + 1, index + horizon + 1)
      .map((bar, offset) => ({ close: bar.close, tradingDay: offset + 1 }));
    const peak = futureCloses.reduce((best, item) => item.close > best.close ? item : best);
    const trough = futureCloses.reduce((best, item) => item.close < best.close ? item : best);
    peakTradingDays.push(peak.tradingDay);
    troughTradingDays.push(trough.tradingDay);
    peakReturns.push(peak.close / bars[index].close - 1);
    troughReturns.push(trough.close / bars[index].close - 1);

    outcomes.push(forwardReturn);
    hits += directionHit(direction, forwardReturn, volatilityBand) ? 1 : 0;
    lastSignalDate = bars[index].date;
    lastOutcomeDate = bars[index + horizon].date;
  }

  return {
    samples: outcomes.length,
    directionalHitRate: outcomes.length > 0 ? round(hits / outcomes.length) : null,
    empiricalUpProbability: outcomes.length > 0 ? round(upOutcomes / outcomes.length) : null,
    empiricalDownProbability: outcomes.length > 0 ? round(downOutcomes / outcomes.length) : null,
    empiricalFlatProbability: outcomes.length > 0 ? round(flatOutcomes / outcomes.length) : null,
    averageForwardReturn: outcomes.length > 0 ? round(average(outcomes)) : null,
    bestForwardReturn: outcomes.length > 0 ? round(Math.max(...outcomes)) : null,
    worstForwardReturn: outcomes.length > 0 ? round(Math.min(...outcomes)) : null,
    medianPeakTradingDay: peakTradingDays.length > 0
      ? Math.round(median(peakTradingDays)!)
      : null,
    medianTroughTradingDay: troughTradingDays.length > 0
      ? Math.round(median(troughTradingDays)!)
      : null,
    medianPeakReturn: peakReturns.length > 0 ? round(median(peakReturns)!) : null,
    medianTroughReturn: troughReturns.length > 0 ? round(median(troughReturns)!) : null,
    lastSignalDate,
    lastOutcomeDate,
  };
}

function chartPoints(bars: HistoricalBar[]): StockTrendChartPoint[] {
  const start = Math.max(0, bars.length - 90);
  return bars.slice(start).map((bar, offset) => {
    const index = start + offset;
    const ma20 = trailingAverage(bars, index, 20, "close");
    const ma60 = trailingAverage(bars, index, 60, "close");
    return {
      date: bar.date,
      close: round(bar.close, 4),
      ma20: Number.isFinite(ma20) ? round(ma20, 4) : null,
      ma60: Number.isFinite(ma60) ? round(ma60, 4) : null,
    };
  });
}

function commonMethodology(): StockTrendForecastReport["methodology"] {
  return {
    version: "1.0.0",
    horizons: HORIZONS,
    minimumBars: MINIMUM_BARS,
    walkForward: true,
    scoreMeaning: "0-100 为当前价格、均线、动量、量能与波动结构的启发式规则分，不是未来上涨概率。",
    validationMeaning: "历史命中率和经验涨跌概率只统计过去相同方向信号形成后的真实收盘；阶段高低点时间与幅度使用这些样本的中位数，不回填当前判断，也不代表保证日期。",
  };
}

function commonGuardrails(): string[] {
  return [
    "结果使用公开前复权日线，仅用于研究与本地 paper 观察，不构成个性化投资建议。",
    "趋势研判不会提交模拟或真实订单，也不会连接券商账户。",
    "历史命中率不代表未来胜率，突发公告、停复牌与涨跌停可能使技术结构失效。",
  ];
}

function baseReport(input: {
  query: string;
  mode: TradingMode;
  provider: string;
  requestedDays: number;
}): StockTrendForecastReport {
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.provider,
    sourceStatus: "degraded",
    query: input.query,
    resolution: "degraded",
    selected: null,
    matches: [],
    source: {
      searchSource: "unavailable",
      historySource: "unavailable",
      fetchedAt: null,
      adjustment: "qfq",
      requestedDays: input.requestedDays,
      barCount: 0,
    },
    latest: null,
    factors: null,
    supportResistance: null,
    horizons: [],
    chart: [],
    evidence: [],
    risks: [],
    warnings: [],
    methodology: commonMethodology(),
    guardrails: commonGuardrails(),
  };
}

function roundedFactors(features: StockTrendFactors): StockTrendFactors {
  return Object.fromEntries(
    Object.entries(features).map(([key, value]) => [key, round(value)]),
  ) as unknown as StockTrendFactors;
}

export function analyzeStockTrendBars(
  input: AnalyzeStockTrendBarsInput,
): StockTrendForecastReport {
  const bars = [...input.series.bars]
    .filter((bar) => bar.date && bar.close > 0 && bar.high > 0 && bar.low > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const base = baseReport({
    query: input.query,
    mode: input.mode,
    provider: input.provider,
    requestedDays: input.requestedDays,
  });
  const latestBar = bars.at(-1) ?? null;
  const common = {
    ...base,
    query: input.query,
    resolution: "resolved" as const,
    selected: input.selected,
    matches: [input.selected],
    source: {
      searchSource: "a-share-spot-cache",
      historySource: input.series.source,
      fetchedAt: input.fetchedAt || null,
      adjustment: "qfq" as const,
      requestedDays: input.requestedDays,
      barCount: bars.length,
    },
    latest: latestBar ? {
      date: latestBar.date,
      close: round(latestBar.close, 4),
      changePercent: round(
        latestBar.changePercent ?? (bars.length > 1
          ? (latestBar.close / bars[bars.length - 2].close - 1) * 100
          : 0),
        2,
      ),
    } : null,
    chart: chartPoints(bars),
  };

  const endIndex = bars.length - 1;
  const features = computeFeatures(bars, endIndex);
  if (!features || bars.length < MINIMUM_BARS) {
    const warning = `至少需要 ${MINIMUM_BARS} 根有效日线才能形成趋势研判，当前只有 ${bars.length} 根。`;
    return {
      ...common,
      sourceStatus: "degraded",
      factors: null,
      supportResistance: null,
      horizons: HORIZONS.map((horizon) => ({
        horizon,
        direction: "insufficient-data",
        score: 50,
        signalStrength: 0,
        volatilityReferencePercent: 0,
        validation: {
          samples: 0,
          directionalHitRate: null,
          empiricalUpProbability: null,
          empiricalDownProbability: null,
          empiricalFlatProbability: null,
          averageForwardReturn: null,
          bestForwardReturn: null,
          worstForwardReturn: null,
          medianPeakTradingDay: null,
          medianTroughTradingDay: null,
          medianPeakReturn: null,
          medianTroughReturn: null,
          lastSignalDate: null,
          lastOutcomeDate: null,
        },
      })),
      evidence: [],
      risks: [warning],
      warnings: [...(input.warnings ?? []), warning],
    };
  }

  const recent20 = bars.slice(-20);
  const support20 = Math.min(...recent20.map((bar) => bar.low));
  const resistance20 = Math.max(...recent20.map((bar) => bar.high));
  const horizons = HORIZONS.map((horizon) => {
    const score = scoreTrend(features, horizon);
    const direction = directionFromScore(score);
    return {
      horizon,
      direction,
      score: round(score, 1),
      signalStrength: round(Math.abs(score - 50) * 2, 1),
      volatilityReferencePercent: round(
        features.annualizedVolatility20d / Math.sqrt(252) * Math.sqrt(horizon),
      ),
      validation: validateDirection(bars, horizon, direction),
    };
  });

  const evidence: string[] = [];
  const risks: string[] = [];
  const conflictingHorizon = horizons.find((item) => {
    const up = item.validation.empiricalUpProbability;
    const down = item.validation.empiricalDownProbability;
    if (up === null || down === null) return false;
    const ruleIsPositive = item.direction === "bullish" || item.direction === "slightly-bullish";
    const ruleIsNegative = item.direction === "bearish" || item.direction === "slightly-bearish";
    return (ruleIsPositive && down > up + 0.1) || (ruleIsNegative && up > down + 0.1);
  });
  if (conflictingHorizon) {
    risks.push(
      `${conflictingHorizon.horizon} 日规则方向与历史经验概率明显冲突，应降低对单一技术分数的信任。`,
    );
  }
  if (features.distanceFromMa20 > 0 && features.distanceFromMa60 > 0) {
    evidence.push("价格位于 20 日和 60 日均线上方。 ");
  } else if (features.distanceFromMa20 < 0 && features.distanceFromMa60 < 0) {
    evidence.push("价格位于 20 日和 60 日均线下方，趋势结构偏弱。 ");
  } else {
    evidence.push("价格处于 20 日与 60 日均线之间，趋势尚未形成一致方向。 ");
  }
  if (features.ma20Slope5d > 0 && features.ma60Slope5d > 0) {
    evidence.push("20 日和 60 日均线近 5 日斜率均向上。 ");
  } else if (features.ma20Slope5d < 0 && features.ma60Slope5d < 0) {
    evidence.push("20 日和 60 日均线近 5 日斜率均向下。 ");
  }
  if (features.return20d > 0.05) evidence.push("近 20 日价格动量保持正向。 ");
  if (features.return20d < -0.05) risks.push("近 20 日跌幅较大，反弹前仍需确认止跌结构。 ");
  if (features.rsi14 >= 75) risks.push("RSI14 处于偏热区间，短线追高回撤风险上升。 ");
  if (features.rsi14 <= 25) risks.push("RSI14 处于超卖区，但超卖不等于已经见底。 ");
  if (features.annualizedVolatility20d > 0.45) risks.push("近 20 日波动率偏高，趋势分数稳定性下降。 ");
  if (resistance20 > 0 && resistance20 / bars[endIndex].close - 1 < 0.02) {
    risks.push("当前价格接近 20 日压力区，突破有效性需要量价确认。 ");
  }
  if (horizons.some((item) => item.validation.samples < 20)) {
    risks.push("至少一个周期的同方向历史样本少于 20 个，命中率参考价值有限。 ");
  }

  return {
    ...common,
    sourceStatus: input.warnings?.length ? "degraded" : "live-read-only",
    factors: roundedFactors(features),
    supportResistance: {
      support20: round(support20, 4),
      resistance20: round(resistance20, 4),
    },
    horizons,
    evidence,
    risks,
    warnings: input.warnings ?? [],
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export async function buildStockTrendForecast(
  input: BuildStockTrendForecastInput,
): Promise<StockTrendForecastReport> {
  const query = input.query.trim();
  const days = clamp(Math.round(input.days), 120, 500);
  const base = baseReport({
    query,
    mode: input.mode,
    provider: input.marketDataProvider,
    requestedDays: days,
  });
  if (input.marketDataProvider !== "akshare") {
    return {
      ...base,
      sourceStatus: "mock-disabled",
      resolution: "mock-disabled",
      warnings: ["当前未启用 AkShare，单股真实趋势研究不可用且不会使用静态数据替代。"],
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = trimTrailingSlash(input.bridgeUrl);
  let search: StockSearchResponse;
  try {
    const searchUrl = new URL(`${baseUrl}/api/market/stock-search`);
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("limit", "8");
    search = await fetchBridgeJson<StockSearchResponse>({
      url: searchUrl.toString(),
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs,
      cacheTtlMs: 60_000,
      fetchImpl,
    });
  } catch (error) {
    return {
      ...base,
      resolution: "degraded",
      warnings: [
        `股票名称与代码搜索暂不可用: ${bridgeErrorMessage(error)}`,
      ],
    };
  }

  const withSearch = {
    ...base,
    sourceStatus: search.source === "unavailable" ? "degraded" as const : "live-read-only" as const,
    matches: search.items,
    source: {
      ...base.source,
      searchSource: search.source,
      fetchedAt: search.fetchedAt || null,
    },
    warnings: search.warning ? [search.warning] : [],
  };
  if (search.items.length === 0) {
    return {
      ...withSearch,
      resolution: search.source === "unavailable" ? "degraded" : "not-found",
    };
  }

  const normalizedQuery = query.toLocaleLowerCase("zh-CN");
  const exactSymbol = search.items.find((item) => item.symbol === query);
  const exactName = search.items.find(
    (item) => item.name.toLocaleLowerCase("zh-CN") === normalizedQuery,
  );
  const selected = exactSymbol ?? exactName ?? (search.items.length === 1 ? search.items[0] : null);
  if (!selected) {
    return {
      ...withSearch,
      resolution: "ambiguous",
    };
  }

  try {
    const historyUrl = new URL(`${baseUrl}/api/market/stock-history`);
    historyUrl.searchParams.set("symbols", selected.symbol);
    historyUrl.searchParams.set("days", String(days));
    const history = await fetchBridgeJson<HistoricalBarsResponse>({
      url: historyUrl.toString(),
      token: input.bridgeToken,
      timeoutMs: historyBridgeTimeoutMs(input.timeoutMs),
      cacheTtlMs: 10 * 60_000,
      fetchImpl,
    });
    const series = history.series.find((item) => item.symbol === selected.symbol);
    if (!series) {
      return {
        ...withSearch,
        resolution: "degraded",
        selected,
        warnings: [
          ...withSearch.warnings,
          history.warning ?? `没有取得 ${selected.symbol} 的有效前复权日线。`,
        ],
      };
    }
    return analyzeStockTrendBars({
      query,
      mode: input.mode,
      provider: input.marketDataProvider,
      selected,
      series,
      fetchedAt: history.fetchedAt || search.fetchedAt,
      requestedDays: days,
      warnings: [search.warning, history.warning].filter((warning): warning is string => Boolean(warning)),
    });
  } catch (error) {
    return {
      ...withSearch,
      resolution: "degraded",
      selected,
      warnings: [
        ...withSearch.warnings,
        `股票历史日线暂不可用: ${bridgeErrorMessage(error)}`,
      ],
    };
  }
}
