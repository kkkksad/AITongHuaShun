import type { MarketSnapshot, TradingMode } from "../../shared/trading";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";

export type ResearchSentiment = "positive" | "neutral" | "negative";
export type ResearchNewsCategory = "macro" | "market" | "company";
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
  category: ResearchNewsCategory;
}

export interface RealNewsSourceCoverage {
  source: string;
  category: ResearchNewsCategory;
  itemCount: number;
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
    sources: RealNewsSourceCoverage[];
    requestedSymbols: string[];
    rawCount: number;
    availableCount: number;
    deduplicatedCount: number;
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
  sources?: RealNewsSourceCoverage[];
  requestedSymbols?: string[];
  rawCount?: number;
  availableCount?: number;
  deduplicatedCount?: number;
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
  preferredSymbols?: string[];
  newsItemLimit?: number;
  newsSymbolLimit?: number;
  includeGlobalMarkets?: boolean;
  fetchImpl?: typeof fetch;
}

const NEWS_ITEM_LIMIT = 80;
const NEWS_SYMBOL_LIMIT = 8;

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

function normalizeNewsCategory(
  value: unknown,
  symbols: string[],
): ResearchNewsCategory {
  if (value === "macro" || value === "company") return value;
  if (value === "market") return value;
  return symbols.length > 0 ? "company" : "market";
}

function normalizeNewsItem(item: RealNewsItem): RealNewsItem {
  const symbols = Array.isArray(item.symbols)
    ? item.symbols.map(String).filter(Boolean).slice(0, 8)
    : [];
  return {
    id: String(item.id),
    source: String(item.source || "unknown"),
    title: String(item.title || ""),
    publishedAt: String(item.publishedAt || item.fetchedAt || ""),
    fetchedAt: String(item.fetchedAt || ""),
    url: item.url ? String(item.url) : null,
    symbols,
    sentiment: normalizeSentiment(item.sentiment),
    summary: item.summary ? String(item.summary) : null,
    category: normalizeNewsCategory(item.category, symbols),
  };
}

