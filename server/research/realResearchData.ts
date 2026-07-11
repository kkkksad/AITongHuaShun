import type { MarketSnapshot, TradingMode } from "../../shared/trading";

export type ResearchSentiment = "positive" | "neutral" | "negative";
export type GlobalImpactDirection = "risk-on" | "neutral" | "risk-off";

export interface RealNewsItem {
  id: string;
  source: string;
  title: string;
  publishedAt: string;
  fetchedAt: string;
  url: string | null;
  symbols: string[];
  sentiment: ResearchSentiment;
  summary: string | null;
}

export interface GlobalMarketSignal {
  symbol: string;
  name: string;
  region: string;
  price: number;
  changePercent: number;
  updatedAt: string;
  source: string;
}

export interface RealResearchDataFeed {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "mock-disabled" | "degraded";
  news: {
    provider: string;
    source: string;
    fetchedAt: string | null;
    items: RealNewsItem[];
    warning: string | null;
  };
  globalMarkets: {
    provider: string;
    fetchedAt: string | null;
    markets: GlobalMarketSignal[];
    warning: string | null;
  };
  impact: {
    direction: GlobalImpactDirection;
    score: number;
    summary: string;
    drivers: string[];
    aShareContext: string[];
  };
  guardrails: string[];
}

interface BridgeNewsResponse {
  provider?: string;
  source?: string;
  fetchedAt?: string;
  items?: RealNewsItem[];
  warning?: string | null;
}

interface BridgeGlobalResponse {
  provider?: string;
  fetchedAt?: string;
  markets?: GlobalMarketSignal[];
  warning?: string | null;
}

