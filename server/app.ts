import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { z, ZodError } from "zod";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PaperStrategyProfile,
} from "../shared/trading";
import {
  SessionStore,
  createAuthHook,
  extractSessionToken,
  registerAuthRoutes,
  type AuthConfig,
} from "./auth";
import type { ServerConfig } from "./config";
import {
  getMetricsText,
  recordAccountCash,
  recordAccountEquity,
  recordAccountPositions,
  recordCircuitBreaker,
  recordHttpRequest,
  recordOrder,
  recordOrderCancellation,
  recordWebSocketConnection,
} from "./metrics";
import {
  contentType,
  exportAuditToCsv,
  exportFilename,
  exportOrdersToCsv,
} from "./monitoring/exportUtils";
import type { ExportFormat } from "./monitoring/exportUtils";
import { queryLogEntries } from "./monitoring/logQuery";
import {
  RequestTelemetry,
  shouldTrackTelemetryRequest,
} from "./monitoring/requestTelemetry";
import type { LogEntry } from "./logger";
import { PaperPlanNotifier } from "./notifications/paperPlanNotifier";
import { WxPusherClient } from "./notifications/wxPusherClient";
import { computeDataQuality } from "./market/dataQuality";
import { buildDailyCandidates } from "./research/dailyCandidates";
import { buildDailyMarketReview } from "./research/dailyMarketReview";
import { buildDailyQualityStocks } from "./research/dailyQualityStocks";
import { buildCrossMarketStrategyContext } from "./research/crossMarketStrategyContext";
import { buildCryptoMarketResearch } from "./research/cryptoMarketResearch";
import { buildExternalMarketImpact } from "./research/externalMarketImpact";
import {
  ExternalMarketFeatureCapture,
  fetchHs300CloseReturnFromBridge,
} from "./research/externalMarketFeatureCapture";
import { ExternalMarketFeatureStore } from "./research/externalMarketFeatureStore";
import { buildHongKongMarketResearch } from "./research/hongKongMarketResearch";
import { buildMarketRegimeResearch } from "./research/marketRegimeResearch";
import { buildIpoSubscriptionResearch } from "./research/ipoSubscriptionResearch";
import { buildCurrentPaperTradingPlan } from "./research/paperTradingPlanService";
import { buildRealResearchDataFeed } from "./research/realResearchData";
import { InMemoryResearchStore } from "./research/researchStore";
import { buildStockTrendForecast } from "./research/stockTrendForecast";
import { buildStrategyLeaderboard } from "./research/strategyLeaderboard";
import { buildStrategyRobustnessReport } from "./research/strategyRobustness";
import { buildSuperMindSignalPackage } from "./research/supermindSignalBridge";
import { buildTurningPointReport } from "./research/turningPointScanner";
import { WebSocketHub } from "./realtime/webSocketHub";
import { createTradingSystem, type TradingSystem } from "./system";
import { PaperAutoExecutor } from "./trading/paperAutoExecutor";

const orderRequestSchema = z.object({
  symbol: z.string().trim().regex(/^\d{6}$/, "标的代码必须是 6 位数字"),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit"]).default("market"),
  quantity: z.coerce.number().int().positive(),
  limitPrice: z.coerce.number().positive().optional(),
  clientOrderId: z.string().trim().min(1).max(80).optional(),
}).refine(
  (data) => data.type !== "limit" || data.limitPrice !== undefined,
  { message: "限价单必须提供 limitPrice", path: ["limitPrice"] },
);

const cancelParamsSchema = z.object({
  orderId: z.string().trim().min(1),
});

const paperStrategyProfileSchema = z.enum([
  "capital-preservation",
  "defensive",
  "balanced",
  "growth",
]);

const resetPaperAccountSchema = z.object({
  startingCash: z.coerce.number().finite().min(1_000).max(100_000_000),
  strategyProfile: paperStrategyProfileSchema,
  confirmation: z.literal("重置模拟账户"),
});

const updatePaperStrategyProfileSchema = z.object({
  strategyProfile: paperStrategyProfileSchema,
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
});

const logsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  module: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const strategyLeaderboardQuerySchema = z.object({
  bars: z.coerce.number().int().min(30).max(240).default(120),
});

const strategyRobustnessQuerySchema = z.object({
  limit: z.coerce.number().int().min(2).max(12).default(12),
  days: z.coerce.number().int().min(360).max(500).default(500),
});

const crossMarketStrategyContextQuerySchema = z.object({
  limit: z.coerce.number().int().min(4).max(16).default(12),
  days: z.coerce.number().int().min(60).max(500).default(180),
});

const externalMarketImpactQuerySchema = z.object({
  days: z.coerce.number().int().min(60).max(500).default(500),
});

const dailyCandidatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(24),
});

const dailyQualityStocksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(120).default(30),
});

const marketRegimeQuerySchema = z.object({
  sectorLimit: z.coerce.number().int().min(1).max(20).default(10),
  stockLimit: z.coerce.number().int().min(1).max(12).default(8),
  days: z.coerce.number().int().min(60).max(500).default(180),
});

const turningPointQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(12),
  days: z.coerce.number().int().min(180).max(500).default(360),
});

const hongKongMarketQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(10),
  days: z.coerce.number().int().min(60).max(500).default(180),
});

const stockTrendQuerySchema = z.object({
  query: z.string().trim().min(1).max(40),
  days: z.coerce.number().int().min(120).max(500).default(360),
});

const ipoSubscriptionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(40),
});

const realDataFeedQuerySchema = z.object({
  scope: z.enum(["full", "news"]).default("full"),
  newsLimit: z.coerce.number().int().min(10).max(80).default(80),
  symbolLimit: z.coerce.number().int().min(1).max(8).default(8),
});

const publicAuthPaths = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/session",
]);

function isPublicPath(url: string): boolean {
  const pathname = url.split("?")[0] ?? url;
  return (
    publicAuthPaths.has(pathname) ||
    pathname === "/ws"
  );
}

function getAuthConfig(config: ServerConfig): AuthConfig {
  return {
    username: config.AUTH_USERNAME,
    passwordHash: config.AUTH_PASSWORD_HASH,
    sessionTtlSeconds: config.AUTH_SESSION_TTL_SECONDS,
    cookieSecure: config.AUTH_COOKIE_SECURE,
    maxSessions: config.AUTH_MAX_SESSIONS,
    loginRateLimitMax: config.AUTH_LOGIN_RATE_LIMIT_MAX,
  };
}

