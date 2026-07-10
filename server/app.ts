import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
} from "../shared/trading";
import type { ServerConfig } from "./config";
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

  await app.register(cors, {
    origin: options.config.WEB_ORIGIN,
    methods: ["GET", "POST", "DELETE"],
  });
  await app.register(websocket);

  const broadcastPositions = (snapshot?: MarketSnapshot) => {
    hub.broadcast({
      type: "positions.snapshot",
      data: system.broker.getPositions(snapshot),
    });
  };

  system.market.on("snapshot", (snapshot: MarketSnapshot) => {
    hub.broadcast({ type: "market.snapshot", data: snapshot });
    system.broker.markToMarket(snapshot);
    broadcastPositions(snapshot);
  });
  system.broker.on("account.updated", (account: AccountSnapshot) => {
    hub.broadcast({ type: "account.snapshot", data: account });
  });
  system.broker.on("order.updated", (order: OrderRecord) => {
    hub.broadcast({ type: "order.updated", data: order });
  });

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

    if ((error as { statusCode?: number }).statusCode === 400) {
      return reply.status(400).send({
        error: "INVALID_REQUEST",
        message: error.message,
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "服务端处理请求失败",
    });
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "kairos-trading-api",
    mode: options.config.MARKET_MODE,
    realTradingEnabled: options.config.REAL_TRADING_ENABLED,
    websocketConnections: hub.connectionCount,
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/market/snapshot", async () => system.market.getSnapshot());
  app.get("/api/account", async () => system.broker.getAccount());
  app.get("/api/positions", async () => system.broker.getPositions());
  app.get("/api/risk/limits", async () => system.risk.getLimits());

  app.get("/api/orders", async (request) => {
    const { limit } = listQuerySchema.parse(request.query);
    return system.broker.getOrders(limit);
  });

  app.get("/api/audit", async (request) => {
    const { limit } = listQuerySchema.parse(request.query);
    return system.store.listAudit(limit);
  });

  app.post("/api/orders", async (request, reply) => {
    const orderRequest = orderRequestSchema.parse(request.body) as OrderRequest;
    const order = system.broker.submitOrder(orderRequest);
    const snapshot = system.market.getSnapshot();
    const account = system.broker.getAccount(snapshot);
    const positions = system.broker.getPositions(snapshot);

    broadcastPositions(snapshot);
    return reply.status(201).send({ order, account, positions });
  });

  app.delete("/api/orders/:orderId", async (request, reply) => {
    const { orderId } = cancelParamsSchema.parse(request.params);
    try {
      const cancelled = system.broker.cancelOrder(orderId);
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

  app.post("/api/trading/pause", async () => ({
    account: system.broker.pause(),
  }));

  app.post("/api/trading/resume", async () => ({
    account: system.broker.resume(),
  }));

  app.get("/ws", { websocket: true }, (socket) => {
    hub.add(socket);
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
  });

  app.addHook("onClose", async () => {
    system.market.stop();
  });

  if (options.startMarket !== false) {
    system.market.start();
  }

  return app;
}