export interface RealResearchDataInput {
  bridgeUrl: string;
  bridgeToken?: string;
  marketDataProvider: string;
  mode: TradingMode;
  snapshot: MarketSnapshot;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

const GLOBAL_RISK_WEIGHTS: Record<string, number> = {
  US: 1.2,
  HK: 1.4,
  JP: 0.6,
  EU: 0.5,
  GLOBAL: 0.4,
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSentiment(value: unknown): ResearchSentiment {
  return value === "positive" || value === "negative" ? value : "neutral";
}

function normalizeNewsItem(item: RealNewsItem): RealNewsItem {
  return {
    id: String(item.id),
    source: String(item.source || "unknown"),
    title: String(item.title || ""),
    publishedAt: String(item.publishedAt || item.fetchedAt || ""),
    fetchedAt: String(item.fetchedAt || ""),
    url: item.url ? String(item.url) : null,
    symbols: Array.isArray(item.symbols)
      ? item.symbols.map(String).filter(Boolean).slice(0, 8)
      : [],
    sentiment: normalizeSentiment(item.sentiment),
    summary: item.summary ? String(item.summary) : null,
  };
}

function normalizeGlobalMarket(item: GlobalMarketSignal): GlobalMarketSignal {
  return {
    symbol: String(item.symbol || item.name || "GLOBAL"),
    name: String(item.name || item.symbol || "全球市场"),
    region: String(item.region || "GLOBAL"),
    price: Number(item.price) || 0,
    changePercent: Number(item.changePercent) || 0,
    updatedAt: String(item.updatedAt || ""),
    source: String(item.source || "unknown"),
  };
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
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function buildImpact(
  markets: GlobalMarketSignal[],
  snapshot: MarketSnapshot,
): RealResearchDataFeed["impact"] {
  const weighted = markets.reduce(
    (acc, market) => {
      const weight = GLOBAL_RISK_WEIGHTS[market.region] ?? GLOBAL_RISK_WEIGHTS.GLOBAL;
      return {
        score: acc.score + clamp(market.changePercent, -5, 5) * weight,
        weight: acc.weight + weight,
      };
    },
    { score: 0, weight: 0 },
  );
  const score = weighted.weight === 0 ? 0 : weighted.score / weighted.weight;
  const direction: GlobalImpactDirection =
    score >= 0.4 ? "risk-on" : score <= -0.4 ? "risk-off" : "neutral";
  const strongest = [...markets]
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 3);
  const aShareIndices = snapshot.quotes
    .filter((quote) => !quote.tradable)
    .slice(0, 4)
    .map((quote) => `${quote.name} ${quote.changePercent.toFixed(2)}%`);

  return {
    direction,
    score: Number(score.toFixed(2)),
    summary:
      direction === "risk-on"
        ? "外围市场偏风险偏好，A 股 paper 计划可优先观察高质量强势候选，但仍需等待本地行情确认。"
        : direction === "risk-off"
          ? "外围市场偏风险规避，A 股 paper 计划应降低追涨权重，优先保护现金和等待确认。"
          : "外围市场信号中性，A 股 paper 计划主要参考本地实时行情、候选评分和风控约束。",
    drivers: strongest.map(
      (market) => `${market.name} ${market.changePercent.toFixed(2)}%`,
    ),
    aShareContext: aShareIndices,
  };
}

function unavailableFeed(input: RealResearchDataInput): RealResearchDataFeed {
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.marketDataProvider,
    sourceStatus: "mock-disabled",
    news: {
      provider: "none",
      source: "mock-disabled",
      fetchedAt: null,
      items: [],
      warning: "当前未启用 AkShare 真实只读数据源，新闻不会使用静态模拟数据替代。",
    },
    globalMarkets: {
      provider: "none",
      fetchedAt: null,
      markets: [],
      warning: "当前未启用 AkShare 真实只读数据源，全球市场影响分析暂不可用。",
    },
    impact: buildImpact([], input.snapshot),
    guardrails: [
      "该接口只读取新闻和全球市场数据，不包含账户、下单或撤单能力。",
      "真实新闻和全球指数必须保留来源、发布时间、抓取时间和降级状态。",
      "跨市场影响只用于研究和 paper 观察，不构成投资建议或真实交易授权。",
    ],
  };
}

export async function buildRealResearchDataFeed(
  input: RealResearchDataInput,
): Promise<RealResearchDataFeed> {
  if (input.marketDataProvider !== "akshare") {
    return unavailableFeed(input);
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = trimTrailingSlash(input.bridgeUrl);
  const [newsResult, globalResult] = await Promise.allSettled([
    fetchJson<BridgeNewsResponse>(
      `${baseUrl}/api/research/news?limit=20`,
      input.bridgeToken,
      input.timeoutMs,
      fetchImpl,
    ),
    fetchJson<BridgeGlobalResponse>(
      `${baseUrl}/api/market/global?limit=12`,
      input.bridgeToken,
      input.timeoutMs,
      fetchImpl,
    ),
  ]);

  const news =
    newsResult.status === "fulfilled"
      ? {
          provider: newsResult.value.provider ?? "akshare",
          source: newsResult.value.source ?? "unknown",
          fetchedAt: newsResult.value.fetchedAt ?? null,
          items: (newsResult.value.items ?? []).map(normalizeNewsItem),
          warning: newsResult.value.warning ?? null,
        }
      : {
          provider: "akshare",
          source: "unavailable",
          fetchedAt: null,
          items: [],
          warning: `真实新闻源暂不可用: ${newsResult.reason}`,
        };

  const globalMarkets =
    globalResult.status === "fulfilled"
      ? {
          provider: globalResult.value.provider ?? "akshare",
          fetchedAt: globalResult.value.fetchedAt ?? null,
          markets: (globalResult.value.markets ?? []).map(normalizeGlobalMarket),
          warning: globalResult.value.warning ?? null,
        }
      : {
          provider: "akshare",
          fetchedAt: null,
          markets: [],
          warning: `全球市场源暂不可用: ${globalResult.reason}`,
        };

  const degraded =
    Boolean(news.warning) ||
    Boolean(globalMarkets.warning) ||
    news.items.length === 0 ||
    globalMarkets.markets.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.marketDataProvider,
    sourceStatus: degraded ? "degraded" : "live-read-only",
    news,
    globalMarkets,
    impact: buildImpact(globalMarkets.markets, input.snapshot),
    guardrails: [
      "该接口只读取真实新闻和全球市场数据，不包含账户、下单或撤单能力。",
      "所有新闻必须保留来源、发布时间、抓取时间和去重依据；缺失时明确显示降级。",
      "全球市场对 A 股的影响是研究信号，需要后续历史样本验证，不能直接触发实盘交易。",
      "本地自动操作仍限定为 paper-only，并继续遵守 A 股 100 股一手和 T+1 规则。",
    ],
  };
}