function buildResearchControlStatus(config: ServerConfig, provider: string) {
  const estimatedDailyBarMb = Math.round(
    (config.RESEARCH_MAX_SYMBOLS * config.RESEARCH_HISTORY_DAYS * 96) /
      1024 /
      1024,
  );

  return {
    generatedAt: new Date().toISOString(),
    mode: "paper-research",
    optimizer: {
      status: "guarded-ready",
      cadence: "manual-or-scheduled-research-run",
      currentInputs: [
        "real-time snapshot",
        "bounded public sector and stock daily bars",
        "strategy leaderboard",
        "daily candidates",
        "paper trading results",
      ],
      nextInputs: [
        "versioned authorized daily A-share dataset",
        "deduplicated real news metadata",
        "global market daily return features",
      ],
      objective: [
        "maximize risk-adjusted paper return",
        "penalize drawdown and turnover",
        "reject future-data leakage",
      ],
    },
    retention: {
      backend: "bounded-local-cache",
      dataDir: config.RESEARCH_DATA_DIR,
      maxSymbols: config.RESEARCH_MAX_SYMBOLS,
      historyDays: config.RESEARCH_HISTORY_DAYS,
      maxCacheMb: config.RESEARCH_MAX_CACHE_MB,
      storeRawNews: config.RESEARCH_STORE_RAW_NEWS,
      policy: [
        "Keep rolling real-time snapshots in memory only.",
        "Persist compact daily OHLCV/features only for watched symbols.",
        "Store news IDs, timestamps, sources and short summaries; avoid full raw bodies by default.",
        "Cap retained research data by symbol count, history window and cache size.",
      ],
      estimatedDailyBarMb: Math.min(estimatedDailyBarMb, config.RESEARCH_MAX_CACHE_MB),
    },
    dataSources: {
      marketProvider: provider,
      historicalBars:
        provider === "akshare" ? "bounded-public-read-only-bridge" : "disabled",
      news: "read-only-metadata",
      globalMarkets: "read-only-features",
    },
    guardrails: [
      "This optimizer is for paper trading and research only.",
      "No real broker order execution is enabled.",
      "A-share paper operations must obey 100-share lots and T+1 sell limits.",
      "Historical training must use time-bounded samples only; no future data is allowed.",
    ],
  };
}

interface BuildTradingAppOptions {
  config: ServerConfig;
  system?: TradingSystem;
  startMarket?: boolean;
  clock?: () => Date;
}

