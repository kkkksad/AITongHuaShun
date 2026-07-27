import type { TradingMode } from "../../shared/trading";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";
import { historyBridgeTimeoutMs } from "./historyRequestPolicy";
import type {
  HistoricalBar,
  HistoricalBarsResponse,
  HistoricalSeries,
} from "./marketRegimeResearch";
import type { StrategyFamily } from "./strategyRobustness";

export type CrossMarketRiskTone = "risk-on" | "neutral" | "risk-off" | "mixed";
export type CrossMarketSignalTone = "positive" | "neutral" | "negative";
export type CrossMarketPositionPosture = "normal" | "reduced" | "cash-only";

export interface CrossMarketSignalGroup {
  tone: CrossMarketSignalTone;
  coverage: number;
  averageChangePercent: number;
  averageReturn20d: number | null;
}

export interface CrossMarketGlobalSignal extends CrossMarketSignalGroup {
  advancerRatio: number;
}

export interface CrossMarketDecisionInput {
  dataComplete: boolean;
  global: CrossMarketGlobalSignal;
  equityFutures: CrossMarketSignalGroup;
  industrialFutures: CrossMarketSignalGroup;
  preciousMetals: CrossMarketSignalGroup;
}

export interface CrossMarketDecision {
  riskTone: CrossMarketRiskTone;
  positionPosture: CrossMarketPositionPosture;
  preferredStrategyFamilies: StrategyFamily[];
  deweightedStrategyFamilies: StrategyFamily[];
  preferredStrategyKeys: string[];
  evidence: string[];
}

export interface FuturesMarketResearchItem {
  symbol: string;
  name: string;
  category: string;
  price: number;
  previousSettlement: number;
  changePercent: number;
  volume: number;
  openInterest: number;
  updatedAt: string;
  source: string;
  history: {
    source: string;
    adjustment: "continuous-main";
    latestDate: string | null;
    barCount: number;
    return5d: number | null;
    return20d: number | null;
    return60d: number | null;
    annualizedVolatility20d: number | null;
    drawdownFrom60DayHigh: number | null;
  };
  forecast: FuturesForecast;
}

export type FuturesTrendStructure = "uptrend" | "downtrend" | "range" | "unknown";
export type FuturesForecastDirection = "bullish" | "bearish" | "range" | "insufficient";

export interface FuturesForecast {
  horizonDays: 5;
  direction: FuturesForecastDirection;
  structure: FuturesTrendStructure;
  sampleQuality: "strong" | "usable" | "insufficient";
  sampleSize: number;
  upFrequency: number | null;
  downFrequency: number | null;
  rangeFrequency: number | null;
  medianForwardReturn: number | null;
  medianMaxFavorableMove: number | null;
  medianMaxAdverseMove: number | null;
  moveThreshold: number | null;
  currentReturn20d: number | null;
  currentVolatility20d: number | null;
  evidence: string[];
  invalidation: string;
}

export interface CrossMarketStrategyContextReport extends CrossMarketDecision {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: {
    globalSource: string;
    futuresQuoteSource: string;
    futuresHistorySource: string;
    fetchedAt: string | null;
    requestedDays: number;
    globalCount: number;
    futuresQuoteCount: number;
    futuresHistoryCount: number;
  };
  signals: {
    global: CrossMarketGlobalSignal;
    equityFutures: CrossMarketSignalGroup;
    industrialFutures: CrossMarketSignalGroup;
    preciousMetals: CrossMarketSignalGroup;
  };
  futures: FuturesMarketResearchItem[];
  warnings: string[];
  guardrails: string[];
}

