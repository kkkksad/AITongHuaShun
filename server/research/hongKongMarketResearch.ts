import type { TradingMode } from "../../shared/trading";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";
import { historyBridgeTimeoutMs } from "./historyRequestPolicy";
import type {
  HistoricalBar,
  HistoricalBarsResponse,
  HistoricalSeries,
} from "./marketRegimeResearch";

export interface HongKongQuote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  changePercent: number;
  volume: number;
  amount: number | null;
  updatedAt: string;
  source: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
}

interface HongKongQuotesResponse {
  provider: string;
  source: string;
  fetchedAt: string;
  items: HongKongQuote[];
  warning: string | null;
}

export type HongKongTrend =
  | "uptrend"
  | "recovering"
  | "range"
  | "weakening"
  | "downtrend"
  | "insufficient-data";

export interface HongKongMarketItem {
  rank: number;
  symbol: string;
  name: string;
  latestDate: string | null;
  barCount: number;
  price: number | null;
  changePercent: number | null;
  amount: number | null;
  trend: HongKongTrend;
  score: number;
  factors: {
    return5d: number;
    return20d: number;
    return60d: number;
    distanceFromMa20: number;
    distanceFromMa60: number;
    ma20Slope5d: number;
    annualizedVolatility20d: number;
    drawdownFrom20DayHigh: number;
    volumeRatio5d: number;
  };
  validation: {
    samples: number;
    upProbability5d: number | null;
    averageForwardReturn5d: number | null;
    worstForwardReturn5d: number | null;
    lastOutcomeDate: string | null;
  };
  evidence: string[];
  riskFlags: string[];
}

export interface HongKongMarketResearchReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: {
    quoteSource: string;
    historySource: string;
    fetchedAt: string | null;
    adjustment: "qfq";
    requestedDays: number;
    quoteCount: number;
    historyCount: number;
  };
  methodology: {
    version: "1.0.0";
    minimumBars: 61;
    validationHorizon: 5;
    scoreMeaning: string;
    validationMeaning: string;
    walkForward: true;
  };
  items: HongKongMarketItem[];
  warnings: string[];
  guardrails: string[];
}

export interface BuildHongKongMarketResearchInput {
  bridgeUrl: string;
  bridgeToken?: string;
  marketDataProvider: string;
  mode: TradingMode;
  limit: number;
  days: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

type Factors = HongKongMarketItem["factors"];

const MINIMUM_LOOKBACK = 60;
const VALIDATION_HORIZON = 5;
const MINIMUM_VALIDATION_SAMPLES = 20;

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
  const start = endIndex - period;
  if (start < 0 || bars[start].close <= 0) return 0;
  return bars[endIndex].close / bars[start].close - 1;
}

function computeFactors(bars: HistoricalBar[], endIndex: number): Factors | null {
  if (endIndex < MINIMUM_LOOKBACK) return null;
  const close = bars[endIndex].close;
  const ma20 = trailingAverage(bars, endIndex, 20, "close");
  const ma60 = trailingAverage(bars, endIndex, 60, "close");
  const previousMa20 = trailingAverage(bars, endIndex - 5, 20, "close");
  const returns = Array.from({ length: 20 }, (_, offset) => {
    const index = endIndex - 19 + offset;
    return bars[index].close / bars[index - 1].close - 1;
  });
  const high20 = Math.max(...bars.slice(endIndex - 19, endIndex + 1).map((bar) => bar.high));
  const volume5 = trailingAverage(bars, endIndex, 5, "volume");
  const volume20 = trailingAverage(bars, endIndex, 20, "volume");
  return {
    return5d: periodReturn(bars, endIndex, 5),
    return20d: periodReturn(bars, endIndex, 20),
    return60d: periodReturn(bars, endIndex, 60),
    distanceFromMa20: ma20 > 0 ? close / ma20 - 1 : 0,
    distanceFromMa60: ma60 > 0 ? close / ma60 - 1 : 0,
    ma20Slope5d: previousMa20 > 0 ? ma20 / previousMa20 - 1 : 0,
    annualizedVolatility20d: standardDeviation(returns) * Math.sqrt(252),
    drawdownFrom20DayHigh: high20 > 0 ? close / high20 - 1 : 0,
    volumeRatio5d: volume20 > 0 ? volume5 / volume20 : 1,
  };
}

function scoreFactors(factors: Factors): number {
  return clamp(
    50 +
      clamp(factors.return5d * 100, -8, 8) * 0.8 +
      clamp(factors.return20d * 100, -20, 20) * 0.8 +
      clamp(factors.return60d * 100, -35, 35) * 0.4 +
      (factors.distanceFromMa20 >= 0 ? 7 : -7) +
      (factors.distanceFromMa60 >= 0 ? 9 : -9) +
      clamp(factors.ma20Slope5d * 100, -5, 5) * 1.6 -
      Math.max(0, factors.annualizedVolatility20d - 0.45) * 18,
    0,
    100,
  );
}