export async function buildTradingApp(
  options: BuildTradingAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.startMarket !== false,
    trustProxy: options.config.TRUST_PROXY,
  });
  const system = options.system ?? createTradingSystem(options.config, options.clock);
  const hub = new WebSocketHub();
  const researchStore = new InMemoryResearchStore();
  const requestTelemetry = new RequestTelemetry();
  const requestStartTimes = new WeakMap<object, number>();
  const telemetryRequests = new WeakSet<object>();
  const authConfig = options.config.AUTH_ENABLED
    ? getAuthConfig(options.config)
    : null;
  const sessions = authConfig
    ? new SessionStore({
        ttlSeconds: authConfig.sessionTtlSeconds,
        maxSessions: authConfig.maxSessions,
      })
    : null;

  // ── Plugins ──────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: options.config.RATE_LIMIT_MAX,
    timeWindow: options.config.RATE_LIMIT_WINDOW_MS,
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: options.config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Content-Type", "X-CSRF-Token"],
  });
  await app.register(websocket);

  if (authConfig && sessions) {
    const authHook = createAuthHook(sessions);
    app.addHook("preHandler", async (request, reply) => {
      if (request.method === "OPTIONS" || isPublicPath(request.url)) return;
      await authHook(request, reply);
    });
    registerAuthRoutes(app, authConfig, sessions);
  }

  app.addHook("onSend", async (request, reply, payload) => {
    const pathname = request.url.split("?")[0] ?? request.url;
    if (pathname.startsWith("/api/") || pathname === "/metrics") {
      if (pathname === "/api/market/quality") {
        reply.removeHeader("Pragma");
      } else {
        reply.header("Cache-Control", "no-store");
        reply.header("Pragma", "no-cache");
      }
    }
    return payload;
  });

  // ── Swagger / OpenAPI ───────────────────────────────────
  if (options.config.API_DOCS_ENABLED) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: "KAIROS Quant API",
          description:
            "量化研究、确定性回测和模拟交易 API。当前不提供真实订单执行。",
          version: "0.2.0",
        },
        servers: [
          {
            url: `http://${options.config.API_HOST}:${options.config.API_PORT}`,
            description: "本地开发服务器",
          },
        ],
        tags: [
          { name: "系统", description: "健康检查与服务状态" },
          { name: "行情", description: "市场行情数据" },
          { name: "账户", description: "账户、持仓与订单" },
          { name: "风控", description: "风险控制与熔断" },
          { name: "交易", description: "下单、撤单与交易控制" },
          { name: "审计", description: "交易审计事件" },
          { name: "导出", description: "审计与交易记录导出" },
          { name: "监控", description: "Prometheus 指标端点" },
          { name: "日志", description: "系统日志查看" },
          { name: "研究", description: "策略优化与研究排行榜" },
        ],
      },
    });
    await app.register(swaggerUi, {
      routePrefix: "/documentation",
      staticCSP: true,
      uiConfig: {
        docExpansion: "list",
        deepLinking: false,
      },
    });
  }

  // ── HTTP request timing hook ─────────────────────────────
  app.addHook("onRequest", async (request) => {
    requestStartTimes.set(request, performance.now());
    const route = request.routeOptions.url ?? request.url;
    if (shouldTrackTelemetryRequest(request.method, route)) {
      telemetryRequests.add(request);
      requestTelemetry.startRequest();
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const start = requestStartTimes.get(request);
    if (start !== undefined) {
      const durationMs = Math.max(0, performance.now() - start);
      const route = request.routeOptions.url ?? request.url;
      recordHttpRequest(
        request.method,
        route,
        reply.statusCode,
        durationMs / 1000,
      );
      if (telemetryRequests.has(request)) {
        telemetryRequests.delete(request);
        requestTelemetry.finishRequest({
          method: request.method,
          route,
          statusCode: reply.statusCode,
          durationMs,
        });
      }
    }
  });

  app.addHook("onRequestAbort", async (request) => {
    if (!telemetryRequests.has(request)) return;
    telemetryRequests.delete(request);
    requestTelemetry.cancelRequest();
    requestStartTimes.delete(request);
  });

  // ── Broadcast helpers ───────────────────────────────────

  const broadcastPositions = (snapshot?: MarketSnapshot) => {
    hub.broadcast({
      type: "positions.snapshot",
      data: system.broker.getPositions(snapshot),
    });
  };

  const updateMetrics = () => {
    const account = system.broker.getAccount();
    if (account) {
      recordAccountEquity(account.equity);
      recordAccountCash(account.cash);
    }
    const riskState = system.risk.getState();
    recordCircuitBreaker(riskState.circuitState === "tripped");
  };

  const requestedMarketSymbols = options.config.MARKET_SYMBOLS
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => /^\d{6}$/.test(symbol));

  const currentMarketQuality = () => {
    let cacheAgeSec: number | null = null;
    if ("getLastFetchSuccessMs" in system.market) {
      const lastMs = (system.market as { getLastFetchSuccessMs(): number })
        .getLastFetchSuccessMs();
      if (lastMs > 0) cacheAgeSec = (Date.now() - lastMs) / 1000;
    }
    return computeDataQuality(
      system.market.getSnapshot(),
      system.marketDataProvider,
      requestedMarketSymbols,
      cacheAgeSec,
    );
  };

  system.market.on("snapshot", (snapshot: MarketSnapshot) => {
    researchStore.recordMarketSnapshot(snapshot, system.marketDataProvider);
    hub.broadcast({ type: "market.snapshot", data: snapshot });
    system.broker.markToMarket(snapshot);
    broadcastPositions(snapshot);
  });
  system.broker.on("account.updated", (account: AccountSnapshot) => {
    hub.broadcast({ type: "account.snapshot", data: account });
    recordAccountEquity(account.equity);
    recordAccountCash(account.cash);
    const positions = system.broker.getPositions();
    recordAccountPositions(positions.length);
  });
  system.broker.on("order.updated", (order: OrderRecord) => {
    hub.broadcast({ type: "order.updated", data: order });
  });

  const wxPusherSender = options.config.WXPUSHER_ENABLED
    ? new WxPusherClient({
        spt: options.config.WXPUSHER_SPT,
        timeoutMs: options.config.WXPUSHER_TIMEOUT_MS,
      })
    : undefined;
  const paperPlanNotifier = new PaperPlanNotifier({
    enabled: options.config.WXPUSHER_ENABLED,
    sender: wxPusherSender,
    store: system.store,
    dailyMessageLimit: options.config.WXPUSHER_DAILY_MESSAGE_LIMIT,
    clock: options.clock,
  });
  const paperAutoExecutor = new PaperAutoExecutor({
    system,
    config: options.config,
    enabled: options.config.PAPER_AUTO_EXECUTION_ENABLED,
    intervalMs: options.config.PAPER_AUTO_EXECUTION_INTERVAL_MS,
    tradeWindowOnly: options.config.PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY,
    maxOrdersPerRun: options.config.PAPER_AUTO_EXECUTION_MAX_ORDERS_PER_RUN,
    maxDailyOrders: options.config.PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS,
    targetDailyOrders: options.config.PAPER_AUTO_EXECUTION_TARGET_DAILY_ORDERS,
    clock: options.clock,
    planNotifier: paperPlanNotifier,
    onOrder: (order, request) => {
      recordOrder(request.side, order.status);
      broadcastPositions(system.market.getSnapshot());
    },
  });
  const externalMarketFeatureCapture = options.config.EXTERNAL_MARKET_FEATURE_CAPTURE_ENABLED
    ? new ExternalMarketFeatureCapture({
        store: new ExternalMarketFeatureStore({
          filePath: options.config.EXTERNAL_MARKET_FEATURE_FILE,
          maxRows: options.config.EXTERNAL_MARKET_FEATURE_MAX_ROWS,
          now: options.clock,
        }),
        buildReport: () => buildExternalMarketImpact({
          bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
          bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
          marketDataProvider: system.marketDataProvider,
          mode: options.config.MARKET_MODE,
          days: 60,
          timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
        }),
        fetchHs300CloseReturn: () => fetchHs300CloseReturnFromBridge({
          bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
          bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
          timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
        }),
        clock: options.clock,
        onError: (error) => {
          app.log.warn({ err: error }, "external market feature capture failed");
        },
      })
    : null;

  // ── Error handler ───────────────────────────────────────

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "INVALID_REQUEST",
        message: "请求参数校验失败",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: statusCode === 429 ? "RATE_LIMITED" : "INVALID_REQUEST",
        message: (error as Error).message,
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "服务端处理请求失败",
    });
  });

  // ── Routes ──────────────────────────────────────────────

  // 系统
  app.get("/api/health", {
    schema: {
      tags: ["系统"],
      summary: "健康检查",
      description: "返回服务运行状态、模式和 WebSocket 连接数",
      response: {
        200: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            service: { type: "string" },
            mode: { type: "string" },
            marketDataProvider: { type: "string", enum: ["mock", "akshare"] },
            realTradingEnabled: { type: "boolean" },
            authEnabled: { type: "boolean" },
            websocketConnections: { type: "number" },
            timestamp: { type: "string" },
          },
        },
      },
    },
  }, async () => ({
    ok: true,
    service: "kairos-trading-api",
    mode: options.config.MARKET_MODE,
    marketDataProvider: system.marketDataProvider,
    realTradingEnabled: options.config.REAL_TRADING_ENABLED,
    authEnabled: options.config.AUTH_ENABLED,
    websocketConnections: hub.connectionCount,
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/system/performance", {
    schema: {
      tags: ["监控"],
      summary: "获取有界 API 性能诊断",
      description:
        "返回当前 Fastify 进程内按路由模板聚合的有限耗时样本、服务端失败和行情质量摘要；不记录请求内容、查询值或凭据。",
    },
  }, async () => {
    const telemetry = requestTelemetry.snapshot();
    const quality = currentMarketQuality();
    const coverageIssues = Math.max(
      0,
      quality.requestedSymbols - quality.validSymbols,
    );
    const issueCount = coverageIssues + quality.score.staleCount +
      quality.score.anomalyPriceCount + quality.score.adjustmentWarningCount;
    const qualityRecommendation = quality.qualityState === "healthy"
      ? []
      : ["行情质量已降级，先核对覆盖、新鲜度和异常报价，再解读研究结果。"];

    return {
      ...telemetry,
      recommendations: [
        ...qualityRecommendation,
        ...telemetry.recommendations,
      ].slice(0, 3),
      runtime: {
        mode: options.config.MARKET_MODE,
        marketDataProvider: system.marketDataProvider,
        realTradingEnabled: options.config.REAL_TRADING_ENABLED,
        websocketConnections: hub.connectionCount,
        marketQuality: {
          state: quality.qualityState,
          overall: quality.score.overall,
          freshness: quality.score.freshness,
          validSymbols: quality.validSymbols,
          requestedSymbols: quality.requestedSymbols,
          issueCount,
        },
      },
    };
  });

  app.get("/api/capabilities", {
    schema: {
      tags: ["系统"],
      summary: "获取系统能力边界",
      description: "明确区分只读行情来源与本地纸面订单执行能力。",
    },
  }, async () => ({
    marketData: {
      provider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      readOnly: true,
      external: system.marketDataProvider !== "mock",
    },
    execution: {
      provider: "paper-broker",
      mode: "paper",
      liveSupported: false,
      humanApprovalRequiredForLive: true,
    },
    autoPaperExecution: {
      enabled: options.config.PAPER_AUTO_EXECUTION_ENABLED,
      mode: "local-paper-broker-only",
      tradeWindowOnly: options.config.PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY,
      intervalMs: options.config.PAPER_AUTO_EXECUTION_INTERVAL_MS,
      maxOrdersPerRun: options.config.PAPER_AUTO_EXECUTION_MAX_ORDERS_PER_RUN,
      maxDailyOrders: options.config.PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS,
      targetDailyOrders: options.config.PAPER_AUTO_EXECUTION_TARGET_DAILY_ORDERS,
      activityMode: options.config.PAPER_AUTO_EXECUTION_ACTIVITY_MODE,
      liveTradingEnabled: false,
    },
    credentials: {
      browserAllowed: false,
      storage: "server-password-hash-only",
    },
    authentication: {
      enabled: options.config.AUTH_ENABLED,
      mode: options.config.AUTH_ENABLED ? "server-session" : "test-unprotected",
      defaultCredentials: false,
    },
    researchData: {
      dataDir: options.config.RESEARCH_DATA_DIR,
      maxSymbols: options.config.RESEARCH_MAX_SYMBOLS,
      historyDays: options.config.RESEARCH_HISTORY_DAYS,
      maxCacheMb: options.config.RESEARCH_MAX_CACHE_MB,
      storeRawNews: options.config.RESEARCH_STORE_RAW_NEWS,
    },
    openApi: options.config.API_DOCS_ENABLED
      ? "/documentation/json"
      : null,
  }));

  // 监控
  app.get("/metrics", {
    schema: {
      tags: ["监控"],
      summary: "Prometheus 指标",
      description: "以 Prometheus 文本格式返回 HTTP、WebSocket、订单和账户指标",
      hide: true,
    },
  }, async (_request, reply) => {
    updateMetrics();
    return reply
      .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(getMetricsText());
  });

  // 行情
  app.get("/api/market/snapshot", {
    schema: {
      tags: ["行情"],
      summary: "获取市场快照",
      description: "返回当前所有监控标的的实时行情快照",
    },
  }, async () => system.market.getSnapshot());


  app.get("/api/market/quality", {
    schema: {
      tags: ["行情"],
      summary: "获取数据质量报告",
      description:
        "返回数据新鲜度、完整度、停牌检测、涨跌停检测等质量评分。结果仅反映数据质量，不构成投资建议。",
    },
  }, async (_request, reply) => {
    reply.header(
      "Cache-Control",
      "private, max-age=5, stale-while-revalidate=15",
    );
    return currentMarketQuality();
  });

  app.get("/api/research/strategy-leaderboard", {
    schema: {
      tags: ["研究"],
      summary: "获取策略研究排行榜",
      description:
        "基于当前行情快照生成确定性研究样本并运行内置策略参数搜索。结果不代表真实收益。",
      querystring: {
        type: "object",
        properties: {
          bars: {
            type: "integer",
            minimum: 30,
            maximum: 240,
            default: 120,
            description: "生成研究样本的 bar 数量",
          },
        },
      },
    },
  }, async (request) => {
    const { bars } = strategyLeaderboardQuerySchema.parse(request.query);
    const report = await buildStrategyLeaderboard(
      system.market.getSnapshot(),
      system.marketDataProvider,
      bars,
    );
    researchStore.recordStrategyLeaderboard(report);
    return report;
  });

  app.get("/api/research/strategy-robustness", {
    schema: {
      tags: ["研究"],
      summary: "获取真实历史策略稳健性验证",
      description:
        "读取受控 A 股观察池的真实前复权日线，用预先固定参数在三个不重叠窗口独立回测。该报告与合成参数排行榜分开，不代表未来收益。",
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 2,
            maximum: 12,
            default: 12,
            description: "按当前成交额选取的股票数量上限",
          },
          days: {
            type: "integer",
            minimum: 360,
            maximum: 500,
            default: 500,
            description: "每只股票请求的前复权日线数量",
          },
        },
      },
    },
  }, async (request) => {
    const { limit, days } = strategyRobustnessQuerySchema.parse(request.query);
    return buildStrategyRobustnessReport({
      bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
      bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      snapshot: system.market.getSnapshot(),
      limit,
      days,
      timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
    });
  });

  app.get("/api/research/cross-market-strategy-context", {
    schema: {
      tags: ["研究"],
      summary: "获取全球市场与国内期货策略上下文",
      description:
        "组合真实全球指数、国内期货主连快照和连续历史，输出风险基调、优先与降权策略族。接口只读，不读取期货账户，也不直接生成订单。",
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 4,
            maximum: 16,
            default: 12,
          },
          days: {
            type: "integer",
            minimum: 60,
            maximum: 500,
            default: 180,
          },
        },
      },
    },
  }, async (request) => {
    const { limit, days } = crossMarketStrategyContextQuerySchema.parse(
      request.query,
    );
    return buildCrossMarketStrategyContext({
      bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
      bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      limit,
      days,
      timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
    });
  });

  app.get("/api/research/crypto-market", {
    schema: {
      tags: ["研究"],
      summary: "获取 BTC/ETH 只读快照",
      description:
        "独立读取 BTC/ETH 真实 24 小时快照与受限 A 股风险偏好解释，不等待全球历史研究，不提供数字资产交易。",
    },
  }, async () => buildCryptoMarketResearch({
    bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
    bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
    marketDataProvider: system.marketDataProvider,
    mode: options.config.MARKET_MODE,
    timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
  }));

  app.get("/api/research/external-market-impact", {
    schema: {
      tags: ["研究"],
      summary: "获取外部市场对 A 股的只读影响研究",
      description:
        "组合美股隔夜、日股、韩股、港股和 BTC/ETH 真实只读数据，以严格早于 A 股交易日的历史收盘做条件统计。结果不直接生成订单，也不能提高 A 股仓位。",
      querystring: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            minimum: 60,
            maximum: 500,
            default: 500,
            description: "全球指数和沪深300历史交易日上限",
          },
        },
      },
    },
  }, async (request) => {
    const { days } = externalMarketImpactQuerySchema.parse(request.query);
    return buildExternalMarketImpact({
      bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
      bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      days,
      timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
    });
  });

  app.get("/api/research/daily-candidates", {
    schema: {
      tags: ["研究"],
      summary: "获取今日策略候选",
      description:
        "基于当前行情快照输出 A 股强势回踩确认战法的只读候选清单。结果只用于研究和模拟盘观察。",
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 80,
            default: 24,
            description: "返回候选数量上限",
          },
        },
      },
    },
  }, async (request) => {
    const { limit } = dailyCandidatesQuerySchema.parse(request.query);
    const report = buildDailyCandidates(
      system.market.getSnapshot(),
      system.marketDataProvider,
      limit,
    );
    researchStore.recordDailyCandidates(report);
    return report;
  });

  app.get("/api/research/daily-quality-stocks", {
    schema: {
      tags: ["研究"],
      summary: "获取每日优质股",
      description:
        "基于当前行情快照输出每日优质股评分清单。当前只用于研究和模拟盘观察，尚未接入授权历史数据。",
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 120,
            default: 30,
            description: "返回优质股数量上限",
          },
        },
      },
    },
  }, async (request) => {
    const { limit } = dailyQualityStocksQuerySchema.parse(request.query);
    const report = buildDailyQualityStocks(
      system.market.getSnapshot(),
      system.marketDataProvider,
      limit,
    );
    researchStore.recordDailyQualityStocks(report);
    return report;
  });

  app.get("/api/research/market-regime", {
    schema: {
      tags: ["研究"],
      summary: "获取真实板块展望与个股形态识别",
      description:
        "读取 AkShare 行业板块、板块日线和个股前复权日线，生成 3/5 日研究评分、滚动历史验证及洗盘候选/趋势恶化识别。结果只读且不代表确定收益。",
      querystring: {
        type: "object",
        properties: {
          sectorLimit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            default: 10,
          },
          stockLimit: {
            type: "integer",
            minimum: 1,
            maximum: 12,
            default: 8,
          },
          days: {
            type: "integer",
            minimum: 60,
            maximum: 500,
            default: 180,
          },
        },
      },
    },
  }, async (request) => {
    const { sectorLimit, stockLimit, days } = marketRegimeQuerySchema.parse(
      request.query,
    );
    return buildMarketRegimeResearch({
      bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
      bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      snapshot: system.market.getSnapshot(),
      sectorLimit,
      stockLimit,
      days,
      timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
    });
  });

  app.get("/api/research/turning-points", {
    schema: {
      tags: ["研究"],
      summary: "获取 A 股变盘候选雷达",
      description:
        "扫描当前受控 A 股观察池，使用真实前复权日线识别波动压缩，并按历史相似状态统计随后 5 个交易日向上、向下或未突破的条件频率。接口只读且不生成订单。",
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 12,
            default: 12,
          },
          days: {
            type: "integer",
            minimum: 180,
            maximum: 500,
            default: 360,
          },
        },
      },
    },
  }, async (request) => {
    const { limit, days } = turningPointQuerySchema.parse(request.query);
    return buildTurningPointReport({
      bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
      bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      snapshot: system.market.getSnapshot(),
      limit,
      days,
      timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
    });
  });

  app.get("/api/research/hong-kong-market", {
    schema: {
      tags: ["研究"],
      summary: "获取真实港股只读研究",
      description:
        "读取港股成交活跃标的快照和前复权日线，输出 5/20/60 日趋势、波动、回撤及同趋势历史验证。接口不读取账户、不套用 A 股规则，也不会生成港股订单。",
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 12,
            default: 10,
          },
          days: {
            type: "integer",
            minimum: 60,
            maximum: 500,
            default: 180,
          },
        },
      },
    },
  }, async (request) => {
    const { limit, days } = hongKongMarketQuerySchema.parse(request.query);
    return buildHongKongMarketResearch({
      bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
      bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      limit,
      days,
      timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
    });
  });

  app.get("/api/research/stock-trend", {
    schema: {
      tags: ["研究"],
      summary: "按股票名称或代码获取未来趋势研究",
      description:
        "解析真实 A 股名称或代码，读取前复权日线并输出 3/5/10 个交易日启发式趋势、滚动历史验证、依据和风险。规则分不是上涨概率，接口只读且不会提交订单。",
      querystring: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            minLength: 1,
            maxLength: 40,
            description: "A 股六位代码、完整名称或名称片段",
          },
          days: {
            type: "integer",
            minimum: 120,
            maximum: 500,
            default: 360,
          },
        },
      },
    },
  }, async (request) => {
    const { query, days } = stockTrendQuerySchema.parse(request.query);
    return buildStockTrendForecast({
      query,
      days,
      bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
      bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
    });
  });

  app.get("/api/research/ipo-subscriptions", {
    schema: {
      tags: ["研究"],
      summary: "获取真实新股申购与近期上市研究",
      description:
        "读取 AkShare 真实只读新股申购表，按申购时可见的估值与价格字段生成启发式研究结论。接口不读取账户资格，也不会提交申购。",
      querystring: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 80,
            default: 40,
          },
        },
      },
    },
  }, async (request) => {
    const { limit } = ipoSubscriptionsQuerySchema.parse(request.query);
    return buildIpoSubscriptionResearch({
      bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
      bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      timeoutMs: options.config.MARKET_DATA_TIMEOUT_MS,
      limit,
      now: options.clock,
    });
  });

  app.get("/api/research/learning-state", {
    schema: {
      tags: ["研究"],
      summary: "获取研究学习状态",
      description:
        "返回运行期内存中的行情快照样本和研究运行记录。结果仅用于研究观测，不代表真实收益。",
    },
  }, async () => {
    researchStore.recordMarketSnapshot(
      system.market.getSnapshot(),
      system.marketDataProvider,
    );
    return researchStore.getLearningState();
  });

  app.get("/api/research/self-optimization", {
    schema: {
      tags: ["鐮旂┒"],
      summary: "获取策略自优化与数据留存控制状态",
      description:
        "返回自优化研究循环、历史数据接入计划和本地缓存上限。该接口只用于 paper 研究，不提供真实下单能力。",
    },
  }, async () => buildResearchControlStatus(
    options.config,
    system.marketDataProvider,
  ));

  app.get("/api/research/paper-trading-plan", {
    schema: {
      tags: ["研究"],
      summary: "获取今日纸面交易计划",
      description:
        "基于当前行情快照、策略排行榜、今日候选和账户状态生成本地 paper 操作计划。结果只用于模拟观察，不会连接真实券商。",
    },
  }, async () => {
    const { plan } = await buildCurrentPaperTradingPlan({
      system,
      config: options.config,
      researchStore,
    });
    return plan;
  });

  app.get("/api/research/daily-review", {
    schema: {
      tags: ["研究"],
      summary: "获取每日盘面与 paper 交易复盘",
      description:
        "基于当前行情快照、本地账户、订单和审计生成每日复盘。结果只代表本地 paper 模拟，不构成真实收益或投资建议。",
    },
  }, async () => {
    const snapshot = system.market.getSnapshot();
    return buildDailyMarketReview({
      snapshot,
      provider: system.marketDataProvider,
      account: system.broker.getAccount(snapshot),
      positions: system.broker.getPositions(snapshot),
      orders: system.broker.getOrders(10_000),
      auditEvents: system.store.listAudit(10_000),
      maxDailyAutoOrders: options.config.PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS,
    });
  });

  app.get("/api/integrations/supermind/signal-package", {
    schema: {
      tags: ["研究"],
      summary: "获取 SuperMind 模拟盘信号包",
      description:
        "将本地 paper 交易计划转换为同花顺 SuperMind 可人工复核的信号 CSV 和云端策略模板。不登录同花顺、不保存凭据、不自动提交订单。",
    },
  }, async () => {
    const { plan } = await buildCurrentPaperTradingPlan({
      system,
      config: options.config,
    });

    return buildSuperMindSignalPackage(plan);
  });

  app.get("/api/research/real-data-feed", {
    schema: {
      tags: ["研究"],
      summary: "获取真实只读研究数据流",
      description:
        "从 AkShare 桥接读取真实新闻和全球市场指数，并生成 A 股影响摘要。该接口只读，不包含账户或订单能力。",
      querystring: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["full", "news"] },
          newsLimit: { type: "integer", minimum: 10, maximum: 80 },
          symbolLimit: { type: "integer", minimum: 1, maximum: 8 },
        },
      },
    },
  }, async (request) => {
    const query = realDataFeedQuerySchema.parse(request.query);
    const newsOnly = query.scope === "news";
    return buildRealResearchDataFeed({
      bridgeUrl: options.config.AKSHARE_BRIDGE_URL,
      bridgeToken: options.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: system.marketDataProvider,
      mode: options.config.MARKET_MODE,
      snapshot: system.market.getSnapshot(),
      timeoutMs: newsOnly
        ? Math.min(options.config.MARKET_DATA_TIMEOUT_MS, 12_000)
        : options.config.MARKET_DATA_TIMEOUT_MS,
      newsItemLimit: query.newsLimit,
      newsSymbolLimit: query.symbolLimit,
      includeGlobalMarkets: !newsOnly,
    });
  });

  // 账户
  app.get("/api/account", {
    schema: {
      tags: ["账户"],
      summary: "获取账户快照",
      description: "返回当前账户权益、现金、持仓市值等信息",
    },
  }, async () => system.broker.getAccount());

  app.post("/api/account/reset", {
    schema: {
      tags: ["账户"],
      summary: "重置本地 paper 账户",
      description:
        "删除当前本地 paper 持仓、订单和旧审计，以指定初始资金和策略档位创建新的纯现金模拟账户。真实交易模式拒绝执行。",
    },
  }, async (request, reply) => {
    if (options.config.MARKET_MODE !== "paper" || options.config.REAL_TRADING_ENABLED) {
      return reply.status(409).send({
        error: "PAPER_MODE_REQUIRED",
        message: "账户重置只允许在本地 paper 模式执行",
      });
    }
    if (paperAutoExecutor.getStatus().running) {
      return reply.status(409).send({
        error: "PAPER_EXECUTION_RUNNING",
        message: "Paper 自动执行正在运行，请等待本轮结束后再重置账户",
      });
    }
    const body = resetPaperAccountSchema.parse(request.body);
    paperAutoExecutor.stop();
    const result = system.broker.resetAccount({
      startingCash: body.startingCash,
      strategyProfile: body.strategyProfile as PaperStrategyProfile,
    });
    paperAutoExecutor.start();
    broadcastPositions(system.market.getSnapshot());
    return reply.send(result);
  });

  app.put("/api/account/strategy-profile", {
    schema: {
      tags: ["账户"],
      summary: "切换本地 paper 策略档位",
      description:
        "只修改后续本地 paper 计划使用的风险档位，不清空当前持仓或订单，不改变硬风控。",
    },
  }, async (request, reply) => {
    if (options.config.MARKET_MODE !== "paper" || options.config.REAL_TRADING_ENABLED) {
      return reply.status(409).send({
        error: "PAPER_MODE_REQUIRED",
        message: "策略档位只允许在本地 paper 模式修改",
      });
    }
    const body = updatePaperStrategyProfileSchema.parse(request.body);
    return reply.send({
      account: system.broker.setStrategyProfile(
        body.strategyProfile as PaperStrategyProfile,
      ),
    });
  });

  app.get("/api/positions", {
    schema: {
      tags: ["账户"],
      summary: "获取持仓列表",
      description: "返回当前所有持仓及市值信息",
    },
  }, async () => system.broker.getPositions());

  // 风控
  app.get("/api/risk/limits", {
    schema: {
      tags: ["风控"],
      summary: "获取风控限额",
      description: "返回当前风控限额配置（单笔金额、仓位权重、日亏损上限等）",
    },
  }, async () => system.risk.getLimits());

  app.get("/api/risk/state", {
    schema: {
      tags: ["风控"],
      summary: "获取风控状态",
      description: "返回熔断器状态、连续亏损次数、日内回撤等信息",
    },
  }, async () => system.risk.getState());

  app.post("/api/risk/reset", {
    schema: {
      tags: ["风控"],
      summary: "重置熔断器",
      description: "手动重置熔断器状态，恢复正常交易",
      response: {
        200: {
          type: "object",
          properties: {
            circuitState: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
  }, async () => {
    system.risk.resetCircuit();
    return {
      circuitState: system.risk.getState().circuitState,
      message: "熔断器已重置",
    };
  });

  // 订单
  app.get("/api/orders", {
    schema: {
      tags: ["账户"],
      summary: "获取订单列表",
      description: "返回最近的订单记录，支持 limit 参数控制数量",
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 100, description: "返回订单数量上限" },
        },
      },
    },
  }, async (request) => {
    const { limit } = listQuerySchema.parse(request.query);
    return system.broker.getOrders(limit);
  });

  app.get("/api/audit", {
    schema: {
      tags: ["审计"],
      summary: "获取审计事件",
      description: "返回最近的交易审计事件记录",
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 100 },
        },
      },
    },
  }, async (request) => {
    const { limit } = listQuerySchema.parse(request.query);
    return system.store.listAudit(limit);
  });

  // ── 导出端点 ──────────────────────────────────────────────

  app.get("/api/audit/export", {
    schema: {
      tags: ["导出"],
      summary: "导出审计日志",
      description: "以 CSV 或 JSON 格式导出审计事件记录",
      querystring: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["csv", "json"], default: "csv" },
        },
      },
    },
  }, async (request, reply) => {
    const { format } = exportQuerySchema.parse(request.query) as { format: ExportFormat };
    const events = system.store.listAudit(10_000);

    if (format === "csv") {
      const csv = exportAuditToCsv(events);
      const bomCsv = "\uFEFF" + csv;
      return reply
        .header("Content-Type", contentType(format))
        .header(
          "Content-Disposition",
          `attachment; filename="${exportFilename("audit", format)}"`,
        )
        .send(bomCsv);
    }

    return reply
      .header("Content-Type", contentType(format))
      .header(
        "Content-Disposition",
        `attachment; filename="${exportFilename("audit", format)}"`,
      )
      .send(JSON.stringify(events, null, 2));
  });

  app.get("/api/orders/export", {
    schema: {
      tags: ["导出"],
      summary: "导出交易记录",
      description: "以 CSV 或 JSON 格式导出订单记录",
      querystring: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["csv", "json"], default: "csv" },
        },
      },
    },
  }, async (request, reply) => {
    const { format } = exportQuerySchema.parse(request.query) as { format: ExportFormat };
    const orders = system.broker.getOrders(10_000);

    if (format === "csv") {
      const csv = exportOrdersToCsv(orders);
      const bomCsv = "\uFEFF" + csv;
      return reply
        .header("Content-Type", contentType(format))
        .header(
          "Content-Disposition",
          `attachment; filename="${exportFilename("orders", format)}"`,
        )
        .send(bomCsv);
    }

    return reply
      .header("Content-Type", contentType(format))
      .header(
        "Content-Disposition",
        `attachment; filename="${exportFilename("orders", format)}"`,
      )
      .send(JSON.stringify(orders, null, 2));
  });

  // ── 系统日志端点 ──────────────────────────────────────────

  // 获取可用日志日期列表
  app.get("/api/logs/dates", {
    schema: {
      tags: ["日志"],
      summary: "获取日志日期列表",
      description: "返回所有可用的日志文件日期",
    },
  }, async () => {
    const logDir = path.resolve(process.cwd(), "logs");
    try {
      if (!fs.existsSync(logDir)) {
        return { dates: [] as string[] };
      }
      const files = fs.readdirSync(logDir);
      const dates = files
        .filter((f) => f.startsWith("app-") && f.endsWith(".log"))
        .map((f) => f.replace("app-", "").replace(".log", ""))
        .sort()
        .reverse();
      return { dates };
    } catch {
      return { dates: [] as string[] };
    }
  });

  // 获取日志内容
  app.get("/api/logs", {
    schema: {
      tags: ["日志"],
      summary: "获取系统日志",
      description: "按日期、级别和模块过滤系统日志条目，返回有界分页结果。默认每页 50 条。",
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 50, maximum: 200, description: "每页返回条数" },
          offset: { type: "integer", default: 0, minimum: 0, description: "过滤结果偏移量" },
          level: { type: "string", enum: ["debug", "info", "warn", "error"], description: "日志级别过滤" },
          module: { type: "string", description: "模块名过滤（模糊匹配）" },
          date: { type: "string", description: "日期过滤，格式 YYYY-MM-DD" },
        },
      },
    },
  }, async (request) => {
    const query = logsQuerySchema.parse(request.query);
    const today = new Date().toISOString().slice(0, 10);
    const date = query.date ?? today;
    const logDir = path.resolve(process.cwd(), "logs");
    const logFile = path.join(logDir, `app-${date}.log`);

    // 收集所有日志条目
    const entries: LogEntry[] = [];

    // 读取指定日期的日志文件
    if (fs.existsSync(logFile)) {
      try {
        const content = fs.readFileSync(logFile, "utf-8");
        const lines = content.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as LogEntry;
            entries.push(entry);
          } catch {
            // 跳过无法解析的行
          }
        }
      } catch {
        // 读取失败返回空
      }
    }

    // 如果请求的日期没有日志，也尝试读取今天的日志作为降级
    if (entries.length === 0 && date !== today) {
      const todayFile = path.join(logDir, `app-${today}.log`);
      if (fs.existsSync(todayFile)) {
        try {
          const content = fs.readFileSync(todayFile, "utf-8");
          const lines = content.split("\n").filter((line) => line.trim());
          for (const line of lines) {
            try {
              const entry = JSON.parse(line) as LogEntry;
              entries.push(entry);
            } catch {
              // 跳过
            }
          }
        } catch {
          // 忽略
        }
      }
    }

    return {
      date,
      ...queryLogEntries(entries, query),
    };
  });

  // 下单
  app.post("/api/orders", {
    schema: {
      tags: ["交易"],
      summary: "提交订单",
      description: "提交市价单或限价单到模拟交易系统",
      body: {
        type: "object",
        required: ["symbol", "side", "quantity"],
        properties: {
          symbol: { type: "string", description: "6位股票代码" },
          side: { type: "string", enum: ["buy", "sell"] },
          type: { type: "string", enum: ["market", "limit"], default: "market" },
          quantity: { type: "integer", description: "委托数量（股）" },
          limitPrice: { type: "number", description: "限价（限价单必填）" },
          clientOrderId: { type: "string", description: "客户端订单ID（可选，用于幂等）" },
        },
      },
    },
  }, async (request, reply) => {
    const orderRequest = orderRequestSchema.parse(request.body) as OrderRequest;
    const order = system.broker.submitOrder(orderRequest);
    recordOrder(orderRequest.side, order.status);
    const snapshot = system.market.getSnapshot();
    const account = system.broker.getAccount(snapshot);
    const positions = system.broker.getPositions(snapshot);

    broadcastPositions(snapshot);
    return reply.status(201).send({ order, account, positions });
  });

  // 撤单
  app.delete("/api/orders/:orderId", {
    schema: {
      tags: ["交易"],
      summary: "撤销订单",
      description: "撤销指定ID的未成交订单",
      params: {
        type: "object",
        required: ["orderId"],
        properties: {
          orderId: { type: "string", description: "订单ID" },
        },
      },
    },
  }, async (request, reply) => {
    const { orderId } = cancelParamsSchema.parse(request.params);
    try {
      const cancelled = system.broker.cancelOrder(orderId);
      recordOrderCancellation();
      const snapshot = system.market.getSnapshot();
      const account = system.broker.getAccount(snapshot);
      const positions = system.broker.getPositions(snapshot);

      broadcastPositions(snapshot);
      return reply.send({ order: cancelled, account, positions });
    } catch (cancelError) {
      return reply.status(400).send({
        error: "INVALID_REQUEST",
        message: cancelError instanceof Error ? cancelError.message : "撤单失败",
      });
    }
  });

  // 交易控制
  app.get("/api/trading/auto-paper-execution/status", {
    schema: {
      tags: ["交易"],
      summary: "获取本地 paper 自动执行状态",
      description:
        "返回 paper-only 自动执行器状态。该执行器只向本地 PaperBroker 提交模拟订单，不连接真实券商或同花顺账户。",
    },
  }, async () => paperAutoExecutor.getStatus());

  app.post("/api/trading/auto-paper-execution/run", {
    schema: {
      tags: ["交易"],
      summary: "手动触发一次本地 paper 自动执行",
      description:
        "立即读取当前纸面计划并把可执行动作提交到本地 PaperBroker。仍受 paper 模式、A 股规则、现金、仓位和风控限制约束。",
    },
  }, async () => {
    const run = await paperAutoExecutor.runOnce("manual");
    const snapshot = system.market.getSnapshot();
    broadcastPositions(snapshot);
    return {
      run,
      account: system.broker.getAccount(snapshot),
      positions: system.broker.getPositions(snapshot),
    };
  });

  app.post("/api/trading/pause", {
    schema: {
      tags: ["交易"],
      summary: "暂停交易",
      description: "暂停模拟交易撮合，新订单将排队等待",
    },
  }, async () => ({
    account: system.broker.pause(),
  }));

  app.post("/api/trading/resume", {
    schema: {
      tags: ["交易"],
      summary: "恢复交易",
      description: "恢复模拟交易撮合，处理排队订单",
    },
  }, async () => ({
    account: system.broker.resume(),
  }));

  // WebSocket
  app.get("/ws", {
    schema: {
      tags: ["行情"],
      summary: "WebSocket 实时通道",
      description: "建立 WebSocket 连接以接收实时行情、账户、持仓和订单推送",
    },
    websocket: true,
  }, (socket, request) => {
    if (authConfig && sessions) {
      const token = extractSessionToken(request);
      const originMatches = request.headers.origin === options.config.WEB_ORIGIN;
      if (!originMatches || !token || !sessions.verify(token)) {
        socket.close(1008, "UNAUTHORIZED");
        return;
      }
    }

    hub.add(socket);
    recordWebSocketConnection(1);
    hub.send(socket, {
      type: "system.status",
      data: { connected: true, message: "模拟交易实时通道已连接" },
    });
    hub.send(socket, {
      type: "market.snapshot",
      data: system.market.getSnapshot(),
    });
    hub.send(socket, {
      type: "account.snapshot",
      data: system.broker.getAccount(),
    });
    hub.send(socket, {
      type: "positions.snapshot",
      data: system.broker.getPositions(),
    });

    socket.on("close", () => {
      recordWebSocketConnection(-1);
    });
  });

  // ── Lifecycle ───────────────────────────────────────────

  app.addHook("onClose", async () => {
    sessions?.clear();
    externalMarketFeatureCapture?.stop();
    paperAutoExecutor.stop();
    system.market.stop();
  });

  if (options.startMarket !== false) {
    system.market.start();
    paperAutoExecutor.start();
    externalMarketFeatureCapture?.start();
  }

  return app;
}
