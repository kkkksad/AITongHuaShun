import type {
  AccountSnapshot,
  AuditEvent,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
  RiskLimits,
  TradingMode,
} from "../../shared/trading";

export interface HealthSnapshot {
  ok: boolean;
  service: string;
  mode: TradingMode;
  marketDataProvider: MarketDataProviderName;
  realTradingEnabled: boolean;
  websocketConnections: number;
  timestamp: string;
}

export type MarketDataProviderName = "mock" | "akshare";

export interface CapabilitiesSnapshot {
  marketData: {
    provider: MarketDataProviderName;
    mode: TradingMode;
    readOnly: true;
    external: boolean;
  };
  execution: {
    provider: "paper-broker";
    mode: "paper";
    liveSupported: false;
    humanApprovalRequiredForLive: true;
  };
  credentials: {
    browserAllowed: false;
    storage: "server-environment-only";
  };
  openApi: string | null;
}

export interface TradingBootstrap {
  health: HealthSnapshot;
  capabilities: CapabilitiesSnapshot;
  market: MarketSnapshot;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  orders: OrderRecord[];
  limits: RiskLimits;
}

export interface OrderSubmission {
  order: OrderRecord;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
}

export interface StrategyLeaderboardEntry {
  rank: number;
  strategyKey: string;
  strategyName: string;
  score: number;
  bestParams: Record<string, number>;
  metrics: {
    totalReturn: number;
    annualizedReturn: number;
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    maxDrawdownPercent: number;
    winRate: number;
    totalTrades: number;
  };
  qualityGate: "pass" | "caution" | "blocked";
  trialCount: number;
}

export interface StrategyLeaderboardReport {
  generatedAt: string;
  seed: number;
  source: {
    provider: MarketDataProviderName;
    mode: TradingMode;
    sampleType: "synthetic-from-current-snapshot";
    quoteCount: number;
    tradableSymbols: string[];
    bars: number;
    snapshotSequence: number;
    snapshotTime: string;
  };
  dataQuality: {
    timestamp: string;
    score: {
      freshness: number;
      completeness: number;
      suspensionRate: number;
      limitUpCount: number;
      limitDownCount: number;
      adjustmentWarningCount: number;
      anomalyPriceCount: number;
      overall: number;
    };
    totalSymbols: number;
    summary: string;
  };
  objective: { metric: string; weight: number }[];
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

export type DailyCandidateAction = "watch" | "paper-buy" | "avoid";

export interface DailyCandidate {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  score: number;
  action: DailyCandidateAction;
  confidence: number;
  suggestedPositionWeight: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  reasons: string[];
  riskFlags: string[];
  updatedAt: string;
}

export interface DailyCandidateReport {
  generatedAt: string;
  strategyKey: "aSharePullback";
  strategyName: "A股强势回踩确认";
  mode: TradingMode;
  source: {
    provider: MarketDataProviderName;
    snapshotSequence: number;
    snapshotTime: string;
    quoteCount: number;
    tradableCount: number;
  };
  autoUpdate: {
    marketRefresh: string;
    researchRefresh: string;
    execution: "paper-only";
    nextStep: string;
  };
  guardrails: string[];
  candidates: DailyCandidate[];
}

export type QualityStockAction = "focus" | "watch" | "avoid";
export type QualityStockGrade = "S" | "A" | "B" | "C";

export interface DailyQualityStock {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  amount: number | null;
  score: number;
  grade: QualityStockGrade;
  action: QualityStockAction;
  style: "core" | "growth" | "momentum" | "defensive";
  confidence: number;
  suggestedPositionWeight: number;
  factors: {
    liquidity: number;
    momentum: number;
    stability: number;
    intradayStrength: number;
    turnover: number;
  };
  reasons: string[];
  riskFlags: string[];
  updatedAt: string;
}

export interface DailyQualityStockReport {
  generatedAt: string;
  mode: TradingMode;
  source: {
    provider: string;
    snapshotSequence: number;
    snapshotTime: string;
    quoteCount: number;
    tradableCount: number;
  };
  methodology: {
    name: "每日优质股评分";
    version: string;
    dataScope: {
      realtimeQuote: boolean;
      historicalBars: boolean;
      news: boolean;
      fundamentals: boolean;
    };
    weights: Record<string, number>;
  };
  autoUpdate: {
    marketRefresh: string;
    qualityRefresh: string;
    execution: "paper-only";
  };
  guardrails: string[];
  stocks: DailyQualityStock[];
}

interface AccountResponse {
  account: AccountSnapshot;
}

const API_PROXY_MISS_HINT =
  "API 代理未命中：请求返回了前端 HTML。请确认使用 npm run dev 或 npm run dev:a-share 启动，且 4173 端口由 config/vite.app.config.js 提供；如果只启动前端，请设置 VITE_API_BASE_URL=http://127.0.0.1:8787。";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  return typeof configured === "string" && configured.trim()
    ? trimTrailingSlash(configured.trim())
    : "";
}