function canonicalNewsKey(item: RealNewsItem): string {
  const normalizedTitle = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (item.category === "macro") return `title:${normalizedTitle}`;
  const normalizedUrl = item.url?.trim().replace(/[?#].*$/, "");
  if (normalizedUrl) return `url:${normalizedUrl}`;
  return `title:${normalizedTitle}`;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAndDedupeNews(
  items: RealNewsItem[],
  preferredSymbols: string[],
): { items: RealNewsItem[]; removed: number } {
  const byKey = new Map<string, RealNewsItem>();
  for (const rawItem of items) {
    const item = normalizeNewsItem(rawItem);
    if (!item.title.trim()) continue;
    const key = canonicalNewsKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    existing.symbols = [...new Set([...existing.symbols, ...item.symbols])].slice(0, 8);
    if (!existing.summary && item.summary) existing.summary = item.summary;
  }
  const preferred = new Set(preferredSymbols);
  const normalized = [...byKey.values()].sort((left, right) => {
    const leftPreferred = left.symbols.some((symbol) => preferred.has(symbol));
    const rightPreferred = right.symbols.some((symbol) => preferred.has(symbol));
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
    return timestamp(right.publishedAt) - timestamp(left.publishedAt);
  });
  return {
    items: normalized,
    removed: Math.max(0, items.length - normalized.length),
  };
}

function buildNewsSourceCoverage(items: RealNewsItem[]): RealNewsSourceCoverage[] {
  const counts = new Map<string, RealNewsSourceCoverage>();
  for (const item of items) {
    const key = `${item.category}:${item.source}`;
    const current = counts.get(key);
    if (current) {
      current.itemCount += 1;
    } else {
      counts.set(key, {
        source: item.source,
        category: item.category,
        itemCount: 1,
      });
    }
  }
  return [...counts.values()].sort(
    (left, right) => right.itemCount - left.itemCount ||
      left.source.localeCompare(right.source, "zh-CN"),
  );
}

export function selectNewsSymbols(
  snapshot: MarketSnapshot,
  preferredSymbols: string[] = [],
  limit = NEWS_SYMBOL_LIMIT,
): string[] {
  const boundedLimit = Math.min(NEWS_SYMBOL_LIMIT, Math.max(1, Math.floor(limit)));
  const selected = preferredSymbols
    .map(String)
    .filter((symbol) => /^\d{6}$/.test(symbol));
  const liquid = snapshot.quotes
    .filter((quote) => quote.tradable && /^\d{6}$/.test(quote.symbol))
    .sort((left, right) =>
      (right.amount ?? 0) - (left.amount ?? 0) ||
      right.volume - left.volume ||
      left.symbol.localeCompare(right.symbol),
    )
    .map((quote) => quote.symbol);
  return [...new Set([...selected, ...liquid])].slice(0, boundedLimit);
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

function buildNewsOnlyImpact(
  snapshot: MarketSnapshot,
): RealResearchDataFeed["impact"] {
  const aShareContext = snapshot.quotes
    .filter((quote) => !quote.tradable)
    .slice(0, 4)
    .map((quote) => `${quote.name} ${quote.changePercent.toFixed(2)}%`);

  return {
    direction: "neutral",
    score: 0,
    summary: "轻量新闻快照只拉取多源新闻，外围市场影响留给完整研究流更新。",
    drivers: [],
    aShareContext,
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
      sources: [],
      requestedSymbols: [],
      rawCount: 0,
      availableCount: 0,
      deduplicatedCount: 0,
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
  const newsItemLimit = clamp(
    Math.floor(input.newsItemLimit ?? NEWS_ITEM_LIMIT),
    10,
    NEWS_ITEM_LIMIT,
  );
  const includeGlobalMarkets = input.includeGlobalMarkets ?? true;
  const requestedNewsSymbols = selectNewsSymbols(
    input.snapshot,
    input.preferredSymbols,
    input.newsSymbolLimit,
  );
  const newsUrl = new URL(`${baseUrl}/api/research/news`);
  newsUrl.searchParams.set("limit", String(newsItemLimit));
  newsUrl.searchParams.set("symbols", requestedNewsSymbols.join(","));
  const globalMarketRequest = includeGlobalMarkets
    ? fetchBridgeJson<BridgeGlobalResponse>({
      url: `${baseUrl}/api/market/global?limit=12`,
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs,
      cacheTtlMs: 5 * 60_000,
      fetchImpl,
      })
    : Promise.resolve<BridgeGlobalResponse>({
        provider: "akshare",
        fetchedAt: undefined,
        markets: [],
        warning: null,
      });
  const [newsResult, globalResult] = await Promise.allSettled([
    fetchBridgeJson<BridgeNewsResponse>({
      url: newsUrl.toString(),
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs,
      cacheTtlMs: 10 * 60_000,
      fetchImpl,
    }),
    globalMarketRequest,
  ]);

  const news =
    newsResult.status === "fulfilled"
      ? (() => {
          const bridgeItems = newsResult.value.items ?? [];
          const normalized = normalizeAndDedupeNews(
            bridgeItems,
            input.preferredSymbols ?? [],
          );
          const rawCount = Math.max(
            bridgeItems.length,
            Number(newsResult.value.rawCount) || 0,
          );
          const deduplicatedCount = Math.min(
            rawCount,
            Math.max(0, Number(newsResult.value.deduplicatedCount) || 0) +
              normalized.removed,
          );
          return {
            provider: newsResult.value.provider ?? "akshare",
            source: newsResult.value.source ?? "unknown",
            fetchedAt: newsResult.value.fetchedAt ?? null,
            items: normalized.items,
            sources: buildNewsSourceCoverage(normalized.items),
            requestedSymbols: newsResult.value.requestedSymbols ?? requestedNewsSymbols,
            rawCount,
            availableCount: Math.max(0, rawCount - deduplicatedCount),
            deduplicatedCount,
            warning: newsResult.value.warning ?? null,
          };
        })()
      : {
          provider: "akshare",
          source: "unavailable",
          fetchedAt: null,
          items: [],
          sources: [],
          requestedSymbols: requestedNewsSymbols,
          rawCount: 0,
          availableCount: 0,
          deduplicatedCount: 0,
          warning: `真实新闻源暂不可用: ${bridgeErrorMessage(newsResult.reason)}`,
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
          warning: `全球市场源暂不可用: ${bridgeErrorMessage(globalResult.reason)}`,
        };

  const degraded =
    Boolean(news.warning) ||
    (includeGlobalMarkets && Boolean(globalMarkets.warning)) ||
    news.items.length === 0 ||
    (includeGlobalMarkets && globalMarkets.markets.length === 0);

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.marketDataProvider,
    sourceStatus: degraded ? "degraded" : "live-read-only",
    news,
    globalMarkets,
    impact: includeGlobalMarkets
      ? buildImpact(globalMarkets.markets, input.snapshot)
      : buildNewsOnlyImpact(input.snapshot),
    guardrails: [
      "该接口只读取真实新闻和全球市场数据，不包含账户、下单或撤单能力。",
      "所有新闻必须保留来源、发布时间、抓取时间和去重依据；缺失时明确显示降级。",
      "全球市场对 A 股的影响是研究信号，需要后续历史样本验证，不能直接触发实盘交易。",
      "本地自动操作仍限定为 paper-only，并继续遵守 A 股 100 股一手和 T+1 规则。",
    ],
  };
}
