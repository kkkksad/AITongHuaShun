import type { TradingMode } from "../../shared/trading";
import type {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    };
  });
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function fetchJson<T>(
  url: string,
  token: string | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
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
    fetchJson<BridgeGlobalResponse>(
      globalUrl,
      input.bridgeToken,
      input.timeoutMs * 4,
      fetchImpl,
    ),
    fetchJson<BridgeFuturesResponse>(
      futuresUrl,
      input.bridgeToken,
      input.timeoutMs * 4,
      fetchImpl,
    ),
  ]);

  const warnings: string[] = [];
  const globalResponse = globalResult.status === "fulfilled" ? globalResult.value : null;
  const futuresResponse = futuresResult.status === "fulfilled" ? futuresResult.value : null;
  if (globalResult.status === "rejected") {
    warnings.push(`全球指数暂不可用: ${errorMessage(globalResult.reason)}`);
  }
  if (futuresResult.status === "rejected") {
    warnings.push(`国内期货快照暂不可用: ${errorMessage(futuresResult.reason)}`);
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
      historyResponse = await fetchJson<HistoricalBarsResponse>(
        historyUrl.toString(),
        input.bridgeToken,
        input.timeoutMs * 12,
        fetchImpl,
      );
      if (historyResponse.warning) warnings.push(historyResponse.warning);
    } catch (error) {
      warnings.push(`国内期货连续历史暂不可用: ${errorMessage(error)}`);
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