export interface BuildCrossMarketStrategyContextInput {
  bridgeUrl: string;
  bridgeToken?: string;
  marketDataProvider: string;
  mode: TradingMode;
  limit: number;
  days: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface BridgeGlobalMarket {
  symbol: string;
  name: string;
  region: string;
  price: number;
  changePercent: number;
  updatedAt: string;
  source: string;
}

interface BridgeGlobalResponse {
  provider: string;
  fetchedAt: string;
  markets: BridgeGlobalMarket[];
  warning?: string | null;
}

interface BridgeFuturesQuote {
  symbol: string;
  name: string;
  category: string;
  price: number;
  previousSettlement: number;
  changePercent: number;
  volume: number;
  openInterest: number;
  updatedAt: string;
  source: string;
}

interface BridgeFuturesResponse {
  provider: string;
  source: string;
  fetchedAt: string;
  items: BridgeFuturesQuote[];
  warning?: string | null;
}

const industrialCategories = new Set(["有色", "黑色", "能源化工"]);
const signalToneLabels: Record<CrossMarketSignalTone, string> = {
  positive: "偏强",
  neutral: "中性",
  negative: "偏弱",
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function movingAverageAt(closes: number[], index: number, period: number): number | null {
  if (index + 1 < period) return null;
  return average(closes.slice(index + 1 - period, index + 1));
}

function returnAt(closes: number[], index: number, period: number): number | null {
  if (index < period || closes[index - period] <= 0) return null;
  return closes[index] / closes[index - period] - 1;
}

function volatilityAt(closes: number[], index: number, period = 20): number | null {
  if (index < period) return null;
  const sample = closes.slice(index - period, index + 1);
  const returns = sample.slice(1).map((close, offset) => close / sample[offset] - 1);
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) * Math.sqrt(252);
}

function structureAt(closes: number[], index: number): FuturesTrendStructure {
  const ma20 = movingAverageAt(closes, index, 20);
  const ma60 = movingAverageAt(closes, index, 60);
  const return20d = returnAt(closes, index, 20);
  if (ma20 === null || ma60 === null || return20d === null) return "unknown";
  const close = closes[index];
  if (close > ma20 && ma20 > ma60 * 1.003 && return20d > 0.01) return "uptrend";
  if (close < ma20 && ma20 < ma60 * 0.997 && return20d < -0.01) return "downtrend";
  return "range";
}

function volatilityBucket(value: number | null): "low" | "normal" | "high" | "unknown" {
  if (value === null) return "unknown";
  if (value < 0.16) return "low";
  if (value > 0.32) return "high";
  return "normal";
}

function forecastInvalidation(direction: FuturesForecastDirection): string {
  if (direction === "bullish") return "收盘跌破 20 日均线且 20 日动量转负时，本研判失效。";
  if (direction === "bearish") return "收盘站上 20 日均线且 20 日动量转正时，本研判失效。";
  if (direction === "range") return "收盘有效突破近 60 日区间且波动显著扩张时，震荡研判失效。";
  return "历史条件样本少于 20 个，不形成方向研判。";
}

export function buildFuturesForecast(inputBars: HistoricalBar[]): FuturesForecast {
  const horizonDays = 5 as const;
  const bars = [...inputBars]
    .filter((bar) => bar.date && bar.close > 0 && bar.high > 0 && bar.low > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const closes = bars.map((bar) => bar.close);
  const latestIndex = closes.length - 1;
  const structure = latestIndex >= 0 ? structureAt(closes, latestIndex) : "unknown";
  const currentReturn20d = latestIndex >= 0 ? returnAt(closes, latestIndex, 20) : null;
  const currentVolatility20d = latestIndex >= 0 ? volatilityAt(closes, latestIndex) : null;
  const currentVolatilityBucket = volatilityBucket(currentVolatility20d);
  const candidates: number[] = [];
  const broaderCandidates: number[] = [];

  for (let index = 59; index + horizonDays < bars.length; index += horizonDays) {
    const candidateStructure = structureAt(closes, index);
    if (candidateStructure !== structure || structure === "unknown") continue;
    broaderCandidates.push(index);
    if (volatilityBucket(volatilityAt(closes, index)) === currentVolatilityBucket) candidates.push(index);
  }

  const selected = candidates.length >= 20 ? candidates : broaderCandidates;
  const dailyVolatility = currentVolatility20d === null ? 0 : currentVolatility20d / Math.sqrt(252);
  const moveThreshold = Math.max(0.008, dailyVolatility * Math.sqrt(horizonDays) * 0.35);
  const outcomes = selected.map((index) => {
    const entry = bars[index].close;
    const forward = bars.slice(index + 1, index + horizonDays + 1);
    return {
      return: forward.at(-1)!.close / entry - 1,
      favorable: Math.max(...forward.map((bar) => bar.high)) / entry - 1,
      adverse: Math.min(...forward.map((bar) => bar.low)) / entry - 1,
    };
  });
  const sampleSize = outcomes.length;
  const evidence = [
    `${sampleSize} 个不重叠历史条件样本，预测窗口为未来 ${horizonDays} 个交易日。`,
    candidates.length >= 20
      ? "样本同时匹配当前趋势结构与波动分层。"
      : "严格波动分层样本不足，样本仅匹配当前趋势结构。",
  ];

  if (sampleSize < 20) {
    return {
      horizonDays,
      direction: "insufficient",
      structure,
      sampleQuality: "insufficient",
      sampleSize,
      upFrequency: null,
      downFrequency: null,
      rangeFrequency: null,
      medianForwardReturn: null,
      medianMaxFavorableMove: null,
      medianMaxAdverseMove: null,
      moveThreshold: null,
      currentReturn20d: currentReturn20d === null ? null : round(currentReturn20d),
      currentVolatility20d: currentVolatility20d === null ? null : round(currentVolatility20d),
      evidence,
      invalidation: forecastInvalidation("insufficient"),
    };
  }

  const upFrequency = outcomes.filter((outcome) => outcome.return > moveThreshold).length / sampleSize;
  const downFrequency = outcomes.filter((outcome) => outcome.return < -moveThreshold).length / sampleSize;
  const rangeFrequency = 1 - upFrequency - downFrequency;
  const direction: FuturesForecastDirection =
    upFrequency >= 0.48 && upFrequency - downFrequency >= 0.12
      ? "bullish"
      : downFrequency >= 0.48 && downFrequency - upFrequency >= 0.12
        ? "bearish"
        : "range";

  return {
    horizonDays,
    direction,
    structure,
    sampleQuality: sampleSize >= 40 ? "strong" : "usable",
    sampleSize,
    upFrequency: round(upFrequency),
    downFrequency: round(downFrequency),
    rangeFrequency: round(rangeFrequency),
    medianForwardReturn: round(median(outcomes.map((outcome) => outcome.return)) ?? 0),
    medianMaxFavorableMove: round(median(outcomes.map((outcome) => outcome.favorable)) ?? 0),
    medianMaxAdverseMove: round(median(outcomes.map((outcome) => outcome.adverse)) ?? 0),
    moveThreshold: round(moveThreshold),
    currentReturn20d: currentReturn20d === null ? null : round(currentReturn20d),
    currentVolatility20d: currentVolatility20d === null ? null : round(currentVolatility20d),
    evidence,
    invalidation: forecastInvalidation(direction),
  };
}

export function summarizeGlobalMarkets(
  markets: Array<{ changePercent: number }>,
): CrossMarketGlobalSignal {
  const valid = markets.filter((market) => Number.isFinite(market.changePercent));
  const changes = valid.map((market) => market.changePercent);
  const averageChangePercent = average(changes);
  const advancerRatio = valid.length === 0
    ? 0
    : changes.filter((change) => change > 0).length / valid.length;
  const tone: CrossMarketSignalTone =
    averageChangePercent >= 0.35 && advancerRatio >= 0.6
      ? "positive"
      : averageChangePercent <= -0.35 && advancerRatio <= 0.4
        ? "negative"
        : "neutral";
  return {
    tone,
    coverage: valid.length,
    averageChangePercent: round(averageChangePercent),
    averageReturn20d: null,
    advancerRatio: round(advancerRatio),
  };
}

function summarizeFuturesGroup(
  items: FuturesMarketResearchItem[],
): CrossMarketSignalGroup {
  const changes = items.map((item) => item.changePercent);
  const returns20d = items
    .map((item) => item.history.return20d)
    .filter((value): value is number => value !== null);
  const averageChangePercent = average(changes);
  const averageReturn20d = returns20d.length > 0 ? average(returns20d) : null;
  const tone: CrossMarketSignalTone =
    averageChangePercent >= 0.25 && (averageReturn20d ?? 0) >= 0.01
      ? "positive"
      : averageChangePercent <= -0.25 && (averageReturn20d ?? 0) <= -0.01
        ? "negative"
        : "neutral";
  return {
    tone,
    coverage: items.length,
    averageChangePercent: round(averageChangePercent),
    averageReturn20d: averageReturn20d === null ? null : round(averageReturn20d),
  };
}

export function deriveCrossMarketDecision(
  input: CrossMarketDecisionInput,
): CrossMarketDecision {
  const evidence = [
    `全球指数${signalToneLabels[input.global.tone]}，平均涨跌 ${input.global.averageChangePercent.toFixed(2)}%，上涨占比 ${(input.global.advancerRatio * 100).toFixed(0)}%。`,
    `股指期货${signalToneLabels[input.equityFutures.tone]}，当期平均涨跌 ${input.equityFutures.averageChangePercent.toFixed(2)}%。`,
    `工业品期货${signalToneLabels[input.industrialFutures.tone]}，20 日平均收益 ${input.industrialFutures.averageReturn20d === null ? "不可用" : `${(input.industrialFutures.averageReturn20d * 100).toFixed(2)}%`}。`,
    `贵金属${signalToneLabels[input.preciousMetals.tone]}，20 日平均收益 ${input.preciousMetals.averageReturn20d === null ? "不可用" : `${(input.preciousMetals.averageReturn20d * 100).toFixed(2)}%`}。`,
  ];

  if (!input.dataComplete) {
    return {
      riskTone: "mixed",
      positionPosture: "cash-only",
      preferredStrategyFamilies: ["defensive"],
      deweightedStrategyFamilies: ["trend", "breakout", "pullback", "mean-reversion"],
      preferredStrategyKeys: [],
      evidence: ["跨市场真实来源覆盖不足，保持现金和只观察。", ...evidence],
    };
  }

  if (
    input.global.tone === "positive" &&
    (input.equityFutures.tone === "positive" || input.industrialFutures.tone === "positive")
  ) {
    return {
      riskTone: "risk-on",
      positionPosture: "normal",
      preferredStrategyFamilies: ["trend", "breakout", "pullback"],
      deweightedStrategyFamilies: ["mean-reversion", "defensive"],
      preferredStrategyKeys: ["kairosLowVolTrend", "turtle", "kairosQuietPullback"],
      evidence,
    };
  }

  if (input.global.tone === "negative" && input.equityFutures.tone === "negative") {
    return {
      riskTone: "risk-off",
      positionPosture: "reduced",
      preferredStrategyFamilies: ["defensive"],
      deweightedStrategyFamilies: ["trend", "breakout", "pullback", "mean-reversion"],
      preferredStrategyKeys: ["kairosCapitalShield"],
      evidence,
    };
  }

  const sourcesConflict =
    (input.global.tone === "positive" && input.equityFutures.tone === "negative") ||
    (input.global.tone === "negative" && input.equityFutures.tone === "positive");
  if (sourcesConflict) {
    return {
      riskTone: "mixed",
      positionPosture: "cash-only",
      preferredStrategyFamilies: ["defensive"],
      deweightedStrategyFamilies: ["trend", "breakout", "pullback", "mean-reversion"],
      preferredStrategyKeys: [],
      evidence: ["全球指数与国内股指期货方向冲突，不强行选择方向。", ...evidence],
    };
  }

  return {
    riskTone: "neutral",
    positionPosture: "reduced",
    preferredStrategyFamilies: ["mean-reversion", "pullback", "defensive"],
    deweightedStrategyFamilies: ["breakout"],
    preferredStrategyKeys: ["rsi", "bollingerBands", "kairosQuietPullback"],
    evidence,
  };
}

function sortedBars(series: HistoricalSeries | undefined) {
  return [...(series?.bars ?? [])]
    .filter((bar) => bar.date && bar.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function periodReturn(closes: number[], period: number): number | null {
  if (closes.length <= period) return null;
  const previous = closes[closes.length - 1 - period];
  return previous > 0 ? closes[closes.length - 1] / previous - 1 : null;
}

function volatility20(closes: number[]): number | null {
  if (closes.length < 21) return null;
  const sample = closes.slice(-21);
  const returns = sample.slice(1).map((close, index) => close / sample[index] - 1);
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) * Math.sqrt(252);
}
function buildFuturesItems(
  quotes: BridgeFuturesQuote[],
  history: HistoricalBarsResponse | null,
): FuturesMarketResearchItem[] {
  const historyBySymbol = new Map(
    (history?.series ?? []).map((series) => [series.symbol, series]),
  );
  return quotes.map((quote) => {
    const series = historyBySymbol.get(quote.symbol);
    const bars = sortedBars(series);
    const closes = bars.map((bar) => bar.close);
    const high60 = closes.length > 0 ? Math.max(...closes.slice(-60)) : null;
    const latestClose = closes.at(-1) ?? null;
    return {
      ...quote,
      history: {
        source: series?.source ?? "unavailable",
        adjustment: "continuous-main",
        latestDate: bars.at(-1)?.date ?? null,
        barCount: bars.length,
        return5d: periodReturn(closes, 5),
        return20d: periodReturn(closes, 20),
        return60d: periodReturn(closes, 60),
        annualizedVolatility20d: volatility20(closes),
        drawdownFrom60DayHigh:
          high60 && latestClose ? latestClose / high60 - 1 : null,
      },
      forecast: buildFuturesForecast(bars),
    };
  });
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function emptySignals() {
  const group: CrossMarketSignalGroup = {
    tone: "neutral",
    coverage: 0,
    averageChangePercent: 0,
    averageReturn20d: null,
  };
  return {
    global: { ...group, advancerRatio: 0 } satisfies CrossMarketGlobalSignal,
    equityFutures: { ...group },
    industrialFutures: { ...group },
    preciousMetals: { ...group },
  };
}

function baseReport(
  input: BuildCrossMarketStrategyContextInput,
): CrossMarketStrategyContextReport {
  const signals = emptySignals();
  const decision = deriveCrossMarketDecision({ dataComplete: false, ...signals });
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.marketDataProvider,
    sourceStatus: "degraded",
    source: {
      globalSource: "unavailable",
      futuresQuoteSource: "unavailable",
      futuresHistorySource: "unavailable",
      fetchedAt: null,
      requestedDays: input.days,
      globalCount: 0,
      futuresQuoteCount: 0,
      futuresHistoryCount: 0,
    },
    signals,
    futures: [],
    warnings: [],
    guardrails: [
      "全球指数和期货只用于解释市场状态与选择研究策略族，不直接生成订单。",
      "主连连续序列不等于可交易具体合约，未计入换月、保证金、夜盘和交割约束。",
      "数据缺失或来源冲突时保持现金和只观察，不使用静态价格补位。",
      "期货行情读取不接触期货账户，也不会改变 A 股本地 paper 或真实仓位。",
    ],
    ...decision,
  };
}

export async function buildCrossMarketStrategyContext(
  input: BuildCrossMarketStrategyContextInput,
): Promise<CrossMarketStrategyContextReport> {
  const limit = Math.min(16, Math.max(4, Math.round(input.limit)));
  const days = Math.min(500, Math.max(60, Math.round(input.days)));
  const normalized = { ...input, limit, days };
  const base = baseReport(normalized);
  if (input.marketDataProvider !== "akshare") {
    return {
      ...base,
      sourceStatus: "mock-disabled",
      warnings: ["当前未启用 AkShare，不会使用静态跨市场数据替代真实全球指数和期货。"],
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = trimTrailingSlash(input.bridgeUrl);
  const globalUrl = `${baseUrl}/api/market/global?limit=${limit}`;
  const futuresUrl = `${baseUrl}/api/market/futures/quotes?limit=${limit}`;
  const [globalResult, futuresResult] = await Promise.allSettled([
    fetchBridgeJson<BridgeGlobalResponse>({
      url: globalUrl,
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs * 4,
      fetchImpl,
    }),
    fetchBridgeJson<BridgeFuturesResponse>({
      url: futuresUrl,
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs * 4,
      fetchImpl,
    }),
  ]);

  const warnings: string[] = [];
  const globalResponse = globalResult.status === "fulfilled" ? globalResult.value : null;
  const futuresResponse = futuresResult.status === "fulfilled" ? futuresResult.value : null;
  if (globalResult.status === "rejected") {
    warnings.push(`全球指数暂不可用: ${bridgeErrorMessage(globalResult.reason)}`);
  }
  if (futuresResult.status === "rejected") {
    warnings.push(`国内期货快照暂不可用: ${bridgeErrorMessage(futuresResult.reason)}`);
  }
  if (globalResponse?.warning) warnings.push(globalResponse.warning);
  if (futuresResponse?.warning) warnings.push(futuresResponse.warning);

  let historyResponse: HistoricalBarsResponse | null = null;
  const symbols = (futuresResponse?.items ?? []).map((item) => item.symbol);
  if (symbols.length > 0) {
    const historyUrl = new URL(`${baseUrl}/api/market/futures/history`);
    historyUrl.searchParams.set("symbols", symbols.join(","));
    historyUrl.searchParams.set("days", String(days));
    try {
      historyResponse = await fetchBridgeJson<HistoricalBarsResponse>({
        url: historyUrl.toString(),
        token: input.bridgeToken,
        timeoutMs: historyBridgeTimeoutMs(input.timeoutMs),
        fetchImpl,
      });
      if (historyResponse.warning) warnings.push(historyResponse.warning);
    } catch (error) {
      warnings.push(`国内期货连续历史暂不可用: ${bridgeErrorMessage(error)}`);
    }
  } else {
    warnings.push("国内期货快照为空，未请求连续历史。");
  }

  const futures = buildFuturesItems(futuresResponse?.items ?? [], historyResponse);
  const signals = {
    global: summarizeGlobalMarkets(globalResponse?.markets ?? []),
    equityFutures: summarizeFuturesGroup(
      futures.filter((item) => item.category === "股指"),
    ),
    industrialFutures: summarizeFuturesGroup(
      futures.filter((item) => industrialCategories.has(item.category)),
    ),
    preciousMetals: summarizeFuturesGroup(
      futures.filter((item) => item.category === "贵金属"),
    ),
  };
  const historyCount = historyResponse?.series.length ?? 0;
  const dataComplete =
    signals.global.coverage >= 3 &&
    signals.equityFutures.coverage >= 2 &&
    signals.industrialFutures.coverage >= 2 &&
    historyCount >= 4;
  const decision = deriveCrossMarketDecision({ dataComplete, ...signals });
  const globalSources = [...new Set(
    (globalResponse?.markets ?? []).map((market) => market.source),
  )];

  return {
    ...base,
    ...decision,
    sourceStatus: dataComplete && warnings.length === 0 ? "live-read-only" : "degraded",
    source: {
      globalSource: globalSources.join("+") || "unavailable",
      futuresQuoteSource: futuresResponse?.source ?? "unavailable",
      futuresHistorySource: historyResponse?.source ?? "unavailable",
      fetchedAt: historyResponse?.fetchedAt ?? futuresResponse?.fetchedAt ?? globalResponse?.fetchedAt ?? null,
      requestedDays: days,
      globalCount: globalResponse?.markets.length ?? 0,
      futuresQuoteCount: futuresResponse?.items.length ?? 0,
      futuresHistoryCount: historyCount,
    },
    signals,
    futures,
    warnings,
  };
}