function trendFromScore(score: number, factors: Factors): HongKongTrend {
  if (score >= 65 && factors.distanceFromMa20 > 0 && factors.distanceFromMa60 > 0) {
    return "uptrend";
  }
  if (score >= 55) return "recovering";
  if (score <= 35 && factors.distanceFromMa20 < 0 && factors.distanceFromMa60 < 0) {
    return "downtrend";
  }
  if (score <= 45) return "weakening";
  return "range";
}

function emptyFactors(): Factors {
  return {
    return5d: 0,
    return20d: 0,
    return60d: 0,
    distanceFromMa20: 0,
    distanceFromMa60: 0,
    ma20Slope5d: 0,
    annualizedVolatility20d: 0,
    drawdownFrom20DayHigh: 0,
    volumeRatio5d: 0,
  };
}

function roundedFactors(factors: Factors): Factors {
  return Object.fromEntries(
    Object.entries(factors).map(([key, value]) => [key, round(value)]),
  ) as unknown as Factors;
}

function validateTrend(
  bars: HistoricalBar[],
  targetTrend: HongKongTrend,
): HongKongMarketItem["validation"] {
  if (targetTrend === "insufficient-data") {
    return {
      samples: 0,
      upProbability5d: null,
      averageForwardReturn5d: null,
      worstForwardReturn5d: null,
      lastOutcomeDate: null,
    };
  }
  const outcomes: number[] = [];
  let lastOutcomeDate: string | null = null;
  for (
    let index = MINIMUM_LOOKBACK;
    index + VALIDATION_HORIZON < bars.length;
    index += 1
  ) {
    const factors = computeFactors(bars, index);
    if (!factors || trendFromScore(scoreFactors(factors), factors) !== targetTrend) continue;
    outcomes.push(bars[index + VALIDATION_HORIZON].close / bars[index].close - 1);
    lastOutcomeDate = bars[index + VALIDATION_HORIZON].date;
  }
  if (outcomes.length < MINIMUM_VALIDATION_SAMPLES) {
    return {
      samples: outcomes.length,
      upProbability5d: null,
      averageForwardReturn5d: null,
      worstForwardReturn5d: null,
      lastOutcomeDate,
    };
  }
  return {
    samples: outcomes.length,
    upProbability5d: round(outcomes.filter((value) => value > 0).length / outcomes.length),
    averageForwardReturn5d: round(average(outcomes)),
    worstForwardReturn5d: round(Math.min(...outcomes)),
    lastOutcomeDate,
  };
}

