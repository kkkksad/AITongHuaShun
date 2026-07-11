import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { z, ZodError } from "zod";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
} from "../shared/trading";
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
import { buildStrategyLeaderboard } from "./research/strategyLeaderboard";
import { WebSocketHub } from "./realtime/webSocketHub";
import { createTradingSystem, type TradingSystem } from "./system";

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

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
});

const logsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(200),
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  module: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const strategyLeaderboardQuerySchema = z.object({
  bars: z.coerce.number().int().min(30).max(180).default(90),
});

interface BuildTradingAppOptions {
  config: ServerConfig;
  system?: TradingSystem;
  startMarket?: boolean;
}

export async function buildTradingApp(
  options: BuildTradingAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.startMarket !== false });
  const system = options.system ?? createTradingSystem(options.config);
  const hub = new WebSocketHub();

  // ── Plugins ──────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: options.config.RATE_LIMIT_MAX,
    timeWindow: options.config.RATE_LIMIT_WINDOW_MS,
  });
  await app.register(cors, {
    origin: options.config.WEB_ORIGIN,
    methods: ["GET", "POST", "DELETE"],
  });
  await app.register(websocket);

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
    (request as unknown as Record<string, unknown>).__startTime = Date.now();
  });

  app.addHook("onResponse", async (request, reply) => {
    const start = (request as unknown as Record<string, number>).__startTime;
    if (start) {
      const duration = (Date.now() - start) / 1000;
      recordHttpRequest(
        request.method,
        request.routeOptions.url ?? request.url,
        reply.statusCode,
        duration,
      );
    }
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

  system.market.on("snapshot", (snapshot: MarketSnapshot) => {
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
    websocketConnections: hub.connectionCount,
    timestamp: new Date().toISOString(),
  }));

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
    credentials: {
      browserAllowed: false,
      storage: "server-environment-only",
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
  }, async () => {
    const { computeDataQuality } = await import("./market/dataQuality");
    const snapshot = system.market.getSnapshot();

    let cacheAgeSec: number | null = null;
    if ("getLastFetchSuccessMs" in system.market) {
      const lastMs = (system.market as { getLastFetchSuccessMs(): number }).getLastFetchSuccessMs();
      if (lastMs > 0) {
        cacheAgeSec = (Date.now() - lastMs) / 1000;
      }
    }

    const requestedSymbols = options.config.MARKET_SYMBOLS
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{6}$/.test(s));

    return computeDataQuality(
      snapshot,
      system.marketDataProvider,
      requestedSymbols,
      cacheAgeSec,
    );
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
            maximum: 180,
            default: 90,
            description: "生成研究样本的 bar 数量",
          },
        },
      },
    },
  }, async (request) => {
    const { bars } = strategyLeaderboardQuerySchema.parse(request.query);
    return buildStrategyLeaderboard(
      system.market.getSnapshot(),
      system.marketDataProvider,
      bars,
    );
  });

  // 账户
  app.get("/api/account", {
    schema: {
      tags: ["账户"],
      summary: "获取账户快照",
      description: "返回当前账户权益、现金、持仓市值等信息",
    },
  }, async () => system.broker.getAccount());

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
      description: "按日期、级别和模块过滤系统日志条目。默认返回最近 200 条。",
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 200, description: "返回条数上限" },
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
    const entries: Array<{
      timestamp: string;
      level: string;
      module: string;
      message: string;
      data?: Record<string, unknown>;
      error?: string;
    }> = [];

    // 读取指定日期的日志文件
    if (fs.existsSync(logFile)) {
      try {
        const content = fs.readFileSync(logFile, "utf-8");
        const lines = content.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
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
              const entry = JSON.parse(line);
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

    // 过滤
    let filtered = entries;
    if (query.level) {
      const levelWeights: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
      const minWeight = levelWeights[query.level];
      filtered = filtered.filter((e) => (levelWeights[e.level] ?? 0) >= minWeight);
    }
    if (query.module) {
      const modLower = query.module.toLowerCase();
      filtered = filtered.filter((e) => e.module.toLowerCase().includes(modLower));
    }

    // 倒序：最新的在前
    filtered.reverse();

    // 截断
    const limited = filtered.slice(0, query.limit);

    return {
      date,
      total: entries.length,
      filtered: limited.length,
      entries: limited,
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
  }, (socket) => {
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
    system.market.stop();
  });

  if (options.startMarket !== false) {
    system.market.start();
  }

  return app;
}
