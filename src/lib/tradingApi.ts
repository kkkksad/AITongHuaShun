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
  authEnabled: boolean;
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
  authentication: {
    enabled: boolean;
    mode: "local-jwt" | "local-unprotected";
    defaultCredentials: false;
  };
  researchData: {
    dataDir: string;
    maxSymbols: number;
    historyDays: number;
    maxCacheMb: number;
    storeRawNews: boolean;
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

export interface SystemStatus {
  health: HealthSnapshot;
  capabilities: CapabilitiesSnapshot;
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

export interface ResearchRunSample {
  recordedAt: string;
  kind: "strategy-leaderboard" | "daily-candidates" | "daily-quality-stocks";
  provider: string;
  mode: TradingMode;
  snapshotSequence: number;
  snapshotTime: string;
  itemCount: number;
  topSymbols: string[];
  summary: string;
}

export interface LearningState {
  generatedAt: string;
  dataMemory: {
    storage: "in-memory";
    marketSnapshotSamples: number;
    researchRuns: number;
    firstSnapshotTime: string | null;
    latestSnapshotTime: string | null;
    providersSeen: string[];
    symbolsSeen: number;
    topSymbols: string[];
  };
  researchLoop: {
    strategyLeaderboardRuns: number;
    dailyCandidateRuns: number;
    dailyQualityRuns: number;
    latestRuns: ResearchRunSample[];
  };
  currentCapability: {
    realtimeQuotes: boolean;
    historicalBars: boolean;
    paperExecution: boolean;
    liveExecution: false;
    statement: string;
  };
  nextDataNeeds: string[];
  guardrails: string[];
}

export type PaperTradingOperationAction =
  | "observe"
  | "paper-buy-plan"
  | "paper-sell-plan"
  | "blocked"
  | "hold";

export interface PaperTradingOperation {
  timestamp: string;
  symbol: string;
  name: string;
  action: PaperTradingOperationAction;
  strategy: string;
  quantity: number;
  price: number;
  estimatedNotional: number;
  reason: string;
  ruleChecks: string[];
}

export interface PaperTradingPlanQualitySummary {
  candidatePoolSize: number;
  affordableCandidateCount: number;
  positionConflictCount: number;
  actionCounts: Record<PaperTradingOperationAction, number>;
  blockedReasons: Record<string, number>;
  plannedBuyNotional: number;
  plannedSellNotional: number;
  cashDeploymentPercent: number;
  planQuality: "actionable" | "watch-only" | "blocked";
  summary: string;
}

export interface PaperTradingPlan {
  generatedAt: string;
  tradingDate: string;
  mode: TradingMode;
  provider: MarketDataProviderName;
  account: {
    accountId: string;
    cash: number;
    equity: number;
    marketValue: number;
  };
  capitalPlan: {
    initialCapital: number;
    maxPositionWeight: number;
    maxSingleOrderNotional: number;
    lotSize: number;
  };
  rules: string[];
  topStrategy: {
    strategyKey: string;
    strategyName: string;
    winRate: number;
    totalTrades: number;
    qualityGate: string;
  } | null;
  qualitySummary: PaperTradingPlanQualitySummary;
  operations: PaperTradingOperation[];
  guardrails: string[];
}

export type RealResearchSourceStatus =
  | "live-read-only"
  | "mock-disabled"
  | "degraded";

export type RealResearchSentiment = "positive" | "neutral" | "negative";
export type GlobalImpactDirection = "risk-on" | "neutral" | "risk-off";

export interface RealNewsItem {
  id: string;
  source: string;
  title: string;
  publishedAt: string;
  fetchedAt: string;
  url: string | null;
  symbols: string[];
  sentiment: RealResearchSentiment;
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
  sourceStatus: RealResearchSourceStatus;
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

export interface AuthUser {
  username: string;
  role: string;
}

export interface LoginResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
}

export interface AuthVerifyResponse {
  valid: true;
  user: AuthUser;
}

export interface SelfOptimizationStatus {
  generatedAt: string;
  mode: "paper-research";
  optimizer: {
    status: "guarded-ready";
    cadence: string;
    currentInputs: string[];
    nextInputs: string[];
    objective: string[];
  };
  retention: {
    backend: "bounded-local-cache";
    dataDir: string;
    maxSymbols: number;
    historyDays: number;
    maxCacheMb: number;
    storeRawNews: boolean;
    policy: string[];
    estimatedDailyBarMb: number;
  };
  dataSources: {
    marketProvider: string;
    historicalBars: string;
    news: string;
    globalMarkets: string;
  };
  guardrails: string[];
}

interface AccountResponse {
  account: AccountSnapshot;
}

const API_PROXY_MISS_HINT =
  "API 代理未命中：请求返回了前端 HTML。请确认使用 npm run dev 或 npm run dev:a-share 启动，且 4173 端口由 config/vite.app.config.js 提供；如果只启动前端，请设置 VITE_API_BASE_URL=http://127.0.0.1:8787。";
const AUTH_TOKEN_STORAGE_KEY = "xuanshu.auth.token";

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

export function getStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function setStoredAuthToken(token: string): void {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

export function clearStoredAuthToken(): void {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

export async function authApiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = getStoredAuthToken();
  return apiRequest<T>(path, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const response = await apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setStoredAuthToken(response.token);
  return response;
}

export function verifyLogin(): Promise<AuthVerifyResponse> {
  return authApiRequest<AuthVerifyResponse>("/api/auth/verify");
}

export async function logout(): Promise<void> {
  try {
    await authApiRequest<{ message: string }>("/api/auth/logout", { method: "POST" });
  } finally {
    clearStoredAuthToken();
  }
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const [health, capabilities] = await Promise.all([
    apiRequest<HealthSnapshot>("/api/health"),
    apiRequest<CapabilitiesSnapshot>("/api/capabilities"),
  ]);

  return { health, capabilities };
}

export async function fetchTradingBootstrap(): Promise<TradingBootstrap> {
  const { health, capabilities } = await fetchSystemStatus();
  const [market, account, positions, orders, limits] = await Promise.all([
    authApiRequest<MarketSnapshot>("/api/market/snapshot"),
    authApiRequest<AccountSnapshot>("/api/account"),
    authApiRequest<PositionSnapshot[]>("/api/positions"),
    authApiRequest<OrderRecord[]>("/api/orders?limit=50"),
    authApiRequest<RiskLimits>("/api/risk/limits"),
  ]);

  return { health, capabilities, market, account, positions, orders, limits };
}

export function submitPaperOrder(order: OrderRequest): Promise<OrderSubmission> {
  return authApiRequest<OrderSubmission>("/api/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export function fetchStrategyLeaderboard(
  bars = 90,
): Promise<StrategyLeaderboardReport> {
  return authApiRequest<StrategyLeaderboardReport>(
    `/api/research/strategy-leaderboard?bars=${bars}`,
  );
}

export function fetchDailyCandidates(limit = 8): Promise<DailyCandidateReport> {
  return authApiRequest<DailyCandidateReport>(
    `/api/research/daily-candidates?limit=${limit}`,
  );
}

export function fetchDailyQualityStocks(limit = 10): Promise<DailyQualityStockReport> {
  return authApiRequest<DailyQualityStockReport>(
    `/api/research/daily-quality-stocks?limit=${limit}`,
  );
}

export function fetchLearningState(): Promise<LearningState> {
  return authApiRequest<LearningState>("/api/research/learning-state");
}

export function fetchPaperTradingPlan(): Promise<PaperTradingPlan> {
  return authApiRequest<PaperTradingPlan>("/api/research/paper-trading-plan");
}

export function fetchRealResearchDataFeed(): Promise<RealResearchDataFeed> {
  return authApiRequest<RealResearchDataFeed>("/api/research/real-data-feed");
}

export function fetchSelfOptimizationStatus(): Promise<SelfOptimizationStatus> {
  return authApiRequest<SelfOptimizationStatus>("/api/research/self-optimization");
}

export function cancelPaperOrder(orderId: string): Promise<OrderSubmission> {
  return authApiRequest<OrderSubmission>(`/api/orders/${orderId}`, {
    method: "DELETE",
  });
}

export function setPaperTradingPaused(paused: boolean): Promise<AccountResponse> {
  return authApiRequest<AccountResponse>(
    paused ? "/api/trading/pause" : "/api/trading/resume",
    { method: "POST" },
  );
}

export function fetchAuditEvents(limit = 100): Promise<AuditEvent[]> {
  return authApiRequest<AuditEvent[]>(`/api/audit?limit=${limit}`);
}

export function getTradingSocketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  const token = getStoredAuthToken();

  if (typeof configured === "string" && configured.trim()) {
    const explicitUrl = new URL(configured.trim(), window.location.origin);
    if (token) explicitUrl.searchParams.set("token", token);
    return explicitUrl.toString();
  }

  const apiBaseUrl = getApiBaseUrl();
  if (apiBaseUrl) {
    const apiUrl = new URL(apiBaseUrl, window.location.origin);
    apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
    apiUrl.pathname = "/ws";
    apiUrl.search = "";
    apiUrl.hash = "";
    if (token) apiUrl.searchParams.set("token", token);
    return apiUrl.toString();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socketUrl = new URL(`${protocol}//${window.location.host}/ws`);
  if (token) socketUrl.searchParams.set("token", token);
  return socketUrl.toString();
}