export function analyzeHongKongSeries(
  series: HistoricalSeries,
  quote: HongKongQuote | null,
): HongKongMarketItem {
  const bars = [...series.bars]
    .filter((bar) => bar.date && bar.close > 0 && bar.high > 0 && bar.low > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const latestDate = bars.at(-1)?.date ?? null;
  const factors = computeFactors(bars, bars.length - 1);
  const base = {
    rank: 0,
    symbol: series.symbol,
    name: quote?.name ?? series.name ?? series.symbol,
    latestDate,
    barCount: bars.length,
    price: quote?.price ?? bars.at(-1)?.close ?? null,
    changePercent: quote?.changePercent ?? null,
    amount: quote?.amount ?? null,
  };
  if (!factors) {
    return {
      ...base,
      trend: "insufficient-data",
      score: 50,
      factors: emptyFactors(),
      validation: validateTrend(bars, "insufficient-data"),
      evidence: [],
      riskFlags: [`至少需要 ${MINIMUM_LOOKBACK + 1} 根有效港股日线。`],
    };
  }

  const score = scoreFactors(factors);
  const trend = trendFromScore(score, factors);
  const validation = validateTrend(bars, trend);
  const evidence: string[] = [];
  const riskFlags: string[] = [];
  if (factors.distanceFromMa20 > 0 && factors.distanceFromMa60 > 0) {
    evidence.push("价格位于 20 日和 60 日均线上方。 ");
  } else if (factors.distanceFromMa20 < 0 && factors.distanceFromMa60 < 0) {
    riskFlags.push("价格位于 20 日和 60 日均线下方。 ");
  } else {
    evidence.push("价格位于中短期均线之间，趋势仍在确认。 ");
  }
  if (factors.ma20Slope5d > 0) evidence.push("20 日均线近 5 日继续抬升。 ");
  if (factors.annualizedVolatility20d > 0.5) riskFlags.push("20 日波动率偏高，港股短线回撤可能放大。 ");
  if (factors.drawdownFrom20DayHigh < -0.1) riskFlags.push("距离 20 日高点回撤超过 10%。 ");
  if (validation.samples < MINIMUM_VALIDATION_SAMPLES) {
    riskFlags.push(`同趋势历史样本只有 ${validation.samples} 个，不展示未来 5 日上涨频率。`);
  }

  return {
    ...base,
    trend,
    score: round(score, 1),
    factors: roundedFactors(factors),
    validation,
    evidence,
    riskFlags,
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function baseReport(input: BuildHongKongMarketResearchInput): HongKongMarketResearchReport {
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.marketDataProvider,
    sourceStatus: "degraded",
    source: {
      quoteSource: "unavailable",
      historySource: "unavailable",
      fetchedAt: null,
      adjustment: "qfq",
      requestedDays: input.days,
      quoteCount: 0,
      historyCount: 0,
    },
    methodology: {
      version: "1.0.0",
      minimumBars: 61,
      validationHorizon: VALIDATION_HORIZON,
      scoreMeaning: "0-100 为港股价格、均线、动量与波动结构的透明规则分，不是未来上涨概率。",
      validationMeaning: "未来 5 日上涨频率只统计过去相同趋势标签，至少 20 个样本才显示。",
      walkForward: true,
    },
    items: [],
    warnings: [],
    guardrails: [
      "港股行情和前复权日线只用于跨市场研究，不读取账户，也不会生成港股订单。",
      "港股没有套用 A 股 100 股整手、T+1、涨跌停或人民币费用模型。",
      "未来如建设港股 paper，必须单独实现交易日历、T+0、每手股数、港币、费用和组合风险。",
    ],
  };
}

export async function buildHongKongMarketResearch(
  input: BuildHongKongMarketResearchInput,
): Promise<HongKongMarketResearchReport> {
  const limit = Math.min(12, Math.max(1, Math.round(input.limit)));
  const days = Math.min(500, Math.max(60, Math.round(input.days)));
  const normalized = { ...input, limit, days };
  const base = baseReport(normalized);
  if (input.marketDataProvider !== "akshare") {
    return {
      ...base,
      sourceStatus: "mock-disabled",
      warnings: ["当前未启用 AkShare，真实港股研究不可用且不会使用静态行情替代。"],
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = trimTrailingSlash(input.bridgeUrl);
  let quotes: HongKongQuotesResponse;
  try {
    quotes = await fetchBridgeJson<HongKongQuotesResponse>({
      url: `${baseUrl}/api/market/hk/quotes?limit=${limit}`,
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs * 8,
      fetchImpl,
    });
  } catch (error) {
    return {
      ...base,
      warnings: [`港股快照暂不可用: ${bridgeErrorMessage(error)}`],
    };
  }
  if (quotes.items.length === 0) {
    return {
      ...base,
      source: {
        ...base.source,
        quoteSource: quotes.source,
        fetchedAt: quotes.fetchedAt || null,
      },
      warnings: [quotes.warning ?? "港股快照没有可研究标的。"],
    };
  }

  const historyUrl = new URL(`${baseUrl}/api/market/hk/history`);
  historyUrl.searchParams.set("symbols", quotes.items.map((item) => item.symbol).join(","));
  historyUrl.searchParams.set("days", String(days));
  try {
    const history = await fetchBridgeJson<HistoricalBarsResponse>({
      url: historyUrl.toString(),
      token: input.bridgeToken,
      timeoutMs: historyBridgeTimeoutMs(input.timeoutMs),
      fetchImpl,
    });
    const quoteBySymbol = new Map(quotes.items.map((item) => [item.symbol, item]));
    const items = history.series
      .map((series) => analyzeHongKongSeries(series, quoteBySymbol.get(series.symbol) ?? null))
      .sort((left, right) =>
        right.score - left.score || (right.amount ?? 0) - (left.amount ?? 0),
      )
      .map((item, index) => ({ ...item, rank: index + 1 }));
    const warnings = [quotes.warning, history.warning]
      .filter((warning): warning is string => Boolean(warning));
    if (history.series.length < quotes.items.length) {
      warnings.push(`港股快照 ${quotes.items.length} 只，仅取得 ${history.series.length} 只有效历史。`);
    }
    return {
      ...base,
      sourceStatus: warnings.length === 0 && items.length > 0
        ? "live-read-only"
        : "degraded",
      source: {
        quoteSource: quotes.source,
        historySource: history.source,
        fetchedAt: history.fetchedAt || quotes.fetchedAt || null,
        adjustment: "qfq",
        requestedDays: days,
        quoteCount: quotes.items.length,
        historyCount: history.series.length,
      },
      items,
      warnings,
    };
  } catch (error) {
    return {
      ...base,
      source: {
        ...base.source,
        quoteSource: quotes.source,
        fetchedAt: quotes.fetchedAt || null,
        quoteCount: quotes.items.length,
      },
      warnings: [
        quotes.warning,
        `港股历史日线暂不可用: ${bridgeErrorMessage(error)}`,
      ]
        .filter((warning): warning is string => Boolean(warning)),
    };
  }
}