export function getApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return path;
  }
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function getPayloadMessage(payload: unknown): string | undefined {
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }
  return undefined;
}

function formatNonJsonError(path: string, response: Response, body: string): Error {
  const preview = body.trim().replace(/\s+/g, " ").slice(0, 140);
  const looksLikeHtml = /^<!doctype html/i.test(preview) || /^<html/i.test(preview);
  if (looksLikeHtml) {
    return new Error(API_PROXY_MISS_HINT);
  }
  return new Error(
    `API ${path} 返回了非 JSON 响应（HTTP ${response.status}）：${preview || "空响应"}`,
  );
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = getApiUrl(path);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知网络错误";
    throw new Error(`无法连接交易 API：${url}（${detail}）`);
  }

  const text = await response.text();
  if (!text.trim()) {
    if (!response.ok) {
      throw new Error(`请求失败：HTTP ${response.status}`);
    }
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw formatNonJsonError(path, response, text);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`API ${path} 返回了无法解析的 JSON 响应。`);
  }

  if (!response.ok) {
    throw new Error(getPayloadMessage(payload) ?? `请求失败：HTTP ${response.status}`);
  }

  return payload as T;
}

export async function fetchTradingBootstrap(): Promise<TradingBootstrap> {
  const [health, capabilities, market, account, positions, orders, limits] =
    await Promise.all([
      apiRequest<HealthSnapshot>("/api/health"),
      apiRequest<CapabilitiesSnapshot>("/api/capabilities"),
      apiRequest<MarketSnapshot>("/api/market/snapshot"),
      apiRequest<AccountSnapshot>("/api/account"),
      apiRequest<PositionSnapshot[]>("/api/positions"),
      apiRequest<OrderRecord[]>("/api/orders?limit=50"),
      apiRequest<RiskLimits>("/api/risk/limits"),
    ]);

  return { health, capabilities, market, account, positions, orders, limits };
}

export function submitPaperOrder(order: OrderRequest): Promise<OrderSubmission> {
  return apiRequest<OrderSubmission>("/api/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export function fetchStrategyLeaderboard(
  bars = 90,
): Promise<StrategyLeaderboardReport> {
  return apiRequest<StrategyLeaderboardReport>(
    `/api/research/strategy-leaderboard?bars=${bars}`,
  );
}

export function fetchDailyCandidates(limit = 8): Promise<DailyCandidateReport> {
  return apiRequest<DailyCandidateReport>(
    `/api/research/daily-candidates?limit=${limit}`,
  );
}

export function fetchDailyQualityStocks(limit = 10): Promise<DailyQualityStockReport> {
  return apiRequest<DailyQualityStockReport>(
    `/api/research/daily-quality-stocks?limit=${limit}`,
  );
}

export function cancelPaperOrder(orderId: string): Promise<OrderSubmission> {
  return apiRequest<OrderSubmission>(`/api/orders/${orderId}`, {
    method: "DELETE",
  });
}

export function setPaperTradingPaused(paused: boolean): Promise<AccountResponse> {
  return apiRequest<AccountResponse>(
    paused ? "/api/trading/pause" : "/api/trading/resume",
    { method: "POST" },
  );
}

export function fetchAuditEvents(limit = 100): Promise<AuditEvent[]> {
  return apiRequest<AuditEvent[]>(`/api/audit?limit=${limit}`);
}

export function getTradingSocketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }

  const apiBaseUrl = getApiBaseUrl();
  if (apiBaseUrl) {
    const apiUrl = new URL(apiBaseUrl, window.location.origin);
    apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
    apiUrl.pathname = "/ws";
    apiUrl.search = "";
    apiUrl.hash = "";
    return apiUrl.toString();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}
